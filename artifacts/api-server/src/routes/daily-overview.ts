import { Router } from "express";
import { isFreeTrial, filterOutFreeTrials } from "../lib/free-trial-businesses";

const AEO_LLM_URL = process.env.AEO_LLM_URL || "http://localhost:8000";

const router = Router();

/**
 * GET /daily-overview/report
 * Full daily overview: performance tiers, important changes, flags, validation.
 * Free-trial businesses are stripped from the response.
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
    const data = await upstream.json() as Record<string, unknown>;

    // Strip free-trial businesses from any array field in the response
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        filtered[key] = filterOutFreeTrials(value as Record<string, unknown>[]);
      } else {
        filtered[key] = value;
      }
    }
    res.json(filtered);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: `AEO LLM service unavailable: ${message}` });
  }
});

/**
 * POST /daily-overview/ideal-flow
 * Body: { business_name: string }
 * DeepSeek Ideal Flow diagnostic for a flagged business + Langfuse trace.
 * Blocked for free-trial businesses.
 */
router.post("/daily-overview/ideal-flow", async (req, res) => {
  const businessName = String(req.body?.business_name ?? "").trim();
  if (businessName && isFreeTrial(businessName)) {
    res.status(403).json({ error: "Daily Session analysis is not available for free-trial accounts." });
    return;
  }

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
