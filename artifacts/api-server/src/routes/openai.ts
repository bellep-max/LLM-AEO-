import { Router } from "express";
import { db } from "@workspace/db";
import { conversations, messages, backendLogs } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import {
  SendOpenaiMessageBody,
  SendOpenaiMessageParams,
  GetOpenaiConversationParams,
  DeleteOpenaiConversationParams,
  ListOpenaiMessagesParams,
  CreateOpenaiConversationBody,
} from "@workspace/api-zod";

const AEO_LLM_URL = process.env.AEO_LLM_URL || "http://localhost:8000";
const CHAT_MODEL = process.env.CHAT_MODEL || "deepseek-chat";

/**
 * Robustly extract and parse JSON from an LLM response.
 * Handles markdown fences, preamble text, trailing commentary, and truncated output.
 * Throws if no valid JSON object/array can be found.
 */
function extractJson(raw: string): unknown {
  // 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
  let text = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  // 2. Try the cleaned text directly first
  try { return JSON.parse(text); } catch { /* continue */ }

  // 3. Extract the outermost { ... } block (handles preamble / trailing text)
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { /* continue */ }

    // 4. Truncated JSON: try closing unclosed braces/brackets
    let fragment = objMatch[0];
    let depth = 0;
    for (const ch of fragment) {
      if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") depth--;
    }
    if (depth > 0) {
      const patched = fragment.trimEnd().replace(/,\s*$/, "") + "}".repeat(depth);
      try { return JSON.parse(patched); } catch { /* continue */ }
    }
  }

  // 5. Try an array at the top level
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch { /* continue */ }
  }

  throw new Error(`Could not extract JSON from response. First 200 chars: ${raw.slice(0, 200)}`);
}

let openai: import("openai").OpenAI | null = null;
let openAIFallback: import("openai").OpenAI | null = null;

// ── Langfuse tracing ───────────────────────────────────────────────────────────
let langfuseClient: import("langfuse").Langfuse | null = null;
let langfuseChecked = false;

async function getLangfuse(): Promise<import("langfuse").Langfuse | null> {
  if (langfuseChecked) return langfuseClient;
  langfuseChecked = true;
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return null;
  try {
    const { default: Langfuse } = await import("langfuse");
    langfuseClient = new Langfuse();
    return langfuseClient;
  } catch {
    return null;
  }
}

type TraceOpts = {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  model: string;
  messages: { role: string; content: string }[];
  responseContent: string;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined;
  startTime: number;
};

async function recordTrace(opts: TraceOpts): Promise<string | null> {
  const lf = await getLangfuse();
  if (!lf) return null;
  const trace = lf.trace({
    name: opts.name,
    input: opts.input,
    output: opts.output,
    metadata: { model: opts.model },
  });
  trace.generation({
    name: "completion",
    model: opts.model,
    input: opts.messages,
    output: opts.responseContent,
    startTime: new Date(opts.startTime),
    endTime: new Date(),
    usage: {
      promptTokens: opts.usage?.prompt_tokens,
      completionTokens: opts.usage?.completion_tokens,
      totalTokens: opts.usage?.total_tokens,
    },
  });
  lf.flushAsync().catch((e) => console.error("[langfuse] flush error", e));
  const base = process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_HOST || "https://cloud.langfuse.com";
  return `${base}/trace/${trace.id}`;
}

async function getOpenAIClient(): Promise<import("openai").OpenAI> {
  if (openai) return openai;
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error("AI_NOT_CONFIGURED");
  }
  const { openai: client } = await import("@workspace/integrations-openai-ai-server");
  openai = client as import("openai").OpenAI;
  return openai;
}

async function getFallbackClient(): Promise<import("openai").OpenAI | null> {
  const key = process.env.OPENAI_FALLBACK_API_KEY;
  if (!key) return null;
  if (openAIFallback) return openAIFallback;
  const { default: OpenAI } = await import("openai");
  openAIFallback = new OpenAI({ apiKey: key });
  return openAIFallback;
}

/**
 * Call chat completions with automatic DeepSeek → OpenAI fallback.
 * If the primary client fails for any reason, silently retries with OpenAI gpt-4o-mini.
 */
async function createCompletion(
  params: Omit<import("openai").OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "stream">
): Promise<import("openai").OpenAI.Chat.ChatCompletion & { _model_used: string }> {
  // 1. Primary (DeepSeek or configured provider)
  try {
    const client = await getOpenAIClient();
    const result = await client.chat.completions.create({ ...params, stream: false as const });
    return { ...result, _model_used: params.model };
  } catch (primaryErr) {
    const fallback = await getFallbackClient();
    if (!fallback) throw primaryErr;
    // 2. OpenAI fallback
    const fallbackModel = process.env.OPENAI_FALLBACK_MODEL || "gpt-4o-mini";
    console.warn(`[fallback] Primary LLM failed (${(primaryErr as Error).message?.slice(0, 60)}). Retrying with ${fallbackModel}.`);
    const result = await fallback.chat.completions.create({ ...params, model: fallbackModel, stream: false as const });
    return { ...result, _model_used: fallbackModel };
  }
}

