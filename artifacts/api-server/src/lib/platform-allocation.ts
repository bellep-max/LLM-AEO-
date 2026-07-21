/**
 * Per-Campaign Platform Allocation — tracks each campaign's expected sessions/day and
 * per-platform (ChatGPT/Gemini/Perplexity) targets against actuals pulled from the daily
 * session CSVs, and computes the status categories from the allocation spec:
 *   Complete / Deviation / Partial / Missed / Platform Gap / Excess
 *
 * Targets have no source of truth anywhere in the existing data (roster xlsx only has
 * Client Name / Campaign Business / Search Address — no session or platform targets). So
 * targets are configurable per campaign, defaulting to that campaign's trailing 7-day actual
 * platform split until a user explicitly overrides them via PUT /api/platform-allocation/:id.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { getCampaignPlatformActuals, getAsOfDate, type CampaignPlatformDay } from "./csv-data.js";

const DATA_DIR = process.env.AEO_DATA_DIR ?? resolve(process.cwd(), "data");
const CONFIG_PATH = process.env.PLATFORM_ALLOCATION_CONFIG_PATH ?? resolve(DATA_DIR, "platform-allocation-config.json");

export type AllocationMode = "auto" | "fixed";

export interface CampaignTargetConfig {
  expectedSessions: number;
  chatgptTarget: number;
  geminiTarget: number;
  perplexityTarget: number;
  mode: AllocationMode; // "auto" = derived from history, never explicitly saved; "fixed" = user-set
}

export type CampaignAllocationStatus = "COMPLETE" | "DEVIATION" | "PARTIAL" | "MISSED";
export type PlatformStatus = "MET" | "SHORT" | "EXCESS" | "ZERO";

export interface PlatformAllocationEntry {
  actual: number;
  target: number;
  status: PlatformStatus;
}

export interface PlatformAllocationDay {
  date: string;
  totalActual: number;
  totalExpected: number;
  status: CampaignAllocationStatus;
  chatgpt: PlatformAllocationEntry;
  gemini: PlatformAllocationEntry;
  perplexity: PlatformAllocationEntry;
}

export interface CampaignAllocation {
  campaignId: string;
  campaignName: string;
  bizName: string;
  clientName: string;
  target: CampaignTargetConfig;
  today: PlatformAllocationDay;
  platformGaps: string[]; // platform names with 0 sessions for 3 consecutive expected-run days
  history: PlatformAllocationDay[]; // trailing 14 days, oldest first
}

// ── Config store (JSON file, keyed by campaignId) ────────────────────────────────
type ConfigStore = Record<string, Omit<CampaignTargetConfig, "mode">>;

let _configCache: ConfigStore | null = null;

function readConfig(): ConfigStore {
  if (_configCache) return _configCache;
  if (!existsSync(CONFIG_PATH)) { _configCache = {}; return _configCache; }
  try {
    _configCache = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    _configCache = {};
  }
  return _configCache!;
}

function writeConfig(store: ConfigStore): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(store, null, 2));
  _configCache = store;
}

export function clearAllocationConfigCache(): void {
  _configCache = null;
}

// ── Default target derivation ────────────────────────────────────────────────────
// Trailing 7-day actual platform split, rounded to whole sessions, remainder assigned to
// whichever platform(s) had the largest fractional share. Falls back to a flat 8/day, roughly
// even 3/3/2 split (matching the existing numCampaigns×8 convention already used elsewhere in
// this codebase) when a campaign has no history yet.
function deriveDefaultTargets(days: CampaignPlatformDay[]): CampaignTargetConfig {
  const last7 = days.slice(-7);
  const sums = last7.reduce(
    (acc, d) => ({
      chatgpt: acc.chatgpt + d.chatgpt,
      gemini: acc.gemini + d.gemini,
      perplexity: acc.perplexity + d.perplexity,
      total: acc.total + d.total,
    }),
    { chatgpt: 0, gemini: 0, perplexity: 0, total: 0 },
  );

  if (sums.total === 0) {
    return { expectedSessions: 8, chatgptTarget: 3, geminiTarget: 3, perplexityTarget: 2, mode: "auto" };
  }

  const activeDays = last7.filter((d) => d.total > 0).length || 1;
  const avgPerDay = Math.max(Math.round(sums.total / activeDays), 1);

  const raw = {
    chatgpt: (sums.chatgpt / sums.total) * avgPerDay,
    gemini: (sums.gemini / sums.total) * avgPerDay,
    perplexity: (sums.perplexity / sums.total) * avgPerDay,
  };
  const floored = { chatgpt: Math.floor(raw.chatgpt), gemini: Math.floor(raw.gemini), perplexity: Math.floor(raw.perplexity) };
  let remainder = avgPerDay - (floored.chatgpt + floored.gemini + floored.perplexity);
  const byFrac = (["chatgpt", "gemini", "perplexity"] as const)
    .map((p) => ({ p, frac: raw[p] - floored[p] }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; remainder > 0; i++, remainder--) floored[byFrac[i % 3].p]++;

  return {
    expectedSessions: avgPerDay,
    chatgptTarget: floored.chatgpt,
    geminiTarget: floored.gemini,
    perplexityTarget: floored.perplexity,
    mode: "auto",
  };
}

function getTargetForCampaign(campaignId: string, days: CampaignPlatformDay[]): CampaignTargetConfig {
  const saved = readConfig()[campaignId];
  if (saved) return { ...saved, mode: "fixed" };
  return deriveDefaultTargets(days);
}

/** Explicitly set (and persist) a campaign's targets. Validates the sum-to-expected rule. */
export function setCampaignTarget(
  campaignId: string,
  target: { expectedSessions: number; chatgptTarget: number; geminiTarget: number; perplexityTarget: number },
): CampaignTargetConfig {
  const sum = target.chatgptTarget + target.geminiTarget + target.perplexityTarget;
  if (sum !== target.expectedSessions) {
    throw new Error(
      `Platform targets must sum to expected sessions: ${target.chatgptTarget} + ${target.geminiTarget} + ${target.perplexityTarget} = ${sum}, expected ${target.expectedSessions}`,
    );
  }
  if ([target.expectedSessions, target.chatgptTarget, target.geminiTarget, target.perplexityTarget].some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error("All target values must be non-negative integers.");
  }
  const store = readConfig();
  store[campaignId] = {
    expectedSessions: target.expectedSessions,
    chatgptTarget: target.chatgptTarget,
    geminiTarget: target.geminiTarget,
    perplexityTarget: target.perplexityTarget,
  };
  writeConfig(store);
  return { ...store[campaignId], mode: "fixed" };
}

