import { readFileSync, writeFileSync } from "fs";
import { resolve, basename } from "path";

import { readdirSync, existsSync } from "fs";
import { isFreeTrial, NO_SESSIONS_YET } from "./free-trial-businesses.js";

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
  _rankings = null; _dailyAnalysis = null; _aeoAnalysis = null; _variantMap = null; _campaignPlatformActuals = null;
}

export function reactivateBusiness(bizName: string): boolean {
  const set = loadArchiveSet();
  if (!set.has(bizName)) return false;
  set.delete(bizName);
  writeFileSync(ARCHIVE_FILE, JSON.stringify({ archived: [...set].sort() }, null, 2));
  _rankings = null; _dailyAnalysis = null; _aeoAnalysis = null; _variantMap = null; _campaignPlatformActuals = null;
  return true;
}

export function clearCache(): void {
  _rankings = null; _dailyAnalysis = null; _aeoAnalysis = null; _variantMap = null; _campaignPlatformActuals = null;
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

// Net trend across a business's tracked keywords — unlike worstLabel (which flags a business red
// if ANY single keyword out of many dropped), this weighs declining keywords against improving
// ones directly; "flat" keywords only decide the outcome when drop/improve momentum is tied (most
// keywords sit within-tier day to day, so a flat-inclusive plurality vote would wash out real
// minority-but-real drift instead of surfacing it).
// Used only for the daily-overview headline chart; per-business badges/alerts still use worstLabel
// so a single concerning keyword still surfaces there.
function netTrendLabel(labels: RankLabel[]): RankLabel {
  const comparable = labels.filter((l) => l !== "BASELINE");
  if (!comparable.length) return "BASELINE";
  let severeDrop = 0, mildDrop = 0, mildUp = 0, severeUp = 0;
  for (const l of comparable) {
    if (l === "SUDDEN_DROP" || l === "NOT_FOUND_CRITICAL") severeDrop++;
    else if (l === "STEADY_DROP") mildDrop++;
    else if (l === "SUDDEN_IMPROVEMENT" || l === "REAPPEARED") severeUp++;
    else if (l === "STEADY_IMPROVEMENT") mildUp++;
  }
  const dropTotal = severeDrop + mildDrop;
  const upTotal = mildUp + severeUp;
  if (dropTotal === upTotal) return "NO_CHANGE"; // includes the all-flat case (both 0)
  if (dropTotal > upTotal) return severeDrop >= mildDrop ? "SUDDEN_DROP" : "STEADY_DROP";
  return severeUp >= mildUp ? "SUDDEN_IMPROVEMENT" : "STEADY_IMPROVEMENT";
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
    const biz = resolveBizNameForRow(row["biz_name"]?.trim() ?? "", row["campaign_id"]?.trim() ?? "");
    if (!biz || archived.has(biz)) continue;
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

export interface ImprovementPriority {
  level: "critical" | "warning" | "opportunity";
  category: "sessions" | "keywords" | "platform" | "rank";
  message: string;
  detail: string;
}

export interface DailySessionRecord {
  date: string;
  total: number;
  success: number;
  successRate: number;
  platforms: Record<string, number>;   // platform → count
  keywords: Set<string>;
  rankSessions: number;    // sessions where has_rank === "True"
  noRankSessions: number;  // sessions where has_rank === "False"
  rankPositions: number[]; // position values from ranked sessions
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

  // Raw daily records (last 30 days, serializable)
  recentDays: Array<Omit<DailySessionRecord, "keywords"> & { keywords: string[] }>;

  // Keyword variants seen in daily CSVs (canonical kw → variant phrasings used)
  keywordVariants: Record<string, string[]>;

  // Rank signals from daily CSV sessions (has_rank / rank_position columns)
  hasRankData: boolean;
  rankDetectionRate: number | null;  // % of sessions where AI cited this business
  avgRankPosition: number | null;    // average position when cited

  // Computed improvement priority list (ranked critical → warning → opportunity)
  improvementPriorities: ImprovementPriority[];
}

const PLATFORMS = ["ChatGPT", "Gemini", "Perplexity"] as const;

function phaseFromDays(daysActive: number): { phase: number; label: string } {
  if (daysActive <= 3) return { phase: 1, label: "Phase 1 — Launch" };
  if (daysActive <= 14) return { phase: 2, label: "Phase 2 — Warmup" };
  if (daysActive <= 28) return { phase: 4, label: "Phase 4 — Build" };
  return { phase: 6, label: "Phase 6 — Sustain and Grow" };
}

// Extract canonical date from a daily CSV filename (e.g. "jun15_daily_*.csv" → "2026-06-15")
const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function extractDateFromFilename(filename: string): string | null {
  const m = filename.match(/^([a-z]{3})(\d{2})_/i);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;
  return `2026-${month}-${m[2]}`;
}

// Recursively collect .csv files under a directory (daily CSVs have been reorganized into
// dated subfolders like "csv/June Folder/" — a flat readdirSync silently finds nothing there).
function listCsvFilesRecursive(dir: string): string[] {
  let out: string[] = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) out = out.concat(listCsvFilesRecursive(full));
    else if (e.isFile() && e.name.toLowerCase().endsWith(".csv")) out.push(full);
  }
  return out;
}

