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
    langfuseClient = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_HOST || process.env.LANGFUSE_BASEURL || "https://us.cloud.langfuse.com",
    });
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
  await lf.flushAsync();
  const base = process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_HOST || process.env.LANGFUSE_BASEURL || "https://us.cloud.langfuse.com";
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

// ── Website content fetcher ───────────────────────────────────────────────────

type FetchedSite = {
  ssl: boolean;
  meta_title?: string;
  meta_description?: string;
  h1s: string[];
  word_count: number;
  has_mobile_viewport: boolean;
  body_excerpt: string;
  fetch_success: boolean;
  fetch_error?: string;
};

async function fetchWebsiteContent(url: string): Promise<FetchedSite> {
  const ssl = url.startsWith("https://");
  const empty: FetchedSite = { ssl, h1s: [], word_count: 0, has_mobile_viewport: false, body_excerpt: "", fetch_success: false };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AEOAuditBot/1.0)", Accept: "text/html" },
    });
    clearTimeout(t);
    if (!res.ok) return { ...empty, fetch_error: `HTTP ${res.status}` };

    const html = await res.text();

    const titleMatch  = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const meta_title  = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : undefined;

    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i)
                       ?? html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["']/i);
    const meta_description = metaDescMatch ? metaDescMatch[1].trim() : undefined;

    const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
    const h1s = h1Matches.map(m => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean).slice(0, 5);

    const has_mobile_viewport = /<meta[^>]*name=["']viewport["']/i.test(html);

    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const word_count  = stripped.split(/\s+/).filter(Boolean).length;
    const body_excerpt = stripped.slice(0, 2000);

    return { ssl, meta_title, meta_description, h1s, word_count, has_mobile_viewport, body_excerpt, fetch_success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...empty, fetch_error: msg.includes("abort") ? "Timeout (7 s)" : msg.slice(0, 120) };
  }
}

// ── Audit prompt (v2) ─────────────────────────────────────────────────────────