type BusinessAnalysisKeyword = {
  phrase?: string;
  intent?: string;
  priority?: string;
  score?: number;
  best_prompt?: string;
  prompt_score?: number;
  prompt_tuning_type?: string;
  prompt_tuning_reason?: string;
};

type BusinessAnalysisBacklink = {
  site?: string;
  type?: string;
  reason?: string;
};

type BusinessAnalysisData = {
  business_name?: string;
  summary?: string;
  keywords?: BusinessAnalysisKeyword[];
  aeo_score?: {
    overall?: number;
    answer_first?: number;
    citability?: number;
    clarity?: number;
    structured_data?: number;
    rationale?: string;
  };
  backlinks?: BusinessAnalysisBacklink[];
  recommended_prompt?: {
    prompt?: string;
    score?: number;
    reason?: string;
  };
};

type BusinessAnalysisResponse = {
  data?: BusinessAnalysisData;
  raw?: string;
  error?: string;
  tokens_used: number;
  trace_id?: string | null;
  trace_url?: string | null;
};

const router = Router();

router.get("/openai/conversations", async (req, res) => {
  const convs = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      messageCount: sql<number>`cast(count(${messages.id}) as int)`,
    })
    .from(conversations)
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .groupBy(conversations.id)
    .orderBy(desc(conversations.createdAt));

  res.json(
    convs.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    }))
  );
});

router.post("/openai/conversations", async (req, res) => {
  const parsed = CreateOpenaiConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const [conv] = await db
    .insert(conversations)
    .values({ title: parsed.data.title })
    .returning();

  res.status(201).json({
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt.toISOString(),
    messageCount: 0,
  });
});

router.get("/openai/conversations/:id", async (req, res) => {
  const { id } = GetOpenaiConversationParams.parse(req.params);

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);

  res.json({
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt.toISOString(),
    messageCount: msgs.length,
    messages: msgs.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      tokensUsed: m.tokensUsed ?? null,
      responseTimeMs: m.responseTimeMs ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

router.delete("/openai/conversations", async (_req, res) => {
  await db.delete(conversations);
  res.status(204).end();
});

router.delete("/openai/conversations/:id", async (req, res) => {
  const { id } = DeleteOpenaiConversationParams.parse(req.params);

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  await db.delete(conversations).where(eq(conversations.id, id));
  res.status(204).end();
});

router.get("/openai/conversations/:id/messages", async (req, res) => {
  const { id } = ListOpenaiMessagesParams.parse(req.params);

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);

  res.json(
    msgs.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      tokensUsed: m.tokensUsed ?? null,
      responseTimeMs: m.responseTimeMs ?? null,
      createdAt: m.createdAt.toISOString(),
    }))
  );
});

function buildAnalysisPrompt(businessName: string, description: string): string {
  return `You are a senior AEO strategist. Analyze the following business and return ONLY a valid JSON object. No markdown. No code fences.

BUSINESS NAME: ${businessName}
BUSINESS DESCRIPTION: ${description}

Return this exact schema:
{
  "business_name": "string",
  "summary": "one sentence description",
  "keywords": [
    {
      "phrase": "string",
      "intent": "informational|commercial|navigational|transactional",
      "priority": "high|medium|low",
      "score": 85,
      "best_prompt": "exact user prompt to trigger an AI answer about this business",
      "prompt_score": 8,
      "prompt_tuning_type": "zero-shot|few-shot|chain-of-thought|role-based",
      "prompt_tuning_reason": "why this prompting style fits"
    }
  ],
  "aeo_score": {
    "overall": 0,
    "answer_first": 0,
    "citability": 0,
    "clarity": 0,
    "structured_data": 0,
    "rationale": "string"
  },
  "backlinks": [
    {
      "site": "string",
      "type": "directory|blog|wiki|industry|news|community|forum",
      "reason": "string"
    }
  ],
  "recommended_prompt": {
    "prompt": "single best high-priority prompt to target first",
    "score": 0,
    "reason": "why this prompt is the best first target"
  }
}

Rules: 10 keywords, 5 backlinks, integer scores only, AEO scores 1-10, keyword scores 1-100, prompt scores 1-10.`;
}