// Classifies a daily CSV filename and determines whether to trust its filename-encoded date.
//
// 2026-07-20 investigation history (kept so this isn't re-litigated from scratch): the 5
// "daily_2026-06-2[6-9]/30_success.csv" files each have a `date`/`timestamp` column that disagrees
// with their own filename by 1-2 days. Checked all 5 together by raw timestamp: they form one
// continuous, gapless stream (median gap between consecutive rows 33s, only one >10min gap per
// file) running from 2026-06-28T03:34:46Z through 2026-07-02T03:19:28Z, with zero activity
// anywhere before 06-28 03:34 in this batch or any other file in the repo — and the filename-to-
// content offsets are inconsistent (+2, +2, +1, +1, +1 days), which only makes sense as arbitrary
// sequential batch labels rather than a single dating bug. That evidence argues for trusting the
// date column, not the filename. The client confirmed twice, directly, that these files represent
// real per-day sessions and the filenames should be trusted (matching the older jun-format
// convention) despite that evidence — so filename wins here. Known, accepted consequence: since no
// file exists named for 07-01 or 07-02, trusting filenames means those 2 dates now show zero
// sessions in the dashboard (they previously inherited spillover from these files under the old
// date-column-trust behavior).
function classifyDailyFile(filename: string): { recognized: boolean; canonicalDate: string | null } {
  const oldFormatDate = extractDateFromFilename(filename);
  if (oldFormatDate) return { recognized: true, canonicalDate: oldFormatDate };
  const newFormatMatch = filename.match(/^daily_(\d{4}-\d{2}-\d{2})_/i);
  if (newFormatMatch) return { recognized: true, canonicalDate: newFormatMatch[1] };
  return { recognized: false, canonicalDate: null };
}

