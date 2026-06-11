import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

import { readdirSync, existsSync } from "fs";

const DATA_DIR = process.env.AEO_DATA_DIR ?? resolve(process.cwd(), "data");
const RANKINGS_CSV = process.env.RANKINGS_CSV_PATH ?? resolve(DATA_DIR, "rankings.csv");
const SESSIONS_CSV = process.env.SESSIONS_CSV_PATH ?? resolve(DATA_DIR, "sessions.csv");
const ARCHIVE_FILE = resolve(DATA_DIR, "archived-businesses.json");
// Daily consolidated CSVs directory (optional — for keyword variant data)
const DAILY_CSV_DIR = process.env.AEO_DAILY_CSV_DIR ?? resolve(process.cwd(), "../../csv");

// ── Archive helpers ────────────────────────────────────────────────────────────

function loadArchiveSet(): Set<string> {
  try {
    const data = JSON.parse(readFileSync(ARCHIVE_FILE, "utf-8"));
    return new Set<string>(Array.isArray(data.archived) ? data.archived : []);
  } catch { return new Set(); }
}

export function getArchivedBusinesses(): string[] {
  return [...loadArchiveSet()].sort();
}

export function archiveBusiness(bizName: string): void {
  const set = loadArchiveSet();
  set.add(bizName);
  writeFileSync(ARCHIVE_FILE, JSON.stringify({ archived: [...set].sort() }, null, 2));
  _rankings = null; _dailyAnalysis = null; _aeoAnalysis = null; _variantMap = null;
}

export function reactivateBusiness(bizName: string): boolean {
  const set = loadArchiveSet();
  if (!set.has(bizName)) return false;
  set.delete(bizName);
  writeFileSync(ARCHIVE_FILE, JSON.stringify({ archived: [...set].sort() }, null, 2));
  _rankings = null; _dailyAnalysis = null; _aeoAnalysis = null; _variantMap = null;
  return true;
}

export function clearCache(): void {
  _rankings = null; _dailyAnalysis = null; _aeoAnalysis = null; _variantMap = null;
}

// ── CSV parser ─────────────────────────────────────────────────────────────────

function parseLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ",") { fields.push(cur); cur = ""; }
      else { cur += ch; }
    }
  }
  fields.push(cur);
  return fields;
}

function parseCSV(filePath: string): Record<string, string>[] {
  let content: string;
  try { content = readFileSync(filePath, "utf-8"); }
  catch { console.error(`[csv-data] Cannot read: ${filePath}`); return []; }
  const lines = content.split("\n");
  if (!lines.length) return [];
  const headers = parseLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = parseLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = vals[j] ?? "";
    rows.push(row);
  }
  return rows;
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}

// ── Platform normalizer ────────────────────────────────────────────────────────