router.post("/openai/business-analysis", async (req, res) => {
  const businessName = typeof req.body?.businessName === "string" ? req.body.businessName.trim() : "";
  const description  = typeof req.body?.description  === "string" ? req.body.description.trim()  : "";

  if (!businessName || !description) {
    res.status(400).json({ error: "businessName and description are required" });
    return;
  }

  // 1. Try Python AEO service first (Langfuse tracing)
  try {
    const aeoRes = await fetch(`${AEO_LLM_URL}/analyze-business`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        business_name: businessName,
        description,
        text: `Business: ${businessName}\nDescription: ${description}`,
      }),
    });
    if (aeoRes.ok) {
      const raw = (await aeoRes.json()) as BusinessAnalysisResponse;
      if (!(raw as any).error && (raw as any).data) {
        res.json(raw);
        return;
      }
    }
  } catch {
    // Python service unavailable — fall through
  }

  // 2. Direct LLM fallback
  try {
    const prompt = buildAnalysisPrompt(businessName, description);
    const startTime = Date.now();

    const completion = await createCompletion({
      model: CHAT_MODEL,
      max_tokens: 3000,
      messages: [
        { role: "system", content: "You are a senior AEO strategist. Return only valid JSON, no markdown." },
        { role: "user",   content: prompt },
      ],
    });

    let data: unknown;
    try {
      data = extractJson(completion.choices[0]?.message?.content ?? "");
    } catch (parseErr) {
      res.status(502).json({ error: `LLM returned non-JSON: ${(parseErr as Error).message}` });
      return;
    }

    const traceUrl = await recordTrace({
      name: "business-analysis",
      input: { businessName, description },
      output: data,
      model: completion._model_used ?? CHAT_MODEL,
      messages: [
        { role: "system", content: "You are a senior AEO strategist. Return only valid JSON, no markdown." },
        { role: "user",   content: buildAnalysisPrompt(businessName, description) },
      ],
      responseContent: completion.choices[0]?.message?.content ?? "",
      usage: completion.usage,
      startTime,
    });

    await db.insert(backendLogs).values({
      event: "business_analysis",
      model: CHAT_MODEL,
      tokensUsed: completion.usage?.total_tokens ?? null,
      responseTimeMs: Date.now() - startTime,
      status: "success",
      details: traceUrl,
    });

    res.json({ data, tokens_used: completion.usage?.total_tokens ?? 0, trace_url: traceUrl });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Business analysis failed" });
  }
});

function buildAuditPrompt(
  businessDescription: string,
  businessSize: string,
  businessType: string,
  competitorDensity: string,
): string {
  return `You are an Answer Engine Optimization (AEO) expert. Your task is to produce a complete AEO audit and action plan for a given business. Follow the instructions exactly. Output ONLY valid JSON. Do not include any explanatory text outside the JSON.

--- USER INPUT ---
Business description: ${businessDescription}
Business size: ${businessSize}
Business type: ${businessType}
Competitor density (1-5, optional): ${competitorDensity || "(infer from type and size)"}

--- RULES AND FORMULAS ---

STEP 1 - Generate 5 AEO keywords. For each: assign Impact (1-5), Confidence (1-5), Effort (1-5). Then:
   Ease = 6 - Effort
   Weighted ICE = (wI * Impact) + (wC * Confidence) + (wE * Ease)

   Weights by business type:
   - local brick-and-mortar: wI=0.60, wC=0.25, wE=0.15
   - B2B SaaS:               wI=0.55, wC=0.30, wE=0.15
   - e-commerce:             wI=0.60, wC=0.20, wE=0.20
   - healthcare/ymyl:        wI=0.40, wC=0.50, wE=0.10
   - legal/financial:        wI=0.40, wC=0.50, wE=0.10
   - news/media:             wI=0.50, wC=0.35, wE=0.15
   - other:                  wI=0.50, wC=0.30, wE=0.20

   Priority thresholds by size:
   - small:      >=3.5 = high, >=2.5 = medium, else low
   - medium:     >=4.0 = high, >=3.0 = medium, else low
   - enterprise: >=4.25 = high, >=3.25 = medium, else low

STEP 2 - Generate 1 example AEO prompt. Score with PEEM:
   PC_avg = average of (Clarity, Linguistic Quality, Fairness) each 1-5
   RC_avg = average of (Accuracy, Coherence, Relevance, Objectivity, Clarity, Conciseness) each 1-5
   PQS = (PC_avg * 0.4) + (RC_avg * 0.6)
   meets_threshold = PQS >= minimum (local=3.5, B2B SaaS/e-commerce=4.0, healthcare/legal=4.5, other/news=3.8)

STEP 3 - Required AI searches:
   Infer Competitor Density (1-5) if not provided:
     local=3, B2B SaaS=3, e-commerce=3, healthcare/legal=3, news/media=3, other=3
   YMYL Penalty = 2 if healthcare/ymyl or legal/financial, else 1
   Local Advantage = 1 if local brick-and-mortar (assume not national), else 0
   Total Prompts = (Competitor Density * 100) + (YMYL Penalty * 30) - (Local Advantage * 20)
   Weekly Prompts = ceil(Total Prompts / 4) for small, /3 for medium, /2 for enterprise

STEP 4 - Backlink strategy (3 sources):
   BQS = (Trust Flow * 0.4) + (Topical Relevance * 0.35) + (Placement Value * 0.25)
   Sources by type: local=local news/chamber/vendor; B2B SaaS=comparison posts/G2/partners;
   e-commerce=review blogs/affiliates/best-of; healthcare=.gov/.edu/associations;
   legal=state bar/journals/.gov; news=social/aggregators/wire; other=forums/directories/guest posts

STEP 5 - Return ONLY this JSON (no extra text, no markdown):
{
  "business_type": "...",
  "business_size": "...",
  "keywords": [
    {"keyword": "...", "impact": 0, "confidence": 0, "effort": 0, "weighted_ice": 0.00, "priority": "high|medium|low"}
  ],
  "example_prompt": {
    "text": "...",
    "pqs_score": 0.00,
    "pc_avg": 0.00,
    "rc_avg": 0.00,
    "meets_threshold": true
  },
  "required_searches": {
    "total_prompts": 0,
    "weekly_prompts": 0,
    "formula_used": "show the exact calculation"
  },
  "backlink_strategy": [
    {"source_type": "...", "clickable": true, "estimated_bqs": 0.00, "reasoning": "..."}
  ],
  "disclaimer": "For YMYL industries, consult compliance before implementation."
}`;
}