function buildAuditPrompt(
  businessDescription: string,
  businessSize: string,
  businessType: string,
  competitorCount: string,
  websiteUrl?: string,
  location?: string,
  site?: FetchedSite,
): string {
  const hasWebsite  = !!websiteUrl;
  const hasLocation = !!location;

  // ── Local Advantage rule (v2 spec) ────────────────────────────────────────
  const isLocalService = /local service|local brick|plumb|electr|hvac|landscap|clean|repair|mechanic|salon|barber|dentist|doctor|clinic|restaurant|cafe|bakery/i.test(businessType + " " + businessDescription);
  const laRule =
    isLocalService && hasLocation ? "Local Service + Location = 1.0" :
    isLocalService && !hasLocation ? "Local Service + No Location = 0.2" :
    !isLocalService && hasLocation ? "Non-Local + Location = 0.5" :
    "Non-Local + No Location = 0";
  const laValue =
    isLocalService && hasLocation ? 1.0 :
    isLocalService && !hasLocation ? 0.2 :
    !isLocalService && hasLocation ? 0.5 : 0;

  // ── Website Quality Modifier context (from server-side fetch) ─────────────
  let siteContext = "";
  let wqmContext  = "";
  if (hasWebsite) {
    if (site?.fetch_success) {
      const wqmLines: string[] = [];
      if (site.ssl)                wqmLines.push("SSL/HTTPS active → +1 to Confidence on all keywords");
      if (site.has_mobile_viewport) wqmLines.push("Mobile viewport tag found → +0.5 Ease on all keywords");
      if (site.word_count > 800)   wqmLines.push(`Content depth ${site.word_count} words → +0.3 PC_avg`);
      else if (site.word_count < 300) wqmLines.push(`Thin content ${site.word_count} words → -0.5 PC_avg`);
      wqmContext = wqmLines.join("\n   ");

      siteContext = `
--- FETCHED WEBSITE CONTENT (real data — use this for CCS and WQM) ---
URL: ${websiteUrl}
SSL: ${site.ssl ? "yes" : "no"}
Mobile viewport: ${site.has_mobile_viewport ? "yes" : "no"}
Estimated word count: ${site.word_count}
Meta title: ${site.meta_title ?? "(not found)"}
Meta description: ${site.meta_description ?? "(not found)"}
H1 tags: ${site.h1s.length ? site.h1s.join(" | ") : "(none found)"}
Page text excerpt (first 2000 chars):
${site.body_excerpt}
`;
    } else {
      siteContext = `
--- WEBSITE NOTE ---
URL provided: ${websiteUrl}
Fetch result: ${site?.fetch_error ?? "could not retrieve"} — infer content from URL and business description.
SSL: ${websiteUrl.startsWith("https://") ? "yes (HTTPS in URL)" : "no (HTTP)"}
`;
    }
  }

  const competitorNum = parseInt(competitorCount, 10) || 3;
  const isYMYL = /health|medical|finance|legal|law|insurance|pharmac/i.test(businessType + " " + businessDescription);
  const ymylPenalty = isYMYL ? 2 : 0;

  return `You are an AEO (Answer Engine Optimization) audit expert performing a full v2 audit. Apply ALL logic rules exactly. Output ONLY valid JSON with no extra text.

--- BUSINESS INPUT ---
Description: ${businessDescription}
Type: ${businessType}
Size: ${businessSize}
Competitor count: ${competitorNum}${hasLocation ? `\nLocation: ${location}` : ""}${hasWebsite ? `\nWebsite: ${websiteUrl}` : ""}
${siteContext}

--- DERIVED VARIABLES (pre-calculated — use these values exactly) ---
Local Advantage (LA): ${laValue}
Rule applied: ${laRule}
LA ease boost: ${laValue >= 0.5 ? "+0.5 to Ease for all geo-specific keywords" : "none"}
Competitor count: ${competitorNum}
YMYL penalty: ${ymylPenalty} (${isYMYL ? "YMYL business detected" : "not YMYL"})
${wqmContext ? `Website Quality Modifier (WQM) signals:\n   ${wqmContext}` : ""}

--- STEP-BY-STEP INSTRUCTIONS ---

STEP 1 — Generate 5–7 AEO keywords based on the business description${hasLocation ? ` and the location "${location}"` : ""}.
For each keyword:
  a) Assign Impact (1–5), Confidence (1–5), Ease (1–5).
  b) If LA ≥ 0.5 AND the keyword targets a specific geography → ease_adj = Ease + 0.5, else ease_adj = Ease.
${site?.fetch_success ? `  c) Check if the keyword (or a close synonym) appears in the fetched page content above. Set found_on_site = true/false.` : `  c) Set found_on_site = false (no website content available to check).`}
  d) ICE = (Impact × 0.4) + (Confidence × 0.3) + (ease_adj × 0.3). Round to 2 decimals.
  e) Priority: ICE ≥ 4.0 = high, ≥ 3.0 = medium, else low.
${hasLocation ? `  All keywords MUST include or imply "${location}" or a specific neighborhood/district within it.` : ""}

STEP 2 — Content Coverage Score (CCS).
  keywords_found = count of keywords where found_on_site = true.
  CCS = (keywords_found / total_keywords) × 100. Round to 1 decimal.

STEP 3 — PQS (Prompt Quality Score).
  Generate 1 example AEO prompt for this business${hasWebsite ? ` referencing ${websiteUrl}` : ""}.
  PC_avg_base = average of (Clarity, Linguistic Quality, Fairness) each 1–5.
  Apply WQM to PC_avg:${site?.fetch_success && site.word_count > 800 ? "\n    +0.3 (content depth > 800 words)" : ""}${site?.fetch_success && site.word_count < 300 ? "\n    -0.5 (thin content < 300 words)" : ""}${site?.fetch_success && site.ssl ? "\n    (SSL contributes to Confidence, not PC_avg)" : ""}
  pc_avg_adjusted = PC_avg_base + WQM adjustments (clamp to 1–5).
  RC_avg = average of (Accuracy, Coherence, Relevance, Objectivity, Clarity, Conciseness) each 1–5.
  PQS = (pc_avg_adjusted × 0.4) + (RC_avg × 0.6). Round to 2 decimals.
  meets_threshold: local service = 3.5, B2B SaaS/e-commerce = 4.0, healthcare/legal = 4.5, other = 3.8.

STEP 4 — Prompt Volume Target.
  base = (${competitorNum} × 100) + (${ymylPenalty} × 30) - (${laValue} × 20)
  total_prompts = base  (this is the monthly total)
  weekly_prompts = ceil(base / 4)
  Populate both fields and show the full arithmetic in formula_used.

STEP 5 — AEO Readiness Score (ARS).
  avg_ice = average ICE across all keywords (use adjusted ICE).
  normalized_ice = (avg_ice / 5) × 100
  normalized_pqs = (PQS / 5) × 100
  ARS = (CCS × 0.3) + (normalized_ice × 0.4) + (normalized_pqs × 0.2) + (${laValue} × 10)
  Round ARS to 1 decimal.
  ars_status: ARS ≥ 80 = "Green", ARS ≥ 60 = "Amber", else "Red".
  Show every step of the ARS calculation.

STEP 6 — Executive Summary.
  Write 3–4 plain-English sentences for the business owner explaining: overall AEO health (ARS + status), the most critical gap, and the top immediate action to take.

STEP 7 — Website Analysis (REQUIRED — write real sentences, do NOT copy this instruction).
  ${site?.fetch_success
    ? `You fetched the website. Analyze the actual content above.`
    : hasWebsite
      ? `No fetch succeeded. Infer from the URL "${websiteUrl}" and the business description.`
      : `No URL was provided. Infer entirely from the business description and business type.`}
  Write 3–4 plain-English sentences covering:
  a) What the website/web presence likely looks like and what content it probably has or lacks.
  b) Its AEO positioning — strong, average, or thin — with specific evidence or reasoned inference.
  c) The single most impactful AEO improvement available right now.
  Put this in website_analysis.overview in the JSON.

STEP 8 — Location & Market Overview (REQUIRED — write real sentences, do NOT copy this instruction).
  ${hasLocation
    ? `Location provided: "${location}". Analyze this specific market.`
    : `No location provided. Cover general market dynamics for this business type.`}
  Write 3–4 plain-English sentences covering:
  ${hasLocation
    ? `a) The local market in "${location}" — competition level, demand, underserved niches.\n  b) What questions people in ${location} ask AI engines about this type of business.\n  c) The single biggest local AEO opportunity being missed.`
    : `a) Typical geographic market dynamics (local vs regional vs national) for this business type.\n  b) What questions people commonly ask AI engines about this type of business.\n  c) How providing a city/location would unlock more targeted AEO opportunities.`}
  Put this in location_analysis.market_overview in the JSON.

STEP 9 — Prioritized Recommendations.
  Generate 4–6 actionable recommendations ranked by impact/effort. Each has: priority (1 = highest), action (what to do), impact ("high"/"medium"/"low"), effort ("low"/"medium"/"high"), rationale (1 sentence why).

FINAL STEP — Return ONLY this JSON (no markdown, no extra text):
{
  "executive_summary": {
    "ars": 0.0,
    "ars_status": "Green|Amber|Red",
    "ars_calculation": "",
    "summary": ""
  },
  "local_advantage": {
    "la_value": ${laValue},
    "rule_applied": "${laRule}",
    "ease_boost_applied": ${laValue >= 0.5},
    "summary": ""
  },
  "keywords": [
    {
      "keyword": "...",
      "impact": 0, "confidence": 0, "ease": 0, "ease_adj": 0.0,
      "ice": 0.00,
      "found_on_site": false,
      "priority": "high|medium|low"
    }
  ],
  "content_coverage": {
    "ccs": 0.0,
    "keywords_found": 0,
    "keywords_total": 0,
    "found_keywords": [],
    "missing_keywords": []
  },
  "website_analysis": {
    "url": "${websiteUrl ?? ""}",
    "ssl": ${site?.ssl ?? websiteUrl?.startsWith("https://") ?? false},
    "mobile_responsive": ${site?.has_mobile_viewport ?? false},
    "word_count": ${site?.word_count ?? 0},
    "meta_title": ${site?.meta_title ? `"${site.meta_title.replace(/"/g, '\\"')}"` : "null"},
    "meta_description": ${site?.meta_description ? `"${site.meta_description.replace(/"/g, '\\"').slice(0, 200)}"` : "null"},
    "h1s": ${JSON.stringify(site?.h1s ?? [])},
    "wqm_adjustments": [],
    "wqm_pc_adj": 0.0,
    "overview": ""
  },
  "pqs": {
    "pc_avg_base": 0.00,
    "pc_avg_adjusted": 0.00,
    "rc_avg": 0.00,
    "pqs_score": 0.00,
    "meets_threshold": true,
    "example_prompt": "the example AEO prompt text"
  },
  "required_searches": {
    "competitor_count": ${competitorNum},
    "ymyl_penalty": ${ymylPenalty},
    "la_value": ${laValue},
    "total_prompts": 0,
    "weekly_prompts": 0,
    "formula_used": "show each step: base = (CompetitorCount×100 + YMYL×30 - LA×20), total_prompts = base, weekly_prompts = ceil(base / 4)"
  },
  "location_analysis": {
    "location": "${location ?? ""}",
    "market_overview": "",
    "local_aeo_opportunities": [],
    "location_optimization_score": 0
  },
  "recommendations": [
    {"priority": 1, "action": "...", "impact": "high", "effort": "low", "rationale": "..."}
  ],
  "disclaimer": "Scores are inferred from business description and available site data. Verify with live analytics before making major decisions."
}`;
}

router.post("/openai/business-audit", async (req, res) => {
  const businessName        = typeof req.body?.businessName        === "string" ? req.body.businessName.trim()        : "";
  const description         = typeof req.body?.description         === "string" ? req.body.description.trim()         : "";
  const businessType        = typeof req.body?.businessType        === "string" ? req.body.businessType               : "other";
  const businessSize        = typeof req.body?.businessSize        === "string" ? req.body.businessSize               : "small";
  const competitorDensity   = typeof req.body?.competitorDensity   === "string" ? req.body.competitorDensity          : "";
  const websiteUrl          = typeof req.body?.websiteUrl          === "string" ? req.body.websiteUrl.trim()          : undefined;
  const location            = typeof req.body?.location            === "string" ? req.body.location.trim()            : undefined;

  if (!businessName || !description) {
    res.status(400).json({ error: "businessName and description are required" });
    return;
  }

  const businessDescription = `${businessName}: ${description}`;

  // 1. Fetch website content (parallel with nothing — runs before LLM call)
  let site: FetchedSite | undefined;
  if (websiteUrl) {
    site = await fetchWebsiteContent(websiteUrl);
  }

  // 2. Try the Python AEO service first (gives Langfuse tracing)
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
        website_url:          websiteUrl,
        location:             location,
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

  // 3. Direct LLM fallback (v2 prompt with fetched site content)
  try {
    const prompt = buildAuditPrompt(businessDescription, businessSize, businessType, competitorDensity, websiteUrl, location, site);
    const startTime = Date.now();

    const completion = await createCompletion({
      model: CHAT_MODEL,
      max_tokens: 4500,
      messages: [
        { role: "system", content: "You are a senior AEO strategist running a v2 audit. Apply every formula step-by-step and return only valid JSON." },
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
      input: { businessDescription, businessSize, businessType, competitorDensity, websiteUrl, location },
      output: data,
      model: completion._model_used ?? CHAT_MODEL,
      messages: [
        { role: "system", content: "You are a senior AEO strategist running a v2 audit. Apply every formula step-by-step and return only valid JSON." },
        { role: "user",   content: prompt },
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
        "You are Signal AEO Assistant, an expert in Answer Engine Optimization. Help users optimize their content to get cited by AI answer engines like ChatGPT, Perplexity, and Gemini. Provide clear, structured, and actionable advice. Always introduce yourself as Signal AEO Assistant.",
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

// ── Keyword Generator ─────────────────────────────────────────────────────────

function buildKeywordGenPrompt(city: string, population: string, businessType: string, service: string): string {
  return `You are a local SEO keyword generator. Use the following real data to avoid hallucination.

