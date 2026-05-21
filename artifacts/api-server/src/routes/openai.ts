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
let openai: import("openai").OpenAI | null = null;

async function getOpenAIClient(): Promise<import("openai").OpenAI> {
  if (openai) return openai;
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error("AI_NOT_CONFIGURED");
  }
  const { openai: client } = await import("@workspace/integrations-openai-ai-server");
  openai = client;
  return openai;
}

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

  const messageCount = msgs.length;

  res.json({
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt.toISOString(),
    messageCount,
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
    res.write(`data: ${JSON.stringify({ error: "AI integration not configured. Please verify your phone number on Replit to enable AI features." })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  }

  try {
    const stream = await client.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 8192,
      messages: chatMessages,
      stream: true,
      stream_options: { include_usage: true },
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

  await db.insert(messages).values({
    conversationId: id,
    role: "assistant",
    content: fullResponse,
    tokensUsed: totalTokens || null,
    responseTimeMs,
  });

  await db.insert(backendLogs).values({
    event: "chat_completion",
    model: "gpt-5.4",
    conversationId: id,
    tokensUsed: totalTokens || null,
    responseTimeMs,
    status: logStatus,
    details: logDetails,
  });

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

export default router;