router.post("/openai/business-audit", async (req, res) => {
  const businessName        = typeof req.body?.businessName        === "string" ? req.body.businessName.trim()        : "";
  const description         = typeof req.body?.description         === "string" ? req.body.description.trim()         : "";
  const businessType        = typeof req.body?.businessType        === "string" ? req.body.businessType               : "other";
  const businessSize        = typeof req.body?.businessSize        === "string" ? req.body.businessSize               : "small";
  const competitorDensity   = typeof req.body?.competitorDensity   === "string" ? req.body.competitorDensity          : "";

  if (!businessName || !description) {
    res.status(400).json({ error: "businessName and description are required" });
    return;
  }

  const businessDescription = `${businessName}: ${description}`;

  // 1. Try the Python AEO service first (gives Langfuse tracing)
  try {
    const aeoRes = await fetch(`${AEO_LLM_URL}/audit-business`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        business_description: businessDescription,
        business_size:        businessSize,
        business_type:        businessType,
        competitor_density:   competitorDensity,
      }),
    });
    if (aeoRes.ok) {
      const raw = await aeoRes.json();
      if (!(raw as any).error && (raw as any).data) {
        res.json(raw);
        return;
      }
    }
  } catch {
    // Python service unavailable — fall through to direct LLM call
  }

  // 2. Direct LLM fallback
  try {
    const prompt = buildAuditPrompt(businessDescription, businessSize, businessType, competitorDensity);
    const startTime = Date.now();

    const completion = await createCompletion({
      model: CHAT_MODEL,
      max_tokens: 3000,
      messages: [
        { role: "system", content: "You are a senior AEO strategist. Return only valid JSON, no markdown." },
        { role: "user",   content: prompt },
      ],
    });

    let data: unknown;
    try {
      data = extractJson(completion.choices[0]?.message?.content ?? "");
    } catch (parseErr) {
      res.status(502).json({ error: `LLM returned non-JSON: ${(parseErr as Error).message}` });
      return;
    }

    const traceUrl = await recordTrace({
      name: "business-audit",
      input: { businessDescription, businessSize, businessType, competitorDensity },
      output: data,
      model: completion._model_used ?? CHAT_MODEL,
      messages: [
        { role: "system", content: "You are a senior AEO strategist. Return only valid JSON, no markdown." },
        { role: "user",   content: buildAuditPrompt(businessDescription, businessSize, businessType, competitorDensity) },
      ],
      responseContent: completion.choices[0]?.message?.content ?? "",
      usage: completion.usage,
      startTime,
    });

    await db.insert(backendLogs).values({
      event: "business_audit",
      model: CHAT_MODEL,
      tokensUsed: completion.usage?.total_tokens ?? null,
      responseTimeMs: Date.now() - startTime,
      status: "success",
      details: traceUrl,
    });

    res.json({
      data,
      tokens_used: completion.usage?.total_tokens ?? 0,
      trace_url: traceUrl,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Business audit failed" });
  }
});