City: ${city}
City population (approx.): ${population}
Business type: ${businessType}
Core service: ${service}

GROUNDING RULES:
- Only generate keywords plausible for a city of this size. For population <100k, avoid hyper-local neighborhood terms unless confident.
- Do NOT invent search volume numbers. Estimate volume as "low/medium/high" relative to city population.
- If unsure whether a keyword is actually searched, lower the confidence score.
- Output MUST be valid JSON array only. No text outside the array.

Generate 30 long-tail keywords for a ${businessType} business offering ${service} in ${city}.
For each keyword provide:
- "keyword": exact phrase
- "intent": "informational" | "commercial" | "transactional"
- "estimated_volume": "low" | "medium" | "high"
- "confidence": 0.0 to 1.0 (1.0 = very confident real people search this)
- "neighborhood_specific": true if it uses a neighborhood/landmark name

At least 5 keywords must include neighborhood or landmark names appropriate for ${city} (flag low confidence if unsure).

Output format — ONLY this JSON array, nothing else:
[
  {"keyword": "...", "intent": "...", "estimated_volume": "...", "confidence": 0.9, "neighborhood_specific": false},
  ...
]`;
}

function buildDailyReviewPrompt(city: string, csvData: string): string {
  return `You are an SEO analyst. Below is today's ranking CSV for city: ${city}.

