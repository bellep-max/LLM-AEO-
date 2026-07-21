import { Router } from "express";
import {
  getCampaignAllocations,
  getCampaignAllocation,
  setCampaignTarget,
  clearCampaignTarget,
  type CampaignAllocationStatus,
} from "../lib/platform-allocation.js";

const router = Router();

function isValidDate(d: unknown): d is string {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/**
 * GET /platform-allocation?date=YYYY-MM-DD
 * All campaigns' actual-vs-target platform allocation for the given day (defaults to the
 * latest date with any session data). Includes a portfolio-wide status summary.
 */
router.get("/platform-allocation", (req, res) => {
  try {
    const dateParam = req.query["date"];
    const date = isValidDate(dateParam) ? dateParam : undefined;
    const { asOfDate, campaigns } = getCampaignAllocations(date);

    const summary: Record<CampaignAllocationStatus, number> & { platformGap: number; excess: number } = {
      COMPLETE: 0, DEVIATION: 0, PARTIAL: 0, MISSED: 0, platformGap: 0, excess: 0,
    };
    for (const c of campaigns) {
      summary[c.today.status]++;
      if (c.platformGaps.length > 0) summary.platformGap++;
      if ([c.today.chatgpt, c.today.gemini, c.today.perplexity].some((p) => p.status === "EXCESS")) summary.excess++;
    }

    res.json({ asOfDate, campaigns, total: campaigns.length, summary });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** GET /platform-allocation/:campaignId?date=YYYY-MM-DD — single campaign, with 14-day history */
router.get("/platform-allocation/:campaignId", (req, res) => {
  try {
    const campaignId = req.params["campaignId"];
    const dateParam = req.query["date"];
    const date = isValidDate(dateParam) ? dateParam : undefined;
    const allocation = getCampaignAllocation(campaignId, date);
    if (!allocation) { res.status(404).json({ error: `No campaign found with id ${campaignId}` }); return; }
    res.json(allocation);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * PUT /platform-allocation/:campaignId
 * Body: { expectedSessions, chatgptTarget, geminiTarget, perplexityTarget }
 * Sets explicit targets for a campaign. Targets must sum to expectedSessions.
 */
router.put("/platform-allocation/:campaignId", (req, res) => {
  try {
    const campaignId = req.params["campaignId"];
    const { expectedSessions, chatgptTarget, geminiTarget, perplexityTarget } = req.body ?? {};
    if ([expectedSessions, chatgptTarget, geminiTarget, perplexityTarget].some((n) => typeof n !== "number")) {
      res.status(400).json({ error: "expectedSessions, chatgptTarget, geminiTarget, perplexityTarget must all be numbers" });
      return;
    }
    const target = setCampaignTarget(campaignId, { expectedSessions, chatgptTarget, geminiTarget, perplexityTarget });
    const allocation = getCampaignAllocation(campaignId);
    res.json({ success: true, target, allocation });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** DELETE /platform-allocation/:campaignId — clear an explicit override, revert to auto-derived targets */
router.delete("/platform-allocation/:campaignId", (req, res) => {
  try {
    const campaignId = req.params["campaignId"];
    clearCampaignTarget(campaignId);
    res.json({ success: true, allocation: getCampaignAllocation(campaignId) });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