function buildBacklinksPrompt(
  businessType: string,
  targetKeyword: string,
  targetUrl: string,
  competitorUrls: string,
): string {
  return `You are an expert SEO strategist specialised in manual, self-created link building. You have deep knowledge of real websites, directories, profiles, and platforms where a business can create its own backlinks without outreach or negotiation. You must never invent a domain; only mention real, active websites that you are at least 98% certain exist. If you cannot verify a site's existence, exclude it.

Your task: Output a JSON object with a list of backlink opportunities that the business owner or marketer can create themselves (e.g., directory listings, social profiles, forum signatures, local citations, resource pages they can submit to, industry association memberships, etc.). Each opportunity must be achievable manually, without outreach, within a few hours.

BUSINESS TYPE: ${businessType}
TARGET KEYWORD: ${targetKeyword}
TARGET URL: ${targetUrl}
COMPETITOR URLS: ${competitorUrls || "None provided"}

Output ONLY this JSON (no text outside it):
{
  "business_type": "...",
  "target_keyword": "...",
  "target_url": "...",
  "competitors_analysed": [],
  "self_creatable_backlinks": [
    {
      "platform_name": "...",
      "platform_url": "https://...",
      "type": "local citation | social profile | business directory | niche forum profile | industry association listing | resource page submission | press release site | Q&A site | other",
      "domain_authority_estimate": 0,
      "relevance": "high | medium | low",
      "do_follow": true,
      "effort": "low (under 15 min) | medium (15-60 min) | high (1-3 hours)",
      "instructions": "Step-by-step actionable instructions for a non-technical person.",
      "competitor_insight": "Whether competitors have a backlink here, or: No direct competitor found, but this platform is widely used by similar businesses.",
      "why_this_works": "Why this backlink helps rankings for the target keyword."
    }
  ],
  "strategy_summary": "Tailored plan explaining why this mix is optimal for this business type.",
  "hallucination_self_audit": {
    "total_opportunities_generated": 0,
    "opportunities_with_verified_real_domains": 0,
    "any_platform_excluded_due_to_uncertainty": false,
    "platforms_i_am_uncertain_about": [],
    "overall_confidence_score": 0.0,
    "audit_notes": "Describe the verification process."
  }
}

RULES:
1. Only self-service platforms — no outreach, no guest posts.
2. At least 5, at most 15 opportunities. No fake sites.
3. Instructions must be actionable for a non-technical person.
4. domain_authority_estimate: realistic 0-100 score.
5. Self-audit every URL: if uncertain, move to platforms_i_am_uncertain_about.`;
}