CSV columns: keyword, organic_rank, local_pack_present, screenshot_url

${csvData}

Tasks (use ONLY the data above, do NOT invent):
1. For each keyword, state if rank improved, declined, or stayed the same compared to yesterday (if yesterday's data not provided, say "baseline only").
2. Flag any keyword that entered or left the top 10.
3. List the 3 keywords with the largest rank improvement.
4. List the 3 keywords with the largest rank drop.
5. Flag any rank jump >20 positions as "POSSIBLE_HALLUCINATION".

Output ONLY this JSON, nothing else:
{
  "city": "${city}",
  "date": "today",
  "data_quality": "good | partial | missing",
  "improvements": [{"keyword": "...", "change": "+N"}],
  "declines": [{"keyword": "...", "change": "-N"}],
  "top10_entered": ["keyword"],
  "top10_exited": ["keyword"],
  "hallucination_flags": ["keyword: reason"],
  "summary_text": "3-4 sentence plain English summary",
  "next_action": "2 keywords to monitor tomorrow"
}`;
}

function buildWeeklyAnalysisPrompt(city: string, csvData: string): string {
  return `You are an SEO analyst reviewing 7 days of ranking data for city: ${city}.

Weekly ranking data (date, keyword, organic_rank, local_pack_present):

${csvData}

Tasks:
1. Calculate average rank per keyword over 7 days.
2. Identify 5 keywords with best average rank improvement (week over week).
3. Identify 5 keywords with worst average rank decline.
4. Detect patterns: do "near me" keywords perform better on weekends? Answer only if data supports it.
5. Flag any rank jump >20 positions in one day as "POSSIBLE_HALLUCINATION".
6. Suggest 3 new keywords to track next week.

Output ONLY this JSON, nothing else:
{
  "city": "${city}",
  "date_range": "...",
  "data_quality": "good | partial | missing",
  "top_improvers": [{"keyword": "...", "avg_rank": 0, "change": "+N"}],
  "top_decliners": [{"keyword": "...", "avg_rank": 0, "change": "-N"}],
  "patterns": "observed patterns or 'insufficient data'",
  "hallucination_flags": ["keyword: reason"],
  "new_keyword_suggestions": ["keyword1", "keyword2", "keyword3"],
  "summary_text": "3-4 sentence summary"
}`;
}

function buildMonthlyAuditPrompt(city: string, rankingsCSV: string, outcomesCSV: string): string {
  return `You are a strategic AEO consultant. Review 30 days of ranking and outcome data for city: ${city}.

Ranking data (date, keyword, organic_rank, local_pack_present):
${rankingsCSV}

Business outcomes (keyword, calls, direction_requests):
${outcomesCSV}

Tasks:
1. For each keyword calculate: average rank, rank trend, total calls, total direction requests.
2. ROI score = (calls * 10) + (direction_requests * 5). List top 10 by ROI.
3. Identify "vanity metrics": keywords in top 10 with zero outcomes.
4. Identify "hidden gems": keywords with rank >30 but >5 calls.
5. Recommend 5 keywords to stop tracking (low rank + low outcomes for 30 days).
6. Flag any keyword with rank fluctuating >20 positions multiple times as "ERRATIC_DATA".

Output ONLY this JSON, nothing else:
{
  "city": "${city}",
  "month": "...",
  "data_quality": "good | partial | missing",
  "top_roi_keywords": [{"keyword": "...", "roi_score": 0, "calls": 0, "directions": 0}],
  "vanity_keywords": ["keyword"],
  "hidden_gems": [{"keyword": "...", "rank": 0, "calls": 0}],
  "stop_tracking": ["keyword"],
  "hallucination_flags": ["keyword: reason"],
  "strategy_summary": "4-5 sentence strategic summary"
}`;
}

function buildCompetitorGapPrompt(keyword: string, city: string): string {
  return `Act as an SEO expert. Analyze the top 10 ranking pages for keyword "${keyword}" in ${city}.

Identify common content patterns (word count, headings, structure) and list 3 specific content gaps or topics that could be targeted to outperform them.

IMPORTANT: Only reference real, known content patterns. Do not invent ranking pages or domains.

Output ONLY this JSON, nothing else:
{
  "keyword": "${keyword}",
  "city": "${city}",
  "common_patterns": ["pattern1", "pattern2", "pattern3"],
  "content_gaps": [
    {"gap": "...", "rationale": "why this is missing from top results"},
    {"gap": "...", "rationale": "..."},
    {"gap": "...", "rationale": "..."}
  ],
  "recommended_topics": ["topic1", "topic2", "topic3"],
  "confidence_note": "Honest note about uncertainty — what you know vs what you're inferring"
}`;
}

router.post("/openai/keyword-generator", async (req, res) => {
  const action = typeof req.body?.action === "string" ? req.body.action : "";
  const validActions = ["keywords", "daily", "weekly", "monthly", "competitor"];
  if (!validActions.includes(action)) {
    res.status(400).json({ error: `action must be one of: ${validActions.join(", ")}` });
    return;
  }

  let prompt = "";
  let eventName = "";

  if (action === "keywords") {
    const city         = String(req.body?.city ?? "").trim();
    const population   = String(req.body?.population ?? "unknown").trim();
    const businessType = String(req.body?.businessType ?? "local business").trim();
    const service      = String(req.body?.service ?? "").trim();
    if (!city || !service) { res.status(400).json({ error: "city and service are required" }); return; }
    prompt = buildKeywordGenPrompt(city, population, businessType, service);
    eventName = "keyword_generator_keywords";
  } else if (action === "daily") {
    const city    = String(req.body?.city ?? "").trim();
    const csvData = String(req.body?.csvData ?? "").trim();
    if (!city) { res.status(400).json({ error: "city is required" }); return; }
    prompt = buildDailyReviewPrompt(city, csvData || "(no CSV data provided — return data_quality: missing)");
    eventName = "keyword_generator_daily";
  } else if (action === "weekly") {
    const city    = String(req.body?.city ?? "").trim();
    const csvData = String(req.body?.csvData ?? "").trim();
    if (!city) { res.status(400).json({ error: "city is required" }); return; }
    prompt = buildWeeklyAnalysisPrompt(city, csvData || "(no CSV data provided — return data_quality: missing)");
    eventName = "keyword_generator_weekly";
  } else if (action === "monthly") {
    const city         = String(req.body?.city ?? "").trim();
    const rankingsCSV  = String(req.body?.rankingsCSV ?? "").trim();
    const outcomesCSV  = String(req.body?.outcomesCSV ?? "").trim();
    if (!city) { res.status(400).json({ error: "city is required" }); return; }
    prompt = buildMonthlyAuditPrompt(
      city,
      rankingsCSV || "(no rankings CSV provided)",
      outcomesCSV || "(no outcomes CSV provided)"
    );
    eventName = "keyword_generator_monthly";
  } else if (action === "competitor") {
    const keyword = String(req.body?.keyword ?? "").trim();
    const city    = String(req.body?.city ?? "").trim();
    if (!keyword || !city) { res.status(400).json({ error: "keyword and city are required" }); return; }
    prompt = buildCompetitorGapPrompt(keyword, city);
    eventName = "keyword_generator_competitor";
  }

  try {
    const startTime = Date.now();
    const completion = await createCompletion({
      model: CHAT_MODEL,
      max_tokens: 4000,
      temperature: 0.3,
      messages: [
        { role: "system", content: "You are an SEO analyst. Output ONLY valid JSON — no markdown, no code fences, no text outside the JSON." },
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
      name: eventName,
      input: req.body,
      output: data,
      model: completion._model_used ?? CHAT_MODEL,
      messages: [
        { role: "system", content: "You are an SEO analyst. Output ONLY valid JSON." },
        { role: "user",   content: prompt },
      ],
      responseContent: completion.choices[0]?.message?.content ?? "",
      usage: completion.usage,
      startTime,
    });

    await db.insert(backendLogs).values({
      event: eventName,
      model: CHAT_MODEL,
      tokensUsed: completion.usage?.total_tokens ?? null,
      responseTimeMs: Date.now() - startTime,
      status: "success",
      details: traceUrl,
    });

    res.json({ data, tokens_used: completion.usage?.total_tokens ?? 0, trace_url: traceUrl });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Keyword generator failed" });
  }
});

// ── AEO Keyword Strategy ──────────────────────────────────────────────────────

function buildAEOKeywordStrategyPrompt(cities: string[], categories: string[]): string {
  const totalSets = cities.length * categories.length;
  const kwPerType = totalSets <= 9 ? 5 : totalSets <= 30 ? 3 : 2;
  const nearMeCount = totalSets <= 9 ? 3 : 2;

  return `You are a senior AEO (Answer Engine Optimization) strategist. AEO targets AI-generated answers in ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini — NOT traditional Google blue links.

Cities: ${cities.join(", ")}
Business categories: ${categories.join(", ")}

TASK: Generate a complete AEO keyword strategy. Return ONLY valid JSON, no markdown.

For each city produce:
- City profile with 6–8 local target areas (neighborhoods, boroughs, districts, ZIP zones)
- For EACH category × city combination: ${kwPerType} big-city keywords, ${kwPerType} local (neighborhood) keywords, ${nearMeCount} "near me" keywords
- Each keyword needs: keyword text, location, volume (High/Medium/Low), competition (Very High/High/Medium/Low), intent (Transactional/Commercial/Informational), conversion (High/Medium/Low), aeo_angle (1 sentence on how it gets into AI answers), explanation (1 sentence strategic rationale)
- A strategic explanation section covering big city rationale, local rationale, combined approach, content strategy, and 5 AEO-specific tips

AEO keyword rules:
- Big city: "[Service] [City]" — e.g. "emergency plumber New York"
- Local: "[Service] [Neighborhood]" — e.g. "plumber Upper East Side"
- Near me: "[Service] near me" variants — highest intent, triggers AI local results
- Phrase keywords as what a person would TYPE or SPEAK into an AI engine
- "aeo_angle" explains HOW this keyword gets the business into an AI-generated answer

Return this JSON structure exactly:
{
  "cities": [
    {
      "name": "",
      "population": "",
      "metro_population": "",
      "aeo_potential": "Very High|High|Medium",
      "classification": "",
      "key_industries": [],
      "local_areas": [
        { "name": "", "population": "", "zip_codes": [], "why_target": "" }
      ]
    }
  ],
  "keywords": [
    {
      "category": "",
      "city": "",
      "items": [
        {
          "type": "big_city|local|near_me",
          "keyword": "",
          "location": "",
          "volume": "",
          "competition": "",
          "intent": "",
          "conversion": "",
          "aeo_angle": "",
          "explanation": ""
        }
      ]
    }
  ],
  "strategy": {
    "big_city_rationale": "",
    "local_rationale": "",
    "combined_approach": "",
    "content_strategy": "",
    "aeo_tips": []
  }
}`;
}

router.post("/openai/aeo-keyword-strategy", async (req, res) => {
  const cities: string[] = Array.isArray(req.body?.cities) && req.body.cities.length > 0
    ? (req.body.cities as string[]).slice(0, 10)
    : ["New York", "Los Angeles", "Chicago"];
  const categories: string[] = Array.isArray(req.body?.categories) && req.body.categories.length > 0
    ? (req.body.categories as string[]).slice(0, 10)
    : ["Home Services"];

  try {
    const prompt = buildAEOKeywordStrategyPrompt(cities, categories);
    const startTime = Date.now();

    const completion = await createCompletion({
      model: CHAT_MODEL,
      max_tokens: 8000,
      messages: [
        { role: "system", content: "You are a senior AEO strategist. AEO = Answer Engine Optimization for AI search (ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini). Return ONLY valid JSON." },
        { role: "user",   content: prompt },
      ],
    });

    let data: unknown;
    try {
      data = extractJson(completion.choices[0]?.message?.content ?? "");
    } catch {
      res.status(502).json({ error: "LLM returned non-JSON response" });
      return;
    }

    const traceUrl = await recordTrace({
      name: "aeo-keyword-strategy",
      input: { cities, categories },
      output: data,
      model: completion._model_used ?? CHAT_MODEL,
      messages: [
        { role: "system", content: "AEO keyword strategy generator" },
        { role: "user",   content: prompt },
      ],
      responseContent: completion.choices[0]?.message?.content ?? "",
      usage: completion.usage,
      startTime,
    });

    await db.insert(backendLogs).values({
      event: "aeo-keyword-strategy",
      model: CHAT_MODEL,
      tokensUsed: completion.usage?.total_tokens ?? null,
      responseTimeMs: Date.now() - startTime,
      status: "success",
      details: traceUrl,
    });

    res.json({ ...(data as object), tokens_used: completion.usage?.total_tokens ?? 0, trace_url: traceUrl });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "AEO keyword strategy failed" });
  }
});

// ── AEO Strategy Chat ─────────────────────────────────────────────────────────

router.post("/openai/aeo-strategy-chat", async (req, res) => {
  const msgs: { role: string; content: string }[] = Array.isArray(req.body?.messages)
    ? req.body.messages.slice(-12)
    : [];
  const cities: string[]     = Array.isArray(req.body?.cities)     ? req.body.cities     : [];
  const categories: string[] = Array.isArray(req.body?.categories) ? req.body.categories : [];
  const period: string       = req.body?.period ?? "weekly";

  const periodGuide =
    period === "daily"
      ? `Daily focus: prioritise "near me" keywords and urgent-intent queries that need daily content freshness. Recommend what to post TODAY.`
      : period === "monthly"
      ? `Monthly focus: big city authority pages — one comprehensive, 1000+ word service page per selected city per month. Long-term brand building.`
      : `Weekly focus: local neighbourhood keywords — publish 1–2 neighbourhood landing pages per week, one per city in rotation.`;

  const systemPrompt = `You are an expert AEO (Answer Engine Optimization) strategist embedded in the Signal AEO Platform. You help users build and execute keyword strategies that get cited in AI answer engines: ChatGPT, Perplexity, Google AI Overviews, Claude, and Gemini.

USER CONFIGURATION:
- Target Cities: ${cities.length ? cities.join(", ") : "Not selected yet"}
- Business Categories: ${categories.length ? categories.join(", ") : "Not selected yet"}
- Content Schedule: ${period.charAt(0).toUpperCase() + period.slice(1)}

${periodGuide}

CRITICAL RULE — NON-COMPETING CITIES:
Each city must have UNIQUE keyword angles so campaigns complement, not compete with each other. If NYC targets "plumber near Central Park", LA targets "plumber near Hollywood", Chicago targets "plumber near Wrigley Field". Never let two cities share the same landmark or hyperlocal signal.

KEYWORD TIER LOGIC (for scheduling advice):
- Daily  → "Near Me" keywords (highest intent, needs daily content freshness + GBP updates)
- Weekly → Local neighbourhood keywords (1–2 pages/week, low competition, highest conversion)
- Monthly → Big city authority keywords (1 comprehensive page/month, long-term brand signal)

AEO PRINCIPLES to always apply:
- Write the answer first — direct answer in the first sentence
- NAP consistency across every platform (Name, Address, Phone must match exactly)
- LocalBusiness schema markup is mandatory
- Reviews mentioning specific neighbourhoods are the highest-value AEO signal
- Hyper-local specificity always beats generic city-wide content

Keep answers concise and directly actionable. When you reference keywords, tie them to the user's actual selected cities. When giving scheduling advice, use the selected period as the primary lens.`;

  try {
    const startTime = Date.now();
    const completion = await createCompletion({
      model: CHAT_MODEL,
      max_tokens: 2000,
      messages: [
        { role: "system" as const, content: systemPrompt },
        ...msgs.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";

    const traceUrl = await recordTrace({
      name: "aeo-strategy-chat",
      input: { cities, categories, period, last_message: msgs[msgs.length - 1]?.content ?? "" },
      output: { content },
      model: completion._model_used ?? CHAT_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...msgs],
      responseContent: content,
      usage: completion.usage,
      startTime,
    });

    res.json({ content, trace_url: traceUrl });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "AEO strategy chat failed" });
  }
});

