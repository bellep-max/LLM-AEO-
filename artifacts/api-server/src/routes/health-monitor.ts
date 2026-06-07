import { Router } from "express";

const AEO_LLM_URL = process.env.AEO_LLM_URL || "http://localhost:8000";

const router = Router();

/**
 * GET /health-monitor/overview
 * All businesses with current health status, flags, track scores.
 * No LLM — fast parse of both Excel files.
 */
router.get("/health-monitor/overview", async (_req, res) => {
  try {
    const upstream = await fetch(`${AEO_LLM_URL}/health-monitor/overview`, {
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
 * POST /health-monitor/analyze
 * Body: { business_name: string }
 * Full DeepSeek diagnostic + Langfuse trace for one business.
 */
router.post("/health-monitor/analyze", async (req, res) => {
  try {
    const upstream = await fetch(`${AEO_LLM_URL}/health-monitor/analyze`, {
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
