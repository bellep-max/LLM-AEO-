import { Router } from "express";
import { db } from "@workspace/db";
import { backendLogs } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

router.get("/backend-logs", async (_req, res) => {
  const logs = await db
    .select()
    .from(backendLogs)
    .orderBy(desc(backendLogs.timestamp))
    .limit(100);

  res.json(
    logs.map((l) => ({
      id: l.id,
      timestamp: l.timestamp.toISOString(),
      event: l.event,
      model: l.model,
      conversationId: l.conversationId ?? null,
      tokensUsed: l.tokensUsed ?? null,
      responseTimeMs: l.responseTimeMs ?? null,
      status: l.status,
      details: l.details ?? null,
    }))
  );
});

export default router;
