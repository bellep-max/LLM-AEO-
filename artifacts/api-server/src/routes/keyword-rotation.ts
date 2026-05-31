import { Router } from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import yaml from "js-yaml";

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

export default router;