// ── AEO City Campaigns ────────────────────────────────────────────────────────

function buildCityCampaignsPrompt(cities: string[]): string {
  const cityListStr = cities.map((c, i) => `${i + 1}. **${c}**`).join("\n");
  return `## PART 1: UNDERSTANDING AEO SIGNALS

**Signal Cited AEO:** Campaigns built around keywords that trigger AI-generated answers. Examples:
- "Best [service] in [city]"
- "Top-rated [business type] near [landmark]"
- "Where to find [product/service] in [neighborhood]"

**Signal AEO (Local):** Campaigns built around hyperlocal signals:
- Neighborhood names (e.g., "Upper East Side")
- ZIP codes (e.g., "10075")
- Landmarks (e.g., "near Central Park")
- Events (e.g., "during Miami Art Week")
- Local culture (e.g., "Chicago deep dish pizza")

---

## PART 2: CAMPAIGN GENERATION RULES

1. **UNIQUENESS RULE:** Every city campaign must be DIFFERENT. Do NOT use the same keyword formulas for all cities.
2. **LOCAL SIGNAL RULE:** For each city, identify 5-10 unique "signals" that make it special. Build campaigns around these signals.
3. **NO COMPETITION RULE:** Ensure that keywords for City A do NOT overlap with City B.
4. **AI-OPTIMIZATION RULE:** All campaigns must be optimized for AI search. Use natural language, questions, and complete sentences.
5. **BUSINESS CATEGORIES:** Cover all business types (plumbers, dentists, restaurants, real estate, lawyers, etc.) but assign them strategically to cities based on demand.

---

## PART 3: CAMPAIGN STRUCTURE

For each city, generate:

### Campaign Name: [City] AEO Campaign

**Unique City Signals:** (List 5-10 unique signals — landmarks, culture, industries, events)

**Campaign Strategy:**
- Explain why these signals matter for AEO
- How AI search will pick up these signals
- Why this campaign will NOT compete with other cities

**Keyword Clusters (10+ per city):**
Organize into 3 clusters:
1. **Signal-Cited Keywords** (using landmark/event signals)
2. **Service-Based Keywords** (using city + service)
3. **Hyperlocal Keywords** (using neighborhoods/ZIPs)

Format as a markdown table with columns: Cluster | Keyword | Why This Works for AEO

**Content Plan for [City]:**
1. City Main Page
2. Service Pages (3-5 with localized content)
3. Neighborhood Pages (3-5 with unique content)
4. Blog Posts (5 ideas using local signals)
5. AI-Optimized FAQs (5 questions AI search will answer)

**Competition Analysis for [City]:**
- Top 3 competitors and what keywords they rank for
- The gap/opportunity

**Conversion Strategy for [City]:**
- Which keywords have highest intent
- Which signals drive most conversions
- Recommended CTA — formatted as a markdown table

---

## PART 4: CITIES TO GENERATE CAMPAIGNS FOR

Generate complete campaigns for EACH of these cities:

${cityListStr}

---

## PART 5: COMPETITION PREVENTION MATRIX

After all city campaigns, output a **Competition Prevention Matrix** table showing unique signal keywords per city and generic keywords to avoid.

## PART 6: FINAL DELIVERABLES

After the matrix, output:
1. **Keyword Master List** — All unique keywords for all cities organized by city (markdown table)
2. **Content Calendar** — Suggested weekly/monthly publishing schedule
3. **Citelogic Data Plan** — Which keywords to prioritize for AI citation testing, with folder mapping

---

Use rich markdown formatting throughout: headers (##, ###), bold, tables, bullet lists. Make it thorough, detailed, and actionable. Each city campaign should be COMPLETE and UNIQUE.`;
}