router.post("/openai/generate-backlinks", async (req, res) => {
  const businessType   = typeof req.body?.businessType   === "string" ? req.body.businessType   : "local";
  const targetKeyword  = typeof req.body?.targetKeyword  === "string" ? req.body.targetKeyword.trim()  : "";
  const targetUrl      = typeof req.body?.targetUrl      === "string" ? req.body.targetUrl.trim()      : "";
  const competitorUrls = typeof req.body?.competitorUrls === "string" ? req.body.competitorUrls.trim() : "";

  if (!targetKeyword || !targetUrl) {
    res.status(400).json({ error: "targetKeyword and targetUrl are required" });
    return;
  }

  // 1. Try Python AEO service (has Langfuse tracing)
  try {
    const aeoRes = await fetch(`${AEO_LLM_URL}/generate-backlinks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        business_type: businessType,
        target_keyword: targetKeyword,
        target_url: targetUrl,
        competitor_urls: competitorUrls,
      }),
    });
    if (aeoRes.ok) {
      const raw = await aeoRes.json();
      if (!(raw as any).error && (raw as any).data) { res.json(raw); return; }
    }
  } catch { /* fall through */ }

  // 2. Direct LLM fallback
  try {
    const prompt = buildBacklinksPrompt(businessType, targetKeyword, targetUrl, competitorUrls);
    const startTime = Date.now();

    const completion = await createCompletion({
      model: CHAT_MODEL,
      max_tokens: 6000,
      messages: [
        { role: "system", content: "You are an expert SEO strategist. Output ONLY valid JSON. No text outside the JSON object." },
        { role: "user",   content: prompt },
      ],
    });

    let data: unknown;
    try { data = extractJson(completion.choices[0]?.message?.content ?? ""); }
    catch (parseErr) { res.status(502).json({ error: `LLM returned non-JSON: ${(parseErr as Error).message}` }); return; }

    const traceUrl = await recordTrace({
      name: "generate-backlinks",
      input: { businessType, targetKeyword, targetUrl, competitorUrls },
      output: data,
      model: completion._model_used ?? CHAT_MODEL,
      messages: [
        { role: "system", content: "You are an expert SEO strategist. Output ONLY valid JSON. No text outside the JSON object." },
        { role: "user",   content: buildBacklinksPrompt(businessType, targetKeyword, targetUrl, competitorUrls) },
      ],
      responseContent: completion.choices[0]?.message?.content ?? "",
      usage: completion.usage,
      startTime,
    });

    await db.insert(backendLogs).values({
      event: "generate_backlinks",
      model: CHAT_MODEL,
      tokensUsed: completion.usage?.total_tokens ?? null,
      responseTimeMs: Date.now() - startTime,
      status: "success",
      details: traceUrl,
    });

    res.json({ data, tokens_used: completion.usage?.total_tokens ?? 0, trace_url: traceUrl });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Backlinks generation failed" });
  }
});

function buildLinkProspectsPrompt(targetKeyword: string, targetUrl: string): string {
  return `You are a top-tier SEO strategist with a perfect memory of real websites. You must generate a list of backlink injection opportunities while rigorously verifying that every domain you mention actually exists. You must never invent a domain. If you are less than 98% certain a domain is real, you must exclude it entirely, even if that means returning fewer prospects.

TASK: For the given target keyword and target URL, produce a JSON object. Follow every instruction exactly.

Return ONLY this JSON (no text outside it):
{
  "target_keyword": "...",
  "target_url": "...",
  "prospects": [
    {
      "rank": 1,
      "website_url": "full URL of the exact page or domain",
      "injection_type": "guest post | niche edit | resource link | broken link replacement | editorial mention | expert roundup",
      "domain_authority_estimate": 0,
      "relevance_score": 0.0,
      "do_follow": true,
      "click_probability": "high | medium | low",
      "reason": "Specific explanation of why this is a top prospect, what content/page to target, and how the link fits naturally.",
      "existence_evidence": "Concrete verifiable detail about the site — known topics, audience, SEO reputation. No vague statements.",
      "content_insertion_guide": {
        "target_page_type": "Type of page to target (blog post, resource page, tools list, FAQ, etc.)",
        "suggested_anchor_text": "Exact anchor text to use",
        "insertion_context": "The exact sentence as it would appear on the host page, with the link included naturally",
        "value_to_host": "Why the host site would want this link — what value it adds to their readers"
      }
    }
  ],
  "conclusion": "Overall summary of the outreach strategy and expected SEO impact.",
  "hallucination_self_audit": {
    "total_prospects_generated": 0,
    "prospects_with_high_certainty": 0,
    "any_domain_excluded_due_to_uncertainty": false,
    "domains_i_am_uncertain_about": [],
    "overall_confidence_score": 0.0,
    "audit_notes": "Transparent explanation of your verification process and any doubts."
  }
}

CRITICAL RULES:
1. Never fabricate a URL. Fewer real prospects beat many invented ones.
2. existence_evidence must cite a concrete, verifiable fact. Vague statements are not accepted.
3. content_insertion_guide.insertion_context must be a full example sentence showing exactly where and how the link appears.
4. domain_authority_estimate must reflect actual site reputation (Forbes=90+, niche blog=40-60).
5. Strict hallucination self-audit: if any doubt about a domain, move it to domains_i_am_uncertain_about.

TARGET KEYWORD: ${targetKeyword}
TARGET URL: ${targetUrl}`;
}

router.post("/openai/generate-link-prospects", async (req, res) => {
  const targetKeyword  = typeof req.body?.targetKeyword  === "string" ? req.body.targetKeyword.trim()  : "";
  const targetUrl      = typeof req.body?.targetUrl      === "string" ? req.body.targetUrl.trim()      : "";

  if (!targetKeyword || !targetUrl) {
    res.status(400).json({ error: "targetKeyword and targetUrl are required" });
    return;
  }

  // 1. Try Python AEO service (Langfuse tracing)
  try {
    const aeoRes = await fetch(`${AEO_LLM_URL}/generate-link-prospects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ target_keyword: targetKeyword, target_url: targetUrl }),
    });
    if (aeoRes.ok) {
      const raw = await aeoRes.json();
      if (!(raw as any).error && (raw as any).data) { res.json(raw); return; }
    }
  } catch { /* fall through */ }

  // 2. Direct LLM fallback
  try {
    const prompt = buildLinkProspectsPrompt(targetKeyword, targetUrl);
    const startTime = Date.now();

    const completion = await createCompletion({
      model: CHAT_MODEL,
      max_tokens: 6000,
      messages: [
        { role: "system", content: "You are a top-tier SEO strategist. Output ONLY valid JSON. No text outside the JSON object." },
        { role: "user",   content: prompt },
      ],
    });

    let data: unknown;
    try { data = extractJson(completion.choices[0]?.message?.content ?? ""); }
    catch (parseErr) { res.status(502).json({ error: `LLM returned non-JSON: ${(parseErr as Error).message}` }); return; }

    const traceUrl = await recordTrace({
      name: "generate-link-prospects",
      input: { targetKeyword, targetUrl },
      output: data,
      model: completion._model_used ?? CHAT_MODEL,
      messages: [
        { role: "system", content: "You are a top-tier SEO strategist. Output ONLY valid JSON. No text outside the JSON object." },
        { role: "user",   content: buildLinkProspectsPrompt(targetKeyword, targetUrl) },
      ],
      responseContent: completion.choices[0]?.message?.content ?? "",
      usage: completion.usage,
      startTime,
    });

    await db.insert(backendLogs).values({
      event: "generate_link_prospects",
      model: CHAT_MODEL,
      tokensUsed: completion.usage?.total_tokens ?? null,
      responseTimeMs: Date.now() - startTime,
      status: "success",
      details: traceUrl,
    });

    res.json({ data, tokens_used: completion.usage?.total_tokens ?? 0, trace_url: traceUrl });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Link prospects generation failed" });
  }
});