function computeImprovementPriorities(a: {
  gapDays7: number;
  platformWindows: PlatformWindow[];
  avg7DaySuccessRate: number;
  missedKeywords5Plus: string[];
  missedKeywords3Plus: string[];
  hasRankData: boolean;
  rankDetectionRate: number | null;
  avgRankPosition: number | null;
}): ImprovementPriority[] {
  const out: ImprovementPriority[] = [];

  // 🔴 Critical — session gaps
  if (a.gapDays7 >= 2) {
    out.push({
      level: "critical", category: "sessions",
      message: `${a.gapDays7} days with zero sessions in the last 7`,
      detail: "Run sessions every day — gaps directly hurt ranking momentum.",
    });
  }

  // 🔴 Critical — platform silent 5+ days
  const silent5 = a.platformWindows.find(p => p.consecutiveDaysSilent >= 5);
  if (silent5) {
    out.push({
      level: "critical", category: "platform",
      message: `${silent5.platform} has received zero sessions for ${silent5.consecutiveDaysSilent} consecutive days`,
      detail: `Send sessions to ${silent5.platform} today — extended silence signals content abandonment to AI engines.`,
    });
  }

  // 🔴 Critical — not being cited in AI answers
  if (a.hasRankData && a.rankDetectionRate !== null && a.rankDetectionRate < 0.3) {
    out.push({
      level: "critical", category: "rank",
      message: `Only ${Math.round(a.rankDetectionRate * 100)}% of sessions result in an AI citation`,
      detail: "Business largely invisible in AI answers. Review content quality, NAP consistency, and local schema markup.",
    });
  }

  // 🟡 Warning — low success rate
  if (a.avg7DaySuccessRate < 0.70) {
    out.push({
      level: "warning", category: "sessions",
      message: `Session success rate critically low at ${Math.round(a.avg7DaySuccessRate * 100)}%`,
      detail: "More than 1 in 3 sessions is failing. Fix proxy or platform errors before the next ranking run.",
    });
  }

  // 🟡 Warning — keywords missed 5+ days
  for (const kw of a.missedKeywords5Plus.slice(0, 2)) {
    out.push({
      level: "warning", category: "keywords",
      message: `"${kw}" not hit in 5+ days`,
      detail: "Re-cover this keyword in the next session wave — extended absence weakens its citation signal.",
    });
  }

  // 🟡 Warning — ranking low in AI answers
  if (a.hasRankData && a.avgRankPosition !== null && a.avgRankPosition > 10) {
    out.push({
      level: "warning", category: "rank",
      message: `Average AI rank position is ${a.avgRankPosition.toFixed(1)} — outside top 10`,
      detail: "Optimize content for direct answer format. Target top 5 by improving NAP signals and review quality.",
    });
  }

  // 🟡 Warning — platform silent 3–4 days
  const silent3 = a.platformWindows.find(p => p.consecutiveDaysSilent >= 3 && p.consecutiveDaysSilent < 5);
  if (silent3 && !silent5) {
    out.push({
      level: "warning", category: "platform",
      message: `${silent3.platform} silent for ${silent3.consecutiveDaysSilent} days`,
      detail: `Include ${silent3.platform} in the next wave to maintain platform coverage.`,
    });
  }

  // 🟡 Warning — success rate below target
  if (a.avg7DaySuccessRate >= 0.70 && a.avg7DaySuccessRate < 0.90) {
    out.push({
      level: "warning", category: "sessions",
      message: `Success rate at ${Math.round(a.avg7DaySuccessRate * 100)}% — below 90% target`,
      detail: "Review session error logs to push success rate above 90% for optimal ranking signal.",
    });
  }

  // 🟢 Opportunity — keywords missed 3 days (not already in 5+ list)
  const missed3Only = a.missedKeywords3Plus.filter(kw => !a.missedKeywords5Plus.includes(kw));
  for (const kw of missed3Only.slice(0, 2)) {
    out.push({
      level: "opportunity", category: "keywords",
      message: `"${kw}" not hit in 3 days — getting stale`,
      detail: "Rotate this keyword back into upcoming sessions to maintain coverage.",
    });
  }

  // 🟢 Opportunity — rank position could improve
  if (a.hasRankData && a.avgRankPosition !== null && a.avgRankPosition > 5 && a.avgRankPosition <= 10) {
    out.push({
      level: "opportunity", category: "rank",
      message: `Average AI rank position is ${a.avgRankPosition.toFixed(1)} — in top 10 but not top 5`,
      detail: "Add more hyperlocal signals (neighbourhood names, landmarks) to push into top 5 citations.",
    });
  }

  return out;
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
  const files = listCsvFilesRecursive(DAILY_CSV_DIR);

  for (const file of files) {
    const rows = parseCSV(file);
    for (const row of rows) {
      const biz = resolveBizNameForRow(row["biz_name"]?.trim() ?? "", row["campaign_id"]?.trim() ?? "");
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

/**
 * Name aliases — maps old/inconsistent pipeline biz_names to the canonical current name.
 * Reason: the pipeline occasionally renames businesses mid-stream (capitalisation changes,
 * location suffix dropped, etc.). Without this map the server treats them as separate
 * businesses and the old name appears "silent" even though the campaign is still running.
 */
const BIZ_NAME_ALIASES: Record<string, string> = {
  // Leo Lapuerta — RESTORED the collapse-to-generic aliases for these 4 location-suffixed names
  // on 2026-07-19, reversing a 2026-07-17 change. What happened: cross-referencing against the
  // client roster showed these 4 names are legitimate separate roster entries while the generic
  // bucket isn't, so the aliases were removed to preserve explicit historical location data.
  // But verified against live Health Monitor output: the pipeline stopped tagging these 4 names
  // entirely after 2026-06-13 — every session since then (the campaign never actually stopped)
  // lands under the generic "Leo Lapuerta, MD Plastic Surgery" name instead. With the aliases
  // removed, these 4 permanently show 7-day gaps / "Under Observation" / 0.0 avg-per-day — a
  // false "gone silent" alarm for a real, currently-active client, forever, since the pipeline
  // will never produce these exact names again. That's worse than the original problem. Re-
  // collapsing them keeps ongoing/gap-day monitoring accurate (correctly shows as active via the
  // generic bucket); their pre-Jun-13 session history is still on record, just no longer split
  // out as its own live-monitored entity. Campaign_id can't safely reconstruct the split anyway —
  // campaign 10 conflicts ~130/70 between the 14503 and 1919 addresses, campaign 11 conflicts
  // ~117/70 between Webster and Pearland (real conflicting data, not a rare mislabel).
  "Leo Lapuerta, MD Plastic Surgery, 14503 Houston": "Leo Lapuerta, MD Plastic Surgery",
  "Leo Lapuerta, MD Plastic Surgery, 1919 Houston":  "Leo Lapuerta, MD Plastic Surgery",
  "Leo Lapuerta, MD Plastic Surgery, Katy":          "Leo Lapuerta, MD Plastic Surgery",
  "Leo Lapuerta, MD Plastic Surgery, Webster":       "Leo Lapuerta, MD Plastic Surgery",
  // Note: Clute and Pearland are NOT aliased — verified both are still receiving sessions under
  // their own exact name through the current date, so no staleness risk from tracking them
  // separately (unlike the 4 above).
  // My Eye Guy Coffee Guy — was aliased backwards (rewrote the roster-matching name AWAY to a
  // name that isn't in the roster at all). Fixed 2026-07-17: now maps the odd-caps pipeline
  // variant to the name that actually appears in csv/Client/Client and business v2.xlsx.
  "My EYE GUY Coffee Guy": "My Eye Guy Coffee Guy",
  // American Plumbing Co — pipeline sometimes drops the ", San Diego" suffix (campaign_id 14).
  // Roster (v2.xlsx) has the suffixed form under client "American Plumbing Co".
  "American Plumbing Co | Plumber in San Diego": "American Plumbing Co | Plumber in San Diego, San Diego",
};

function resolveBizName(raw: string): string {
  return BIZ_NAME_ALIASES[raw] ?? raw;
}

// Overrides keyed by campaign_id, applied BEFORE the biz_name-keyed alias map above. Use only
// when the row's own biz_name text is unreliable but campaign_id maps to a consistent address —
// unlike BIZ_NAME_ALIASES (which trusts biz_name text), this distrusts biz_name entirely for
// these specific campaigns.
const CAMPAIGN_ID_BIZ_OVERRIDE: Record<string, string> = {
  // Atlanta Basement Design — verified 2026-07-17: biz_name text alternates between "Johns
  // Creek" and "Roswell" for the SAME campaign_id ~30% of the time, but the campaign_name/address
  // is 100% consistent per campaign_id (no conflicts) — campaign 47 is always 6000 Medlock Bridge
  // Pkwy, Johns Creek, GA; campaign 46 is always 1425 Old Ellis Road, Roswell, GA. Both are
  // separate legitimate roster entries (client: Judith Smith).
  "47": "Atlanta Basement Design, Johns Creek",
  "46": "Atlanta Basement Design, Roswell",
  "433362": "Atlanta Basement Design, Johns Creek", // stray duplicate id, same address as 47
};

function resolveBizNameForRow(rawBiz: string, campaignId: string): string {
  return CAMPAIGN_ID_BIZ_OVERRIDE[campaignId] ?? resolveBizName(rawBiz);
}

function loadDailyAnalysis(): BusinessDailyAnalysis[] {
  const archived = loadArchiveSet();

  type BizData = {
    campaignIds: Set<string>;
    keywords: Set<string>;
    campaignName: string;
    clientName: string;
    days: Map<string, DailySessionRecord>;
  };
  const bizMap = new Map<string, BizData>();

  // Dedup across SESSIONS_CSV and daily CSVs by timestamp+biz_name
  const seenTimestamps = new Set<string>();

  function processRow(row: Record<string, string>, canonicalDate: string | null) {
    const rawBiz = row["biz_name"]?.trim();
    if (!rawBiz) return;
    const biz = resolveBizNameForRow(rawBiz, row["campaign_id"]?.trim() ?? "");
    if (archived.has(biz)) return;

    // Filename date wins for daily CSVs; fall back to date column for SESSIONS_CSV
    const date = canonicalDate ?? row["date"]?.slice(0, 10);
    if (!date || date.length !== 10) return;

    // Dedup by timestamp+biz
    const ts = row["timestamp"]?.trim();
    if (ts) {
      const key = `${ts}|||${biz}`;
      if (seenTimestamps.has(key)) return;
      seenTimestamps.add(key);
    }

    const platform = normPlatform(row["ai_platform"] ?? row["platform"] ?? "");
    const keyword = (row["keyword_text"] ?? row["keyword"] ?? "").trim();
    const campaignId = row["campaign_id"]?.trim() ?? "";
    const isSuccess = row["status"] === "success";
    const campaignName = row["campaign_name"]?.trim() ?? "";
    const clientName = row["client_name"]?.trim() ?? "";

    // Rank signals (only present in newer daily CSV format)
    const hasRankCol = "has_rank" in row;
    const hasRank = row["has_rank"] === "True";
    const rankPos = row["rank_position"]?.trim();
    const rankPosNum = rankPos && rankPos !== "" && rankPos !== "null" ? parseInt(rankPos, 10) : null;

    if (!bizMap.has(biz)) bizMap.set(biz, { campaignIds: new Set(), keywords: new Set(), campaignName, clientName, days: new Map() });
    const bd = bizMap.get(biz)!;
    if (campaignId) bd.campaignIds.add(campaignId);
    if (keyword) bd.keywords.add(keyword);
    if (campaignName && !bd.campaignName) bd.campaignName = campaignName;
    if (clientName && !bd.clientName) bd.clientName = clientName;

    if (!bd.days.has(date)) {
      bd.days.set(date, { date, total: 0, success: 0, successRate: 0, platforms: {}, keywords: new Set(), rankSessions: 0, noRankSessions: 0, rankPositions: [] });
    }
    const day = bd.days.get(date)!;
    day.total++;
    if (isSuccess) day.success++;
    if (platform) day.platforms[platform] = (day.platforms[platform] ?? 0) + 1;
    if (keyword) day.keywords.add(keyword);

    // Rank data (only when has_rank column is present)
    if (hasRankCol) {
      if (hasRank) {
        day.rankSessions++;
        if (rankPosNum !== null && !isNaN(rankPosNum) && rankPosNum > 0) day.rankPositions.push(rankPosNum);
      } else {
        day.noRankSessions++;
      }
    }
  }

  // ── 1. Load SESSIONS_CSV (historical baseline) ─────────────────────────────
  for (const row of parseCSV(SESSIONS_CSV)) processRow(row, null);

  // ── 2. Load daily consolidated CSV files (jun15–present, recursively — files may be
  //      organized into dated subfolders like "csv/June Folder/") ──────────────────
  // Old filename format's date overrides any UTC-bled date column values. New format
  // ("daily_YYYY-MM-DD_*.csv") has an unreliable filename date — falls back to each row's
  // own `date` column instead (see classifyDailyFile).
  if (existsSync(DAILY_CSV_DIR)) {
    const files = listCsvFilesRecursive(DAILY_CSV_DIR);
    for (const file of files) {
      const { recognized, canonicalDate } = classifyDailyFile(basename(file));
      if (!recognized) continue; // skip non-daily files (rankings, client roster, etc.)
      for (const row of parseCSV(file)) processRow(row, canonicalDate);
    }
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

    // Rank signals — aggregate across ALL days
    let totalRankSessions = 0, totalNoRankSessions = 0;
    const allRankPositions: number[] = [];
    for (const day of bd.days.values()) {
      totalRankSessions += day.rankSessions;
      totalNoRankSessions += day.noRankSessions;
      allRankPositions.push(...day.rankPositions);
    }
    const hasRankData = (totalRankSessions + totalNoRankSessions) > 0;
    const rankDetectionRate = hasRankData
      ? totalRankSessions / (totalRankSessions + totalNoRankSessions)
      : null;
    const avgRankPosition = allRankPositions.length > 0
      ? Math.round((allRankPositions.reduce((s, v) => s + v, 0) / allRankPositions.length) * 10) / 10
      : null;

    // Improvement priorities
    const improvementPriorities = computeImprovementPriorities({
      gapDays7, platformWindows, avg7DaySuccessRate,
      missedKeywords5Plus, missedKeywords3Plus,
      hasRankData, rankDetectionRate, avgRankPosition,
    });

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
      hasRankData, rankDetectionRate, avgRankPosition,
      improvementPriorities,
    });
  }

  // ── 3. Inject "not started" placeholders for paying clients with zero sessions ──
  // (see NO_SESSIONS_YET in free-trial-businesses.ts). Without this, these clients are
  // invisible everywhere downstream, since every view here is built by iterating session rows —
  // a client with zero rows never gets an entry at all.
  const todayIso = new Date().toISOString().slice(0, 10);
  for (const bizName of NO_SESSIONS_YET) {
    if (bizMap.has(bizName) || archived.has(bizName)) continue;
    results.push({
      bizName, clientName: "", campaignName: "", numCampaigns: 1, targetPerDay: 8,
      allKeywords: [], daysActive: 0, totalSessions: 0,
      firstDate: "", latestDate: "", phase: 0, phaseLabel: "Not Started",
      latestDayData: null, sessionsToday: 0, successRateToday: 0,
      keywordsHitToday: [], platformsToday: {},
      avg7DaySessions: 0, avg7DaySuccessRate: 0, gapDays7: 0,
      keywordCoverages: [], missedKeywords3Plus: [], missedKeywords5Plus: [],
      platformWindows: PLATFORMS.map((p) => ({
        platform: p, sessionsLast3Days: 0, sessionsLast5Days: 0,
        consecutiveDaysSilent: 0, status: "NO_SESSIONS" as const,
      })),
      prediction: "TOO_EARLY", predictionLabel: "Not Started — No Sessions Yet", predictionEmoji: "🆕",
      why: "This client has been onboarded but no sessions have run yet.",
      action: "Kick off session generation for this campaign.",
      nextRankingRunDue: addDays(todayIso, 14),
      recentDays: [],
      keywordVariants: {},
      hasRankData: false, rankDetectionRate: null, avgRankPosition: null,
      improvementPriorities: [],
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
// SECTION D — PER-CAMPAIGN PLATFORM ACTUALS (for Platform Allocation feature)
// ══════════════════════════════════════════════════════════════════════════════
// Unlike loadDailyAnalysis (which aggregates at the BUSINESS level — summing all of a
// business's campaigns together), this aggregates at the CAMPAIGN level, since a single
// business can run multiple campaigns (different locations/addresses) each with its own
// platform-allocation targets. Runs its own pass over the same CSVs rather than piggybacking
// on loadDailyAnalysis's bizMap, since campaign_id isn't tracked per-day there.

export interface CampaignPlatformDay {
  date: string;
  chatgpt: number;
  gemini: number;
  perplexity: number;
  total: number;
}

export interface CampaignPlatformActuals {
  campaignId: string;
  campaignName: string;
  bizName: string;
  clientName: string;
  days: CampaignPlatformDay[]; // sorted ascending by date
}

let _campaignPlatformActuals: CampaignPlatformActuals[] | null = null;

function loadCampaignPlatformActuals(): CampaignPlatformActuals[] {
  const archived = loadArchiveSet();

  type CampData = {
    campaignName: string;
    bizName: string;
    clientName: string;
    days: Map<string, { chatgpt: number; gemini: number; perplexity: number; total: number }>;
  };
  const campMap = new Map<string, CampData>();
  const seenTimestamps = new Set<string>();

  function processRow(row: Record<string, string>, canonicalDate: string | null) {
    const campaignId = row["campaign_id"]?.trim();
    if (!campaignId) return;
    const rawBiz = row["biz_name"]?.trim();
    if (!rawBiz) return;
    const biz = resolveBizNameForRow(rawBiz, campaignId);
    if (archived.has(biz) || isFreeTrial(biz)) return;

    const date = canonicalDate ?? row["date"]?.slice(0, 10);
    if (!date || date.length !== 10) return;

    const ts = row["timestamp"]?.trim();
    if (ts) {
      const key = `${ts}|||${biz}|||${campaignId}`;
      if (seenTimestamps.has(key)) return;
      seenTimestamps.add(key);
    }

    const platform = normPlatform(row["ai_platform"] ?? row["platform"] ?? "");
    const campaignName = row["campaign_name"]?.trim() ?? "";
    const clientName = row["client_name"]?.trim() ?? "";

    if (!campMap.has(campaignId)) {
      campMap.set(campaignId, { campaignName, bizName: biz, clientName, days: new Map() });
    }
    const cd = campMap.get(campaignId)!;
    if (campaignName && !cd.campaignName) cd.campaignName = campaignName;
    if (clientName && !cd.clientName) cd.clientName = clientName;
    if (!cd.days.has(date)) cd.days.set(date, { chatgpt: 0, gemini: 0, perplexity: 0, total: 0 });
    const day = cd.days.get(date)!;
    day.total++;
    if (platform === "ChatGPT") day.chatgpt++;
    else if (platform === "Gemini") day.gemini++;
    else if (platform === "Perplexity") day.perplexity++;
  }

  for (const row of parseCSV(SESSIONS_CSV)) processRow(row, null);
  if (existsSync(DAILY_CSV_DIR)) {
    const files = listCsvFilesRecursive(DAILY_CSV_DIR);
    for (const file of files) {
      const { recognized, canonicalDate } = classifyDailyFile(basename(file));
      if (!recognized) continue;
      for (const row of parseCSV(file)) processRow(row, canonicalDate);
    }
  }

  const results: CampaignPlatformActuals[] = [];
  for (const [campaignId, cd] of campMap) {
    const days = [...cd.days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, ...d }));
    results.push({ campaignId, campaignName: cd.campaignName, bizName: cd.bizName, clientName: cd.clientName, days });
  }
  return results.sort((a, b) => a.bizName.localeCompare(b.bizName) || a.campaignId.localeCompare(b.campaignId));
}

export function getCampaignPlatformActuals(): CampaignPlatformActuals[] {
  if (!_campaignPlatformActuals) _campaignPlatformActuals = loadCampaignPlatformActuals();
  return _campaignPlatformActuals;
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION C — COMBINED DAILY OVERVIEW
// ══════════════════════════════════════════════════════════════════════════════

export interface DailyOverviewData {
  asOfDate: string;
  // Calendar dates with suspiciously zero session volume sandwiched between two normal-volume
  // days — likely a missing/mislabeled source file, not a real outage. See computeDataGapDates.
  dataGapDates: string[];
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
    hasRankData: boolean;
    rankDetectionRate: number | null;
    avgRankPosition: number | null;
    improvementPriorities: ImprovementPriority[];
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
  const allBiz = getAllDailyAnalysis();
  const rankingDates = getAllRankings().map((r) => r.latestRunDate).filter(Boolean);

  // Tally total sessions per calendar date across all businesses, to detect a partial/
  // still-collecting trailing day (e.g. a batch exported mid-day). Treating a partial day as
  // "today" for gap-day/AT_RISK analysis would make every business with a normal cadence look
  // silent, since most won't have a session logged yet for a day that isn't finished.
  const totalsByDate = new Map<string, number>();
  for (const biz of allBiz) {
    for (const d of biz.recentDays) totalsByDate.set(d.date, (totalsByDate.get(d.date) ?? 0) + d.total);
  }
  const sortedDates = [...totalsByDate.keys()].sort();
  let sessionAsOf = sortedDates[sortedDates.length - 1] ?? "";
  if (sortedDates.length >= 2) {
    const latestTotal = totalsByDate.get(sortedDates[sortedDates.length - 1])!;
    const priorTotal = totalsByDate.get(sortedDates[sortedDates.length - 2])!;
    if (priorTotal > 0 && latestTotal < priorTotal * 0.5) sessionAsOf = sortedDates[sortedDates.length - 2];
  }

  return [sessionAsOf, ...rankingDates].filter(Boolean).sort().pop() ?? new Date().toISOString().slice(0, 10);
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

  const improvementPriorities = computeImprovementPriorities({
    gapDays7, platformWindows, avg7DaySuccessRate,
    missedKeywords5Plus, missedKeywords3Plus,
    hasRankData: biz.hasRankData,
    rankDetectionRate: biz.rankDetectionRate,
    avgRankPosition: biz.avgRankPosition,
  });

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
// Detects calendar dates with suspiciously zero session volume sandwiched between two days of
// normal volume — a signature of a missing/mislabeled source file rather than a real portfolio-
// wide outage (a real outage would also show reduced volume on the days immediately adjacent as
// things ramp down/back up; an isolated single-file gap does not). Verified 2026-07-20: for the
// "daily_YYYY-MM-DD_success.csv" batch, every file's rows are dated 1-2 days AFTER its own
// filename (never on it), while all 24 preceding "junNN_..." files match their filename exactly —
// so an isolated zero day here is far more likely a labeling/export gap than a true outage. This
// is reported to the UI as a caveat, not silently corrected — we can't be certain from the CSVs
// alone, and asserting either way risks hiding a real incident or crying wolf over a labeling bug.
/**
 * Calendar dates within the last 45 days (the longest rolling window used anywhere in this file)
 * with zero session volume portfolio-wide despite normal volume immediately before and after —
 * a signature of a missing/mislabeled source file rather than a real outage. Exposed so any route
 * can surface it as a caveat alongside gap-day / AT_RISK counts.
 */
export function getRecentDataGapDates(asOfDate?: string): string[] {
  const date = asOfDate ?? getAsOfDate();
  return computeDataGapDates().filter((d) => d >= addDays(date, -45));
}

function computeDataGapDates(): string[] {
  // Built from getCampaignPlatformActuals() rather than per-business recentDays — recentDays is a
  // trailing-30-day window computed PER BUSINESS relative to that business's own latest date, so
  // aggregating it across businesses with different windows produces spurious dips wherever fewer
  // businesses' windows happen to overlap. getCampaignPlatformActuals aggregates every raw CSV row
  // by its own date column directly, so a date's total here is a true, window-independent count.
  const actuals = getCampaignPlatformActuals();
  const totalsByDate = new Map<string, number>();
  for (const c of actuals) {
    for (const d of c.days) totalsByDate.set(d.date, (totalsByDate.get(d.date) ?? 0) + d.total);
  }
  const seenDates = [...totalsByDate.keys()].sort();
  if (seenDates.length < 3) return [];
  // Walk every CALENDAR day in the observed range, not just dates that appear as map keys — a
  // date with zero rows anywhere never becomes a key at all, so it would otherwise be silently
  // skipped rather than read as 0. Detects RUNS of one or more consecutive zero days (not just
  // isolated single days) sandwiched between two normal-volume days — a 2-day run like Jun 26-27
  // would never trigger a single-day check, since neither day individually has non-zero neighbors
  // on both sides.
  const dailyTotals: { date: string; total: number }[] = [];
  for (let i = 0; ; i++) {
    const cursor = addDays(seenDates[0], i);
    if (cursor > seenDates[seenDates.length - 1]) break;
    dailyTotals.push({ date: cursor, total: totalsByDate.get(cursor) ?? 0 });
  }

  const gaps: string[] = [];
  let runStart = -1;
  for (let i = 0; i < dailyTotals.length; i++) {
    if (dailyTotals[i].total === 0) {
      if (runStart === -1) runStart = i;
      continue;
    }
    if (runStart !== -1) {
      const before = dailyTotals[runStart - 1]?.total ?? 0;
      const after = dailyTotals[i].total;
      if (before >= 20 && after >= 20) {
        for (let j = runStart; j < i; j++) gaps.push(dailyTotals[j].date);
      }
      runStart = -1;
    }
  }
  return gaps;
}

function buildDailyOverview(allSessions: BusinessDailyAnalysis[], asOfDate: string): DailyOverviewData {
  // Free-trial/test businesses are excluded from Health Monitor and Daily Session features
  // (see free-trial-businesses.ts). Filtering here — not just on the route's response arrays —
  // ensures aggregate counts (rankingsSummary, sessionsSummary, totalBusinesses, etc.) aren't
  // inflated by them too.
  const sessions = allSessions.filter((s) => !isFreeTrial(s.bizName));
  const rankings = getAllRankings().filter((r) => !isFreeTrial(r.bizName));
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
  // Uses netTrendLabel (dominant trend across all tracked keywords), NOT overallLabel (worst
  // single keyword) — otherwise one bad keyword out of ~15 flags the whole business as declining
  // even when most of its keywords are flat or improving. Per-business badges/alerts elsewhere
  // still use overallLabel so a single concerning keyword is still surfaced there.
  const rc = { suddenDrops: 0, suddenImprovements: 0, steadyDrop: 0, steadyImprovement: 0, baseline: 0, noChange: 0 };
  for (const rank of rankings) {
    if (rank.isFirstRunOnly) continue; // skip — no prior run to compare against
    const l = netTrendLabel(rank.keywords.map((k) => k.label));
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
      hasRankData: sess?.hasRankData ?? false,
      rankDetectionRate: sess?.rankDetectionRate ?? null,
      avgRankPosition: sess?.avgRankPosition ?? null,
      improvementPriorities: sess?.improvementPriorities ?? [],
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
    dataGapDates: getRecentDataGapDates(asOfDate),
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
    const biz      = resolveBizNameForRow(row["biz_name"]?.trim() ?? "", row["campaign_id"]?.trim() ?? "");
    if (!biz || archived.has(biz)) continue;
    const platform = normPlatform(row["platform"] ?? "");
    const date     = row["date"]?.trim()?.slice(0, 10);
    if (!platform || !date || date.length !== 10) continue;

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

// Finds every daily CSV file containing rows for the given date — not just the first match.
// New-format files ("daily_YYYY-MM-DD_*.csv") can each span 2+ calendar dates, and a single
// date's rows can be split across multiple files (verified 2026-07-17: 2026-07-01's rows were
// 522 in one file and 938 in another — returning only the first file silently dropped 64% of
// that date's data).
function findDailyFiles(date: string): string[] {
  if (!existsSync(DAILY_CSV_DIR)) return [];
  const d = new Date(date + "T00:00:00Z");
  const mon = MONTH_ABBR[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, "0");
  const pattern = `${mon}${day}`;
  const files = listCsvFilesRecursive(DAILY_CSV_DIR);
  // Old format: filename directly encodes the date — exactly one file should match.
  const nameMatches = files.filter(f => basename(f).toLowerCase().includes(pattern) && classifyDailyFile(basename(f)).canonicalDate !== null);
  if (nameMatches.length) return nameMatches;
  // New format: filename date is unreliable — collect every recognized file whose rows
  // actually contain this date in their own `date` column.
  const contentMatches: string[] = [];
  for (const f of files) {
    if (!classifyDailyFile(basename(f)).recognized) continue;
    const rows = parseCSV(f);
    if (rows.some(r => r["date"]?.slice(0, 10) === date)) contentMatches.push(f);
  }
  return contentMatches;
}

export function getBacklinkActionItems(date: string): BacklinkActionReport {
  const filePaths = findDailyFiles(date);
  if (!filePaths.length) {
    return {
      date, sourceFile: null,
      totalBusinessesWithInjected: 0, totalInjectedSessions: 0,
      totalFoundSessions: 0, detectionRate: 0,
      immediateAction: [], monitorClosely: [], resolved: [],
    };
  }

  // New-format files can span more than one date — restrict to rows matching the requested date.
  const rows = filePaths.flatMap(fp => parseCSV(fp)).filter(r => r["date"]?.slice(0, 10) === date);
  const injected = rows.filter(r => r["backlink_injected"]?.toLowerCase() === "true");

  // Build a biz→clientName lookup from master session data (has human-readable names;
  // individual daily CSVs store numeric IDs in client_name)
  const _masterData = getAllDailyAnalysis();
  const bizClientLookup = new Map(_masterData.map(b => [b.bizName, b.clientName]));

  // Group by business
  const bizMap = new Map<string, { clientName: string; sessions: Array<{ platform: string; found: boolean; url: string }> }>();
  for (const r of injected) {
    const biz = resolveBizNameForRow(r["biz_name"]?.trim() ?? "", r["campaign_id"]?.trim() ?? "");
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
    sourceFile: filePaths.map(fp => fp.split("/").pop()).join(", ") || null,
    totalBusinessesWithInjected: bizMap.size,
    totalInjectedSessions,
    totalFoundSessions,
    detectionRate: totalInjectedSessions > 0 ? totalFoundSessions / totalInjectedSessions : 0,
    immediateAction,
    monitorClosely: monitorCloselyFiltered,
    resolved,
  };
}