/** Remove an explicit override so the campaign falls back to auto-derived targets. */
export function clearCampaignTarget(campaignId: string): void {
  const store = readConfig();
  if (campaignId in store) {
    delete store[campaignId];
    writeConfig(store);
  }
}

// ── Status computation ───────────────────────────────────────────────────────────
function platformStatus(actual: number, target: number): PlatformStatus {
  if (target === 0) return actual > 0 ? "EXCESS" : "MET";
  if (actual === 0) return "ZERO";
  if (actual < target) return "SHORT";
  if (actual > target) return "EXCESS";
  return "MET";
}

function computeDayStatus(day: CampaignPlatformDay | undefined, target: CampaignTargetConfig, date: string): PlatformAllocationDay {
  const chatgptActual = day?.chatgpt ?? 0;
  const geminiActual = day?.gemini ?? 0;
  const perplexityActual = day?.perplexity ?? 0;
  const totalActual = day?.total ?? 0;

  const chatgpt = { actual: chatgptActual, target: target.chatgptTarget, status: platformStatus(chatgptActual, target.chatgptTarget) };
  const gemini = { actual: geminiActual, target: target.geminiTarget, status: platformStatus(geminiActual, target.geminiTarget) };
  const perplexity = { actual: perplexityActual, target: target.perplexityTarget, status: platformStatus(perplexityActual, target.perplexityTarget) };

  let status: CampaignAllocationStatus;
  if (totalActual === 0) {
    status = "MISSED";
  } else if (totalActual < target.expectedSessions) {
    status = "PARTIAL";
  } else {
    const allMet = chatgpt.status === "MET" && gemini.status === "MET" && perplexity.status === "MET";
    status = allMet ? "COMPLETE" : "DEVIATION";
  }

  return { date, totalActual, totalExpected: target.expectedSessions, status, chatgpt, gemini, perplexity };
}