router.post("/openai/aeo-city-campaigns", async (req, res) => {
  const cities: string[] = Array.isArray(req.body?.cities) && req.body.cities.length > 0
    ? (req.body.cities as string[]).slice(0, 25)
    : ["New York", "Los Angeles", "Chicago", "Miami", "Houston"];

  try {
    const prompt = buildCityCampaignsPrompt(cities);
    const startTime = Date.now();

    const completion = await createCompletion({
      model: CHAT_MODEL,
      max_tokens: 12000,
      messages: [
        {
          role: "system",
          content: "You are a Local Marketing Strategist specializing in Answer Engine Optimization (AEO) for AI-driven search platforms including ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini, and Bing Copilot. Generate detailed, unique, city-specific AEO campaigns in rich markdown format. Each campaign must be distinct and non-competing. Do not return JSON — return well-formatted markdown text.",
        },
        { role: "user", content: prompt },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";

    const traceUrl = await recordTrace({
      name: "aeo-city-campaigns",
      input: { cities },
      output: { content_length: content.length },
      model: completion._model_used ?? CHAT_MODEL,
      messages: [
        { role: "system", content: "AEO city campaigns generator" },
        { role: "user",   content: prompt },
      ],
      responseContent: content,
      usage: completion.usage,
      startTime,
    });

    await db.insert(backendLogs).values({
      event: "aeo-city-campaigns",
      model: CHAT_MODEL,
      tokensUsed: completion.usage?.total_tokens ?? null,
      responseTimeMs: Date.now() - startTime,
      status: "success",
      details: traceUrl,
    });

    res.json({ content, tokens_used: completion.usage?.total_tokens ?? 0, trace_url: traceUrl });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "AEO city campaigns failed" });
  }
});

export default router;
