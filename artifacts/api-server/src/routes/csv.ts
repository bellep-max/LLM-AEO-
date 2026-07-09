import { Router } from "express";
import { db } from "@workspace/db";
import { backendLogs } from "@workspace/db";
import {
  getAllRankings,
  getBusinessRanking,
  getAllDailyAnalysis,
  getDailyAnalysisForDate,
  getBusinessDailyAnalysis,
  getDailyOverview,
  getDailyOverviewForDate,
  getAsOfDate,
  getAllAEOAnalysis,
  getBusinessAEOAnalysis,
  getBacklinkActionItems,
  clearCache,
  type Prediction,
  type PerformanceTier,
  type AEOFlagType,
} from "../lib/csv-data.js";
import { isFreeTrial } from "../lib/free-trial-businesses.js";

const router = Router();

/** GET /csv/rankings/dates — distinct ranking run dates in descending order */
router.get("/csv/rankings/dates", (_req, res) => {
  try {
    const all = getAllRankings();
    const dateSet = new Set<string>();
    for (const b of all) {
      for (const kw of b.keywords) {
        for (const run of kw.runs) if (run.date) dateSet.add(run.date);
      }
    }
    const dates = [...dateSet].sort().reverse();
    res.json({ dates });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** GET /csv/rankings/businesses — joined with session prediction */
router.get("/csv/rankings/businesses", (_req, res) => {
  try {
    const sessMap = new Map(
      getAllDailyAnalysis().map((s) => [s.bizName, {
        prediction: s.prediction as Prediction,
        predictionEmoji: s.predictionEmoji,
        predictionLabel: s.predictionLabel,
        avg7DaySessions: s.avg7DaySessions,
        gapDays7: s.gapDays7,
        sessionsToday: s.sessionsToday,
        targetPerDay: s.targetPerDay,
      }])
    );

    const data = getAllRankings().map((b) => {
      const sess = sessMap.get(b.bizName);
      // Best current and previous rank per platform
      const bestRanks: Record<string, number | null> = {};
      const prevBestRanks: Record<string, number | null> = {};
      for (const p of ["ChatGPT", "Gemini", "Perplexity"]) {
        const kws = b.keywords.filter((k) => k.platform === p);
        const currKws = kws.filter((k) => k.currentRun?.position != null);
        const prevKws = kws.filter((k) => k.prevRun?.position != null);
        bestRanks[p]     = currKws.length ? Math.min(...currKws.map((k) => k.currentRun!.position!)) : null;
        prevBestRanks[p] = prevKws.length ? Math.min(...prevKws.map((k) => k.prevRun!.position!))    : null;
      }
      return {
        bizName: b.bizName, overallLabel: b.overallLabel,
        platformLabels: b.platformLabels, firstRunDate: b.firstRunDate,
        latestRunDate: b.latestRunDate, totalRuns: b.totalRuns,
        bestRanks, prevBestRanks,
        session: sess ?? null,
      };
    });
    res.json({ businesses: data, total: data.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** GET /csv/rankings/detail?business=X */
router.get("/csv/rankings/detail", (req, res) => {
  try {
    const bizName = req.query["business"] as string | undefined;
    if (!bizName) { res.status(400).json({ error: "business query param required" }); return; }
    const data = getBusinessRanking(bizName);
    if (!data) { res.status(404).json({ error: `Business not found: ${bizName}` }); return; }
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** GET /csv/sessions/overview[?date=YYYY-MM-DD] — all businesses with prediction-based KPIs, optionally as of a date */
router.get("/csv/sessions/overview", (req, res) => {
  try {
    const dateParam = req.query["date"] as string | undefined;
    const isValidDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
    const asOfDate = isValidDate ? dateParam! : getAsOfDate();
    const sessions = isValidDate ? getDailyAnalysisForDate(dateParam!) : getAllDailyAnalysis();
    const data = sessions.map((b) => ({
      bizName: b.bizName,
      clientName: b.clientName,
      campaignName: b.campaignName,
      numCampaigns: b.numCampaigns,
      targetPerDay: b.targetPerDay,
      daysActive: b.daysActive,
      totalSessions: b.totalSessions,
      firstDate: b.firstDate,
      latestDate: b.latestDate,
      phase: b.phase,
      phaseLabel: b.phaseLabel,
      sessionsToday: b.sessionsToday,
      successRateToday: b.successRateToday,
      avg7DaySessions: b.avg7DaySessions,
      avg7DaySuccessRate: b.avg7DaySuccessRate,
      gapDays7: b.gapDays7,
      missedKeywords3Plus: b.missedKeywords3Plus,
      missedKeywords5Plus: b.missedKeywords5Plus,
      platformWindows: b.platformWindows,
      prediction: b.prediction,
      predictionLabel: b.predictionLabel,
      predictionEmoji: b.predictionEmoji,
      nextRankingRunDue: b.nextRankingRunDue,
      hasRankData: b.hasRankData,
      rankDetectionRate: b.rankDetectionRate,
      avgRankPosition: b.avgRankPosition,
      improvementPriorities: b.improvementPriorities,
    }));
    res.json({ businesses: data, total: data.length, asOfDate });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** GET /csv/sessions/detail?business=X[&date=YYYY-MM-DD] — full daily analysis for one business, optionally as of a date */
router.get("/csv/sessions/detail", (req, res) => {
  try {
    const bizName = req.query["business"] as string | undefined;
    if (!bizName) { res.status(400).json({ error: "business query param required" }); return; }
    const dateParam = req.query["date"] as string | undefined;
    const isValidDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
    let data = getBusinessDailyAnalysis(bizName);
    if (!data) { res.status(404).json({ error: `Business not found: ${bizName}` }); return; }
    if (isValidDate) {
      // Recompute the single business's metrics for the requested date
      const forDate = getDailyAnalysisForDate(dateParam!).find(b => b.bizName === bizName);
      if (forDate) data = forDate;
    }
    // Serialize Sets for JSON
    const serialized = {
      ...data,
      latestDayData: data.latestDayData
        ? { ...data.latestDayData, keywords: [...data.latestDayData.keywords] }
        : null,
    };
    res.json(serialized);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** GET /csv/daily/overview[?date=YYYY-MM-DD] — combined daily overview, optionally as of a specific date */
router.get("/csv/daily/overview", (req, res) => {
  try {
    const date = req.query["date"] as string | undefined;
    const raw = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? getDailyOverviewForDate(date)
      : getDailyOverview();

    // Strip free-trial businesses from every per-business array
    const data = {
      ...raw,
      businesses:      raw.businesses.filter(b => !isFreeTrial(b.bizName)),
      atRiskBusinesses: raw.atRiskBusinesses.filter(b => !isFreeTrial(b.bizName)),
      rankAlerts:      raw.rankAlerts.filter(b => !isFreeTrial(b.bizName)),
      keywordRotationGap: raw.keywordRotationGap.filter(b => !isFreeTrial(b.bizName)),
    };

    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── AEO Performance Analysis routes ───────────────────────────────────────────

/** GET /csv/aeo/overview — all businesses with health scores, tiers, and flags */
router.get("/csv/aeo/overview", (_req, res) => {
  try {
    const all = getAllAEOAnalysis().filter(b => !isFreeTrial(b.bizName));

    // Tier counts
    const tiers: Record<PerformanceTier, number> = {
      EXCELLENT: 0, GOOD: 0, AT_RISK: 0, CRITICAL: 0,
    };
    for (const b of all) tiers[b.performanceTier]++;

    // Flagged businesses (any flag)
    const flagged = all.filter(b => b.flags.length > 0).map(b => ({
      bizName:           b.bizName,
      flags:             b.flags,
      flagLabels:        b.flagLabels,
      overallHealthScore: b.overallHealthScore,
      healthScoreDelta:  b.healthScoreDelta,
      performanceTier:   b.performanceTier,
      performanceTierLabel: b.performanceTierLabel,
      isNewBusiness:     b.isNewBusiness,
      latestDataDate:    b.latestDataDate,
    }));

    // Important changes across all businesses
    const importantChanges = all
      .filter(b => b.importantChanges.length > 0)
      .flatMap(b => b.importantChanges.map(c => ({ bizName: b.bizName, ...c })));

    // Slim business list for the overview table
    const businesses = all.map(b => ({
      bizName:              b.bizName,
      overallHealthScore:   b.overallHealthScore,
      avg4RunHealthScore:   b.avg4RunHealthScore,
      healthScoreDelta:     b.healthScoreDelta,
      performanceTier:      b.performanceTier,
      performanceTierLabel: b.performanceTierLabel,
      flags:                b.flags,
      flagLabels:           b.flagLabels,
      isNewBusiness:        b.isNewBusiness,
      latestDataDate:       b.latestDataDate,
      totalRuns:            b.totalRuns,
      platforms: b.platforms.map(p => ({
        platform:          p.platform,
        latestHealthScore: p.latestHealthScore,
        avg4RunHealthScore: p.avg4RunHealthScore,
        healthScoreDelta:  p.healthScoreDelta,
      })),
    }));

    res.json({ businesses, tiers, flagged, importantChanges, total: all.length });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** GET /csv/aeo/detail?business=X — full analysis for one business */
router.get("/csv/aeo/detail", (req, res) => {
  try {
    const bizName = req.query["business"] as string | undefined;
    if (!bizName) { res.status(400).json({ error: "business query param required" }); return; }
    const data = getBusinessAEOAnalysis(bizName);
    if (!data) { res.status(404).json({ error: `No AEO data for: ${bizName}` }); return; }
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── AEO Chatbot ───────────────────────────────────────────────────────────────

function buildAEOChatContext(businessName?: string): string {
  const baseRole = `You are an expert AEO (Answer Engine Optimization) performance analyst with deep knowledge of:
- How ChatGPT, Gemini, and Perplexity rank and recommend businesses
- Session-based signal building for AI answer engines
- Ranking volatility patterns and recovery strategies
- The AEO normalization formula: (Total - Rank) / (Total - 1) × 100

Your analysis style is direct, data-driven, and actionable. Always cite specific numbers from the data. Use markdown formatting with clear headers and bullet points.

KEY CONCEPTS:
- Health Score: Normalized ranking score (0–100) adjusted for volatility. ≥80=Excellent, 60-79=Good, 40-59=At Risk, <40=Critical
- Sessions: Daily AI engine interactions that build ranking signals across all platforms
- Bi-weekly ranking runs: Every ~14 days the system captures current positions across all platforms
- Flags: IMMEDIATE_ACTION (≥3 consecutive declining runs), NEEDS_REVIEW (≥2 declining runs), SUDDEN_KEYWORD_DROP (≥10pt health drop in one run), UNSTABLE_RANKINGS (high volatility across 3+ runs)
- Ideal Flow: Week 1 = diagnose root cause, Weeks 2–3 = fix + push session volume, Week 4 = re-measure results`;

  if (!businessName) {
    try {
      const overview        = getDailyOverview();
      const aeoAll          = getAllAEOAnalysis();
      const allRankings     = getAllRankings();
      const allDailyAnalysis = getAllDailyAnalysis();

      // ── AEO tier counts ────────────────────────────────────────────────────
      const tierCounts: Record<PerformanceTier, number> = { EXCELLENT: 0, GOOD: 0, AT_RISK: 0, CRITICAL: 0 };
      const aeoByBiz = new Map(aeoAll.map(b => [b.bizName, b]));
      for (const b of aeoAll) tierCounts[b.performanceTier]++;

      // ── Walk all keywords, build date-indexed events + full lists ──────────
      type KWEvent = { bizName: string; platform: string; keyword: string; prev: string; curr: string; spots: string; date: string };
      const dropsByDate    = new Map<string, KWEvent[]>();
      const improveByDate  = new Map<string, KWEvent[]>();
      const notFoundByDate = new Map<string, KWEvent[]>();
      const reappearedByDate = new Map<string, KWEvent[]>();
      const allDrops: KWEvent[]    = [];
      const allImprove: KWEvent[]  = [];
      const allNotFound: KWEvent[] = [];
      const allReappeared: KWEvent[] = [];

      // Per-business current labels for the status table
      const bizLabelMap = new Map<string, { platform: string; label: string; rank: string }[]>();

      for (const biz of allRankings) {
        for (const kw of biz.keywords) {
          const date = kw.currentRun?.date ?? "unknown";
          const curr = kw.currentRun?.position !== null && kw.currentRun?.position !== undefined
            ? `#${kw.currentRun.position}/${kw.currentRun.total}`
            : "NOT FOUND";
          const prev = kw.prevRun
            ? (kw.prevRun.position !== null ? `#${kw.prevRun.position}` : "NOT FOUND")
            : "BASELINE";
          const spots = kw.spotsChanged !== null
            ? ` (${kw.spotsChanged > 0 ? "+" : ""}${kw.spotsChanged} spots)`
            : "";

          const ev: KWEvent = { bizName: biz.bizName, platform: kw.platform, keyword: kw.keyword, prev, curr, spots, date };

          const push = (map: Map<string, KWEvent[]>, arr: KWEvent[]) => {
            if (!map.has(date)) map.set(date, []);
            map.get(date)!.push(ev);
            arr.push(ev);
          };

          if      (kw.label === "SUDDEN_DROP")        push(dropsByDate, allDrops);
          else if (kw.label === "NOT_FOUND_CRITICAL")  push(notFoundByDate, allNotFound);
          else if (kw.label === "SUDDEN_IMPROVEMENT")  push(improveByDate, allImprove);
          else if (kw.label === "REAPPEARED")          push(reappearedByDate, allReappeared);

          // Build per-biz label map
          if (!bizLabelMap.has(biz.bizName)) bizLabelMap.set(biz.bizName, []);
          bizLabelMap.get(biz.bizName)!.push({ platform: kw.platform, label: kw.label, rank: curr });
        }
      }

      // ── Helpers to format event lines ──────────────────────────────────────
      const fmtEv = (e: KWEvent) =>
        `  ${e.bizName} | ${e.platform} | "${e.keyword}" | ${e.prev} → ${e.curr}${e.spots}`;

      // ── Date-indexed sections (all available run dates, sorted desc) ────────
      const allDates = [...new Set([
        ...dropsByDate.keys(), ...improveByDate.keys(),
        ...notFoundByDate.keys(), ...reappearedByDate.keys(),
      ])].sort().reverse();

      const dateSection = allDates.map(date => {
        const parts: string[] = [`📅 Run Date: ${date}`];
        const drops    = dropsByDate.get(date)    ?? [];
        const impr     = improveByDate.get(date)  ?? [];
        const nf       = notFoundByDate.get(date) ?? [];
        const reapp    = reappearedByDate.get(date) ?? [];
        if (drops.length)  parts.push(`  🔴 Sudden Drops (${drops.length}):\n${drops.map(fmtEv).join("\n")}`);
        if (nf.length)     parts.push(`  🚫 Not Found / Critical (${nf.length}):\n${nf.map(fmtEv).join("\n")}`);
        if (impr.length)   parts.push(`  ✅ Sudden Improvements (${impr.length}):\n${impr.map(fmtEv).join("\n")}`);
        if (reapp.length)  parts.push(`  ✨ Reappeared (${reapp.length}):\n${reapp.map(fmtEv).join("\n")}`);
        return parts.join("\n");
      }).join("\n\n");

      // ── Historical AEO health score snapshots per run date ────────────────
      // For each business, average platform health scores per run date
      const aeoHealthByDate = new Map<string, Map<string, { avg: number; tier: string }>>();
      for (const b of aeoAll) {
        const runDateScores = new Map<string, number[]>();
        for (const p of b.platforms) {
          for (const r of p.runs) {
            if (!runDateScores.has(r.date)) runDateScores.set(r.date, []);
            runDateScores.get(r.date)!.push(r.healthScore);
          }
        }
        for (const [date, scores] of runDateScores) {
          const avg = scores.reduce((a, v) => a + v, 0) / scores.length;
          const tier = avg >= 80 ? "Excellent" : avg >= 60 ? "Good" : avg >= 40 ? "At Risk" : "Critical";
          if (!aeoHealthByDate.has(date)) aeoHealthByDate.set(date, new Map());
          aeoHealthByDate.get(date)!.set(b.bizName, { avg, tier });
        }
      }

      // ── Historical ranking positions per run date ──────────────────────────
      // For each business + run date: best rank per platform
      type RankSnap = { bizName: string; gpt: number | null; gem: number | null; perp: number | null; overallLabel: string };
      const rankPosByDate = new Map<string, Map<string, RankSnap>>();

      for (const biz of allRankings) {
        for (const kw of biz.keywords) {
          for (const run of kw.runs) {
            if (run.position === null) continue;
            if (!rankPosByDate.has(run.date)) rankPosByDate.set(run.date, new Map());
            const dateMap = rankPosByDate.get(run.date)!;
            if (!dateMap.has(biz.bizName)) {
              dateMap.set(biz.bizName, { bizName: biz.bizName, gpt: null, gem: null, perp: null, overallLabel: biz.overallLabel });
            }
            const snap = dateMap.get(biz.bizName)!;
            if (kw.platform === "ChatGPT")    { if (snap.gpt  === null || run.position < snap.gpt)  snap.gpt  = run.position; }
            if (kw.platform === "Gemini")     { if (snap.gem  === null || run.position < snap.gem)  snap.gem  = run.position; }
            if (kw.platform === "Perplexity") { if (snap.perp === null || run.position < snap.perp) snap.perp = run.position; }
          }
        }
      }

      // ── All available run dates (sorted desc) ────────────────────────────
      const allRunDates = [...new Set([
        ...aeoHealthByDate.keys(),
        ...rankPosByDate.keys(),
      ])].sort().reverse();

      // ── Build per-date health snapshot sections ──────────────────────────
      const healthSnapshotSection = allRunDates.map(date => {
        const healthMap = aeoHealthByDate.get(date);
        const rankMap   = rankPosByDate.get(date);

        // Tier counts for this date
        const tc = { Excellent: 0, Good: 0, "At Risk": 0, Critical: 0 };
        if (healthMap) for (const { tier } of healthMap.values()) tc[tier as keyof typeof tc]++;

        // Per-business lines: health score + best ranks on this date
        const bizLines = allRankings.map(biz => {
          const h   = healthMap?.get(biz.bizName);
          const r   = rankMap?.get(biz.bizName);
          const hlth = h ? `${h.avg.toFixed(1)}(${h.tier})` : "no-data";
          const rnks = r
            ? `GPT=${r.gpt ?? "—"} Gem=${r.gem ?? "—"} Perp=${r.perp ?? "—"}`
            : "no-rank-data";
          return `  ${biz.bizName}: Health=${hlth} | ${rnks}`;
        }).filter(l => !l.includes("no-data")).join("\n");

        return `📅 ${date}\n  Tiers: Excellent=${tc.Excellent} Good=${tc.Good} At-Risk=${tc["At Risk"]} Critical=${tc.Critical}\n${bizLines}`;
      }).join("\n\n");

      // ── Per-business current status table ─────────────────────────────────
      const bizStatusLines = allRankings.map(biz => {
        const aeo  = aeoByBiz.get(biz.bizName);
        const hlth = aeo ? ` | Health: ${aeo.overallHealthScore.toFixed(1)} (${aeo.performanceTierLabel})` : "";
        const flag = aeo && aeo.flags.length > 0 ? ` 🚨 ${aeo.flags[0]}` : "";
        const plat = Object.entries(biz.platformLabels).map(([p, l]) => `${p}=${l}`).join(", ");
        return `- ${biz.bizName}: Overall=${biz.overallLabel} | ${plat}${hlth}${flag} | Runs: ${biz.totalRuns} | Latest: ${biz.latestRunDate}`;
      }).join("\n");

      // ── At-risk sessions ───────────────────────────────────────────────────
      const atRiskLines = overview.atRiskBusinesses.map(b =>
        `- ${b.predictionEmoji} ${b.bizName}: Gap days (7d)=${b.gapDays7} | Success rate=${(b.avg7DaySuccessRate * 100).toFixed(0)}%\n  Why: ${b.why}\n  Action: ${b.action}${b.missedKeywords5Plus.length > 0 ? `\n  Critical missed keywords (5+ days): ${b.missedKeywords5Plus.join(", ")}` : ""}`
      ).join("\n\n");

      // ── Detailed health digest: Critical / Session Risk / Stable / Too Early ──
      const globalLatestDate = allDailyAnalysis.map(b => b.latestDate).filter(Boolean).sort().pop() ?? "";

      const criticalBizsList = overview.atRiskBusinesses.filter(b =>
        b.rankLabel === "SUDDEN_DROP" || b.rankLabel === "NOT_FOUND_CRITICAL"
      );
      const sessionRiskList = overview.atRiskBusinesses.filter(b =>
        b.rankLabel !== "SUDDEN_DROP" && b.rankLabel !== "NOT_FOUND_CRITICAL"
      );
      const stableList   = allDailyAnalysis.filter(b => b.prediction === "STABLE");
      const tooEarlyList = allDailyAnalysis.filter(b => b.prediction === "TOO_EARLY");

      const criticalDigest = criticalBizsList.map(b => {
        const details: string[] = [];
        if (b.silentPlatform) details.push(`${b.silentPlatform} silent for consecutive days`);
        if (b.missedKeywords5Plus.length) details.push(`keyword "${b.missedKeywords5Plus[0]}" not hit in 5+ days`);
        if (b.gapDays7 >= 2) details.push(`${b.gapDays7} days with zero sessions in last 7`);
        return `  🚨 CRITICAL — ${b.bizName}\n    Issue: ${details.join("; ")} + ${b.rankLabel} ranking\n    Action: ${b.action}`;
      }).join("\n\n");

      const sessionRiskDigest = sessionRiskList.map(b => {
        const details: string[] = [];
        if (b.silentPlatform) details.push(`${b.silentPlatform} silent for consecutive days`);
        if (b.missedKeywords5Plus.length) details.push(`keyword "${b.missedKeywords5Plus[0]}" not hit in 5+ days`);
        if (b.gapDays7 >= 2) details.push(`${b.gapDays7} days with zero sessions in last 7`);
        return `  ⚠️ SESSION RISK (no ranking drop yet, rank label: ${b.rankLabel}) — ${b.bizName}\n    Issue: ${details.join("; ")}\n    Action: ${b.action}`;
      }).join("\n\n");

      const stableDigest = stableList.map(b => {
        const silentPlat = b.platformWindows.find(p => p.consecutiveDaysSilent >= 3);
        const detail = silentPlat
          ? `${silentPlat.platform} silent ${silentPlat.consecutiveDaysSilent} consecutive days (borderline — watch closely)`
          : `7-day success rate ${(b.avg7DaySuccessRate * 100).toFixed(0)}%, gap days: ${b.gapDays7}`;
        return `  ➡️ STABLE (borderline): ${b.bizName} — ${detail}`;
      }).join("\n");

      const tooEarlyDigest = tooEarlyList.map(b => {
        const gapDays = globalLatestDate && b.latestDate
          ? Math.round((new Date(globalLatestDate + "T00:00:00Z").getTime() - new Date(b.latestDate + "T00:00:00Z").getTime()) / 86400000)
          : 0;
        const gapNote = gapDays >= 3
          ? `⚠️ ${gapDays}-day session gap — last session was ${b.latestDate}, needs immediate restart`
          : `last session: ${b.latestDate} (${b.daysActive} days active, ${b.totalSessions} total sessions — truly new)`;
        return `  ⏳ TOO EARLY: ${b.bizName} — ${gapNote}`;
      }).join("\n");

      const suddenDropBizCount = overview.businesses.filter(b => b.rankLabel === "SUDDEN_DROP" || b.rankLabel === "NOT_FOUND_CRITICAL").length;
      const notFoundBizCount   = overview.businesses.filter(b => b.rankLabel === "NOT_FOUND_CRITICAL").length;
      const steadyDropBizCount = overview.businesses.filter(b => b.rankLabel === "STEADY_DROP").length;
      const baselineBizCount   = overview.businesses.filter(b => b.rankLabel === "BASELINE").length;

      // ── Per-date session summaries (historical — for date-specific queries) ──
      type DayRow = { bizName: string; total: number; success: number; rate: number; platforms: Record<string, number> };
      const sessionDayMap = new Map<string, DayRow[]>();
      for (const biz of allDailyAnalysis) {
        for (const day of biz.recentDays) {
          if (!sessionDayMap.has(day.date)) sessionDayMap.set(day.date, []);
          sessionDayMap.get(day.date)!.push({
            bizName: biz.bizName,
            total: day.total,
            success: day.success,
            rate: day.successRate,
            platforms: day.platforms,
          });
        }
      }
      const sessionDates = [...sessionDayMap.keys()].sort().reverse();
      const sessionDateSection = sessionDates.map(date => {
        const rows = sessionDayMap.get(date)!;
        const totalS  = rows.reduce((a, r) => a + r.total, 0);
        const totalOk = rows.reduce((a, r) => a + r.success, 0);
        const platAgg: Record<string, number> = {};
        for (const r of rows) for (const [p, c] of Object.entries(r.platforms)) platAgg[p] = (platAgg[p] ?? 0) + c;
        const platStr = Object.entries(platAgg).sort().map(([p, c]) => `${p}=${c}`).join(", ");
        const rate = totalS > 0 ? ((totalOk / totalS) * 100).toFixed(1) : "0";
        const bizLines = rows.map(r => {
          const bp = Object.entries(r.platforms).map(([p, c]) => `${p}=${c}`).join(" ");
          return `  - ${r.bizName}: ${r.total} sessions (${(r.rate * 100).toFixed(0)}%)${bp ? ` | ${bp}` : ""}`;
        }).join("\n");
        const lowSucc = rows.filter(r => r.total > 0 && r.rate < 0.8).map(r => `${r.bizName} (${(r.rate * 100).toFixed(0)}%)`);
        const lowStr  = lowSucc.length > 0 ? `\n  ⚠️ Low success rate on this date: ${lowSucc.join(", ")}` : "";
        const noSess  = rows.filter(r => r.total === 0).map(r => r.bizName);
        const noStr   = noSess.length > 0 ? `\n  ❌ No sessions on this date: ${noSess.join(", ")}` : "";
        return `📅 SESSION DATE: ${date}\n  Active businesses: ${rows.length} | Total sessions: ${totalS} | Successful: ${totalOk} | Rate: ${rate}%\n  Platforms: ${platStr}\n${bizLines}${lowStr}${noStr}`;
      }).join("\n\n");

      return `${baseRole}

## PORTFOLIO OVERVIEW (latest data)
Data As Of: ${overview.asOfDate}
Businesses with session data: ${overview.totalBusinesses} | With rankings: ${overview.totalWithRankings}
Available run dates (newest first): ${allRunDates.join(", ")}

NOTE: When a user asks about a specific date (e.g. "June 2"), find the closest run date from the list above. Rankings are bi-weekly so there may not be an exact match — use the nearest date on or before the queried date and state which date you're referencing.

### AEO Health Score — Current Tier Distribution
- 🟢 Excellent (≥80): ${tierCounts.EXCELLENT} businesses
- 🔵 Good (60–79): ${tierCounts.GOOD} businesses
- 🟡 At Risk (40–59): ${tierCounts.AT_RISK} businesses
- 🔴 Critical (<40): ${tierCounts.CRITICAL} businesses

### Daily Session Health (today)
- ✅ On Track: ${overview.sessionsSummary.onTrack} | 🚨 At Risk: ${overview.sessionsSummary.atRisk} | ➡️ Stable: ${overview.sessionsSummary.stable} | ⏳ Too Early: ${overview.sessionsSummary.tooEarly}

### Most Improved (latest run)
${overview.mostImprovedBiz ? `↑ ${overview.mostImprovedBiz.bizName} — ${overview.mostImprovedBiz.platform} | "${overview.mostImprovedBiz.keyword}" | +${overview.mostImprovedBiz.spotsChanged} spots` : "None recorded"}

### Most Declined (latest run)
${overview.mostDeclinedBiz ? `↓ ${overview.mostDeclinedBiz.bizName} — ${overview.mostDeclinedBiz.platform} | "${overview.mostDeclinedBiz.keyword}" | ${overview.mostDeclinedBiz.spotsChanged} spots` : "None recorded"}

---

## PORTFOLIO HEALTH SNAPSHOTS BY DATE
(Health score averaged across all platforms. Rankings show best rank per platform on that run date.)

${healthSnapshotSection || "No historical snapshot data available."}

---

## RANKING CHANGES BY DATE (sudden events only, newest first)
${dateSection || "No sudden changes recorded across any run date."}

---

## ALL SUDDEN DROPS — Complete List (${allDrops.length} total)
${allDrops.length > 0 ? allDrops.map(fmtEv).join("\n") : "None"}

## ALL NOT FOUND / CRITICAL — Complete List (${allNotFound.length} total)
${allNotFound.length > 0 ? allNotFound.map(fmtEv).join("\n") : "None"}

## ALL SUDDEN IMPROVEMENTS — Complete List (${allImprove.length} total)
${allImprove.length > 0 ? allImprove.map(fmtEv).join("\n") : "None"}

## ALL REAPPEARED — Complete List (${allReappeared.length} total)
${allReappeared.length > 0 ? allReappeared.map(fmtEv).join("\n") : "None"}

---

## SESSION AT-RISK BUSINESSES (current prediction)
${atRiskLines || "No at-risk businesses today — all sessions on track."}

---

## PORTFOLIO HEALTH STATUS DIGEST
(Use this section to answer questions about which businesses need attention, what's critical, and what action is needed — for any date query, always include this context.)

### AT_RISK Businesses — ${overview.sessionsSummary.atRisk} total

**CRITICAL — Ranking drop + session health issue (${criticalBizsList.length}):**
${criticalDigest || "  None"}

**SESSION RISK — Session health issue only, no sudden ranking drop yet (${sessionRiskList.length}):**
${sessionRiskDigest || "  None"}

### STABLE Businesses — ${overview.sessionsSummary.stable} total (borderline, watch closely)
${stableDigest || "  None — no businesses in stable state"}

### TOO_EARLY Businesses — ${overview.sessionsSummary.tooEarly} total
${tooEarlyDigest || "  None"}

### Rankings Distribution (${overview.totalWithRankings} businesses with ranking data)
- 🔴 Sudden Drop (worst label): ${suddenDropBizCount} businesses → in "Monitor" or "Critical" bucket
- 📉 Steady Drop: ${steadyDropBizCount} businesses → watch at next ranking run
- 🚫 Not Found / Critical (disappeared entirely): ${notFoundBizCount} business(es)
- ⬜ Baseline (first run only, no comparison yet): ${baselineBizCount} businesses

### Key Action Items (immediate priorities)
${criticalBizsList.map(b => `- 🚨 ${b.bizName}: ${b.action}`).join("\n")}
${sessionRiskList.map(b => `- ⚠️ ${b.bizName}: ${b.action}`).join("\n")}
${tooEarlyList.filter(b => {
  const gapDays = globalLatestDate && b.latestDate
    ? Math.round((new Date(globalLatestDate + "T00:00:00Z").getTime() - new Date(b.latestDate + "T00:00:00Z").getTime()) / 86400000)
    : 0;
  return gapDays >= 3;
}).map(b => `- ⏳ ${b.bizName}: Sessions have not run in 3+ days — restart immediately before this business hits AT_RISK threshold`).join("\n")}

---

## SESSION DATA BY DATE (historical, newest first)
IMPORTANT: Use this section to answer ALL date-specific session questions, such as:
- "What was the daily session on June 3?"
- "Give me the overview of June 3, 2026"
- "What businesses had issues on June 2?"
- "What's the session health for a specific date?"

Each section shows that date's actual sessions — businesses active, total volume, success rates, platform split, and any low-performing businesses.

Available session dates: ${sessionDates.join(", ")}

${sessionDateSection || "No historical session data available."}

---

## ALL BUSINESSES — Current Performance (latest run)
${bizStatusLines}

---
INSTRUCTIONS FOR DATE QUERIES:
- "Daily session on June 3" → look in "SESSION DATA BY DATE" for 📅 SESSION DATE: 2026-06-03 and report active businesses, total sessions, success rate, platform split, and any ⚠️ low success businesses
- "Overview of June 2" → SESSION DATA BY DATE for 2026-06-02 + RANKING CHANGES BY DATE for nearby run dates
- "What sudden changes on June 3?" → SESSION DATA BY DATE (low success on that date) + RANKING CHANGES BY DATE for closest run date
- "Sudden drops on June 1" → filter "ALL SUDDEN DROPS" list by date=2026-06-01
- "Portfolio health on June 2" → PORTFOLIO HEALTH SNAPSHOTS BY DATE, find the closest run date to June 2
- "Overall performance of [Business]" → combine session data from the relevant date section + current ranking labels
Always explicitly state which date you are referencing and how many businesses were active on that date.`;
    } catch (err) {
      return `${baseRole}\n\nPortfolio data temporarily unavailable: ${err instanceof Error ? err.message : String(err)}. Please try again or ask about a specific business by name.`;
    }
  }

  // ── Business-specific context ────────────────────────────────────────────────
  const aeo     = getBusinessAEOAnalysis(businessName);
  const session = getBusinessDailyAnalysis(businessName);
  const ranking = getBusinessRanking(businessName);

  if (!aeo && !session && !ranking) {
    return `${baseRole}\n\nNo data found for: "${businessName}". Please verify the business name.`;
  }

  let ctx = `${baseRole}

## BUSINESS: ${businessName}

`;

  if (aeo) {
    const platformBlocks = aeo.platforms.map(p => {
      const history = p.runs.map(r =>
        `${r.date.slice(5)}: ${r.healthScore.toFixed(1)}${r.runDelta !== null ? (r.runDelta >= 0 ? "▲" : "▼") : ""}`
      ).join(" → ");
      return `**${p.platform}**: Latest=${p.latestHealthScore.toFixed(1)} | 4-Run Avg=${p.avg4RunHealthScore.toFixed(1)} | Delta=${p.healthScoreDelta >= 0 ? "+" : ""}${p.healthScoreDelta.toFixed(1)}\n  History: ${history}`;
    }).join("\n\n");

    ctx += `### AEO Health Score Analysis
Overall Health Score: ${aeo.overallHealthScore.toFixed(1)} / 100
4-Run Average: ${aeo.avg4RunHealthScore.toFixed(1)}
Health Score Delta (vs 4-run avg): ${aeo.healthScoreDelta >= 0 ? "+" : ""}${aeo.healthScoreDelta.toFixed(1)} pts
Performance Tier: ${aeo.performanceTierLabel}
Total Ranking Runs: ${aeo.totalRuns}
Latest Data: ${aeo.latestDataDate}
New Business (<3 runs): ${aeo.isNewBusiness ? "YES — establishing baseline" : "No"}

#### Per-Platform Health Scores
${platformBlocks}

${aeo.flags.length > 0
  ? `#### 🚨 Active Flags\n${aeo.flagLabels.map(f => `- ${f}`).join("\n")}`
  : "#### ✅ No Active Flags — Performing as expected"}

${aeo.importantChanges.length > 0
  ? `#### Notable Changes (last run)\n${aeo.importantChanges.map(c => `${c.direction === "up" ? "↑ IMPROVED" : "↓ DECLINED"} ${c.platform}: ${c.description}`).join("\n")}`
  : ""}

${aeo.idealFlow
  ? `#### Recommended Ideal Flow
**Week 1 — Diagnosis:** ${aeo.idealFlow.week1Diagnosis}
**Weeks 2–3 — Actions:**
${aeo.idealFlow.week2_3Actions.map(a => `- ${a}`).join("\n")}
**Week 4 — Re-measure:** ${aeo.idealFlow.week4Outcome}`
  : "#### No Ideal Flow generated (insufficient data — need ≥2 runs)"}

`;
  }

  if (ranking) {
    const kwLines = ranking.keywords.map(kw => {
      const cur  = kw.currentRun;
      const prev = kw.prevRun;
      return `${kw.platform} | "${kw.keyword}": ${cur?.position ?? "—"}/${cur?.total ?? "—"} (${kw.label}${kw.spotsChanged !== null ? `, ${kw.spotsChanged > 0 ? "+" : ""}${kw.spotsChanged} spots` : ""}) | prev: ${prev?.position ?? "—"}/${prev?.total ?? "—"}`;
    });

    ctx += `### Current Rankings
Overall Label: ${ranking.overallLabel}
Total Runs: ${ranking.totalRuns} | First: ${ranking.firstRunDate} | Latest: ${ranking.latestRunDate}
Platform Labels: ${Object.entries(ranking.platformLabels).map(([p, l]) => `${p}=${l}`).join(" | ")}

Keywords (platform | keyword: rank/total | label | prev):
${kwLines.join("\n")}

`;
  }

  if (session) {
    const pwLines = (session.platformWindows as Array<{platform: string; sessionsLast3Days: number; status: string}>)
      .map(pw => `${pw.platform}: ${pw.sessionsLast3Days} sessions (${pw.status})`)
      .join("\n");

    ctx += `### Daily Session Health
Campaign: ${session.campaignName}
Phase: ${session.phaseLabel} (Day ${session.daysActive})
Prediction: ${session.predictionEmoji} ${session.predictionLabel}

Sessions Today: ${session.sessionsToday} / ${session.targetPerDay} target (${(session.successRateToday * 100).toFixed(0)}% success)
7-Day Average: ${session.avg7DaySessions.toFixed(1)}/day (${(session.avg7DaySuccessRate * 100).toFixed(0)}% success rate)
Gap Days (last 7): ${session.gapDays7}

Platform Windows (last 3 days):
${pwLines}

Keywords Hit Today: ${(session.keywordsHitToday as string[])?.join(", ") || "None"}
Missed Keywords (3+ days): ${(session.missedKeywords3Plus as string[])?.join(", ") || "None"}
Critical Keywords (5+ days): ${(session.missedKeywords5Plus as string[])?.join(", ") || "None"}

Reason for prediction: ${session.why}
Recommended Action: ${session.action}
Next Ranking Run Due: ${session.nextRankingRunDue}
`;
  }

  ctx += `
## INSTRUCTIONS
Answer questions about ${businessName} using the data above. Be specific — cite actual health scores, keyword positions, platform names, and session numbers.
If asked for the "ideal flow", "general process", or "weekly plan": provide a comprehensive timeline based on the current status above.
If asked about session-ranking correlation: explain how session gaps and low success rates cause ranking drops over a 14-day window.
Format your response with clear markdown headers and bullet points.`;

  return ctx;
}

// ── Langfuse helper (reuse env vars already set for other routes) ──────────────
let _lfClient: import("langfuse").Langfuse | null = null;
let _lfChecked = false;
async function getChatLangfuse(): Promise<import("langfuse").Langfuse | null> {
  if (_lfChecked) return _lfClient;
  _lfChecked = true;
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return null;
  try {
    const { default: Langfuse } = await import("langfuse");
    _lfClient = new Langfuse({
      publicKey:  process.env.LANGFUSE_PUBLIC_KEY,
      secretKey:  process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_HOST || "https://us.cloud.langfuse.com",
    });
    return _lfClient;
  } catch { return null; }
}

/** POST /csv/aeo/chat */
router.post("/csv/aeo/chat", async (req, res) => {
  try {
    const { messages, businessName } = req.body as {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      businessName?: string;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array required" });
      return;
    }

    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const model   = process.env.CHAT_MODEL ?? "deepseek-chat";

    if (!baseURL || !apiKey) {
      res.status(503).json({ error: "AI client not configured. Set AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY." });
      return;
    }

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ baseURL, apiKey });

    const systemPrompt = buildAEOChatContext(businessName?.trim() || undefined);
    const allMessages = [
      { role: "system" as const, content: systemPrompt },
      ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];
    const startTime = Date.now();

    const completion = await client.chat.completions.create({
      model,
      messages: allMessages,
      max_tokens: 2000,
      temperature: 0.3,
    });

    const content = completion.choices[0]?.message?.content ?? "No response generated.";

    // Record to Langfuse (best-effort, non-blocking)
    let traceUrl: string | null = null;
    try {
      const lf = await getChatLangfuse();
      if (lf) {
        const userQuery = messages[messages.length - 1]?.content ?? "";
        const trace = lf.trace({
          name: "aeo-chat",
          input:  { query: userQuery, businessName: businessName ?? "portfolio" },
          output: { response: content },
          metadata: { model, businessName: businessName ?? "portfolio" },
        });
        trace.generation({
          name:      "chat-completion",
          model,
          input:     allMessages,
          output:    content,
          startTime: new Date(startTime),
          endTime:   new Date(),
          usage: {
            promptTokens:     completion.usage?.prompt_tokens,
            completionTokens: completion.usage?.completion_tokens,
            totalTokens:      completion.usage?.total_tokens,
          },
        });
        await lf.flushAsync();
        const base = process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_HOST || "https://us.cloud.langfuse.com";
        traceUrl = `${base}/trace/${trace.id}`;
      }
    } catch { /* Langfuse failure never blocks the response */ }

    // Record to backend logs table (best-effort)
    try {
      await db.insert(backendLogs).values({
        event: businessName ? `aeo-chat:${businessName}` : "aeo-chat:portfolio",
        model,
        tokensUsed: completion.usage?.total_tokens ?? null,
        responseTimeMs: Date.now() - startTime,
        status: "success",
        details: traceUrl,
      });
    } catch { /* DB failure never blocks the response */ }

    res.json({ content, traceUrl });
  } catch (err: unknown) {
    // Log failure to backend logs too (best-effort)
    try {
      await db.insert(backendLogs).values({
        event: "aeo-chat:error",
        model: null,
        tokensUsed: null,
        responseTimeMs: null,
        status: "error",
        details: err instanceof Error ? err.message : String(err),
      });
    } catch { /* ignore */ }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** GET /csv/sessions/by-date?date=YYYY-MM-DD — per-business session snapshot for a specific date */
router.get("/csv/sessions/by-date", (req, res) => {
  try {
    const date = (req.query["date"] as string | undefined)?.slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "date query param required (YYYY-MM-DD)" }); return;
    }
    const all = getAllDailyAnalysis();
    const businesses = all
      .filter(biz => !isFreeTrial(biz.bizName))
      .map(biz => {
        const day = biz.recentDays.find(d => d.date === date);
        const dayRankSessions   = (day as any)?.rankSessions   ?? 0;
        const dayNoRankSessions = (day as any)?.noRankSessions ?? 0;
        const dayRankPositions  = (day as any)?.rankPositions  ?? [];
        const dayHasRankData = (dayRankSessions + dayNoRankSessions) > 0;
        const dayRankDetectionRate = dayHasRankData ? dayRankSessions / (dayRankSessions + dayNoRankSessions) : null;
        const dayAvgRankPosition = dayRankPositions.length > 0
          ? Math.round((dayRankPositions.reduce((s: number, v: number) => s + v, 0) / dayRankPositions.length) * 10) / 10
          : null;
        return {
          bizName:           biz.bizName,
          clientName:        biz.clientName,
          campaignName:      biz.campaignName,
          prediction:        biz.prediction,
          predictionEmoji:   biz.predictionEmoji,
          total:             day?.total       ?? 0,
          success:           day?.success     ?? 0,
          successRate:       day?.successRate ?? 0,
          platforms:         day?.platforms   ?? {},
          keywords:          day?.keywords    ?? [],
          hadSessions:       !!day && day.total > 0,
          hasRankData:       dayHasRankData,
          rankDetectionRate: dayRankDetectionRate,
          avgRankPosition:   dayAvgRankPosition,
          improvementPriorities: biz.improvementPriorities,
        };
      }).filter(b => b.total > 0);
    res.json({ date, businesses, total: businesses.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /csv/backlinks/action-items?date=YYYY-MM-DD
 * Returns businesses with backlinks injected on the given date, grouped by detection status.
 * Reads the daily consolidated CSV file for that date from AEO_DAILY_CSV_DIR.
 */
router.get("/csv/backlinks/action-items", (req, res) => {
  try {
    const dateParam = (req.query["date"] as string | undefined)?.slice(0, 10);
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : getAsOfDate();
    const report = getBacklinkActionItems(date);
    res.json(report);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** GET /csv/sessions/dates — returns list of dates that have session data */
router.get("/csv/sessions/dates", (_req, res) => {
  try {
    const all = getAllDailyAnalysis();
    const dateSet = new Set<string>();
    for (const biz of all) for (const day of biz.recentDays) dateSet.add(day.date);
    const dates = [...dateSet].sort().reverse();
    res.json({ dates });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** GET /csv/daily-report?date=2026-06-03 — returns printable HTML report for a specific session date */
router.get("/csv/daily-report", (req, res) => {
  try {
    const targetDate = (req.query["date"] as string | undefined)?.slice(0, 10);
    if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      res.status(400).send("<p>Missing or invalid <code>date</code> query param (YYYY-MM-DD).</p>"); return;
    }

    const all = getAllDailyAnalysis();
    const overview = getDailyOverview();
    const allRankings = getAllRankings();
    const rankMap = new Map(allRankings.map(r => [r.bizName, r]));

    type ReportRow = {
      bizName: string; campaignName: string;
      total: number; success: number; rate: number;
      platforms: Record<string, number>; keywords: string[];
      rankLabel: string; latestRankDate: string; prediction: string; why: string; action: string;
    };
    const rows: ReportRow[] = [];

    for (const biz of all) {
      const day = biz.recentDays.find(d => d.date === targetDate);
      if (!day) continue;
      const rank = rankMap.get(biz.bizName);
      rows.push({
        bizName: biz.bizName,
        campaignName: biz.campaignName,
        total: day.total,
        success: day.success,
        rate: day.successRate,
        platforms: day.platforms,
        keywords: day.keywords,
        rankLabel: rank?.overallLabel ?? "—",
        latestRankDate: rank?.latestRunDate ?? "—",
        prediction: biz.predictionLabel,
        why: biz.why,
        action: biz.action,
      });
    }

    if (rows.length === 0) {
      res.status(404).send(`<p>No session data found for ${targetDate}. Available dates: ${
        [...new Set(all.flatMap(b => b.recentDays.map(d => d.date)))].sort().reverse().join(", ")
      }</p>`); return;
    }

    rows.sort((a, b) => a.rate - b.rate || a.bizName.localeCompare(b.bizName));

    const fmtDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    const totalS  = rows.reduce((a, r) => a + r.total, 0);
    const totalOk = rows.reduce((a, r) => a + r.success, 0);
    const platAgg: Record<string, number> = {};
    for (const r of rows) for (const [p, c] of Object.entries(r.platforms)) platAgg[p] = (platAgg[p] ?? 0) + c;
    const lowPerf  = rows.filter(r => r.rate < 0.8);
    const goodPerf = rows.filter(r => r.rate >= 0.9);

    const platColors: Record<string, string> = { ChatGPT: "#10b981", Gemini: "#3b82f6", Perplexity: "#8b5cf6" };

    const rowsHtml = rows.map(r => {
      const ratePct = (r.rate * 100).toFixed(0);
      const rateColor = r.rate >= 0.9 ? "#10b981" : r.rate >= 0.8 ? "#f59e0b" : "#ef4444";
      const platBadges = Object.entries(r.platforms).map(([p, c]) =>
        `<span style="background:${platColors[p] ?? "#6b7280"}22;color:${platColors[p] ?? "#6b7280"};border:1px solid ${platColors[p] ?? "#6b7280"}44;padding:1px 6px;border-radius:4px;font-size:11px">${p}=${c}</span>`
      ).join(" ");
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:500">${r.bizName}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#6b7280">${r.campaignName}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px">${r.total}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px;font-weight:600;color:${rateColor}">${ratePct}%</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px">${platBadges}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#6b7280">${r.prediction}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px">${r.rankLabel}</td>
      </tr>`;
    }).join("");

    const alertsHtml = lowPerf.length > 0
      ? `<div style="margin-bottom:24px;padding:16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px">
          <h3 style="margin:0 0 10px;font-size:13px;font-weight:700;color:#dc2626">⚠️ Businesses Needing Attention (${lowPerf.length} — success rate &lt;80%)</h3>
          ${lowPerf.map(r => `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #fecaca">
            <p style="margin:0 0 4px;font-size:12px;font-weight:600">${r.bizName} — ${(r.rate*100).toFixed(0)}% success rate (${r.success}/${r.total} sessions)</p>
            <p style="margin:0 0 2px;font-size:11px;color:#7f1d1d"><strong>Why:</strong> ${r.why}</p>
            <p style="margin:0;font-size:11px;color:#7f1d1d"><strong>Action:</strong> ${r.action}</p>
          </div>`).join("")}
        </div>` : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AEO Daily Session Report — ${fmtDate(targetDate)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin:0; padding:24px 32px; color:#111827; background:#fff; }
  h1 { font-size:22px; font-weight:700; margin:0 0 4px; }
  h2 { font-size:14px; font-weight:700; margin:20px 0 10px; text-transform:uppercase; letter-spacing:.04em; color:#374151; }
  .meta { font-size:12px; color:#6b7280; margin-bottom:24px; }
  .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:24px; }
  .kpi { padding:14px 16px; border:1px solid #e5e7eb; border-radius:8px; }
  .kpi-val { font-size:26px; font-weight:700; margin:0; }
  .kpi-lbl { font-size:11px; color:#6b7280; margin:2px 0 0; }
  table { width:100%; border-collapse:collapse; font-size:12px; margin-bottom:24px; }
  thead tr { background:#f9fafb; }
  thead th { padding:9px 10px; text-align:left; font-size:11px; font-weight:600; color:#6b7280; border-bottom:2px solid #e5e7eb; white-space:nowrap; }
  @media print {
    body { padding:12px 16px; }
    button { display:none !important; }
    .kpi-grid { grid-template-columns:repeat(4,1fr); }
    h1 { font-size:18px; }
  }
</style>
</head>
<body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
  <div>
    <h1>AEO Daily Session Report</h1>
    <p class="meta">Date: ${fmtDate(targetDate)} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString("en-US",{timeZone:"America/Los_Angeles"})} &nbsp;|&nbsp; Businesses active: ${rows.length}</p>
  </div>
  <button onclick="window.print()" style="padding:8px 18px;background:#111827;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">⬇ Print / Save PDF</button>
</div>

<div class="kpi-grid">
  <div class="kpi"><p class="kpi-val">${rows.length}</p><p class="kpi-lbl">Businesses active</p></div>
  <div class="kpi"><p class="kpi-val">${totalS}</p><p class="kpi-lbl">Total sessions</p></div>
  <div class="kpi"><p class="kpi-val" style="color:${totalS > 0 && (totalOk/totalS) >= 0.9 ? '#10b981' : '#f59e0b'}">${totalS > 0 ? ((totalOk/totalS)*100).toFixed(1) : 0}%</p><p class="kpi-lbl">Overall success rate</p></div>
  <div class="kpi"><p class="kpi-val" style="color:${lowPerf.length === 0 ? '#10b981' : '#ef4444'}">${lowPerf.length}</p><p class="kpi-lbl">Needing attention (&lt;80%)</p></div>
</div>

<div style="margin-bottom:20px;padding:12px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">
  <h2 style="margin:0 0 8px">Platform Distribution</h2>
  <div style="display:flex;gap:16px;flex-wrap:wrap">
    ${Object.entries(platAgg).sort().map(([p, c]) =>
      `<span style="font-size:13px;font-weight:600">${p}: <span style="color:${platColors[p] ?? '#6b7280'}">${c}</span> sessions</span>`
    ).join("  |  ")}
  </div>
</div>

${alertsHtml}

<h2>All Business Session Data — ${fmtDate(targetDate)}</h2>
<table>
<thead><tr>
  <th>Business Name</th><th>Campaign</th><th>Sessions</th><th>Success</th><th>Platforms</th><th>Health Prediction</th><th>Ranking Trend</th>
</tr></thead>
<tbody>${rowsHtml}</tbody>
</table>

<div style="margin-top:16px;padding:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px">
  <p style="margin:0;font-size:11px;color:#166534">✅ ${goodPerf.length} businesses with ≥90% success rate on ${fmtDate(targetDate)}</p>
</div>

<p style="margin-top:24px;font-size:10px;color:#9ca3af;text-align:center">Signal AEO Dashboard &nbsp;·&nbsp; ${fmtDate(targetDate)} Daily Report</p>
<script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    res.status(500).send(`<p>Error generating report: ${err instanceof Error ? err.message : String(err)}</p>`);
  }
});

/** POST /csv/cache/clear — clears in-memory caches so next request re-reads CSV files */
router.post("/csv/cache/clear", (_req, res) => {
  clearCache();
  res.json({ ok: true, message: "Cache cleared — next request will re-read all CSV files." });
});

export default router;

