import { Router } from "express";

const AEO_LLM_URL = process.env.AEO_LLM_URL || "http://localhost:8000";

const router = Router();

/**
 * GET /daily-overview/report
 * Full daily overview: performance tiers, important changes, flags, validation.
 * No LLM — fast parse of both Excel files.
 */
router.get("/daily-overview/report", async (_req, res) => {
  try {
    const upstream = await fetch(`${AEO_LLM_URL}/daily-overview/report`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: await upstream.text() });
      return;
    }
    res.json(await upstream.json());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: `AEO LLM service unavailable: ${message}` });
  }
});

/**
 * POST /daily-overview/ideal-flow
 * Body: { business_name: string }
 * DeepSeek Ideal Flow diagnostic for a flagged business + Langfuse trace.
 */
router.post("/daily-overview/ideal-flow", async (req, res) => {
  try {
    const upstream = await fetch(`${AEO_LLM_URL}/daily-overview/ideal-flow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: await upstream.text() });
      return;
    }
    res.json(await upstream.json());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: `AEO LLM service unavailable: ${message}` });
  }
});

export default router;