const PLATFORM_KEYS = ["chatgpt", "gemini", "perplexity"] as const;

function computePlatformGaps(history: PlatformAllocationDay[], target: CampaignTargetConfig): string[] {
  const last3 = history.slice(-3);
  if (last3.length < 3) return [];
  const gaps: string[] = [];
  const labels = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity" };
  const targets = { chatgpt: target.chatgptTarget, gemini: target.geminiTarget, perplexity: target.perplexityTarget };
  for (const p of PLATFORM_KEYS) {
    if (targets[p] === 0) continue; // not a required platform for this campaign
    if (last3.every((d) => d[p].actual === 0)) gaps.push(labels[p]);
  }
  return gaps;
}

function buildAllocation(actuals: import("./csv-data.js").CampaignPlatformActuals, asOfDate: string): CampaignAllocation {
  const target = getTargetForCampaign(actuals.campaignId, actuals.days);
  const dayMap = new Map(actuals.days.map((d) => [d.date, d]));

  // Trailing 14 calendar days ending at asOfDate, oldest first.
  const history: PlatformAllocationDay[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(asOfDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    history.push(computeDayStatus(dayMap.get(date), target, date));
  }
  const today = history[history.length - 1];
  const platformGaps = computePlatformGaps(history, target);

  return {
    campaignId: actuals.campaignId,
    campaignName: actuals.campaignName,
    bizName: actuals.bizName,
    clientName: actuals.clientName,
    target,
    today,
    platformGaps,
    history,
  };
}

// A campaign_id with zero sessions across the entire trailing 14-day window isn't "active" per
// the allocation spec ("Each active campaign must define...") — it's a retired/replaced
// campaign_id still sitting in historical CSVs. Without this filter it would show as permanently
// MISSED forever, which is noise rather than an actionable signal (same reasoning as why
// NO_SESSIONS_YET businesses get their own "not started" bucket instead of being lumped into
// AT_RISK elsewhere in this codebase).
function isDormant(days: CampaignPlatformDay[], asOfDate: string): boolean {
  const cutoff = new Date(asOfDate + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - 13);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return !days.some((d) => d.date >= cutoffStr && d.date <= asOfDate && d.total > 0);
}

export function getCampaignAllocations(asOfDate?: string): { asOfDate: string; campaigns: CampaignAllocation[] } {
  const actuals = getCampaignPlatformActuals();
  // getAsOfDate() applies the same "partial trailing day" correction used everywhere else in this
  // codebase — the raw latest CSV date is often a still-collecting partial day, which would make
  // every active campaign falsely show as MISSED for that day.
  const date = asOfDate ?? getAsOfDate();
  const active = actuals.filter((c) => !isDormant(c.days, date));
  return { asOfDate: date, campaigns: active.map((c) => buildAllocation(c, date)) };
}

export function getCampaignAllocation(campaignId: string, asOfDate?: string): CampaignAllocation | null {
  const actuals = getCampaignPlatformActuals();
  const found = actuals.find((c) => c.campaignId === campaignId);
  if (!found) return null;
  const date = asOfDate ?? getAsOfDate();
  return buildAllocation(found, date);
}