router.post("/openai/generate-backlink-content", async (req, res) => {
  const platformType  = typeof req.body?.platformType  === "string" ? req.body.platformType.trim()  : "forum comment";
  const targetUrl     = typeof req.body?.targetUrl     === "string" ? req.body.targetUrl.trim()     : "";
  const topic         = typeof req.body?.topic         === "string" ? req.body.topic.trim()         : "";
  const anchorText    = typeof req.body?.anchorText    === "string" ? req.body.anchorText.trim()    : "";
  const writingStyle  = typeof req.body?.writingStyle  === "string" ? req.body.writingStyle.trim()  : "casual";

  if (!targetUrl || !topic) {
    res.status(400).json({ error: "targetUrl and topic are required" });
    return;
  }

  // 1. Try Python AEO service (Langfuse tracing)
  try {
    const aeoRes = await fetch(`${AEO_LLM_URL}/generate-backlink-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        platform_type: platformType,
        target_url: targetUrl,
        topic,
        anchor_text: anchorText,
        writing_style: writingStyle,
      }),
    });
    if (aeoRes.ok) {
      const raw = await aeoRes.json();
      if (!(raw as any).error && (raw as any).content) { res.json(raw); return; }
    }
  } catch { /* fall through */ }

  // 2. Direct LLM fallback — returns plain text, no JSON parsing needed
  try {
    const client = await getOpenAIClient();
    const anchor = anchorText || "(use a natural anchor)";
    const prompt = `You are an expert human copywriter, not an AI. Write a short, completely natural piece of content for a ${platformType} that contains one subtle backlink. The content must read as if a real person wrote it spontaneously.

PLATFORM TYPE: ${platformType}
TARGET BACKLINK URL: ${targetUrl}
ANCHOR TEXT: ${anchor}
TOPIC/CONTEXT: ${topic}
WRITING STYLE: ${writingStyle}

RULES:
- Add slight human imperfections: a filler word, casual phrase, or short personal aside.
- No marketing speak. No CTAs. The link must feel like a helpful reference, not an ad.
- Context-first: add genuine value. The link is a natural part of that value.
- Mix short and long sentences. Use contractions.
- Include one small personal aside (e.g. "I stumbled on this while looking for something else").

Output ONLY the content itself. No labels. No JSON. No explanation. Just the text.`;

    const startTime = Date.now();
    const completion = await createCompletion({
      model: CHAT_MODEL,
      max_tokens: 600,
      messages: [
        { role: "system", content: "You are a human copywriter. Output only the content itself — no labels, no JSON, no markdown." },
        { role: "user",   content: prompt },
      ],
    });

    const content = (completion.choices[0]?.message?.content ?? "").trim();

    const traceUrl = await recordTrace({
      name: "generate-backlink-content",
      input: { platformType, targetUrl, topic, anchorText, writingStyle },
      output: content,
      model: completion._model_used ?? CHAT_MODEL,
      messages: [
        { role: "system", content: "You are a human copywriter. Output only the content itself — no labels, no JSON, no markdown." },
        { role: "user",   content: `Platform: ${platformType}\nTarget URL: ${targetUrl}\nTopic: ${topic}` },
      ],
      responseContent: content,
      usage: completion.usage,
      startTime,
    });

    await db.insert(backendLogs).values({
      event: "generate_backlink_content",
      model: CHAT_MODEL,
      tokensUsed: completion.usage?.total_tokens ?? null,
      responseTimeMs: Date.now() - startTime,
      status: "success",
      details: traceUrl,
    });

    res.json({ content, tokens_used: completion.usage?.total_tokens ?? 0, trace_url: traceUrl });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Content generation failed" });
  }
});

router.post("/openai/inject-backlink-content", async (req, res) => {
  const existingContent = typeof req.body?.existingContent === "string" ? req.body.existingContent.trim() : "";
  const targetUrl       = typeof req.body?.targetUrl       === "string" ? req.body.targetUrl.trim()       : "";
  const anchorText      = typeof req.body?.anchorText      === "string" ? req.body.anchorText.trim()      : "";
  const platformType    = typeof req.body?.platformType    === "string" ? req.body.platformType.trim()    : "forum comment";

  if (!existingContent || !targetUrl) {
    res.status(400).json({ error: "existingContent and targetUrl are required" });
    return;
  }

  try {
    const client = await getOpenAIClient();
    const anchor = anchorText || targetUrl;
    const prompt = `You are an expert human copywriter. You will receive existing text content and a backlink URL. Your task is to naturally inject the backlink into the existing content so it reads as if a real person included it.

EXISTING CONTENT:
${existingContent}

URL TO INJECT: ${targetUrl}
ANCHOR TEXT: ${anchor}
PLATFORM TYPE: ${platformType}

RULES:
1. Preserve the original tone, voice, and style of the content exactly.
2. The link must feel like a natural, helpful reference — not an advertisement.
3. Weave the URL/anchor into an existing sentence where it fits naturally. Avoid adding a whole new sentence just to drop the link if possible.
4. Use the anchor text as the clickable text (e.g. "I contacted [anchor text](url)" or "the team at [anchor text] helped me").
5. Do NOT add marketing language or change the meaning of the existing text.
6. Return ONLY the modified content — no labels, no explanation, no markdown.

Output ONLY the modified content.`;

    const startTime = Date.now();
    const completion = await createCompletion({
      model: CHAT_MODEL,
      max_tokens: 800,
      messages: [
        { role: "system", content: "You are a human copywriter. Output only the modified content — no labels, no JSON, no markdown." },
        { role: "user",   content: prompt },
      ],
    });

    const content = (completion.choices[0]?.message?.content ?? "").trim();

    const traceUrl = await recordTrace({
      name: "inject-backlink-content",
      input: { platformType, targetUrl, anchorText },
      output: content,
      model: completion._model_used ?? CHAT_MODEL,
      messages: [
        { role: "system", content: "You are a human copywriter. Output only the modified content — no labels, no JSON, no markdown." },
        { role: "user",   content: `Inject URL: ${targetUrl} into existing content` },
      ],
      responseContent: content,
      usage: completion.usage,
      startTime,
    });

    await db.insert(backendLogs).values({
      event: "inject_backlink_content",
      model: CHAT_MODEL,
      tokensUsed: completion.usage?.total_tokens ?? null,
      responseTimeMs: Date.now() - startTime,
      status: "success",
      details: traceUrl,
    });

    res.json({ content, tokens_used: completion.usage?.total_tokens ?? 0, trace_url: traceUrl });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Backlink injection failed" });
  }
});

router.post("/openai/conversations/:id/messages", async (req, res) => {
  const { id } = SendOpenaiMessageParams.parse(req.params);
  const parsed = SendOpenaiMessageBody.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const existingMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);

  await db.insert(messages).values({
    conversationId: id,
    role: "user",
    content: parsed.data.content,
  });

  const chatMessages = [
    {
      role: "system" as const,
      content:
        "You are a helpful AI assistant for AEO (Answer Engine Optimization). Help users optimize their content for AI answer engines like ChatGPT, Perplexity, and similar platforms. Provide clear, structured, actionable advice.",
    },
    ...existingMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: parsed.data.content },
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const startTime = Date.now();
  let fullResponse = "";
  let totalTokens = 0;
  let logStatus = "success";
  let logDetails: string | null = null;

  let client;
  try {
    client = await getOpenAIClient();
  } catch {
    res.write(`data: ${JSON.stringify({ error: "AI integration not configured. Set AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY in your .env file." })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  }

  try {
    const stream = await client.chat.completions.create({
      model: CHAT_MODEL,
      max_tokens: 8192,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
      if (chunk.usage) {
        totalTokens = chunk.usage.total_tokens;
      }
    }
  } catch (err) {
    logStatus = "error";
    logDetails = err instanceof Error ? err.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ error: logDetails })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  }

  const responseTimeMs = Date.now() - startTime;

  const chatTraceUrl = await recordTrace({
    name: "chat-completion",
    input: { conversationId: id, userMessage: parsed.data.content },
    output: fullResponse,
    model: CHAT_MODEL,
    messages: chatMessages,
    responseContent: fullResponse,
    usage: totalTokens ? { total_tokens: totalTokens } : null,
    startTime,
  });

  await db.insert(messages).values({
    conversationId: id,
    role: "assistant",
    content: fullResponse,
    tokensUsed: totalTokens || null,
    responseTimeMs,
  });

  await db.insert(backendLogs).values({
    event: "chat_completion",
    model: CHAT_MODEL,
    conversationId: id,
    tokensUsed: totalTokens || null,
    responseTimeMs,
    status: logStatus,
    details: chatTraceUrl ?? logDetails,
  });

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

export default router;
