import { Router } from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import yaml from "js-yaml";

// ── Ranking-based rotation (automation/keyword_rotation.py output) ─────────────
// Works whether the server is started from the repo root OR from artifacts/api-server/
const _repoRoot =
  existsSync(join(process.cwd(), "automation"))
    ? process.cwd()
    : join(process.cwd(), "../..");
const AUTOMATION_DIR   = join(_repoRoot, "automation");
const RANKING_STATE    = join(AUTOMATION_DIR, "rotation_state.json");
const RANKING_KEYWORDS = join(AUTOMATION_DIR, "keywords.json");
const RANKING_LOGS_DIR = join(AUTOMATION_DIR, "logs");

function loadRankingStatus() {
  // Load keywords.json (fixed keyword list)
  let keywordConfigs: { keyword: string; priority: number }[] = [];
  if (existsSync(RANKING_KEYWORDS)) {
    const raw = JSON.parse(readFileSync(RANKING_KEYWORDS, "utf8"));
    keywordConfigs = (raw.keywords ?? []).map((k: Record<string, unknown>) => ({
      keyword:  k.keyword as string,
      priority: (k.priority as number) ?? 1,
    }));
  }

  // Load rotation_state.json (lock state)
  let state: Record<string, { locked: boolean; locked_since: string | null }> = {};
  if (existsSync(RANKING_STATE)) {
    state = JSON.parse(readFileSync(RANKING_STATE, "utf8"));
  }

  // Find the latest content log file
  let latestLog: Record<string, unknown> | null = null;
  let lastRun: string | null = null;
  if (existsSync(RANKING_LOGS_DIR)) {
    const logs = readdirSync(RANKING_LOGS_DIR)
      .filter((f) => f.startsWith("content_") && f.endsWith(".json"))
      .sort()
      .reverse();
    if (logs.length > 0) {
      const logPath = join(RANKING_LOGS_DIR, logs[0]);
      latestLog = JSON.parse(readFileSync(logPath, "utf8"));
      lastRun = (latestLog?.date as string) ?? null;
    }
  }

  const summary = (latestLog?.keyword_summary ?? {}) as Record<
    string,
    { top3_days: number; top3_stability: number; current_rank: number | null; locked: boolean }
  >;

  const keywords = keywordConfigs.map((cfg) => {
    const win     = summary[cfg.keyword];
    const kstate  = state[cfg.keyword] ?? { locked: false, locked_since: null };
    return {
      keyword:        cfg.keyword,
      priority:       cfg.priority,
      locked:         kstate.locked || (win?.locked ?? false),
      locked_since:   kstate.locked_since ?? null,
      top3_days:      win?.top3_days    ?? null,
      top3_stability: win?.top3_stability ?? null,
      current_rank:   win?.current_rank ?? null,
    };
  });

  const lockedCount = keywords.filter((k) => k.locked).length;

  return {
    last_run:           lastRun,
    selected_keyword:   (latestLog?.selected_keyword as string) ?? null,
    generated_content:  (latestLog?.content as string) ?? null,
    keywords,
    total_keywords:     keywords.length,
    locked_count:       lockedCount,
    active_count:       keywords.length - lockedCount,
  };
}

const AEO_LLM_URL = process.env.AEO_LLM_URL || "http://localhost:8000";

// aeo-llm lives one directory up from the dashboard root (../aeo-llm)
const CLUSTERS_YAML = join(process.cwd(), "..", "aeo-llm", "data", "keyword_clusters.yaml");

function injectClusterLocal(body: {
  business_name: string;
  brand: string;
  keywords: { keyword: string; ground_truth: string }[];
  backlinks?: Record<string, unknown>[];
}): { cluster: string; keyword_count: number; message: string } {
  const clusterName = body.business_name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  // Ensure data dir exists
  const dataDir = dirname(CLUSTERS_YAML);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  // Load existing clusters
  let existing: { clusters: Record<string, { keywords: Record<string, unknown>[]; backlinks?: unknown[] }> } =
    { clusters: {} };
  if (existsSync(CLUSTERS_YAML)) {
    existing = (yaml.load(readFileSync(CLUSTERS_YAML, "utf8")) as typeof existing) ?? { clusters: {} };
    if (!existing.clusters) existing.clusters = {};
  }

  // Build existing keyword map (preserve locked state)
  const existingKws: Record<string, Record<string, unknown>> = {};
  for (const kw of (existing.clusters[clusterName]?.keywords ?? [])) {
    existingKws[kw.keyword as string] = kw;
  }

  const newKeywords = body.keywords.map((item) => {
    const prev = existingKws[item.keyword] ?? {};
    return {
      keyword: item.keyword,
      brand: body.brand,
      ground_truth: item.ground_truth,
      locked: prev.locked ?? false,
      days_idle: 0,
      last_score: prev.last_score ?? 0.0,
      consecutive_top: prev.consecutive_top ?? 0,
    };
  });

  existing.clusters[clusterName] = {
    keywords: newKeywords,
    backlinks: body.backlinks ?? [],
  };

  writeFileSync(CLUSTERS_YAML, yaml.dump({ clusters: existing.clusters }, { lineWidth: 120 }), "utf8");

  return {
    cluster: clusterName,
    keyword_count: newKeywords.length,
    message: `${newKeywords.length} keywords written to cluster "${clusterName}". Run rotation to begin scoring.`,
  };
}

const router = Router();

/**
 * GET /keyword-rotation/status
 * Proxy to the Python FastAPI: GET /keyword-rotation/status
 * Returns live keyword cluster data with AEO visibility scores,
 * lock state, days idle, and rotation priority for the UI dashboard.
 */
router.get("/keyword-rotation/status", async (_req, res) => {
  try {
    const upstream = await fetch(`${AEO_LLM_URL}/keyword-rotation/status`);
    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).json({ error: text });
      return;
    }
    const data = await upstream.json();
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res
      .status(503)
      .json({ error: `AEO LLM service unavailable: ${message}` });
  }
});

/**
 * POST /keyword-rotation/run
 * Proxy to the Python FastAPI: POST /keyword-rotation/run
 * Triggers a background keyword rotation cycle.
 */
router.post("/keyword-rotation/run", async (req, res) => {
  try {
    const upstream = await fetch(`${AEO_LLM_URL}/keyword-rotation/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body ?? {}),
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).json({ error: text });
      return;
    }
    const data = await upstream.json();
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res
      .status(503)
      .json({ error: `AEO LLM service unavailable: ${message}` });
  }
});

/**
 * POST /keyword-rotation/inject-cluster
 * Tries the Python AEO service first; falls back to writing keyword_clusters.yaml directly.
 */
router.post("/keyword-rotation/inject-cluster", async (req, res) => {
  // 1. Try Python service
  try {
    const upstream = await fetch(`${AEO_LLM_URL}/keyword-rotation/inject-cluster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify(req.body ?? {}),
    });
    if (upstream.ok) {
      res.json(await upstream.json());
      return;
    }
  } catch {
    // Python service unavailable — fall through to local write
  }

  // 2. Write directly to keyword_clusters.yaml
  try {
    const result = injectClusterLocal(req.body);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Inject failed: ${message}` });
  }
});

/**
 * GET /keyword-rotation/ranking-status
 * Returns ranking-API-based rotation state from automation/keyword_rotation.py output.
 * Reads automation/rotation_state.json + latest automation/logs/content_YYYY-MM-DD.json.
 */
router.get("/keyword-rotation/ranking-status", (_req, res) => {
  try {
    res.json(loadRankingStatus());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to load ranking status: ${message}` });
  }
});

export default router;