function normPlatform(raw: string): string {
  const l = raw.toLowerCase().trim();
  if (l === "chatgpt") return "ChatGPT";
  if (l === "gemini") return "Gemini";
  if (l === "perplexity") return "Perplexity";
  return raw;
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION A — RANKINGS TYPES & LOGIC (bi-weekly, unchanged)
// ══════════════════════════════════════════════════════════════════════════════

export type RankLabel =
  | "SUDDEN_IMPROVEMENT" | "STEADY_IMPROVEMENT" | "NO_CHANGE"
  | "STEADY_DROP" | "SUDDEN_DROP" | "BASELINE"
  | "NOT_FOUND_CRITICAL" | "REAPPEARED";

export interface RankRun {
  date: string; position: number | null; total: number | null;
}

export interface KeywordRank {
  platform: string; keyword: string; runs: RankRun[];
  label: RankLabel; prevRun: RankRun | null; currentRun: RankRun | null;
  spotsChanged: number | null; firstRunDate: string;
  latestRunDate: string; nextRunDue: string;
  daysBetweenRuns: number | null;
}

export interface BusinessRankSummary {
  bizName: string; keywords: KeywordRank[];
  overallLabel: RankLabel; platformLabels: Record<string, RankLabel>;
  firstRunDate: string; latestRunDate: string; totalRuns: number;
  isFirstRunOnly: boolean; // true = only 1 distinct run date — no comparison possible
}

const LABEL_PRIORITY: RankLabel[] = [
  "SUDDEN_DROP", "NOT_FOUND_CRITICAL", "STEADY_DROP",
  "SUDDEN_IMPROVEMENT", "STEADY_IMPROVEMENT", "REAPPEARED", "NO_CHANGE", "BASELINE",
];

function labelPri(l: RankLabel) { return LABEL_PRIORITY.indexOf(l); }
function worstLabel(labels: RankLabel[]): RankLabel {
  if (!labels.length) return "BASELINE";
  return labels.reduce((w, l) => (labelPri(l) < labelPri(w) ? l : w));
}

function normalizePos(raw: number | null): number | null {
  if (raw === null || raw === 0 || (typeof raw === "number" && isNaN(raw))) return null;
  return raw;
}

// Position tiers: 1–5 = top (always good), 6–10 = acceptable, 11+ = poor
function posTier(pos: number): 1 | 2 | 3 {
  if (pos <= 5)  return 1;
  if (pos <= 10) return 2;
  return 3;
}

function computeRankLabel(prev: RankRun | null, current: RankRun | null): { label: RankLabel; spotsChanged: number | null } {
  if (!prev) return { label: "BASELINE", spotsChanged: null };
  const pPos = normalizePos(prev.position);
  const cPos = normalizePos(current?.position ?? null);
  if (pPos === null && cPos === null) return { label: "BASELINE", spotsChanged: null };
  if (pPos !== null && cPos === null) return { label: "NOT_FOUND_CRITICAL", spotsChanged: null };
  if (pPos === null && cPos !== null) return { label: "REAPPEARED", spotsChanged: null };

  const spots = pPos! - cPos!;
  const pt = posTier(pPos!);
  const ct = posTier(cPos!);

  // Currently Top 1–5: always good regardless of where it came from
  if (ct === 1) {
    return pt > 1
      ? { label: "STEADY_IMPROVEMENT", spotsChanged: spots }
      : { label: "NO_CHANGE",          spotsChanged: spots };
  }

  // Currently Top 6–10
  if (ct === 2) {
    if (pt === 3) return { label: "STEADY_IMPROVEMENT", spotsChanged: spots }; // came from 11+: fine
    if (pt === 2) return { label: "NO_CHANGE",          spotsChanged: spots }; // holding 6–10: stable
    return          { label: "STEADY_DROP",             spotsChanged: spots }; // fell from top 1–5
  }

  // Currently 11+ (poor zone)
  // Only SUDDEN if fell from top-5 (tier-1). Fell from 6–10 (tier-2) → 11+ is STEADY_DROP.
  if (pt === 1) return { label: "SUDDEN_DROP",  spotsChanged: spots }; // fell from top-5 → 11+
  if (pt === 2) return { label: "STEADY_DROP",  spotsChanged: spots }; // fell from 6–10 → 11+
  // Both in 11+: use direction within bad zone
  if (spots > 0) return { label: "STEADY_IMPROVEMENT", spotsChanged: spots };
  if (spots === 0) return { label: "NO_CHANGE",         spotsChanged: 0 };
  return               { label: "STEADY_DROP",          spotsChanged: spots };
}

let _rankings: BusinessRankSummary[] | null = null;

function loadRankings(): BusinessRankSummary[] {
  const archived = loadArchiveSet();
  const rows = parseCSV(RANKINGS_CSV);
  const map = new Map<string, RankRun[]>();
  for (const row of rows) {
    const biz = row["biz_name"]?.trim();
    if (biz && archived.has(biz)) continue;
    const platform = normPlatform(row["platform"] ?? "");
    const keyword = row["keyword"]?.trim();
    const date = row["date"]?.trim()?.slice(0, 10);
    if (!biz || !platform || !keyword || !date || date.length !== 10) continue;
    const rawPos = row["ranking_position"];
    const position = rawPos?.trim() ? parseInt(rawPos, 10) : null;
    const rawTotal = row["ranking_total"];
    const total = rawTotal?.trim() ? parseInt(rawTotal, 10) : null;
    const key = `${biz}|||${platform}|||${keyword}`;
    if (!map.has(key)) map.set(key, []);
    const runs = map.get(key)!;
    if (!runs.some((r) => r.date === date))
      runs.push({ date, position: position !== null && !isNaN(position) ? position : null, total: total !== null && !isNaN(total) ? total : null });
  }
  const bizMap = new Map<string, KeywordRank[]>();
  for (const [key, runs] of map) {
    const [biz, platform, keyword] = key.split("|||");
    runs.sort((a, b) => a.date.localeCompare(b.date));
    const prevRun = runs.length >= 2 ? runs[runs.length - 2] : null;
    const currentRun = runs[runs.length - 1];
    const { label, spotsChanged } = computeRankLabel(prevRun, currentRun);
    const daysBetweenRuns = prevRun ? daysBetween(prevRun.date, currentRun.date) : null;
    const kr: KeywordRank = {
      platform, keyword, runs, label, prevRun, currentRun, spotsChanged,
      firstRunDate: runs[0].date, latestRunDate: currentRun.date,
      nextRunDue: addDays(currentRun.date, 14),
      daysBetweenRuns,
    };
    if (!bizMap.has(biz)) bizMap.set(biz, []);
    bizMap.get(biz)!.push(kr);
  }
  const results: BusinessRankSummary[] = [];
  for (const [bizName, keywords] of bizMap) {
    const platformLabels: Record<string, RankLabel> = {};
    for (const kw of keywords) {
      const prev = platformLabels[kw.platform];
      if (!prev || labelPri(kw.label) < labelPri(prev)) platformLabels[kw.platform] = kw.label;
    }
    const allDates = keywords.flatMap((k) => k.runs.map((r) => r.date)).sort();
    const uniqueDates = [...new Set(allDates)];
    results.push({
      bizName, keywords, overallLabel: worstLabel(keywords.map((k) => k.label)),
      platformLabels, firstRunDate: allDates[0] ?? "", latestRunDate: allDates[allDates.length - 1] ?? "",
      totalRuns: uniqueDates.length,
      isFirstRunOnly: uniqueDates.length <= 1,
    });
  }
  return results.sort((a, b) => a.bizName.localeCompare(b.bizName));
}

export function getAllRankings(): BusinessRankSummary[] {
  if (!_rankings) _rankings = loadRankings();
  return _rankings;
}
export function getBusinessRanking(bizName: string): BusinessRankSummary | null {
  return getAllRankings().find((b) => b.bizName === bizName) ?? null;
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION B — DAILY SESSION ANALYSIS (new prompt-based logic)
// ══════════════════════════════════════════════════════════════════════════════

export type Prediction = "ON_TRACK" | "AT_RISK" | "STABLE" | "TOO_EARLY";

export interface DailySessionRecord {
  date: string;
  total: number;
  success: number;
  successRate: number;
  platforms: Record<string, number>;   // platform → count
  keywords: Set<string>;
}

export interface KeywordCoverageItem {
  keyword: string;
  daysSinceLastHit: number;
  status: "OK" | "WARNING" | "CRITICAL";
}

export interface PlatformWindow {
  platform: string;
  sessionsLast3Days: number;
  sessionsLast5Days: number;
  consecutiveDaysSilent: number;
  status: "ACTIVE" | "NO_SESSIONS";
}

export interface BusinessDailyAnalysis {
  bizName: string;
  clientName: string;
  campaignName: string;
  numCampaigns: number;
  targetPerDay: number;           // numCampaigns × 8
  allKeywords: string[];
  daysActive: number;             // calendar days since first session
  totalSessions: number;
  firstDate: string;
  latestDate: string;
  phase: number;
  phaseLabel: string;

  // Latest day
  latestDayData: DailySessionRecord | null;
  sessionsToday: number;
  successRateToday: number;
  keywordsHitToday: string[];
  platformsToday: Record<string, number>;

  // 7-day rolling window
  avg7DaySessions: number;
  avg7DaySuccessRate: number;
  gapDays7: number;              // calendar days with 0 sessions in last 7

  // Keyword coverage
  keywordCoverages: KeywordCoverageItem[];
  missedKeywords3Plus: string[]; // missed 3+ consecutive days (warning)
  missedKeywords5Plus: string[]; // missed 5+ consecutive days (critical)

  // Platform 3-day and 5-day windows
  platformWindows: PlatformWindow[];

  // Prediction
  prediction: Prediction;
  predictionLabel: string;
  predictionEmoji: string;
  why: string;
  action: string;

  // Next ranking run (from rankings data if available)
  nextRankingRunDue: string;

  // Raw daily records (last 14 days, serializable)
  recentDays: Array<Omit<DailySessionRecord, "keywords"> & { keywords: string[] }>;

  // Keyword variants seen in daily CSVs (canonical kw → variant phrasings used)
  keywordVariants: Record<string, string[]>;
}

const PLATFORMS = ["ChatGPT", "Gemini", "Perplexity"] as const;

function phaseFromDays(daysActive: number): { phase: number; label: string } {
  if (daysActive <= 3) return { phase: 1, label: "Phase 1 — Launch" };
  if (daysActive <= 14) return { phase: 2, label: "Phase 2 — Warmup" };
  if (daysActive <= 28) return { phase: 4, label: "Phase 4 — Build" };
  return { phase: 6, label: "Phase 6 — Sustain and Grow" };
}

function computePrediction(a: {
  daysActive: number; totalSessions: number;
  gapDays7: number; avg7DaySuccessRate: number;
  missedKeywords5Plus: string[]; platformWindows: PlatformWindow[];
  missedKeywords3Plus: string[];
}): { prediction: Prediction; predictionLabel: string; predictionEmoji: string; why: string; action: string } {

  if (a.daysActive < 5 || a.totalSessions < 10) {
    return {
      prediction: "TOO_EARLY", predictionLabel: "Too Early to Assess", predictionEmoji: "⏳",
      why: `Only ${a.daysActive} day${a.daysActive !== 1 ? "s" : ""} of session data available (${a.totalSessions} total sessions). Not enough history to predict ranking direction yet.`,
      action: "Continue running sessions every day. Return to assess after 7 days of data.",
    };
  }

  const silentPlatform5 = a.platformWindows.find((p) => p.consecutiveDaysSilent >= 5);
  const silentPlatform3 = a.platformWindows.find((p) => p.consecutiveDaysSilent >= 3);
  // AT_RISK only from real session health problems — gaps, low success rate, or a silent platform.
  // Keyword-only rotation gaps do NOT trigger AT_RISK when sessions are healthy.
  const hasSessionHealthIssue = a.gapDays7 >= 2 || a.avg7DaySuccessRate < 0.70 || !!silentPlatform5;
  const isAtRisk = hasSessionHealthIssue;
  const isOnTrack = !isAtRisk && a.gapDays7 === 0 && a.avg7DaySuccessRate >= 0.90 && a.missedKeywords3Plus.length === 0 && !silentPlatform3;

  if (isAtRisk) {
    const reasons: string[] = [];
    if (a.gapDays7 >= 2) reasons.push(`${a.gapDays7} days with zero sessions in the last 7`);
    if (a.avg7DaySuccessRate < 0.70) reasons.push(`success rate critically low at ${(a.avg7DaySuccessRate * 100).toFixed(0)}%`);
    if (silentPlatform5) reasons.push(`${silentPlatform5.platform} has received zero sessions for ${silentPlatform5.consecutiveDaysSilent} consecutive days`);

    const actions: string[] = [];
    if (a.gapDays7 >= 2) actions.push("Eliminate all session gaps immediately — run sessions every single day without exception.");
    if (a.avg7DaySuccessRate < 0.70) actions.push("Fix session errors before the next ranking run — 1 in 3 sessions is currently failing.");
    if (silentPlatform5) actions.push(`Ensure ${silentPlatform5.platform} receives sessions today — it has been silent too long.`);
    if (a.missedKeywords5Plus.length) actions.push(`Re-cover keyword: "${a.missedKeywords5Plus[0]}" in upcoming sessions.`);

    return {
      prediction: "AT_RISK", predictionLabel: "At Risk of Drop", predictionEmoji: "🚨",
      why: reasons.join(". ") + ". The next ranking run will likely show a negative move if this is not corrected.",
      action: actions.slice(0, 2).join(" "),
    };
  }

  if (isOnTrack) {
    return {
      prediction: "ON_TRACK", predictionLabel: "On Track for Improvement", predictionEmoji: "📈",
      why: `No session gaps in the last 7 days, ${(a.avg7DaySuccessRate * 100).toFixed(0)}% average success rate, all keywords covered, and all 3 platforms receiving sessions in natural rotation. The next ranking run should show a positive move.`,
      action: "Maintain current session cadence through to the next ranking run. No changes needed.",
    };
  }

  // STABLE
  const stableReasons: string[] = [];
  if (a.gapDays7 === 1) stableReasons.push("1 session gap in the last 7 days");
  if (a.avg7DaySuccessRate >= 0.70 && a.avg7DaySuccessRate < 0.90) stableReasons.push(`success rate is ${(a.avg7DaySuccessRate * 100).toFixed(0)}% — just below the 90% target`);
  if (a.missedKeywords5Plus.length) stableReasons.push(`keyword "${a.missedKeywords5Plus[0]}" not hit in 5+ days — rotate this keyword back into upcoming sessions`);
  else if (a.missedKeywords3Plus.length) stableReasons.push(`keyword "${a.missedKeywords3Plus[0]}" not hit in 3+ days`);
  if (silentPlatform3) stableReasons.push(`${silentPlatform3.platform} silent for ${silentPlatform3.consecutiveDaysSilent} days`);

  const worstKpi = a.avg7DaySuccessRate < 0.90 ? "success rate" : a.gapDays7 > 0 ? "session consistency" : "keyword coverage";
  const fallbackReason = stableReasons.length ? stableReasons.join(" and ") : "some keywords need more rotation coverage";

  return {
    prediction: "STABLE", predictionLabel: "Stable — Holding Position", predictionEmoji: "➡️",
    why: "Sessions are running consistently but " + fallbackReason + ". Enough to hold position but not enough to push for improvement.",
    action: `Investigate why ${worstKpi} is below target. Fixing this one KPI could be enough to push from stable to improvement on the next ranking run.`,
  };
}

// ── Keyword variant loader (reads daily consolidated CSVs if present) ──────────
// Returns: bizName → canonical_keyword → Set<variant>
type VariantMap = Map<string, Map<string, Set<string>>>;
let _variantMap: VariantMap | null = null;

function loadKeywordVariants(): VariantMap {
  const result: VariantMap = new Map();
  if (!existsSync(DAILY_CSV_DIR)) return result;
  let files: string[] = [];
  try { files = readdirSync(DAILY_CSV_DIR).filter((f) => f.endsWith(".csv")); }
  catch { return result; }

  for (const file of files) {
    const rows = parseCSV(resolve(DAILY_CSV_DIR, file));
    for (const row of rows) {
      const biz = row["biz_name"]?.trim();
      const kw  = (row["keyword"] ?? row["keyword_text"] ?? "").trim();
      const variant = (row["keyword_variant"] ?? "").trim();
      if (!biz || !kw || !variant || variant === kw) continue;
      if (!result.has(biz)) result.set(biz, new Map());
      const kwMap = result.get(biz)!;
      if (!kwMap.has(kw)) kwMap.set(kw, new Set());
      kwMap.get(kw)!.add(variant);
    }
  }
  return result;
}

function getVariantMap(): VariantMap {
  if (!_variantMap) _variantMap = loadKeywordVariants();
  return _variantMap;
}

let _dailyAnalysis: BusinessDailyAnalysis[] | null = null;

function loadDailyAnalysis(): BusinessDailyAnalysis[] {
  const archived = loadArchiveSet();
  const rows = parseCSV(SESSIONS_CSV);

  // Build per-business session records
  type BizData = {
    campaignIds: Set<string>;  // unique campaign_ids (correct campaign count)
    keywords: Set<string>;
    campaignName: string;
    clientName: string;
    // date → record
    days: Map<string, DailySessionRecord>;
  };
  const bizMap = new Map<string, BizData>();

  for (const row of rows) {
    const biz = row["biz_name"]?.trim();
    if (biz && archived.has(biz)) continue;
    const date = row["date"]?.slice(0, 10);
    if (!biz || !date || date.length !== 10) continue;

    // Support both column naming conventions:
    // sessions-all export uses ai_platform/keyword_text
    // daily consolidated CSVs use platform/keyword
    const platform = normPlatform(row["ai_platform"] ?? row["platform"] ?? "");
    const keyword = (row["keyword_text"] ?? row["keyword"] ?? "").trim();
    const campaignId = row["campaign_id"]?.trim() ?? "";
    const isSuccess = row["status"] === "success";
    const campaignName = row["campaign_name"]?.trim() ?? "";
    const clientName = row["client_name"]?.trim() ?? "";

    if (!bizMap.has(biz)) bizMap.set(biz, { campaignIds: new Set(), keywords: new Set(), campaignName, clientName, days: new Map() });
    const bd = bizMap.get(biz)!;
    if (campaignId) bd.campaignIds.add(campaignId);
    if (keyword) bd.keywords.add(keyword);
    if (campaignName && !bd.campaignName) bd.campaignName = campaignName;
    if (clientName && !bd.clientName) bd.clientName = clientName;

    if (!bd.days.has(date)) bd.days.set(date, { date, total: 0, success: 0, successRate: 0, platforms: {}, keywords: new Set() });
    const day = bd.days.get(date)!;
    day.total++;
    if (isSuccess) day.success++;
    if (platform) day.platforms[platform] = (day.platforms[platform] ?? 0) + 1;
    if (keyword) day.keywords.add(keyword);
  }

  // Find overall latest date across all businesses
  const allLatest = [...bizMap.values()].map((bd) => [...bd.days.keys()].sort().pop() ?? "").filter(Boolean).sort();
  const globalLatest = allLatest[allLatest.length - 1] ?? new Date().toISOString().slice(0, 10);

  // Look up ranking data for next run dates
  const rankMap = new Map(getAllRankings().map((r) => [r.bizName, r.latestRunDate]));

  const results: BusinessDailyAnalysis[] = [];

  for (const [bizName, bd] of bizMap) {
    // Update successRate for each day
    for (const day of bd.days.values()) {
      day.successRate = day.total > 0 ? day.success / day.total : 0;
    }

    const allDates = [...bd.days.keys()].sort();
    const firstDate = allDates[0] ?? "";
    const latestDate = allDates[allDates.length - 1] ?? globalLatest;
    const daysActive = firstDate ? daysBetween(firstDate, latestDate) + 1 : 0;
    const totalSessions = [...bd.days.values()].reduce((s, d) => s + d.total, 0);
    // Use campaign_id count (correct); fall back to 1 if no campaign_ids found
    const numCampaigns = Math.max(bd.campaignIds.size, 1);
    const targetPerDay = numCampaigns * 8;
    const { phase, label: phaseLabel } = phaseFromDays(daysActive);

    // Latest day
    const latestDay = bd.days.get(latestDate) ?? null;

    // 7-day rolling window: last 7 calendar days from latestDate
    // Only count days on or after firstDate as potential gap days (pre-launch days are not gaps)
    let win7Total = 0, win7Success = 0, gapDays7 = 0;
    const last7Dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(latestDate, -i);
      last7Dates.push(d);
      if (d < firstDate) continue;
      const rec = bd.days.get(d);
      if (!rec || rec.total === 0) { gapDays7++; }
      else { win7Total += rec.total; win7Success += rec.success; }
    }
    const avg7DaySessions = win7Total / 7;
    const avg7DaySuccessRate = win7Total > 0 ? win7Success / win7Total : 0;

    // Keyword coverage: days since last hit for each keyword
    const keywordCoverages: KeywordCoverageItem[] = [];
    for (const kw of bd.keywords) {
      let daysSince = 0;
      for (let i = 0; i <= 30; i++) {
        const d = addDays(latestDate, -i);
        const rec = bd.days.get(d);
        if (rec && rec.keywords.has(kw)) { daysSince = i; break; }
        if (i === 30) daysSince = 30;
      }
      const status: KeywordCoverageItem["status"] = daysSince >= 5 ? "CRITICAL" : daysSince >= 3 ? "WARNING" : "OK";
      keywordCoverages.push({ keyword: kw, daysSinceLastHit: daysSince, status });
    }
    const missedKeywords3Plus = keywordCoverages.filter((k) => k.daysSinceLastHit >= 3).map((k) => k.keyword);
    const missedKeywords5Plus = keywordCoverages.filter((k) => k.daysSinceLastHit >= 5).map((k) => k.keyword);

    // Platform windows (3-day and 5-day)
    // Stop counting consecutive silent days once we reach a day before firstDate — pre-launch days are not silence.
    const platformWindows: PlatformWindow[] = PLATFORMS.map((p) => {
      let sessions3 = 0, sessions5 = 0;
      let consecutiveSilent = 0;
      for (let i = 0; i <= 30; i++) {
        const d = addDays(latestDate, -i);
        if (d < firstDate) break;
        const rec = bd.days.get(d);
        const cnt = rec?.platforms[p] ?? 0;
        if (i < 3) sessions3 += cnt;
        if (i < 5) sessions5 += cnt;
        if (cnt === 0) consecutiveSilent++;
        else break;
      }
      return {
        platform: p, sessionsLast3Days: sessions3, sessionsLast5Days: sessions5,
        consecutiveDaysSilent: consecutiveSilent,
        status: sessions3 > 0 ? "ACTIVE" : "NO_SESSIONS" as const,
      };
    });

    // Prediction
    const { prediction, predictionLabel, predictionEmoji, why, action } = computePrediction({
      daysActive, totalSessions, gapDays7, avg7DaySuccessRate,
      missedKeywords5Plus, platformWindows, missedKeywords3Plus,
    });

    // Next ranking run
    const lastRankDate = rankMap.get(bizName);
    const nextRankingRunDue = lastRankDate ? addDays(lastRankDate, 14) : addDays(firstDate, 14);

    // Recent days (last 30 serializable — needs 30 for accurate platform-silence window in recomputeForDate)
    const recentDays = allDates.slice(-30).map((d) => {
      const rec = bd.days.get(d)!;
      return { ...rec, keywords: [...rec.keywords] };
    });

    // Keyword variants (from daily CSVs if available)
    const variantBizMap = getVariantMap().get(bizName);
    const keywordVariants: Record<string, string[]> = {};
    for (const kw of bd.keywords) {
      const vars = variantBizMap?.get(kw);
      if (vars && vars.size > 0) keywordVariants[kw] = [...vars].sort();
    }

    results.push({
      bizName, clientName: bd.clientName, campaignName: bd.campaignName, numCampaigns, targetPerDay,
      allKeywords: [...bd.keywords].sort(), daysActive, totalSessions,
      firstDate, latestDate, phase, phaseLabel,
      latestDayData: latestDay, sessionsToday: latestDay?.total ?? 0,
      successRateToday: latestDay?.successRate ?? 0,
      keywordsHitToday: latestDay ? [...latestDay.keywords] : [],
      platformsToday: latestDay?.platforms ?? {},
      avg7DaySessions, avg7DaySuccessRate, gapDays7,
      keywordCoverages, missedKeywords3Plus, missedKeywords5Plus,
      platformWindows, prediction, predictionLabel, predictionEmoji, why, action,
      nextRankingRunDue,
      recentDays,
      keywordVariants,
    });
  }

  // Sort: AT_RISK first, then TOO_EARLY, then STABLE, then ON_TRACK
  const predOrd: Prediction[] = ["AT_RISK", "TOO_EARLY", "STABLE", "ON_TRACK"];
  return results.sort((a, b) => {
    const diff = predOrd.indexOf(a.prediction) - predOrd.indexOf(b.prediction);
    return diff !== 0 ? diff : a.bizName.localeCompare(b.bizName);
  });
}

export function getAllDailyAnalysis(): BusinessDailyAnalysis[] {
  if (!_dailyAnalysis) _dailyAnalysis = loadDailyAnalysis();
  return _dailyAnalysis;
}

export function getBusinessDailyAnalysis(bizName: string): BusinessDailyAnalysis | null {
  return getAllDailyAnalysis().find((b) => b.bizName === bizName) ?? null;
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION C — COMBINED DAILY OVERVIEW
// ══════════════════════════════════════════════════════════════════════════════

export interface DailyOverviewData {
  asOfDate: string;
  totalBusinesses: number;        // total with session data (matches Health Monitor)
  totalWithRankings: number;      // all businesses that have ANY ranking data
  totalWithComparableRankings: number; // rankings with 2+ run dates (can compute change)
  phase1to2Count: number;         // businesses in Phase 1 or 2 (launch/warmup)
  phase4to6Count: number;         // businesses in Phase 4, 5, or 6 (build/sustain)
  rankingsSummary: {
    suddenDrops: number; suddenImprovements: number; steadyDrop: number;
    steadyImprovement: number; baseline: number; noChange: number;
  };
  // Counts ONLY businesses with session data — matches Health Monitor exactly
  sessionsSummary: { onTrack: number; atRisk: number; stable: number; tooEarly: number };
  mostImprovedBiz: { bizName: string; label: RankLabel; keyword: string; platform: string; spotsChanged: number } | null;
  mostDeclinedBiz: { bizName: string; label: RankLabel; keyword: string; platform: string; spotsChanged: number } | null;
  atRiskBusinesses: Array<{
    bizName: string; prediction: Prediction; predictionEmoji: string;
    why: string; action: string; gapDays7: number; avg7DaySuccessRate: number;
    missedKeywords5Plus: string[]; silentPlatform: string | null;
    rankLabel: RankLabel; latestRankDate: string;
  }>;
  rankAlerts: Array<{
    bizName: string; label: RankLabel; platform: string; keyword: string;
    prevRank: number | null; currentRank: number | null; spotsChanged: number | null;
    sessionPrediction: Prediction; sessionPredictionEmoji: string;
    sessionWhy: string; sessionAction: string;
    gapDays7: number; avg7DaySuccessRate: number;
  }>;
  businesses: Array<{
    bizName: string; clientName: string; rankLabel: RankLabel; prediction: Prediction;
    predictionEmoji: string; predictionLabel: string; latestRankDate: string;
    sessionsToday: number; targetPerDay: number; avg7DaySessions: number;
    avg7DaySuccessRate: number; gapDays7: number;
    hasSessionData: boolean;
    isFirstRunOnly: boolean;
    bestRanks: Record<string, number | null>;
    // session detail fields for per-business report
    campaignName: string; daysActive: number; phase: number; phaseLabel: string;
    firstDate: string; latestDate: string; nextRankingRunDue: string;
    why: string; action: string;
    platformWindows: PlatformWindow[];
    missedKeywords3Plus: string[]; missedKeywords5Plus: string[];
    keywordsHitToday: string[]; platformsToday: Record<string, number>;
    allKeywords: string[];
    successRateToday: number;
  }>;
  // Businesses that got keyword rotation on 2026-06-06 and are running below 8 sessions/day
  keywordRotationGap: Array<{
    bizName: string; clientName: string;
    // Per-day session counts from rotation date to asOfDate
    dailySessions: Array<{ date: string; sessions: number }>;
    avgSessionsPerDay: number; gapPerDay: number; isAtRisk: boolean;
  }>;
  keywordRotationTotal: number; // total businesses that had rotation (including those on target)
}

export function getAsOfDate(): string {
  const sessionDates = getAllDailyAnalysis().map((s) => s.latestDate).filter(Boolean);
  const rankingDates = getAllRankings().map((r) => r.latestRunDate).filter(Boolean);
  return [...sessionDates, ...rankingDates].sort().pop() ?? new Date().toISOString().slice(0, 10);
}

// ── Date-parameterized recomputation ─────────────────────────────────────────
// Given an existing BusinessDailyAnalysis (from cache), recompute all health
// metrics anchored to asOfDate using the 14-day window already stored in recentDays.
function recomputeForDate(biz: BusinessDailyAnalysis, asOfDate: string): BusinessDailyAnalysis {
  // Build a day-lookup from recentDays (keywords: string[] → Set<string>)
  const dayMap = new Map<string, DailySessionRecord>();
  for (const d of biz.recentDays) {
    dayMap.set(d.date, { ...d, keywords: new Set(d.keywords) });
  }

  const latestDay = dayMap.get(asOfDate) ?? null;

  // daysActive: calendar days from firstDate to asOfDate (clamped at 1)
  const daysActive = biz.firstDate ? Math.max(daysBetween(biz.firstDate, asOfDate) + 1, 1) : 0;

  // totalSessions: subtract sessions that happened AFTER asOfDate from the all-time total
  const sessionsAfter = biz.recentDays
    .filter((d) => d.date > asOfDate)
    .reduce((s, d) => s + d.total, 0);
  const totalSessions = Math.max(biz.totalSessions - sessionsAfter, 0);

  // 7-day rolling window ending on asOfDate
  // Skip days before firstDate — pre-launch days are not gaps
  let win7Total = 0, win7Success = 0, gapDays7 = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(asOfDate, -i);
    if (biz.firstDate && d < biz.firstDate) continue;
    const rec = dayMap.get(d);
    if (!rec || rec.total === 0) gapDays7++;
    else { win7Total += rec.total; win7Success += rec.success; }
  }
  const avg7DaySessions = win7Total / 7;
  const avg7DaySuccessRate = win7Total > 0 ? win7Success / win7Total : 0;

  // Keyword coverage (up to 30-day lookback from asOfDate)
  const keywordCoverages: KeywordCoverageItem[] = [];
  for (const kw of biz.allKeywords) {
    let daysSince = 30;
    for (let i = 0; i <= 30; i++) {
      const rec = dayMap.get(addDays(asOfDate, -i));
      if (rec?.keywords.has(kw)) { daysSince = i; break; }
    }
    const status: KeywordCoverageItem["status"] = daysSince >= 5 ? "CRITICAL" : daysSince >= 3 ? "WARNING" : "OK";
    keywordCoverages.push({ keyword: kw, daysSinceLastHit: daysSince, status });
  }
  const missedKeywords3Plus = keywordCoverages.filter((k) => k.daysSinceLastHit >= 3).map((k) => k.keyword);
  const missedKeywords5Plus = keywordCoverages.filter((k) => k.daysSinceLastHit >= 5).map((k) => k.keyword);

  // Platform windows ending on asOfDate
  // Stop at firstDate (pre-launch) or at the edge of the recentDays window (no data = can't count silence).
  const earliestInMap = biz.recentDays.length > 0 ? biz.recentDays[0].date : (biz.firstDate ?? "");
  const platformWindows: PlatformWindow[] = PLATFORMS.map((p) => {
    let sessions3 = 0, sessions5 = 0, consecutiveSilent = 0;
    for (let i = 0; i <= 30; i++) {
      const d = addDays(asOfDate, -i);
      if (biz.firstDate && d < biz.firstDate) break;
      if (d < earliestInMap) break; // beyond our data window — can't reliably count silence
      const cnt = dayMap.get(d)?.platforms[p] ?? 0;
      if (i < 3) sessions3 += cnt;
      if (i < 5) sessions5 += cnt;
      if (cnt === 0) consecutiveSilent++;
      else break;
    }
    return {
      platform: p, sessionsLast3Days: sessions3, sessionsLast5Days: sessions5,
      consecutiveDaysSilent: consecutiveSilent,
      status: sessions3 > 0 ? "ACTIVE" : "NO_SESSIONS" as const,
    };
  });

  const { prediction, predictionLabel, predictionEmoji, why, action } = computePrediction({
    daysActive, totalSessions, gapDays7, avg7DaySuccessRate,
    missedKeywords5Plus, platformWindows, missedKeywords3Plus,
  });
  const { phase, label: phaseLabel } = phaseFromDays(daysActive);

  return {
    ...biz,
    latestDate: asOfDate,
    daysActive, totalSessions, phase, phaseLabel,
    latestDayData: latestDay,
    sessionsToday: latestDay?.total ?? 0,
    successRateToday: latestDay?.successRate ?? 0,
    keywordsHitToday: latestDay ? [...latestDay.keywords] : [],
    platformsToday: latestDay?.platforms ?? {},
    avg7DaySessions, avg7DaySuccessRate, gapDays7,
    keywordCoverages, missedKeywords3Plus, missedKeywords5Plus,
    platformWindows, prediction, predictionLabel, predictionEmoji, why, action,
  };
}

// ── Core overview builder (shared by date-less and date-parameterized paths) ──
function buildDailyOverview(sessions: BusinessDailyAnalysis[], asOfDate: string): DailyOverviewData {
  const rankings = getAllRankings();
  const sessMap = new Map(sessions.map((s) => [s.bizName, s]));
  const rankMap = new Map(rankings.map((r) => [r.bizName, r]));

  // sessionsSummary + phase counts (session businesses only)
  const sc = { onTrack: 0, atRisk: 0, stable: 0, tooEarly: 0 };
  let phase1to2Count = 0, phase4to6Count = 0;
  for (const sess of sessions) {
    if (sess.prediction === "ON_TRACK") sc.onTrack++;
    else if (sess.prediction === "AT_RISK") sc.atRisk++;
    else if (sess.prediction === "STABLE") sc.stable++;
    else sc.tooEarly++;
    if (sess.phase <= 2) phase1to2Count++;
    else phase4to6Count++;
  }

  const totalWithComparableRankings = rankings.filter((r) => !r.isFirstRunOnly).length;

  // rankingsSummary — only count businesses with 2+ run dates (comparable)
  // First-run-only businesses are always BASELINE and excluded from change metrics
  const rc = { suddenDrops: 0, suddenImprovements: 0, steadyDrop: 0, steadyImprovement: 0, baseline: 0, noChange: 0 };
  for (const rank of rankings) {
    if (rank.isFirstRunOnly) continue; // skip — no prior run to compare against
    const l = rank.overallLabel;
    if (l === "SUDDEN_DROP" || l === "NOT_FOUND_CRITICAL") rc.suddenDrops++;
    else if (l === "SUDDEN_IMPROVEMENT" || l === "REAPPEARED") rc.suddenImprovements++;
    else if (l === "STEADY_DROP") rc.steadyDrop++;
    else if (l === "STEADY_IMPROVEMENT") rc.steadyImprovement++;
    else if (l === "BASELINE") rc.baseline++;
    else rc.noChange++;
  }

  // most improved / most declined (by absolute spotsChanged magnitude)
  let mostImprovedBiz: DailyOverviewData["mostImprovedBiz"] = null;
  let mostDeclinedBiz: DailyOverviewData["mostDeclinedBiz"] = null;
  for (const rank of rankings) {
    for (const kw of rank.keywords) {
      if (kw.spotsChanged === null) continue;
      if (kw.spotsChanged > 0) {
        if (!mostImprovedBiz || kw.spotsChanged > mostImprovedBiz.spotsChanged)
          mostImprovedBiz = { bizName: rank.bizName, label: kw.label, keyword: kw.keyword, platform: kw.platform, spotsChanged: kw.spotsChanged };
      } else if (kw.spotsChanged < 0) {
        if (!mostDeclinedBiz || kw.spotsChanged < mostDeclinedBiz.spotsChanged)
          mostDeclinedBiz = { bizName: rank.bizName, label: kw.label, keyword: kw.keyword, platform: kw.platform, spotsChanged: kw.spotsChanged };
      }
    }
  }

  const atRiskBusinesses: DailyOverviewData["atRiskBusinesses"] = [];
  const rankAlerts: DailyOverviewData["rankAlerts"] = [];
  const businesses: DailyOverviewData["businesses"] = [];

  const sessionBizNames = new Set(sessions.map((s) => s.bizName));
  const allBizNames = new Set([...sessions.map((s) => s.bizName), ...rankings.map((r) => r.bizName)]);

  for (const bizName of allBizNames) {
    const rank = rankMap.get(bizName);
    const sess = sessMap.get(bizName);
    const hasSessionData = sessionBizNames.has(bizName);
    const l = rank?.overallLabel ?? "BASELINE";
    const pred = sess?.prediction ?? "TOO_EARLY";

    if (sess?.prediction === "AT_RISK") {
      const silentPlatform = sess.platformWindows.find((p) => p.consecutiveDaysSilent >= 5)?.platform ?? null;
      atRiskBusinesses.push({
        bizName, prediction: sess.prediction, predictionEmoji: sess.predictionEmoji,
        why: sess.why, action: sess.action, gapDays7: sess.gapDays7,
        avg7DaySuccessRate: sess.avg7DaySuccessRate,
        missedKeywords5Plus: sess.missedKeywords5Plus, silentPlatform,
        rankLabel: l, latestRankDate: rank?.latestRunDate ?? "",
      });
    }

    if (rank && (l === "SUDDEN_DROP" || l === "SUDDEN_IMPROVEMENT" || l === "NOT_FOUND_CRITICAL" || l === "REAPPEARED")) {
      const alertKw = rank.keywords.find((k) => k.label === l) ?? rank.keywords[0];
      if (alertKw) {
        rankAlerts.push({
          bizName, label: alertKw.label, platform: alertKw.platform, keyword: alertKw.keyword,
          prevRank: alertKw.prevRun?.position ?? null, currentRank: alertKw.currentRun?.position ?? null,
          spotsChanged: alertKw.spotsChanged,
          sessionPrediction: pred, sessionPredictionEmoji: sess?.predictionEmoji ?? "⏳",
          sessionWhy: sess?.why ?? "", sessionAction: sess?.action ?? "",
          gapDays7: sess?.gapDays7 ?? 0, avg7DaySuccessRate: sess?.avg7DaySuccessRate ?? 0,
        });
      }
    }

    const bestRanks: Record<string, number | null> = {};
    if (rank) {
      for (const p of ["ChatGPT", "Gemini", "Perplexity"]) {
        const kwsForPlatform = rank.keywords.filter((k) => k.platform === p && k.currentRun?.position != null);
        bestRanks[p] = kwsForPlatform.length ? Math.min(...kwsForPlatform.map((k) => k.currentRun!.position!)) : null;
      }
    }

    businesses.push({
      bizName, clientName: sess?.clientName ?? "", rankLabel: l, prediction: pred,
      predictionEmoji: sess?.predictionEmoji ?? "⏳",
      predictionLabel: sess?.predictionLabel ?? "Too Early to Assess",
      latestRankDate: rank?.latestRunDate ?? "",
      sessionsToday: sess?.sessionsToday ?? 0,
      successRateToday: sess?.successRateToday ?? 0,
      targetPerDay: sess?.targetPerDay ?? 8,
      avg7DaySessions: Math.round((sess?.avg7DaySessions ?? 0) * 10) / 10,
      avg7DaySuccessRate: sess?.avg7DaySuccessRate ?? 0,
      gapDays7: sess?.gapDays7 ?? 0,
      hasSessionData, isFirstRunOnly: rank?.isFirstRunOnly ?? false, bestRanks,
      campaignName: sess?.campaignName ?? "",
      daysActive: sess?.daysActive ?? 0,
      phase: sess?.phase ?? 1,
      phaseLabel: sess?.phaseLabel ?? "Phase 1 — Launch",
      firstDate: sess?.firstDate ?? "",
      latestDate: sess?.latestDate ?? "",
      nextRankingRunDue: sess?.nextRankingRunDue ?? "",
      why: sess?.why ?? "",
      action: sess?.action ?? "",
      platformWindows: sess?.platformWindows ?? [],
      missedKeywords3Plus: sess?.missedKeywords3Plus ?? [],
      missedKeywords5Plus: sess?.missedKeywords5Plus ?? [],
      keywordsHitToday: sess?.keywordsHitToday ?? [],
      platformsToday: sess?.platformsToday ?? {},
      allKeywords: sess?.allKeywords ?? [],
    });
  }

  const predOrd: Prediction[] = ["AT_RISK", "TOO_EARLY", "STABLE", "ON_TRACK"];
  businesses.sort((a, b) => {
    if (a.hasSessionData !== b.hasSessionData) return a.hasSessionData ? -1 : 1;
    const diff = predOrd.indexOf(a.prediction) - predOrd.indexOf(b.prediction);
    return diff !== 0 ? diff : a.bizName.localeCompare(b.bizName);
  });

  // ── Keyword rotation gap (Jun 6, 2026) ────────────────────────────────────────
  // Businesses that had their keywords rotated on Jun 6 (reached Top 1-3 on old keywords)
  // and are running below the required 8 sessions/day on the new keywords.
  // Window: Jun 6 → asOfDate (grows as new daily CSVs are imported).
  const KW_ROTATION_DATE = "2026-06-06";
  const rotatedSet = new Set<string>(
    rankings
      .filter(r =>
        r.keywords.some(kw => kw.runs.some(run => run.date < KW_ROTATION_DATE)) &&
        r.keywords.some(kw => kw.firstRunDate === KW_ROTATION_DATE)
      )
      .map(r => r.bizName)
  );
  const keywordRotationGap: DailyOverviewData["keywordRotationGap"] = [];
  // Build date range: KW_ROTATION_DATE … asOfDate (inclusive)
  const rotationDates: string[] = [];
  for (let d = KW_ROTATION_DATE; d <= asOfDate; d = addDays(d, 1)) rotationDates.push(d);
  for (const biz of sessions) {
    if (!rotatedSet.has(biz.bizName)) continue;
    const dayMap = new Map(biz.recentDays.map(d => [d.date, d.total]));
    const dailySessions = rotationDates.map(d => ({ date: d, sessions: dayMap.get(d) ?? 0 }));
    const totalSess = dailySessions.reduce((s, d) => s + d.sessions, 0);
    const avg = totalSess / rotationDates.length;
    if (avg < 8) {
      keywordRotationGap.push({
        bizName: biz.bizName, clientName: biz.clientName,
        dailySessions,
        avgSessionsPerDay: Math.round(avg * 10) / 10,
        gapPerDay: Math.round((8 - avg) * 10) / 10,
        isAtRisk: dailySessions.some(d => d.sessions === 0),
      });
    }
  }
  keywordRotationGap.sort((a, b) => {
    if (a.isAtRisk !== b.isAtRisk) return a.isAtRisk ? -1 : 1;
    return b.gapPerDay - a.gapPerDay || a.bizName.localeCompare(b.bizName);
  });

  return {
    asOfDate,
    totalBusinesses: sessions.length,
    totalWithRankings: rankings.length,
    totalWithComparableRankings,
    phase1to2Count,
    phase4to6Count,
    rankingsSummary: rc,
    sessionsSummary: sc,
    mostImprovedBiz,
    mostDeclinedBiz,
    atRiskBusinesses: atRiskBusinesses.sort((a, b) => a.bizName.localeCompare(b.bizName)),
    rankAlerts: rankAlerts.sort((a, b) => {
      const p: Record<string, number> = { NOT_FOUND_CRITICAL: 0, SUDDEN_DROP: 1, SUDDEN_IMPROVEMENT: 2, REAPPEARED: 3 };
      return (p[a.label] ?? 9) - (p[b.label] ?? 9);
    }),
    businesses,
    keywordRotationGap,
    keywordRotationTotal: rotatedSet.size,
  };
}

export function getDailyOverview(): DailyOverviewData {
  const asOfDate = getAsOfDate();
  return getDailyOverviewForDate(asOfDate);
}

/** Returns all businesses with health metrics recomputed as of the given date. */
export function getDailyAnalysisForDate(date: string): BusinessDailyAnalysis[] {
  const predOrd: Prediction[] = ["AT_RISK", "TOO_EARLY", "STABLE", "ON_TRACK"];
  return getAllDailyAnalysis()
    .filter((biz) => biz.firstDate <= date)
    .map((biz) => recomputeForDate(biz, date))
    .sort((a, b) => {
      const diff = predOrd.indexOf(a.prediction) - predOrd.indexOf(b.prediction);
      return diff !== 0 ? diff : a.bizName.localeCompare(b.bizName);
    });
}

export function getDailyOverviewForDate(date: string): DailyOverviewData {
  return buildDailyOverview(getDailyAnalysisForDate(date), date);
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION D — AEO PERFORMANCE ANALYSIS ENGINE
// Normalization formula, health scores, volatility, flags, tiers, ideal flows.
// Data unit: each bi-weekly ranking run = one data point (no separate daily CSV).
// ══════════════════════════════════════════════════════════════════════════════

export type PerformanceTier = "EXCELLENT" | "GOOD" | "AT_RISK" | "CRITICAL";
export type AEOFlagType =
  | "IMMEDIATE_ACTION"     // health score declining ≥ 3 consecutive runs
  | "NEEDS_REVIEW"         // health score declining ≥ 2 consecutive runs
  | "SUDDEN_KEYWORD_DROP"  // track score drops ≥ 10 pts between runs
  | "UNSTABLE_RANKINGS";   // volatility penalty > 0.15 for 3+ consecutive runs

export interface RunScore {
  date: string;
  avgNormalizedScore: number;   // mean of all keyword normalized scores this run
  healthScore: number;          // avgNormalizedScore × (1 - volatilityPenalty)
  volatility: number;           // stddev of run-to-run deltas (last 4 runs)
  volatilityPenalty: number;    // min(volatility / 100, 0.2)
  runDelta: number | null;      // change from previous run's avgNormalizedScore
  keywordCount: number;
}

export interface PlatformAEOData {
  platform: string;
  runs: RunScore[];
  latestHealthScore: number;
  avg4RunHealthScore: number;   // avg of last 4 runs ≈ "7-day avg" in bi-weekly cadence
  healthScoreDelta: number;     // latest vs avg4Run
}

export interface AEOImportantChange {
  type: "HEALTH_SCORE_DELTA" | "SUDDEN_DROP" | "VOLATILITY_SPIKE";
  platform: string;
  description: string;
  delta: number;
  direction: "up" | "down";
}

export interface AEOIdealFlow {
  week1Diagnosis: string;
  week2_3Actions: string[];
  week4Outcome: string;
}

export interface BusinessAEOAnalysis {
  bizName: string;
  // Cross-platform overall
  overallHealthScore: number;
  avg4RunHealthScore: number;
  healthScoreDelta: number;
  performanceTier: PerformanceTier;
  performanceTierLabel: string;
  // Flags
  flags: AEOFlagType[];
  flagLabels: string[];
  // Important changes
  importantChanges: AEOImportantChange[];
  // Per-platform breakdown
  platforms: PlatformAEOData[];
  // Ideal flow (populated only when flagged)
  idealFlow: AEOIdealFlow | null;
  // Metadata
  isNewBusiness: boolean;       // fewer than 3 runs — "Building history"
  latestDataDate: string;
  totalRuns: number;
}

// ── Math helpers ───────────────────────────────────────────────────────────────

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

// Normalization formula (Section 1 of the prompt — source of truth)
function normalizeRankScore(rank: number | null, total: number | null): number {
  if (rank === null || rank === 0) return 0;
  if (total === null || total <= 1) return 100;
  return ((total - rank) / (total - 1)) * 100;
}

function computeTier(score: number): { tier: PerformanceTier; label: string } {
  if (score >= 80) return { tier: "EXCELLENT", label: "Excellent" };
  if (score >= 60) return { tier: "GOOD",      label: "Good" };
  if (score >= 40) return { tier: "AT_RISK",   label: "At Risk" };
  return               { tier: "CRITICAL",  label: "Critical" };
}

function computeIdealFlow(
  flags: AEOFlagType[],
  platforms: PlatformAEOData[],
): AEOIdealFlow {
  const allDecline = platforms.filter(p => p.runs.length > 1)
    .every(p => p.healthScoreDelta <= -5);
  const singleDecline = platforms.filter(p => p.healthScoreDelta <= -5).length === 1;
  const highVol = flags.includes("UNSTABLE_RANKINGS");
  const suddenDrop = flags.includes("SUDDEN_KEYWORD_DROP");

  let week1Diagnosis: string;
  if (flags.includes("IMMEDIATE_ACTION")) {
    week1Diagnosis = allDecline
      ? "Critical decline across all 3 platforms. Identify the top 3 declining keywords. Cross-platform decline = off-page/algorithm issue — check backlinks, brand mentions, and overall domain authority."
      : "Critical decline on specific platform(s). Identify which keywords dropped most and on which platform. Single-platform = algorithm change or session-delivery issue.";
  } else if (flags.includes("NEEDS_REVIEW")) {
    week1Diagnosis = singleDecline
      ? "Consistent decline on one platform for 2 runs. Check session delivery logs for that specific platform and verify keyword variant relevance."
      : "Consistent multi-platform decline for 2 runs. Audit session health — are sessions running every day with no gaps?";
  } else if (suddenDrop) {
    week1Diagnosis = "Sudden track score drop detected. Identify which keywords caused the drop and on which platform. Check session logs for errors on those keywords.";
  } else {
    week1Diagnosis = "Unstable rankings detected. Do not make further page or session changes — allow a full 14-day window to stabilize before evaluating.";
  }

  const week2_3Actions: string[] = allDecline
    ? [
        "Off-page: build backlinks, acquire reviews, and increase brand mentions across the web",
        "Update content depth, examples, FAQs, and schema on key landing pages",
        "Ensure daily sessions run on all 3 platforms with zero gaps for the full 14-day window",
      ]
    : highVol
      ? [
          "Stop making changes to pages or session config — allow stability window",
          "Maintain consistent session cadence with zero gaps",
          "Re-evaluate after one full 14-day ranking cycle",
        ]
      : [
          "Increase session volume on the declining platform without reducing the other two",
          "Check keyword variant relevance and prompt format for the platform that dropped",
          suddenDrop
            ? "Run a technical SEO audit on any keyword that dropped out of the top 20"
            : "Review ranking_total trend — if competition increased, increase session volume to compensate",
        ];

  const week4Outcome = flags.includes("IMMEDIATE_ACTION")
    ? "Auto re-evaluate after the next ranking run. If health score improves by ≥ +5 points, flag clears. If still declining → escalate to Deep Audit."
    : "Re-measure health scores after the next ranking cycle. If improvement ≥ +5 points from current score, flag clears automatically.";

  return { week1Diagnosis, week2_3Actions, week4Outcome };
}

// ── Core loader ────────────────────────────────────────────────────────────────

let _aeoAnalysis: BusinessAEOAnalysis[] | null = null;

function loadAEOAnalysis(): BusinessAEOAnalysis[] {
  const archived = loadArchiveSet();
  const rows = parseCSV(RANKINGS_CSV);

  // biz → platform → date → normalizedScore[]
  type DateMap = Map<string, number[]>;
  type PlatMap = Map<string, DateMap>;
  const bizMap = new Map<string, PlatMap>();

  for (const row of rows) {
    if (row["status"]?.trim() !== "success") continue;
    const biz      = row["biz_name"]?.trim();
    if (biz && archived.has(biz)) continue;
    const platform = normPlatform(row["platform"] ?? "");
    const date     = row["date"]?.trim()?.slice(0, 10);
    if (!biz || !platform || !date || date.length !== 10) continue;

    const rawPos   = row["ranking_position"];
    const rawTotal = row["ranking_total"];
    const rank     = rawPos?.trim()   ? parseInt(rawPos,   10) : null;
    const total    = rawTotal?.trim() ? parseInt(rawTotal, 10) : null;
    const normRank = rank  !== null && !isNaN(rank)  && rank  > 0 ? rank  : null;
    const normTot  = total !== null && !isNaN(total)              ? total : null;
    const score    = normalizeRankScore(normRank, normTot);

    if (!bizMap.has(biz)) bizMap.set(biz, new Map());
    const platMap = bizMap.get(biz)!;
    if (!platMap.has(platform)) platMap.set(platform, new Map());
    const dateMap = platMap.get(platform)!;
    if (!dateMap.has(date)) dateMap.set(date, []);
    dateMap.get(date)!.push(score);
  }

  const results: BusinessAEOAnalysis[] = [];

  for (const [bizName, platMap] of bizMap) {
    const platformData: PlatformAEOData[] = [];

    for (const [platform, dateMap] of platMap) {
      const sortedDates = [...dateMap.keys()].sort();

      // Per-run average normalized score
      const runAvgs: Array<{ date: string; avg: number }> = sortedDates.map(d => {
        const scores = dateMap.get(d)!;
        return { date: d, avg: scores.reduce((a, b) => a + b, 0) / scores.length };
      });

      // Run-to-run deltas
      const deltas: number[] = runAvgs.slice(1).map((r, i) => r.avg - runAvgs[i].avg);

      // Build RunScore for each run
      const runs: RunScore[] = runAvgs.map((ra, i) => {
        const last4Deltas = deltas.slice(Math.max(0, i - 4), i);
        const vol         = stddev(last4Deltas);
        const vPenalty    = Math.min(vol / 100, 0.2);
        return {
          date:                 ra.date,
          avgNormalizedScore:   round1(ra.avg),
          healthScore:          round1(ra.avg * (1 - vPenalty)),
          volatility:           round1(vol),
          volatilityPenalty:    round1(vPenalty * 100) / 100,
          runDelta:             i > 0 ? round1(ra.avg - runAvgs[i - 1].avg) : null,
          keywordCount:         dateMap.get(ra.date)!.length,
        };
      });

      const latest  = runs[runs.length - 1];
      const last4   = runs.slice(-4);
      const avg4Run = round1(last4.reduce((a, r) => a + r.healthScore, 0) / last4.length);

      platformData.push({
        platform,
        runs,
        latestHealthScore: latest.healthScore,
        avg4RunHealthScore: avg4Run,
        healthScoreDelta: round1(latest.healthScore - avg4Run),
      });
    }

    // Cross-platform overall (only platforms with at least 1 run)
    const valid = platformData.filter(p => p.runs.length > 0);
    const overallHealth = valid.length
      ? round1(valid.reduce((a, p) => a + p.latestHealthScore, 0) / valid.length)
      : 0;
    const overallAvg = valid.length
      ? round1(valid.reduce((a, p) => a + p.avg4RunHealthScore, 0) / valid.length)
      : 0;
    const overallDelta = round1(overallHealth - overallAvg);

    const { tier, label: tierLabel } = computeTier(overallHealth);

    // ── Flags ──────────────────────────────────────────────────────────────────
    const flags: AEOFlagType[]   = [];
    const flagLabels: string[]   = [];

    // Build combined overall health time series (average across platforms per date)
    const allDates = new Set<string>();
    platformData.forEach(p => p.runs.forEach(r => allDates.add(r.date)));
    const overallByDate = [...allDates].sort().map(date => {
      const scores = platformData
        .map(p => p.runs.find(r => r.date === date)?.healthScore)
        .filter((s): s is number => s !== undefined);
      return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    }).filter((s): s is number => s !== null);

    // Consecutive-decline flags (run-to-run changes in overall health)
    const overallDeltas = overallByDate.slice(1).map((v, i) => v - overallByDate[i]);
    const last3 = overallDeltas.slice(-3);
    const last2 = overallDeltas.slice(-2);
    if (last3.length >= 3 && last3.every(d => d <= -5)) {
      flags.push("IMMEDIATE_ACTION");
      flagLabels.push("Immediate Action Required — health score declining for 3+ consecutive runs");
    } else if (last2.length >= 2 && last2.every(d => d <= -5)) {
      flags.push("NEEDS_REVIEW");
      flagLabels.push("Needs Review — health score declining for 2 consecutive runs");
    }

    // Sudden keyword drop: any platform's latest run dropped ≥ 10 pts
    for (const p of platformData) {
      if (p.runs.length >= 2) {
        const latest = p.runs[p.runs.length - 1];
        const prev   = p.runs[p.runs.length - 2];
        if (latest.avgNormalizedScore - prev.avgNormalizedScore <= -10) {
          if (!flags.includes("SUDDEN_KEYWORD_DROP")) {
            flags.push("SUDDEN_KEYWORD_DROP");
            flagLabels.push(
              `Sudden Keyword Drop — ${p.platform} track score dropped ${Math.abs(round1(latest.avgNormalizedScore - prev.avgNormalizedScore))} pts`
            );
          }
        }
      }
    }

    // Unstable rankings: volatility penalty > 0.15 for last 3 runs on any platform
    for (const p of platformData) {
      const last3Runs = p.runs.slice(-3);
      if (last3Runs.length >= 3 && last3Runs.every(r => r.volatilityPenalty > 0.15)) {
        if (!flags.includes("UNSTABLE_RANKINGS")) {
          flags.push("UNSTABLE_RANKINGS");
          flagLabels.push(`Unstable Rankings — ${p.platform} volatility penalty > 15% for 3+ consecutive runs`);
        }
      }
    }

    // ── Important changes ─────────────────────────────────────────────────────
    const importantChanges: AEOImportantChange[] = [];

    if (Math.abs(overallDelta) >= 5) {
      importantChanges.push({
        type: "HEALTH_SCORE_DELTA",
        platform: "Overall",
        description: `Overall health score ${overallDelta > 0 ? "improved" : "declined"} by ${Math.abs(overallDelta)} pts vs 4-run average`,
        delta: overallDelta,
        direction: overallDelta > 0 ? "up" : "down",
      });
    }

    for (const p of platformData) {
      if (Math.abs(p.healthScoreDelta) >= 5) {
        importantChanges.push({
          type: "HEALTH_SCORE_DELTA",
          platform: p.platform,
          description: `${p.platform} health score ${p.healthScoreDelta > 0 ? "improved" : "declined"} by ${Math.abs(p.healthScoreDelta)} pts`,
          delta: p.healthScoreDelta,
          direction: p.healthScoreDelta > 0 ? "up" : "down",
        });
      }
      if (p.runs.length >= 2) {
        const latest = p.runs[p.runs.length - 1];
        const prev   = p.runs[p.runs.length - 2];
        const volChange = latest.volatilityPenalty - prev.volatilityPenalty;
        if (volChange > 0.1) {
          importantChanges.push({
            type: "VOLATILITY_SPIKE",
            platform: p.platform,
            description: `${p.platform} volatility spiked — penalty rose by ${Math.round(volChange * 100)}%`,
            delta: volChange,
            direction: "down",
          });
        }
      }
    }

    // ── Metadata ──────────────────────────────────────────────────────────────
    const allRunDates = [...allDates].sort();
    const totalRuns = allRunDates.length;
    const isNewBusiness = totalRuns <= 3;
    const latestDataDate = allRunDates[allRunDates.length - 1] ?? "";

    results.push({
      bizName,
      overallHealthScore: overallHealth,
      avg4RunHealthScore: overallAvg,
      healthScoreDelta: overallDelta,
      performanceTier: tier,
      performanceTierLabel: tierLabel,
      flags,
      flagLabels,
      importantChanges,
      platforms: platformData,
      idealFlow: flags.length > 0 ? computeIdealFlow(flags, platformData) : null,
      isNewBusiness,
      latestDataDate,
      totalRuns,
    });
  }

  // Sort: flagged first, then by health score ascending (worst first)
  const FLAG_PRI: Record<AEOFlagType, number> = {
    IMMEDIATE_ACTION: 0, NEEDS_REVIEW: 1, SUDDEN_KEYWORD_DROP: 2, UNSTABLE_RANKINGS: 3,
  };
  return results.sort((a, b) => {
    const aWorst = a.flags.reduce((min, f) => Math.min(min, FLAG_PRI[f]), 9);
    const bWorst = b.flags.reduce((min, f) => Math.min(min, FLAG_PRI[f]), 9);
    if (aWorst !== bWorst) return aWorst - bWorst;
    return a.overallHealthScore - b.overallHealthScore;
  });
}

export function getAllAEOAnalysis(): BusinessAEOAnalysis[] {
  if (!_aeoAnalysis) _aeoAnalysis = loadAEOAnalysis();
  return _aeoAnalysis;
}

export function getBusinessAEOAnalysis(bizName: string): BusinessAEOAnalysis | null {
  return getAllAEOAnalysis().find(b => b.bizName === bizName) ?? null;
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION E — BACKLINK ACTION ITEMS (from daily consolidated CSVs)
// ══════════════════════════════════════════════════════════════════════════════

export interface BacklinkActionItem {
  bizName: string;
  clientName: string;
  injectedCount: number;
  foundCount: number;
  missedPlatforms: string[];
  foundPlatforms: string[];
  foundUrls: string[];
  status: "CRITICAL" | "PARTIAL" | "RESOLVED";
}

export interface BacklinkActionReport {
  date: string;
  sourceFile: string | null;
  totalBusinessesWithInjected: number;
  totalInjectedSessions: number;
  totalFoundSessions: number;
  detectionRate: number;
  immediateAction: BacklinkActionItem[];
  monitorClosely: BacklinkActionItem[];
  resolved: BacklinkActionItem[];
}

const MONTH_ABBR = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

function findDailyFile(date: string): string | null {
  if (!existsSync(DAILY_CSV_DIR)) return null;
  const d = new Date(date + "T00:00:00Z");
  const mon = MONTH_ABBR[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, "0");
  const pattern = `${mon}${day}`;
  let files: string[] = [];
  try { files = readdirSync(DAILY_CSV_DIR).filter(f => f.endsWith(".csv") || f.endsWith(".csv")); }
  catch { return null; }
  const match = files.find(f => f.toLowerCase().includes(pattern));
  return match ? resolve(DAILY_CSV_DIR, match) : null;
}

export function getBacklinkActionItems(date: string): BacklinkActionReport {
  const filePath = findDailyFile(date);
  if (!filePath) {
    return {
      date, sourceFile: null,
      totalBusinessesWithInjected: 0, totalInjectedSessions: 0,
      totalFoundSessions: 0, detectionRate: 0,
      immediateAction: [], monitorClosely: [], resolved: [],
    };
  }

  const rows = parseCSV(filePath);
  const injected = rows.filter(r => r["backlink_injected"]?.toLowerCase() === "true");

  // Build a biz→clientName lookup from master session data (has human-readable names;
  // individual daily CSVs store numeric IDs in client_name)
  const _masterData = getAllDailyAnalysis();
  const bizClientLookup = new Map(_masterData.map(b => [b.bizName, b.clientName]));

  // Group by business
  const bizMap = new Map<string, { clientName: string; sessions: Array<{ platform: string; found: boolean; url: string }> }>();
  for (const r of injected) {
    const biz = r["biz_name"]?.trim();
    if (!biz) continue;
    const clientName = bizClientLookup.get(biz) ?? r["client_name"]?.trim() ?? "";
    if (!bizMap.has(biz)) bizMap.set(biz, { clientName, sessions: [] });
    bizMap.get(biz)!.sessions.push({
      platform: normPlatform(r["platform"] ?? r["ai_platform"] ?? ""),
      found: r["backlink_found"]?.toLowerCase() === "true",
      url: r["backlink_url"]?.trim() ?? "",
    });
  }

  const immediateAction: BacklinkActionItem[] = [];
  const monitorClosely: BacklinkActionItem[] = [];
  const resolved: BacklinkActionItem[] = [];

  for (const [bizName, data] of bizMap) {
    const { clientName, sessions } = data;
    const injectedCount = sessions.length;
    const foundCount = sessions.filter(s => s.found).length;
    const missedPlatforms = sessions.filter(s => !s.found).map(s => s.platform);
    const foundPlatforms = sessions.filter(s => s.found).map(s => s.platform);
    const foundUrls = [...new Set(sessions.filter(s => s.found && s.url).map(s => s.url))];

    const item: BacklinkActionItem = {
      bizName, clientName, injectedCount, foundCount,
      missedPlatforms, foundPlatforms, foundUrls,
      status: foundCount === 0 ? "CRITICAL" : foundCount < injectedCount ? "PARTIAL" : "RESOLVED",
    };

    if (item.status === "CRITICAL") immediateAction.push(item);
    else if (item.status === "PARTIAL") monitorClosely.push(item);
    else resolved.push(item);
  }

  // If a PARTIAL business has all 3 platforms ACTIVE in session data, it doesn't need
  // monitoring — the backlink miss is a rotation gap, not a session health problem.
  // Move those from monitorClosely → resolved.
  const platformActiveSet = new Set<string>();
  for (const biz of _masterData) {
    const windows = biz.platformWindows ?? [];
    if (windows.length > 0 && windows.every((w: { status: string }) => w.status === "ACTIVE")) {
      platformActiveSet.add(biz.bizName);
    }
  }
  const monitorCloselyFiltered: BacklinkActionItem[] = [];
  for (const item of monitorClosely) {
    if (platformActiveSet.has(item.bizName)) {
      resolved.push(item);
    } else {
      monitorCloselyFiltered.push(item);
    }
  }

  // Sort immediate action by most injections (highest effort wasted first)
  immediateAction.sort((a, b) => b.injectedCount - a.injectedCount);
  monitorCloselyFiltered.sort((a, b) => (b.injectedCount - b.foundCount) - (a.injectedCount - a.foundCount));
  resolved.sort((a, b) => a.bizName.localeCompare(b.bizName));

  const totalInjectedSessions = injected.length;
  const totalFoundSessions = injected.filter(r => r["backlink_found"]?.toLowerCase() === "true").length;

  return {
    date,
    sourceFile: filePath.split("/").pop() ?? null,
    totalBusinessesWithInjected: bizMap.size,
    totalInjectedSessions,
    totalFoundSessions,
    detectionRate: totalInjectedSessions > 0 ? totalFoundSessions / totalInjectedSessions : 0,
    immediateAction,
    monitorClosely: monitorCloselyFiltered,
    resolved,
  };
}
