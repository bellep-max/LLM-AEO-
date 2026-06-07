import { Router } from "express";

const AEO_LLM_URL = process.env.AEO_LLM_URL || "http://localhost:8000";

const router = Router();

/**
 * GET /rankings/businesses
 * Returns all businesses in the rankings Excel with per-platform NRS summary.
 * Fast — no LLM call.
 */
router.get("/rankings/businesses", async (_req, res) => {
  try {
    const upstream = await fetch(`${AEO_LLM_URL}/rankings/businesses`);
    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).json({ error: text });
      return;
    }
    res.json(await upstream.json());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: `AEO LLM service unavailable: ${message}` });
  }
});

/**
 * POST /rankings/analyze
 * Body: { business_name: string }
 * Runs Claude analysis + Langfuse trace for one business. Returns events
 * timeline, LLM narrative, and trace_url.
 */
router.post("/rankings/analyze", async (req, res) => {
  try {
    const upstream = await fetch(`${AEO_LLM_URL}/rankings/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).json({ error: text });
      return;
    }
    res.json(await upstream.json());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: `AEO LLM service unavailable: ${message}` });
  }
});

export default router;
