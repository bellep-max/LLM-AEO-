import { useState, useEffect } from "react";
import { AeoChatPanel } from "@/components/aeo-chat-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp, TrendingDown, Minus, Search, BarChart2,
  Loader2, AlertCircle, ChevronRight, Calendar, Activity,
  Target, Info, MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── AEO Analysis types (mirrors csv-data.ts Section D) ────────────────────────
type PerformanceTier = "EXCELLENT" | "GOOD" | "AT_RISK" | "CRITICAL";
type AEOFlagType = "IMMEDIATE_ACTION" | "NEEDS_REVIEW" | "SUDDEN_KEYWORD_DROP" | "UNSTABLE_RANKINGS";

interface RunScore {
  date: string; avgNormalizedScore: number; healthScore: number;
  volatility: number; volatilityPenalty: number; runDelta: number | null; keywordCount: number;
}
interface PlatformAEOData {
  platform: string; runs: RunScore[];
  latestHealthScore: number; avg4RunHealthScore: number; healthScoreDelta: number;
}
interface AEOImportantChange {
  type: string; platform: string; description: string; delta: number; direction: "up" | "down";
}
interface AEOIdealFlow {
  week1Diagnosis: string; week2_3Actions: string[]; week4Outcome: string;
}
interface BusinessAEOAnalysis {
  bizName: string;
  overallHealthScore: number; avg4RunHealthScore: number; healthScoreDelta: number;
  performanceTier: PerformanceTier; performanceTierLabel: string;
  flags: AEOFlagType[]; flagLabels: string[];
  importantChanges: AEOImportantChange[];
  platforms: PlatformAEOData[];
  idealFlow: AEOIdealFlow | null;
  isNewBusiness: boolean; latestDataDate: string; totalRuns: number;
}
// slim shape from /csv/aeo/overview
interface AEOBizSummary {
  bizName: string; overallHealthScore: number; avg4RunHealthScore: number; healthScoreDelta: number;
  performanceTier: PerformanceTier; performanceTierLabel: string;
  flags: AEOFlagType[]; flagLabels: string[];
  isNewBusiness: boolean; latestDataDate: string; totalRuns: number;
  platforms: Array<{ platform: string; latestHealthScore: number; avg4RunHealthScore: number; healthScoreDelta: number }>;
}
interface AEOOverview {
  businesses: AEOBizSummary[];
  tiers: Record<PerformanceTier, number>;
  flagged: AEOBizSummary[];
  importantChanges: Array<AEOImportantChange & { bizName: string }>;
  total: number;
}

// ── Types ──────────────────────────────────────────────────────────────────────
type RankLabel =
  | "SUDDEN_IMPROVEMENT" | "STEADY_IMPROVEMENT" | "NO_CHANGE"
  | "STEADY_DROP" | "SUDDEN_DROP" | "BASELINE"
  | "NOT_FOUND_CRITICAL" | "REAPPEARED";

type Prediction = "ON_TRACK" | "AT_RISK" | "STABLE" | "TOO_EARLY";

interface RankRun { date: string; position: number | null; total: number | null }

interface KeywordRank {
  platform: string; keyword: string; runs: RankRun[];
  label: RankLabel; prevRun: RankRun | null; currentRun: RankRun | null;
  spotsChanged: number | null; firstRunDate: string;
  latestRunDate: string; nextRunDue: string;
  daysBetweenRuns: number | null;
}

interface SessionInfo {
  prediction: Prediction; predictionEmoji: string; predictionLabel: string;
  avg7DaySessions: number; gapDays7: number;
  sessionsToday: number; targetPerDay: number;
}

interface BusinessSummary {
  bizName: string; overallLabel: RankLabel;
  platformLabels: Record<string, RankLabel>;
  firstRunDate: string; latestRunDate: string; totalRuns: number;
  bestRanks: Record<string, number | null>;
  prevBestRanks: Record<string, number | null>;
  session: SessionInfo | null;
}

interface BusinessDetail extends Omit<BusinessSummary, "session"> {
  keywords: KeywordRank[];
  session: SessionInfo | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const PLATFORMS = ["ChatGPT", "Gemini", "Perplexity"] as const;

const PLATFORM_COLOR: Record<string, string> = {
  ChatGPT:    "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  Gemini:     "bg-blue-500/15 text-blue-600 border-blue-500/30",
  Perplexity: "bg-violet-500/15 text-violet-600 border-violet-500/30",
};

const LABEL_CONFIG: Record<RankLabel, { label: string; color: string; icon: string; dir: "up" | "down" | "neutral" }> = {
  SUDDEN_IMPROVEMENT:  { label: "Sudden ↑",   color: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", icon: "✅", dir: "up" },
  STEADY_IMPROVEMENT:  { label: "Steady ↑",   color: "bg-teal-500/15 text-teal-700 border-teal-500/30",         icon: "📈", dir: "up" },
  NO_CHANGE:           { label: "No Change",   color: "bg-slate-500/15 text-slate-600 border-slate-500/30",       icon: "➡️", dir: "neutral" },
  STEADY_DROP:         { label: "Steady ↓",    color: "bg-amber-500/15 text-amber-700 border-amber-500/30",       icon: "📉", dir: "down" },
  SUDDEN_DROP:         { label: "Sudden ↓",    color: "bg-blue-500/15 text-blue-700 border-blue-500/30",          icon: "🚨", dir: "down" },
  NOT_FOUND_CRITICAL:  { label: "Not Found",   color: "bg-blue-600/15 text-blue-800 border-blue-600/40",           icon: "🚫", dir: "down" },
  REAPPEARED:          { label: "Re-appeared", color: "bg-cyan-500/15 text-cyan-700 border-cyan-500/30",          icon: "✨", dir: "up" },
  BASELINE:            { label: "Baseline",    color: "bg-slate-400/15 text-slate-500 border-slate-400/30",       icon: "⏳", dir: "neutral" },
};

const PRED_CONFIG: Record<Prediction, { color: string; icon: string; label: string }> = {
  AT_RISK:   { color: "bg-blue-500/15 text-blue-700 border-blue-500/30",          icon: "🔍", label: "Under Observation" },
  STABLE:    { color: "bg-amber-500/15 text-amber-700 border-amber-500/30",       icon: "➡️", label: "Stable" },
  ON_TRACK:  { color: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", icon: "📈", label: "On Track" },
  TOO_EARLY: { color: "bg-slate-500/15 text-slate-500 border-slate-400/30",       icon: "⏳", label: "Too Early" },
};

// ── Analysis helpers ───────────────────────────────────────────────────────────

function generateWhyText(kw: KeywordRank): string {
  const { label, spotsChanged, daysBetweenRuns, prevRun, currentRun } = kw;
  const days = daysBetweenRuns ?? 14;
  const totalDelta = (currentRun?.total ?? 0) - (prevRun?.total ?? 0);
  const totalCtx = Math.abs(totalDelta) > 20
    ? totalDelta > 0
      ? ` More competition entered results (+${totalDelta} total) which may have contributed.`
      : ` Fewer competitors in results (${totalDelta} total) — harder to disappear.`
    : "";

  switch (label) {
    case "SUDDEN_IMPROVEMENT":
      return `Jumped ${spotsChanged} spots in ${days} days. Consistent daily sessions during this window built enough signal for ${kw.platform} to actively recommend this business.${totalCtx} Do not change session strategy — document what worked and maintain exact cadence.`;
    case "STEADY_IMPROVEMENT":
      return `Gained ${spotsChanged} spot${spotsChanged !== 1 ? "s" : ""} in ${days} days. Sessions running consistently with gradual signal buildup.${totalCtx} On the right track — push session consistency to accelerate toward a sudden improvement.`;
    case "NO_CHANGE":
      return `Held rank for ${days} days. Sessions running but not generating enough new signal to break the plateau.${totalCtx} Increase session volume to push the ranking — competition is at a similar activity level.`;
    case "STEADY_DROP":
      return `Lost ${Math.abs(spotsChanged!)} spot${Math.abs(spotsChanged!) !== 1 ? "s" : ""} in ${days} days. Likely occasional session gaps (1 day here and there) or success rate slightly below target.${totalCtx} Act now — identify and eliminate gaps before next run or this becomes a sudden drop.`;
    case "SUDDEN_DROP":
      return `Dropped ${Math.abs(spotsChanged!)} spots in ${days} days. Sessions likely had major gaps or high error rate during the ranking window.${totalCtx} Check if all 3 platforms dropped (campaign session issue) or only ${kw.platform} (algorithm or platform-specific issue).`;
    case "NOT_FOUND_CRITICAL":
      return `Business completely disappeared from ${kw.platform} results. Critical signal failure — sessions either stopped, had very high error rate, or ${kw.platform} de-indexed the business. Check session logs for the ${days}-day window before this run. Escalate immediately.`;
    case "REAPPEARED":
      return `Business re-appeared in ${kw.platform} results after being not found. Sessions have rebuilt enough signal to become visible again. Increase volume to push toward top rankings in the next ranking window.`;
    case "BASELINE":
      return `First ranking run captured on ${kw.firstRunDate}. No previous data to compare. This is the starting reference point. Continue daily sessions for the full 14-day window before the next assessment.`;
  }
}

function getImprovementAdvice(pos: number | null): { title: string; bullets: string[] } {
  if (pos === null || pos > 100) return {
    title: "Rebuild",
    bullets: [
      "Full campaign review needed — fix all errors before increasing volume",
      "Run maximum sessions every day with zero gaps",
      "Check if keyword is appropriate for this platform",
      "Expect minimum 4–6 weeks (3+ ranking runs) to recover",
    ],
  };
  if (pos <= 3) return {
    title: "Defend Top Position",
    bullets: [
      "Do NOT reduce sessions — maintain exact cadence with zero gaps",
      "Monitor all 3 platforms — a drop on one is an early warning",
      "If rank holds for 3+ consecutive runs: stable top position confirmed",
    ],
  };
  if (pos <= 6) return {
    title: "Push Into Top 3",
    bullets: [
      "Increase session volume slightly — hold zero gaps across the full 14-day window",
      "All keywords must be hit on all 3 platforms",
      "1–2 more consistent ranking windows should reach top 3",
    ],
  };
  if (pos <= 10) return {
    title: "Build Toward Visibility",
    bullets: [
      "Consistent sessions every day with no exceptions",
      "Fix any errors immediately — no error tolerance at this level",
      "Check if keyword variant matches platform expectations",
      "Expect 2–3 ranking windows to reach top 5",
    ],
  };
  if (pos <= 20) return {
    title: "Recovery Mode",
    bullets: [
      "Audit session health for the last full ranking window",
      "Identify which platform is weakest and focus there first",
      "Check ranking_total — is competition increasing?",
      "Expect 3–4 ranking windows to reach top 10",
    ],
  };
  return {
    title: "Low Visibility — Increase Volume",
    bullets: [
      "Significantly increase session volume and eliminate all gaps",
      "Check if keyword is appropriate for this platform",
      "Fix all session errors — no tolerance below rank 50",
      "Expect 4–6+ weeks to reach top 20",
    ],
  };
}

function getCrossPattern(
  platformLabels: Record<string, RankLabel>,
): { pattern: string; detail: string; severity: "good" | "bad" | "mixed" | "neutral" } {
  const isNeg = (l: RankLabel) => l === "SUDDEN_DROP" || l === "NOT_FOUND_CRITICAL" || l === "STEADY_DROP";
  const isPos = (l: RankLabel) => l === "SUDDEN_IMPROVEMENT" || l === "STEADY_IMPROVEMENT" || l === "REAPPEARED";
  const isCritical = (l: RankLabel) => l === "SUDDEN_DROP" || l === "NOT_FOUND_CRITICAL";

  const entries = PLATFORMS.map((p) => ({ p, l: platformLabels[p] ?? "BASELINE" }));
  const negPlatforms = entries.filter((e) => isNeg(e.l)).map((e) => e.p);
  const posPlatforms = entries.filter((e) => isPos(e.l)).map((e) => e.p);
  const critPlatforms = entries.filter((e) => isCritical(e.l)).map((e) => e.p);

  if (negPlatforms.length === 3) return {
    pattern: "All 3 platforms dropping",
    detail: "Campaign-level session or signal issue — sessions likely stopped or had high error rate across all platforms. Fix before next ranking window opens.",
    severity: "bad",
  };
  if (posPlatforms.length === 3) return {
    pattern: "All 3 platforms improving",
    detail: "Campaign performing well across all platforms. Maintain current session cadence to hold and extend gains.",
    severity: "good",
  };
  if (negPlatforms.length === 0 && posPlatforms.length === 0) return {
    pattern: "Baseline / No change",
    detail: "No significant movement detected. Continue daily sessions and check back after the next ranking run.",
    severity: "neutral",
  };
  if (critPlatforms.length === 1 && posPlatforms.length >= 1) return {
    pattern: `Split — ${critPlatforms[0]} critical`,
    detail: `${critPlatforms[0]} had an algorithm change or platform-specific session failure. Isolate and fix ${critPlatforms[0]} sessions without reducing the other platforms.`,
    severity: "mixed",
  };
  if (negPlatforms.length === 1 && posPlatforms.length >= 1) return {
    pattern: `Split — ${negPlatforms[0]} dropping`,
    detail: `Only ${negPlatforms[0]} is dropping while others hold or improve. This points to a ${negPlatforms[0]}-specific issue rather than a full campaign problem.`,
    severity: "mixed",
  };
  if (posPlatforms.length === 2 && negPlatforms.length === 1) return {
    pattern: "2 improving, 1 dropping",
    detail: `${negPlatforms[0]} needs isolated attention. Treat it as its own recovery while maintaining the other two platforms.`,
    severity: "mixed",
  };
  return {
    pattern: "Mixed results",
    detail: "Different trends across platforms — review each platform's keyword details independently.",
    severity: "neutral",
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function rankColor(pos: number | null): string {
  if (pos === null) return "text-blue-500";
  if (pos <= 3) return "text-emerald-500";
  if (pos <= 7) return "text-amber-500";
  return "text-blue-400";
}

function RankChip({ pos, total }: { pos: number | null; total?: number | null }) {
  if (pos === null) return <span className="text-[9px] text-blue-400 font-mono">—</span>;
  return (
    <span className={cn("text-[10px] font-mono font-bold", rankColor(pos))}>
      #{pos}{total ? `/${total}` : ""}
    </span>
  );
}

function LabelBadge({ label, small }: { label: RankLabel; small?: boolean }) {
  const cfg = LABEL_CONFIG[label];
  return (
    <Badge variant="outline" className={cn(cfg.color, small ? "text-[10px] px-1.5 py-0" : "text-xs px-2")}>
      {cfg.icon} {cfg.label}
    </Badge>
  );
}

function RankSparkline({ runs }: { runs: RankRun[] }) {
  const valid = runs.filter((r) => r.position !== null && r.position > 0);
  if (valid.length < 2) return null;
  const positions = valid.map((r) => r.position!);
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);
  const range = maxPos - minPos || 1;
  const W = 72, H = 20;
  const pts = valid.map((r, i) => {
    const x = (i / (valid.length - 1)) * W;
    const y = H - ((maxPos - r.position!) / range) * H;
    return `${x},${y}`;
  }).join(" ");
  const last = valid[valid.length - 1].position!;
  const prev = valid[valid.length - 2].position!;
  const color = last < prev ? "#10b981" : last > prev ? "#3b82f6" : "#6b7280";
  return (
    <svg width={W} height={H} className="shrink-0 opacity-70">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ── Keyword report card ────────────────────────────────────────────────────────
function KeywordReportCard({ kw }: { kw: KeywordRank }) {
  const [showWhy, setShowWhy] = useState(false);
  const cfg = LABEL_CONFIG[kw.label];
  const isAlert = kw.label === "SUDDEN_DROP" || kw.label === "NOT_FOUND_CRITICAL";
  const isGood = kw.label === "SUDDEN_IMPROVEMENT" || kw.label === "REAPPEARED";
  const baselineRun = kw.runs[0];
  const isMultiRun = kw.runs.length > 1;
  const prevIsDifferentFromBaseline = kw.prevRun && kw.prevRun.date !== baselineRun.date;

  return (
    <div className={cn(
      "rounded-lg border p-3 space-y-2",
      isAlert ? "border-blue-500/30 bg-blue-500/5" :
      isGood  ? "border-emerald-500/20 bg-emerald-500/5" :
                "border-border bg-secondary/20"
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-foreground leading-snug flex-1">{kw.keyword}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          {kw.runs.length > 1 && <RankSparkline runs={kw.runs} />}
          <LabelBadge label={kw.label} small />
        </div>
      </div>

      {/* Run history — report format */}
      <div className="rounded border border-border/40 overflow-hidden text-[10px]">
        {/* Baseline row */}
        <div className="flex items-center gap-0 border-b border-border/30">
          <span className="w-20 shrink-0 px-2 py-1.5 text-muted-foreground bg-secondary/30 font-medium">Baseline</span>
          <span className="w-24 shrink-0 px-2 py-1.5 font-mono text-muted-foreground">{baselineRun.date}</span>
          <span className="flex-1 px-2 py-1.5">
            <RankChip pos={baselineRun.position} total={baselineRun.total} />
          </span>
        </div>

        {/* Previous run — only if it's not the same as baseline */}
        {isMultiRun && prevIsDifferentFromBaseline && kw.prevRun && (
          <div className="flex items-center gap-0 border-b border-border/30">
            <span className="w-20 shrink-0 px-2 py-1.5 text-muted-foreground bg-secondary/30 font-medium">Previous</span>
            <span className="w-24 shrink-0 px-2 py-1.5 font-mono text-muted-foreground">{kw.prevRun.date}</span>
            <span className="flex-1 px-2 py-1.5">
              <RankChip pos={kw.prevRun.position} total={kw.prevRun.total} />
            </span>
          </div>
        )}

        {/* Latest run */}
        {kw.currentRun && (
          <div className="flex items-center gap-0">
            <span className={cn("w-20 shrink-0 px-2 py-1.5 bg-secondary/30 font-semibold",
              isAlert ? "text-blue-700" : isGood ? "text-emerald-700" : "text-foreground"
            )}>Latest</span>
            <span className="w-24 shrink-0 px-2 py-1.5 font-mono text-foreground">{kw.currentRun.date}</span>
            <span className="flex-1 px-2 py-1.5 flex items-center gap-1.5">
              <RankChip pos={kw.currentRun.position} total={kw.currentRun.total} />
              {kw.daysBetweenRuns !== null && (
                <span className="text-muted-foreground">· {kw.daysBetweenRuns}d gap</span>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Change bar */}
      {kw.label !== "BASELINE" && (
        <div className="flex items-center gap-2 text-[10px]">
          <span className={cn("flex items-center gap-1 font-semibold",
            cfg.dir === "up"   ? "text-emerald-600" :
            cfg.dir === "down" ? "text-blue-600" :
                                 "text-muted-foreground"
          )}>
            {cfg.dir === "up"   ? <TrendingUp className="w-3 h-3" /> :
             cfg.dir === "down" ? <TrendingDown className="w-3 h-3" /> :
                                  <Minus className="w-3 h-3" />}
            {kw.spotsChanged !== null
              ? kw.spotsChanged > 0
                ? `+${kw.spotsChanged} improved`
                : kw.spotsChanged < 0
                  ? `${kw.spotsChanged} dropped`
                  : "No change"
              : cfg.label}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">Next run due {kw.nextRunDue}</span>
        </div>
      )}

      {/* Why toggle */}
      <button
        onClick={() => setShowWhy((v) => !v)}
        className="text-[10px] text-primary/60 hover:text-primary flex items-center gap-1 transition-colors"
      >
        <Info className="w-3 h-3" />
        {showWhy ? "Hide analysis" : "Why this happened"}
      </button>

      {showWhy && (
        <p className="text-[10px] text-muted-foreground leading-relaxed bg-background/60 rounded p-2 border border-border/30">
          {generateWhyText(kw)}
        </p>
      )}
    </div>
  );
}

// ── Cross-platform summary ─────────────────────────────────────────────────────
function CrossPlatformSummary({ platformLabels, bestRanks, daysSinceLastRun, totalRuns }: {
  platformLabels: Record<string, RankLabel>;
  bestRanks: Record<string, number | null>;
  daysSinceLastRun: number | null;
  totalRuns: number;
}) {
  const { pattern, detail, severity } = getCrossPattern(platformLabels);

  const severityBorder = {
    good:    "border-emerald-500/30 bg-emerald-500/5",
    bad:     "border-blue-500/30 bg-blue-500/5",
    mixed:   "border-amber-500/30 bg-amber-500/5",
    neutral: "border-border bg-secondary/10",
  }[severity];

  return (
    <Card className={cn("border", severityBorder)}>
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
          <BarChart2 className="w-3.5 h-3.5 text-primary" />
          Cross-Platform Summary
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">
            {totalRuns} run{totalRuns !== 1 ? "s" : ""}
            {daysSinceLastRun !== null && ` · ${daysSinceLastRun}d since last`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="space-y-1.5">
          {PLATFORMS.map((p) => {
            const label = platformLabels[p] ?? "BASELINE";
            const cfg = LABEL_CONFIG[label];
            const rank = bestRanks[p];
            return (
              <div key={p} className="flex items-center gap-2 text-xs">
                <span className={cn("w-[78px] shrink-0 text-[10px] font-medium", PLATFORM_COLOR[p].split(" ")[1])}>
                  {p}
                </span>
                <span className={cn("font-mono font-bold text-[11px] w-8 shrink-0", rankColor(rank))}>
                  {rank !== null ? `#${rank}` : "—"}
                </span>
                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", cfg.color)}>
                  {cfg.icon} {cfg.label}
                </Badge>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border/30 pt-2 space-y-0.5">
          <p className="text-[11px] font-semibold text-foreground">Pattern: {pattern}</p>
          <p className="text-[10px] text-muted-foreground leading-relaxed">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Drops panel ────────────────────────────────────────────────────────────────
function AlertsPanel({ keywords }: { keywords: KeywordRank[] }) {
  const DROP_LABELS: RankLabel[] = ["SUDDEN_DROP", "NOT_FOUND_CRITICAL", "STEADY_DROP"];
  const alerts = keywords
    .filter((k) => DROP_LABELS.includes(k.label))
    .sort((a, b) => {
      const pri: Record<RankLabel, number> = {
        NOT_FOUND_CRITICAL: 0, SUDDEN_DROP: 1, STEADY_DROP: 2,
        SUDDEN_IMPROVEMENT: 3, REAPPEARED: 4, STEADY_IMPROVEMENT: 5, NO_CHANGE: 6, BASELINE: 7,
      };
      return (pri[a.label] ?? 9) - (pri[b.label] ?? 9);
    });

  if (!alerts.length) {
    return (
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 py-1">
        <span className="text-emerald-500">✓</span> No drops — performing as expected.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {alerts.map((kw, i) => {
        const cfg = LABEL_CONFIG[kw.label];
        const prevPos = kw.prevRun?.position;
        const curPos = kw.currentRun?.position;
        return (
          <div key={i} className={cn("flex items-start gap-2 rounded-md border px-3 py-2", cfg.color)}>
            <span className="shrink-0 mt-0.5 text-sm">{cfg.icon}</span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold">
                {cfg.label.toUpperCase()} — {kw.platform} | {kw.keyword}
              </p>
              <p className="text-[10px] opacity-80 mt-0.5">
                {prevPos !== undefined ? `Rank ${prevPos ?? "—"} → ${curPos ?? "—"}` : `Baseline Rank ${curPos ?? "—"}`}
                {kw.spotsChanged !== null && kw.spotsChanged !== 0 && (
                  <span> ({kw.spotsChanged > 0 ? `+${kw.spotsChanged} improved` : `${kw.spotsChanged} dropped`})</span>
                )}
                {kw.daysBetweenRuns !== null && <span> · {kw.daysBetweenRuns}d between runs</span>}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── How to Improve ─────────────────────────────────────────────────────────────
function HowToImprovePanel({ keywords }: { keywords: KeywordRank[] }) {
  const ranked = keywords
    .filter((k) => k.currentRun?.position != null)
    .map((k) => k.currentRun!.position!);

  const worstPos = ranked.length ? Math.max(...ranked) : null;
  const bestPos  = ranked.length ? Math.min(...ranked) : null;
  const advice = getImprovementAdvice(worstPos);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Target className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-xs font-semibold">{advice.title}</span>
        {bestPos !== null && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            best #{bestPos}{worstPos !== null && worstPos !== bestPos ? ` · worst #${worstPos}` : ""}
          </span>
        )}
      </div>
      <ul className="space-y-1">
        {advice.bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <span className="text-primary mt-0.5 shrink-0">→</span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Session health mini-panel ──────────────────────────────────────────────────
function SessionMiniPanel({ sess }: { sess: SessionInfo }) {
  const cfg = PRED_CONFIG[sess.prediction];
  return (
    <Card className={cn("border",
      sess.prediction === "AT_RISK"  ? "border-blue-500/30" :
      sess.prediction === "ON_TRACK" ? "border-emerald-500/20" :
                                       "border-border"
    )}>
      <CardHeader className="pb-1 pt-3">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-primary" />Session Health
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="outline" className={cn("text-xs", cfg.color)}>{cfg.icon} {cfg.label}</Badge>
          <span className={cn("text-xs font-mono", sess.sessionsToday >= sess.targetPerDay ? "text-emerald-500" : "text-amber-500")}>
            {sess.sessionsToday}/{sess.targetPerDay} today
          </span>
          <span className="text-xs text-muted-foreground">{sess.avg7DaySessions.toFixed(1)}/day avg</span>
          {sess.gapDays7 > 0 && (
            <span className="text-xs text-blue-500">{sess.gapDays7} gap day{sess.gapDays7 !== 1 ? "s" : ""}</span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">{sess.predictionLabel}</p>
      </CardContent>
    </Card>
  );
}

// ── Per-platform keyword list ──────────────────────────────────────────────────
function PlatformKeywords({ keywords, platform }: { keywords: KeywordRank[]; platform: string }) {
  const filtered = keywords.filter((k) => k.platform === platform);
  if (!filtered.length)
    return <p className="text-xs text-muted-foreground py-6 text-center">No data for {platform}</p>;

  return (
    <div className="space-y-3">
      {/* Run history chips */}
      <div className="space-y-1">
        {filtered.map((kw, i) => (
          <div key={i} className="flex items-center gap-2 text-xs border border-border/30 rounded px-2.5 py-1.5 bg-secondary/10">
            <p className="font-medium truncate flex-1 min-w-0 text-[11px]" title={kw.keyword}>{kw.keyword}</p>
            <div className="flex gap-1 shrink-0">
              {kw.runs.map((r, j) => (
                <span key={j} className={cn(
                  "text-[9px] font-mono rounded border px-1 py-0",
                  rankColor(r.position), "border-current/20 bg-current/5"
                )}>
                  {r.date.slice(5)} {r.position !== null ? `#${r.position}` : "×"}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Individual keyword report cards */}
      <div className="space-y-2.5">
        {filtered.map((kw, i) => (
          <KeywordReportCard key={i} kw={kw} />
        ))}
      </div>
    </div>
  );
}

// ── Detail panel ───────────────────────────────────────────────────────────────
function DetailPanel({ detail }: { detail: BusinessDetail }) {
  const [aeo, setAeo] = useState<BusinessAEOAnalysis | null>(null);
  useEffect(() => {
    setAeo(null);
    fetch(`/api/csv/aeo/detail?business=${encodeURIComponent(detail.bizName)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setAeo(d))
      .catch(() => {});
  }, [detail.bizName]);
  const daysSinceLastRun = detail.keywords.length > 0
    ? (() => {
        const dates = detail.keywords.flatMap((k) => k.runs.map((r) => r.date)).sort();
        const latest = dates[dates.length - 1];
        const today = new Date().toISOString().slice(0, 10);
        if (!latest) return null;
        return Math.round((new Date(today).getTime() - new Date(latest).getTime()) / 86400000);
      })()
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-foreground">{detail.bizName}</h2>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />First run: {detail.firstRunDate}
              </span>
              <span>Latest: {detail.latestRunDate}</span>
              <span>{detail.totalRuns} run{detail.totalRuns !== 1 ? "s" : ""}</span>
              {detail.totalRuns <= 2 && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/30 text-amber-600">
                  ⚠️ Early data — {detail.totalRuns === 1 ? "baseline only" : "2 runs, treat with caution"}
                </Badge>
              )}
            </div>
          </div>
          <LabelBadge label={detail.overallLabel} />
        </div>
      </div>

      {/* Cross-platform summary */}
      <CrossPlatformSummary
        platformLabels={detail.platformLabels}
        bestRanks={detail.bestRanks}
        daysSinceLastRun={daysSinceLastRun}
        totalRuns={detail.totalRuns}
      />

      {/* Session health */}
      {detail.session && <SessionMiniPanel sess={detail.session} />}

      {/* AEO Health Score */}
      {aeo && <AEOHealthCard aeo={aeo} />}

      {/* Ideal Flow (if flagged) */}
      {aeo?.idealFlow && aeo.flags.length > 0 && (
        <IdealFlowCard flow={aeo.idealFlow} flags={aeo.flags} />
      )}

      {/* How to Improve */}
      <Card>
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-primary" />How to Improve
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <HowToImprovePanel keywords={detail.keywords} />
        </CardContent>
      </Card>

      {/* Alerts */}
      <Card>
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-primary" />Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <AlertsPanel keywords={detail.keywords} />
        </CardContent>
      </Card>

      {/* Per-platform keyword breakdown */}
      <Tabs defaultValue="ChatGPT">
        <TabsList className="h-8">
          {PLATFORMS.map((p) => {
            const count = detail.keywords.filter((k) => k.platform === p).length;
            const lbl = detail.platformLabels[p];
            const lCfg = lbl ? LABEL_CONFIG[lbl] : null;
            return (
              <TabsTrigger key={p} value={p} className="text-xs h-7 gap-1.5">
                {p}
                {lCfg && (
                  <span className={cn("w-1.5 h-1.5 rounded-full",
                    lbl === "SUDDEN_DROP" || lbl === "NOT_FOUND_CRITICAL" ? "bg-blue-500" :
                    lbl === "SUDDEN_IMPROVEMENT" ? "bg-emerald-500" :
                    lbl === "STEADY_DROP" ? "bg-amber-500" :
                    lbl === "STEADY_IMPROVEMENT" ? "bg-teal-500" : "bg-slate-400"
                  )} />
                )}
                <Badge variant="outline" className={cn("text-[9px] px-1 py-0 h-4 min-w-4 justify-center", PLATFORM_COLOR[p])}>
                  {count}
                </Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {PLATFORMS.map((p) => (
          <TabsContent key={p} value={p} className="mt-3">
            <Card>
              <CardContent className="pt-4">
                <PlatformKeywords keywords={detail.keywords} platform={p} />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// ── AEO constants & small components ──────────────────────────────────────────

const TIER_CONFIG: Record<PerformanceTier, { label: string; color: string; bg: string; dot: string }> = {
  EXCELLENT: { label: "Excellent",  color: "text-emerald-700", bg: "bg-emerald-500/10 border-emerald-500/30", dot: "bg-emerald-500" },
  GOOD:      { label: "Good",       color: "text-teal-700",    bg: "bg-teal-500/10 border-teal-500/30",       dot: "bg-teal-500"    },
  AT_RISK:   { label: "At Risk",    color: "text-amber-700",   bg: "bg-amber-500/10 border-amber-500/30",     dot: "bg-amber-500"   },
  CRITICAL:  { label: "Critical",   color: "text-blue-700",    bg: "bg-blue-500/10 border-blue-500/30",       dot: "bg-blue-500"    },
};

const FLAG_CONFIG: Record<AEOFlagType, { label: string; color: string; icon: string }> = {
  IMMEDIATE_ACTION:    { label: "Immediate Action",  color: "bg-blue-600/15 text-blue-800 border-blue-600/40",   icon: "🔴" },
  NEEDS_REVIEW:        { label: "Needs Review",      color: "bg-blue-500/10 text-blue-700 border-blue-500/30",   icon: "🟡" },
  SUDDEN_KEYWORD_DROP: { label: "Sudden KW Drop",    color: "bg-amber-500/10 text-amber-700 border-amber-500/30",icon: "📉" },
  UNSTABLE_RANKINGS:   { label: "Unstable",          color: "bg-slate-500/10 text-slate-600 border-slate-400/30",icon: "⚠️" },
};

function TierBadge({ tier, small }: { tier: PerformanceTier; small?: boolean }) {
  const cfg = TIER_CONFIG[tier];
  return (
    <Badge variant="outline" className={cn(cfg.bg, cfg.color, small ? "text-[9px] px-1.5 py-0" : "text-[10px] px-2")}>
      <span className={cn("w-1.5 h-1.5 rounded-full mr-1 inline-block", cfg.dot)} />
      {cfg.label}
    </Badge>
  );
}

function HealthScore({ score, delta, small }: { score: number; delta?: number; small?: boolean }) {
  const color = score >= 80 ? "text-emerald-600" : score >= 60 ? "text-teal-600" : score >= 40 ? "text-amber-600" : "text-blue-600";
  return (
    <span className="flex items-baseline gap-1">
      <span className={cn("font-bold font-mono", small ? "text-base" : "text-2xl", color)}>{score.toFixed(1)}</span>
      {delta !== undefined && (
        <span className={cn("text-[10px] font-mono", delta >= 0 ? "text-emerald-500" : "text-blue-500")}>
          {delta >= 0 ? "+" : ""}{delta.toFixed(1)}
        </span>
      )}
    </span>
  );
}

// ── Ideal Flow card ────────────────────────────────────────────────────────────
function IdealFlowCard({ flow, flags }: { flow: AEOIdealFlow; flags: AEOFlagType[] }) {
  const [open, setOpen] = useState(false);
  const worstFlag = flags.find(f => f === "IMMEDIATE_ACTION") ?? flags[0];
  const fCfg = worstFlag ? FLAG_CONFIG[worstFlag] : null;
  return (
    <Card className={cn("border", worstFlag === "IMMEDIATE_ACTION" ? "border-blue-500/30 bg-blue-500/5" : "border-amber-500/30 bg-amber-500/5")}>
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <span>🗺️</span> Ideal Flow
          {fCfg && (
            <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 ml-1", fCfg.color)}>
              {fCfg.icon} {fCfg.label}
            </Badge>
          )}
          <button onClick={() => setOpen(v => !v)} className="ml-auto text-[10px] text-primary/60 hover:text-primary transition-colors">
            {open ? "collapse" : "expand"}
          </button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="pt-0 space-y-3">
          <div>
            <p className="text-[10px] font-semibold text-foreground mb-1">Week 1 — Diagnosis</p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">{flow.week1Diagnosis}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-foreground mb-1">Weeks 2–3 — Fixes</p>
            <ul className="space-y-0.5">
              {flow.week2_3Actions.map((a, i) => (
                <li key={i} className="flex items-start gap-1 text-[10px] text-muted-foreground">
                  <span className="text-primary mt-0.5 shrink-0">→</span>{a}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-foreground mb-1">Week 4 — Re-measure</p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">{flow.week4Outcome}</p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── AEO Health Score card (shown in detail panel) ──────────────────────────────
function AEOHealthCard({ aeo }: { aeo: BusinessAEOAnalysis }) {
  return (
    <Card className={cn("border", aeo.flags.includes("IMMEDIATE_ACTION") ? "border-blue-500/30 bg-blue-500/5" : aeo.flags.includes("NEEDS_REVIEW") ? "border-amber-500/30" : "border-border")}>
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <BarChart2 className="w-3.5 h-3.5 text-primary" />
          AEO Health Score
          {aeo.isNewBusiness && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-slate-400/30 text-slate-500 ml-1">⏳ Building history</Badge>
          )}
          <TierBadge tier={aeo.performanceTier} small />
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Overall score */}
        <div className="flex items-end gap-4">
          <div>
            <p className="text-[9px] text-muted-foreground mb-0.5">Overall health</p>
            <HealthScore score={aeo.overallHealthScore} delta={aeo.healthScoreDelta} />
          </div>
          <div className="text-[10px] text-muted-foreground">
            <p>4-run avg: <span className="font-mono">{aeo.avg4RunHealthScore.toFixed(1)}</span></p>
            <p>{aeo.totalRuns} ranking run{aeo.totalRuns !== 1 ? "s" : ""} · {aeo.latestDataDate}</p>
          </div>
          <p className="text-[9px] text-muted-foreground ml-auto italic">
            No external performance data — using ranking-derived track score as proxy
          </p>
        </div>

        {/* Per-platform mini scores */}
        <div className="grid grid-cols-3 gap-2">
          {aeo.platforms.map(p => {
            const { label, color, bg } = TIER_CONFIG[
              p.latestHealthScore >= 80 ? "EXCELLENT" : p.latestHealthScore >= 60 ? "GOOD" : p.latestHealthScore >= 40 ? "AT_RISK" : "CRITICAL"
            ];
            return (
              <div key={p.platform} className={cn("rounded-md border p-2 text-center", bg)}>
                <p className={cn("text-[9px] font-semibold", color)}>{p.platform}</p>
                <p className={cn("text-lg font-bold font-mono mt-0.5", color)}>{p.latestHealthScore.toFixed(1)}</p>
                <p className={cn("text-[9px] font-mono", p.healthScoreDelta >= 0 ? "text-emerald-600" : "text-blue-500")}>
                  {p.healthScoreDelta >= 0 ? "+" : ""}{p.healthScoreDelta.toFixed(1)}
                </p>
              </div>
            );
          })}
        </div>

        {/* Flags */}
        {aeo.flags.length > 0 && (
          <div className="space-y-1">
            {aeo.flagLabels.map((fl, i) => {
              const fCfg = FLAG_CONFIG[aeo.flags[i]];
              return (
                <div key={i} className={cn("flex items-start gap-1.5 rounded border px-2 py-1.5 text-[10px]", fCfg.color)}>
                  <span>{fCfg.icon}</span>
                  <span>{fl}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Important changes */}
        {aeo.importantChanges.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-foreground mb-1">🔔 Important Changes</p>
            <div className="space-y-0.5">
              {aeo.importantChanges.map((c, i) => (
                <p key={i} className={cn("text-[10px]", c.direction === "up" ? "text-emerald-600" : "text-blue-500")}>
                  {c.direction === "up" ? "↑" : "↓"} {c.description}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Run history per platform */}
        <div className="space-y-1.5">
          {aeo.platforms.map(p => (
            <div key={p.platform}>
              <p className="text-[9px] text-muted-foreground mb-0.5">{p.platform} run history</p>
              <div className="flex gap-1 flex-wrap">
                {p.runs.map((r, i) => {
                  const tier = r.healthScore >= 80 ? "EXCELLENT" : r.healthScore >= 60 ? "GOOD" : r.healthScore >= 40 ? "AT_RISK" : "CRITICAL";
                  const { color, bg } = TIER_CONFIG[tier];
                  return (
                    <span key={i} className={cn("text-[9px] font-mono rounded border px-1.5 py-0.5", bg, color)}>
                      {r.date.slice(5)} {r.healthScore.toFixed(0)}
                      {r.runDelta !== null && (
                        <span className={r.runDelta >= 0 ? " text-emerald-600" : " text-blue-500"}>
                          {r.runDelta >= 0 ? "▲" : "▼"}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Overview panel ────────────────────────────────────────────────────────────
type SortField = "name" | "ChatGPT" | "Gemini" | "Perplexity" | "overall";

const LABEL_SORT: Record<RankLabel, number> = {
  NOT_FOUND_CRITICAL: 0, SUDDEN_DROP: 1, STEADY_DROP: 2,
  NO_CHANGE: 3, BASELINE: 4, STEADY_IMPROVEMENT: 5, REAPPEARED: 6, SUDDEN_IMPROVEMENT: 7,
};

function OverviewPanel({
  businesses,
  onSelect,
}: {
  businesses: BusinessSummary[];
  onSelect: (biz: BusinessSummary) => void;
}) {
  const [sortField, setSortField] = useState<SortField>("overall");
  const [sortAsc, setSortAsc]     = useState(true);
  const [tableSearch, setTableSearch] = useState("");

  // AEO analysis data
  const [aeoData, setAeoData]     = useState<AEOOverview | null>(null);
  const [aeoLoading, setAeoLoading] = useState(true);
  useEffect(() => {
    fetch("/api/csv/aeo/overview")
      .then(r => r.json())
      .then(d => { setAeoData(d); setAeoLoading(false); })
      .catch(() => setAeoLoading(false));
  }, []);

  const isDropLabel = (l: RankLabel) =>
    l === "SUDDEN_DROP" || l === "NOT_FOUND_CRITICAL" || l === "STEADY_DROP";
  const isImpLabel = (l: RankLabel) =>
    l === "SUDDEN_IMPROVEMENT" || l === "STEADY_IMPROVEMENT" || l === "REAPPEARED";

  // ── Per-platform stats ──────────────────────────────────────────────────────
  const pStats = PLATFORMS.map((p) => {
    const labels = businesses.map((b) => b.platformLabels[p] ?? "BASELINE");
    const suddenDrop = labels.filter((l) => l === "SUDDEN_DROP" || l === "NOT_FOUND_CRITICAL").length;
    const steadyDrop = labels.filter((l) => l === "STEADY_DROP").length;
    const suddenImp  = labels.filter((l) => l === "SUDDEN_IMPROVEMENT" || l === "REAPPEARED").length;
    const steadyImp  = labels.filter((l) => l === "STEADY_IMPROVEMENT").length;
    const baseline   = labels.filter((l) => l === "BASELINE").length;
    const noChange   = labels.filter((l) => l === "NO_CHANGE").length;
    return { platform: p, suddenDrop, steadyDrop, suddenImp, steadyImp, baseline, noChange };
  });

  // ── Overall distribution ────────────────────────────────────────────────────
  const total = businesses.length;
  const overallDist = {
    suddenDrop: businesses.filter((b) => b.overallLabel === "SUDDEN_DROP" || b.overallLabel === "NOT_FOUND_CRITICAL").length,
    steadyDrop: businesses.filter((b) => b.overallLabel === "STEADY_DROP").length,
    suddenImp:  businesses.filter((b) => b.overallLabel === "SUDDEN_IMPROVEMENT" || b.overallLabel === "REAPPEARED").length,
    steadyImp:  businesses.filter((b) => b.overallLabel === "STEADY_IMPROVEMENT").length,
  };

  // ── Cross-platform pattern counts ───────────────────────────────────────────
  const droppingBizzes    = businesses.filter((b) => PLATFORMS.some((p) => isDropLabel(b.platformLabels[p] ?? "BASELINE")));
  const allThreeDropping  = droppingBizzes.filter((b) => PLATFORMS.every((p) => isDropLabel(b.platformLabels[p] ?? "BASELINE")));
  const singlePlatDrop    = droppingBizzes.filter((b) => PLATFORMS.filter((p) => isDropLabel(b.platformLabels[p] ?? "BASELINE")).length === 1);
  const improvingBizzes   = businesses.filter((b) => PLATFORMS.some((p) => isImpLabel(b.platformLabels[p] ?? "BASELINE")));
  const allThreeImproving = improvingBizzes.filter((b) => PLATFORMS.every((p) => isImpLabel(b.platformLabels[p] ?? "BASELINE")));

  const platformDropCounts = PLATFORMS.map((p) => ({
    platform: p,
    count: businesses.filter((b) => isDropLabel(b.platformLabels[p] ?? "BASELINE")).length,
  })).sort((a, b) => b.count - a.count);

  const platformImpCounts = PLATFORMS.map((p) => ({
    platform: p,
    count: businesses.filter((b) => isImpLabel(b.platformLabels[p] ?? "BASELINE")).length,
  })).sort((a, b) => b.count - a.count);

  // ── Sort + filter table ─────────────────────────────────────────────────────
  function toggleSort(f: SortField) {
    if (sortField === f) setSortAsc((v) => !v);
    else { setSortField(f); setSortAsc(true); }
  }

  const tableRows = businesses
    .filter((b) => b.bizName.toLowerCase().includes(tableSearch.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") {
        cmp = a.bizName.localeCompare(b.bizName);
      } else if (sortField === "overall") {
        cmp = LABEL_SORT[a.overallLabel] - LABEL_SORT[b.overallLabel];
      } else {
        const ar = a.bestRanks[sortField] ?? 99999;
        const br = b.bestRanks[sortField] ?? 99999;
        cmp = ar - br;
      }
      return sortAsc ? cmp : -cmp;
    });

  function SortTh({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field;
    return (
      <th
        className={cn("text-left pb-2 pr-3 font-medium cursor-pointer select-none whitespace-nowrap transition-colors",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
        onClick={() => toggleSort(field)}
      >
        {label}{active ? (sortAsc ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-foreground">Rankings Overview</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} businesses · ChatGPT, Gemini, Perplexity · bi-weekly snapshot
          </p>
        </div>
        <div className="flex gap-2 flex-wrap shrink-0">
          {[
            { color: "bg-blue-500", label: `${overallDist.suddenDrop + overallDist.steadyDrop} dropping` },
            { color: "bg-emerald-500", label: `${overallDist.suddenImp + overallDist.steadyImp} improving` },
          ].map((chip) => (
            <span key={chip.label} className="flex items-center gap-1.5 text-[10px] border border-border rounded-full px-2.5 py-0.5 bg-secondary/50">
              <span className={cn("w-1.5 h-1.5 rounded-full", chip.color)} />
              {chip.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Position Distribution per Platform ──────────────────────────── */}
      {total > 0 && (() => {
        const tiers = [
          { label: "Top 1",  max: 1,  color: "text-emerald-700", bg: "bg-emerald-500/10" },
          { label: "Top 3",  max: 3,  color: "text-teal-700",    bg: "bg-teal-500/10" },
          { label: "Top 10", max: 10, color: "text-blue-700",    bg: "bg-blue-500/10" },
          { label: "Top 25", max: 25, color: "text-violet-700",  bg: "bg-violet-500/10" },
        ];
        const platDot:  Record<string, string> = { ChatGPT: "bg-emerald-500",   Gemini: "bg-blue-500",   Perplexity: "bg-violet-500" };
        const platText: Record<string, string> = { ChatGPT: "text-emerald-700", Gemini: "text-blue-700", Perplexity: "text-violet-700" };
        const rows = [
          ...tiers.map(({ label, max, color, bg }) => ({
            label, color, bg,
            cells: PLATFORMS.map(p => {
              const cnt = businesses.filter(b => (b.bestRanks[p] ?? 999) <= max).length;
              return { cnt, pct: Math.round((cnt / total) * 100) };
            }),
          })),
          {
            label: "Not Found", color: "text-slate-600", bg: "bg-slate-500/10",
            cells: PLATFORMS.map(p => {
              const cnt = businesses.filter(b => b.bestRanks[p] == null).length;
              return { cnt, pct: Math.round((cnt / total) * 100) };
            }),
          },
        ];
        return (
          <div className="rounded-xl border border-border p-4 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              📊 Ranking Visibility — Position Distribution
              <span className="font-normal normal-case ml-1 text-muted-foreground/70">({total} businesses)</span>
            </p>
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr>
                  <th className="text-left py-1 pr-3 text-muted-foreground font-medium w-20">Tier</th>
                  {PLATFORMS.map(p => (
                    <th key={p} className="text-center py-1 px-2 font-semibold">
                      <div className="flex items-center justify-center gap-1">
                        <span className={cn("w-2 h-2 rounded-full shrink-0", platDot[p])} />
                        <span className={platText[p]}>{p}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ label, color, bg, cells }) => (
                  <tr key={label} className={bg}>
                    <td className={cn("py-1 pr-3 font-medium pl-2", color)}>{label}</td>
                    {cells.map(({ cnt, pct }, i) => (
                      <td key={i} className={cn("text-center py-1 px-2 font-mono tabular-nums", color)}>
                        {cnt} <span className="text-[10px] font-normal text-muted-foreground">({pct}%)</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* ── AEO Performance Tier summary ──────────────────────────────────── */}
      {aeoLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading health scores…
        </div>
      ) : aeoData && (
        <div className="space-y-4">
          {/* Tier cards */}
          <div className="grid grid-cols-4 gap-2">
            {(["EXCELLENT","GOOD","AT_RISK","CRITICAL"] as PerformanceTier[]).map(tier => {
              const cfg   = TIER_CONFIG[tier];
              const count = aeoData.tiers[tier] ?? 0;
              const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={tier} className={cn("rounded-lg border p-3 text-center", cfg.bg)}>
                  <p className={cn("text-xs font-semibold", cfg.color)}>{cfg.label}</p>
                  <p className={cn("text-2xl font-bold font-mono mt-1", cfg.color)}>{count}</p>
                  <p className="text-[9px] text-muted-foreground">{pct}% of businesses</p>
                </div>
              );
            })}
          </div>

          {/* Flagged businesses */}
          {aeoData.flagged.length > 0 && (
            <Card className="border-blue-500/25">
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-xs flex items-center gap-1.5">
                  🚨 Flagged Businesses — Needing Improvement
                  <span className="ml-auto text-[10px] font-normal text-muted-foreground">{aeoData.flagged.length} flagged</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-1.5">
                {aeoData.flagged.map((biz, i) => {
                  const worstFlag = biz.flags[0];
                  const fCfg = FLAG_CONFIG[worstFlag];
                  const matchedBiz = businesses.find(b => b.bizName === biz.bizName);
                  return (
                    <div
                      key={i}
                      onClick={() => matchedBiz && onSelect(matchedBiz)}
                      className={cn("flex items-center gap-2 rounded border px-3 py-2 text-[10px] cursor-pointer hover:opacity-80 transition-opacity", fCfg.color)}
                    >
                      <span className="shrink-0">{fCfg.icon}</span>
                      <span className="font-semibold flex-1 truncate">{biz.bizName}</span>
                      <span className="shrink-0">Health: <span className="font-mono font-bold">{biz.overallHealthScore.toFixed(1)}</span></span>
                      <span className={cn("shrink-0 font-mono", biz.healthScoreDelta >= 0 ? "text-emerald-600" : "text-blue-500")}>
                        {biz.healthScoreDelta >= 0 ? "+" : ""}{biz.healthScoreDelta.toFixed(1)}
                      </span>
                      <TierBadge tier={biz.performanceTier} small />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Important changes */}
          {aeoData.importantChanges.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-xs">🔔 Important Changes (all businesses)</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-1">
                {aeoData.importantChanges.slice(0, 10).map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    <span className={c.direction === "up" ? "text-emerald-600" : "text-blue-500"}>
                      {c.direction === "up" ? "↑" : "↓"}
                    </span>
                    <span className="font-medium text-foreground truncate">{c.bizName}</span>
                    <span className="text-muted-foreground">—</span>
                    <span className="text-muted-foreground truncate flex-1">{c.description}</span>
                  </div>
                ))}
                {aeoData.importantChanges.length > 10 && (
                  <p className="text-[9px] text-muted-foreground pt-1">
                    +{aeoData.importantChanges.length - 10} more changes — select a business to see details
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Per-platform ranking label cards */}
      <div className="grid grid-cols-3 gap-3">
        {pStats.map((stat) => {
          const dropPct = Math.round(((stat.suddenDrop + stat.steadyDrop) / total) * 100);
          const impPct  = Math.round(((stat.suddenImp  + stat.steadyImp)  / total) * 100);
          const isDomDrop = stat.suddenDrop + stat.steadyDrop > stat.suddenImp + stat.steadyImp;
          const isDomImp  = stat.suddenImp + stat.steadyImp > stat.suddenDrop + stat.steadyDrop;
          return (
            <Card key={stat.platform} className={cn("border",
              isDomDrop ? "border-blue-500/25" :
              isDomImp  ? "border-emerald-500/25" : "border-border"
            )}>
              <CardHeader className="pb-1.5 pt-3">
                <CardTitle className="text-xs flex items-center gap-1.5">
                  <span className={cn("inline-block w-2 h-2 rounded-full",
                    stat.platform === "ChatGPT"    ? "bg-emerald-500" :
                    stat.platform === "Gemini"     ? "bg-blue-500" :
                                                     "bg-violet-500"
                  )} />
                  {stat.platform}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                  <span className="text-blue-600">🚨 {stat.suddenDrop} sudden ↓</span>
                  <span className="text-emerald-600">✅ {stat.suddenImp} sudden ↑</span>
                  <span className="text-amber-600">📉 {stat.steadyDrop} steady ↓</span>
                  <span className="text-teal-600">📈 {stat.steadyImp} steady ↑</span>
                  <span className="text-muted-foreground">➡️ {stat.noChange} no change</span>
                  <span className="text-muted-foreground">⏳ {stat.baseline} baseline</span>
                </div>
                {/* Distribution bar */}
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden flex gap-px">
                  {dropPct > 0 && <div style={{ width: `${dropPct}%` }} className="bg-blue-500 h-full rounded-l-full" />}
                  {impPct > 0  && <div style={{ width: `${impPct}%` }}  className="bg-emerald-500 h-full" />}
                </div>
                <p className="text-[9px] text-muted-foreground">
                  {dropPct}% dropping · {impPct}% improving
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Visibility Gains & Drops ─────────────────────────────────────── */}
      {(() => {
        // REAPPEARED = was not found, now visible on any platform
        const reappearedBiz = businesses.filter(b =>
          PLATFORMS.some(p => b.platformLabels[p] === "REAPPEARED")
        );
        // NOT_FOUND_CRITICAL = was visible, now gone on any platform
        const lostVisibilityBiz = businesses.filter(b =>
          PLATFORMS.some(p => b.platformLabels[p] === "NOT_FOUND_CRITICAL")
        );
        // Major rank jumps: prevBestRank > 25 and now bestRank <= 25 (big position improvement)
        const majorJumpBiz = businesses.filter(b =>
          PLATFORMS.some(p => {
            const prev = b.prevBestRanks?.[p];
            const curr = b.bestRanks[p];
            return prev != null && curr != null && prev > 25 && curr <= 25;
          })
        );

        if (reappearedBiz.length === 0 && lostVisibilityBiz.length === 0 && majorJumpBiz.length === 0) return null;

        return (
          <div className="grid grid-cols-2 gap-3">
            {/* Visibility Gains */}
            <Card className="border-emerald-500/25 bg-emerald-500/5">
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-xs flex items-center gap-2">
                  ✨ Visibility Gains
                  <span className="ml-auto text-[10px] font-normal text-muted-foreground">{reappearedBiz.length + majorJumpBiz.length} businesses</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {reappearedBiz.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-emerald-700">Re-appeared (was gone, now visible)</p>
                    {reappearedBiz.map((b, i) => {
                      const plats = PLATFORMS.filter(p => b.platformLabels[p] === "REAPPEARED");
                      return (
                        <div key={i} className="flex items-center gap-2 rounded border border-emerald-300/50 bg-white/60 px-2 py-1.5 text-[10px]">
                          <span className="flex-1 font-medium text-foreground truncate">{b.bizName}</span>
                          <span className="text-emerald-600 shrink-0">{plats.join(", ")}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {majorJumpBiz.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-teal-700">Major Jump (outside Top 25 → inside Top 25)</p>
                    {majorJumpBiz.map((b, i) => {
                      const details = PLATFORMS
                        .filter(p => { const prev = b.prevBestRanks?.[p]; const curr = b.bestRanks[p]; return prev != null && curr != null && prev > 25 && curr <= 25; })
                        .map(p => `${p}: #${b.prevBestRanks[p]}→#${b.bestRanks[p]}`);
                      return (
                        <div key={i} className="flex items-center gap-2 rounded border border-teal-300/50 bg-white/60 px-2 py-1.5 text-[10px]">
                          <span className="flex-1 font-medium text-foreground truncate">{b.bizName}</span>
                          <span className="text-teal-600 shrink-0 text-[9px]">{details.join(" · ")}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {reappearedBiz.length === 0 && majorJumpBiz.length === 0 && (
                  <p className="text-[10px] text-muted-foreground italic">No visibility gains this run</p>
                )}
              </CardContent>
            </Card>

            {/* Lost Visibility */}
            <Card className="border-blue-600/25 bg-blue-500/5">
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-xs flex items-center gap-2">
                  🚫 Lost Visibility
                  <span className="ml-auto text-[10px] font-normal text-muted-foreground">{lostVisibilityBiz.length} businesses</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-1">
                <p className="text-[10px] text-muted-foreground mb-1.5">
                  Were ranked, now completely absent from AI responses on at least one platform.
                </p>
                {lostVisibilityBiz.length === 0 ? (
                  <p className="text-[10px] text-emerald-600 italic">No businesses lost visibility ✅</p>
                ) : lostVisibilityBiz.map((b, i) => {
                  const plats = PLATFORMS.filter(p => b.platformLabels[p] === "NOT_FOUND_CRITICAL");
                  const prevRanks = plats.map(p => b.prevBestRanks?.[p] ? `${p}: was #${b.prevBestRanks[p]}` : p).join(" · ");
                  return (
                    <div key={i} className="rounded border border-blue-300/50 bg-white/60 px-2 py-1.5 text-[10px] space-y-0.5">
                      <p className="font-medium text-foreground truncate">{b.bizName}</p>
                      <p className="text-blue-700 text-[9px]">{prevRanks}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* Why analysis — side by side */}
      <div className="grid grid-cols-2 gap-3">
        {/* Why sudden drops */}
        <Card className="border-blue-500/25 bg-blue-500/5">
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-xs">🚨 Why Most Sudden Drops</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-start gap-4">
              <div className="text-center shrink-0">
                <p className="text-3xl font-bold text-blue-600 leading-none">
                  {overallDist.suddenDrop + overallDist.steadyDrop}
                </p>
                <p className="text-[9px] text-muted-foreground mt-0.5">businesses<br/>dropping</p>
              </div>
              <div className="space-y-1.5 flex-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">All 3 platforms dropping</span>
                  <span className="font-semibold">{allThreeDropping.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Single platform only</span>
                  <span className="font-semibold">{singlePlatDrop.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Most affected</span>
                  <span className="font-semibold">
                    {platformDropCounts[0]?.platform} ({platformDropCounts[0]?.count})
                  </span>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {allThreeDropping.length >= singlePlatDrop.length
                ? `${allThreeDropping.length} business${allThreeDropping.length !== 1 ? "es" : ""} dropped on all 3 platforms simultaneously — this is a campaign-level signal failure. Sessions likely stopped or had a high error rate during the ranking window, sending no signal to any platform.`
                : `${singlePlatDrop.length} business${singlePlatDrop.length !== 1 ? "es" : ""} dropped on only one platform — pointing to a ${platformDropCounts[0]?.platform}-specific algorithm change or session delivery issue rather than a full campaign problem.`
              }
            </p>
            <p className="text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">Fix: </span>
              {allThreeDropping.length >= singlePlatDrop.length
                ? "Check session logs for gaps and error spikes across the full ranking window. Run sessions on all 3 platforms daily with zero gaps."
                : `Increase session volume specifically on ${platformDropCounts[0]?.platform} without reducing the other two platforms.`
              }
            </p>
          </CardContent>
        </Card>

        {/* Why improvements */}
        <Card className="border-emerald-500/25 bg-emerald-500/5">
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-xs">✅ Why Most Improvements</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-start gap-4">
              <div className="text-center shrink-0">
                <p className="text-3xl font-bold text-emerald-600 leading-none">
                  {overallDist.suddenImp + overallDist.steadyImp}
                </p>
                <p className="text-[9px] text-muted-foreground mt-0.5">businesses<br/>improving</p>
              </div>
              <div className="space-y-1.5 flex-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">All 3 platforms up</span>
                  <span className="font-semibold">{allThreeImproving.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sudden jump (4+ spots)</span>
                  <span className="font-semibold">{overallDist.suddenImp}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Best platform</span>
                  <span className="font-semibold">
                    {platformImpCounts[0]?.platform} ({platformImpCounts[0]?.count})
                  </span>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {platformImpCounts[0]?.count > 0
                ? `${platformImpCounts[0]?.platform} is seeing the most improvements (${platformImpCounts[0]?.count} businesses). Consistent daily sessions with no gaps during the 14-day window built enough signal for ${platformImpCounts[0]?.platform} to actively recommend these businesses.`
                : "No significant improvements this cycle. Ensure sessions run every day with no gaps across all 3 platforms."
              }
            </p>
            <p className="text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">What's working: </span>
              Businesses that jumped ran zero-gap sessions throughout the full 14-day window with a high success rate. The AI platform absorbed accumulated signals and updated its index in their favor.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* All businesses table */}
      <Card>
        <CardHeader className="pb-2 pt-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-xs flex items-center gap-1.5 flex-1">
              <BarChart2 className="w-3.5 h-3.5 text-primary" />
              All Businesses — Platform Performance
            </CardTitle>
            <div className="relative w-48">
              <Search className="absolute left-2 top-1.5 w-3 h-3 text-muted-foreground" />
              <Input
                placeholder="Filter…"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="pl-6 h-6 text-[10px]"
              />
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">{tableRows.length} shown</span>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-border">
                  <SortTh field="name"       label="Business" />
                  <SortTh field="ChatGPT"    label="ChatGPT" />
                  <SortTh field="Gemini"     label="Gemini" />
                  <SortTh field="Perplexity" label="Perplexity" />
                  <SortTh field="overall"    label="Overall" />
                  <th className="text-left pb-2 font-medium text-muted-foreground whitespace-nowrap">Health Score</th>
                  <th className="text-left pb-2 font-medium text-muted-foreground">Session</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((biz, i) => {
                  const oCfg = LABEL_CONFIG[biz.overallLabel];
                  const sCfg = biz.session ? PRED_CONFIG[biz.session.prediction] : null;
                  return (
                    <tr
                      key={i}
                      onClick={() => onSelect(biz)}
                      className="border-b border-border/30 hover:bg-secondary/50 cursor-pointer transition-colors group"
                    >
                      <td className="py-2 pr-3 max-w-[180px]">
                        <p className="truncate font-medium text-foreground group-hover:text-primary transition-colors" title={biz.bizName}>
                          {biz.bizName}
                        </p>
                        <p className="text-[9px] text-muted-foreground">{biz.totalRuns} run{biz.totalRuns !== 1 ? "s" : ""}</p>
                      </td>
                      {PLATFORMS.map((p) => {
                        const rank  = biz.bestRanks[p];
                        const label = biz.platformLabels[p] ?? "BASELINE";
                        const lCfg  = LABEL_CONFIG[label];
                        return (
                          <td key={p} className="py-2 pr-3 whitespace-nowrap">
                            <span className={cn("font-mono font-bold text-[11px] block", rankColor(rank))}>
                              {rank !== null ? `#${rank}` : "—"}
                            </span>
                            <span className={cn("text-[8px]", lCfg.color.split(" ").slice(1, 2).join(" "))}>
                              {lCfg.icon} {lCfg.label}
                            </span>
                          </td>
                        );
                      })}
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={cn("text-[8px] px-1.5 py-0", oCfg.color)}>
                          {oCfg.icon} {oCfg.label}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {(() => {
                          const aeo = aeoData?.businesses.find(a => a.bizName === biz.bizName);
                          if (!aeo) return <span className="text-muted-foreground">—</span>;
                          const tCfg = TIER_CONFIG[aeo.performanceTier];
                          return (
                            <div className="flex flex-col gap-0.5">
                              <span className={cn("font-mono font-bold text-[11px]", tCfg.color)}>
                                {aeo.overallHealthScore.toFixed(1)}
                              </span>
                              <span className={cn("text-[8px]", aeo.healthScoreDelta >= 0 ? "text-emerald-600" : "text-blue-500")}>
                                {aeo.healthScoreDelta >= 0 ? "+" : ""}{aeo.healthScoreDelta.toFixed(1)}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-2">
                        {sCfg ? (
                          <Badge variant="outline" className={cn("text-[8px] px-1.5 py-0", sCfg.color)}>
                            {sCfg.icon} {sCfg.label}
                          </Badge>
                        ) : (
                          <span className="text-[9px] text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export function RankingsPage() {
  const [businesses, setBusinesses] = useState<BusinessSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterLabel, setFilterLabel] = useState<string>("all");
  const [aeoMap, setAeoMap] = useState<Map<string, AEOBizSummary>>(new Map());
  const [chatOpen, setChatOpen] = useState(false);
  const [rankingDates, setRankingDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");

  const [selected, setSelected] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/csv/rankings/businesses")
      .then((r) => r.json())
      .then((d) => { setBusinesses(d.businesses ?? []); setLoading(false); })
      .catch((e) => { setListError(e.message); setLoading(false); });
    fetch("/api/csv/aeo/overview")
      .then(r => r.json())
      .then((d: AEOOverview) => {
        const m = new Map<string, AEOBizSummary>();
        for (const b of d.businesses ?? []) m.set(b.bizName, b);
        setAeoMap(m);
      })
      .catch(() => {});
    fetch("/api/csv/rankings/dates")
      .then(r => r.json())
      .then((d: { dates: string[] }) => {
        setRankingDates(d.dates ?? []);
        if (d.dates?.length) setSelectedDate(d.dates[0]);
      })
      .catch(() => {});
  }, []);

  async function selectBusiness(bizName: string, session: SessionInfo | null, bestRanks: Record<string, number | null>) {
    setSelected(bizName);
    setLoadingDetail(true);
    setDetail(null);
    setDetailError(null);
    try {
      const r = await fetch(`/api/csv/rankings/detail?business=${encodeURIComponent(bizName)}`);
      const d = await r.json();
      if (!r.ok) { setDetailError(d.error ?? "Failed to load"); return; }
      setDetail({ ...d, session, bestRanks });
    } catch (e: unknown) {
      setDetailError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDetail(false);
    }
  }

  const DROP_LABELS: RankLabel[] = ["SUDDEN_DROP", "NOT_FOUND_CRITICAL", "STEADY_DROP"];
  const dropCount = businesses.filter((b) => DROP_LABELS.includes(b.overallLabel)).length;
  const improveCount = businesses.filter((b) => b.overallLabel === "STEADY_IMPROVEMENT" || b.overallLabel === "SUDDEN_IMPROVEMENT").length;
  const stableCount  = businesses.filter((b) => b.overallLabel === "NO_CHANGE").length;

  // Date filter: when a date is chosen, only show businesses whose latest run is that date OR
  // that have any keyword run on that exact date.
  const dateFilteredBiz = selectedDate
    ? businesses.filter((b) => b.latestRunDate === selectedDate || b.firstRunDate === selectedDate)
    : businesses;

  const filtered = dateFilteredBiz.filter((b) => {
    const matchSearch = b.bizName.toLowerCase().includes(search.toLowerCase());
    const matchLabel = filterLabel === "all" || b.overallLabel === filterLabel ||
      (filterLabel === "drops" && DROP_LABELS.includes(b.overallLabel)) ||
      (filterLabel === "improved" && (b.overallLabel === "STEADY_IMPROVEMENT" || b.overallLabel === "SUDDEN_IMPROVEMENT")) ||
      (filterLabel === "stable" && b.overallLabel === "NO_CHANGE");
    return matchSearch && matchLabel;
  });

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left panel */}
      <aside className="w-80 shrink-0 border-r border-border flex flex-col min-h-0">
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-bold text-foreground">Rankings</h1>
            <Badge variant="outline" className="text-[10px] ml-auto">Bi-weekly</Badge>
          </div>

          {/* Date calendar — select ranking run date */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
            {rankingDates.length > 0 ? (
              <select
                value={selectedDate}
                onChange={(e) => { setSelectedDate(e.target.value); setSelected(null); setDetail(null); }}
                className="text-[11px] border border-border rounded px-1.5 py-1 bg-background text-foreground flex-1 cursor-pointer"
              >
                {rankingDates.map((d) => (
                  <option key={d} value={d}>
                    {new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[11px] text-muted-foreground">Loading dates…</span>
            )}
          </div>

          {/* Filter pills */}
          <div className="flex gap-1.5 flex-wrap">
            {[
              { key: "all",      label: `All (${dateFilteredBiz.length})` },
              { key: "drops",    label: `📉 Drops (${dropCount})` },
              { key: "improved", label: `📈 Improved (${improveCount})` },
              { key: "stable",   label: `➡️ Stable (${stableCount})` },
              { key: "BASELINE", label: "⏳ Baseline" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setFilterLabel((p) => (p === key ? "all" : key))}
                className={cn("text-[10px] rounded border px-2 py-0.5 transition-colors",
                  filterLabel === key
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary/60"
                )}>
                {label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Search businesses…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
          {!loading && (
            <p className="text-[10px] text-muted-foreground">{filtered.length} of {dateFilteredBiz.length} shown · {businesses.length} total</p>
          )}
        </div>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : listError ? (
            <div className="p-4">
              <p className="text-xs text-rose-500 flex gap-1">
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />{listError}
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {filtered.map((biz) => {
                const isSelected = selected === biz.bizName;
                const lCfg = LABEL_CONFIG[biz.overallLabel];
                const sCfg = biz.session ? PRED_CONFIG[biz.session.prediction] : null;

                return (
                  <div key={biz.bizName}
                    onClick={() => selectBusiness(biz.bizName, biz.session, biz.bestRanks)}
                    className={cn(
                      "rounded-md px-3 py-2.5 cursor-pointer transition-colors border group",
                      isSelected && loadingDetail ? "bg-primary/10 border-primary/30 opacity-70" :
                      isSelected                  ? "bg-primary/10 border-primary/20" :
                                                    "border-transparent hover:bg-secondary/60 hover:border-border"
                    )}>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <p className={cn("text-xs font-medium truncate flex-1",
                        isSelected ? "text-primary" : "text-foreground group-hover:text-primary transition-colors"
                      )} title={biz.bizName}>{biz.bizName}</p>
                      {isSelected && loadingDetail
                        ? <Loader2 className="w-3 h-3 animate-spin shrink-0 text-muted-foreground" />
                        : <ChevronRight className={cn("w-3 h-3 shrink-0",
                            isSelected ? "text-primary" : "text-muted-foreground/40 group-hover:text-primary"
                          )} />
                      }
                    </div>

                    {/* Best rank per platform */}
                    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                      {PLATFORMS.map((p) => {
                        const rank = biz.bestRanks[p];
                        return (
                          <span key={p} title={`${p}: best rank`}
                            className={cn("inline-flex items-center gap-0.5 text-[9px] rounded-full border px-1.5 py-0 leading-5", PLATFORM_COLOR[p])}>
                            {p[0]}:
                            <span className={cn("font-mono font-bold", rankColor(rank))}>
                              {rank !== null && rank !== undefined ? `#${rank}` : "—"}
                            </span>
                          </span>
                        );
                      })}
                    </div>

                    {/* Label + session prediction + health score */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", lCfg.color)}>
                        {lCfg.icon} {lCfg.label}
                      </Badge>
                      {sCfg && (
                        <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", sCfg.color)}>
                          {sCfg.icon} {sCfg.label}
                        </Badge>
                      )}
                      {(() => {
                        const aeo = aeoMap.get(biz.bizName);
                        if (!aeo) return null;
                        const tCfg = TIER_CONFIG[aeo.performanceTier];
                        return (
                          <span className={cn("text-[9px] font-mono font-bold border rounded px-1 py-0", tCfg.bg, tCfg.color)}>
                            {aeo.overallHealthScore.toFixed(0)}
                            {aeo.flags.length > 0 && " 🚨"}
                          </span>
                        );
                      })()}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-muted-foreground">
                        {biz.totalRuns} run{biz.totalRuns !== 1 ? "s" : ""}
                        {biz.totalRuns <= 2 ? " ⚠️ early" : ""}
                      </span>
                      <span className="text-[9px] text-muted-foreground ml-auto">{biz.latestRunDate?.slice(5)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </aside>

      {/* Right panel */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col min-h-0">
        {/* ── Right panel header with chat toggle ────────────── */}
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-border shrink-0">
          <button
            onClick={() => setChatOpen(o => !o)}
            className={cn(
              "flex items-center gap-1.5 text-[11px] rounded-lg px-3 py-1.5 border transition-colors font-medium",
              chatOpen
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {chatOpen ? "Close Chat" : "AI Chat"}
          </button>
        </div>

        {chatOpen ? (
          /* ── Chat mode ──────────────────────────────────────── */
          <div className="flex-1 min-h-0 overflow-hidden">
            <AeoChatPanel
              businesses={businesses}
              initialBizName={selected}
            />
          </div>
        ) : (
          /* ── Rankings / Overview mode ───────────────────────── */
          <ScrollArea className="flex-1">
            <div className="p-6">
              {loadingDetail ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">
                    Loading ranking data for <span className="font-medium">{selected}</span>…
                  </p>
                </div>
              ) : detailError ? (
                <Card className="border-rose-500/30">
                  <CardContent className="pt-6 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-rose-600">Failed to load</p>
                      <p className="text-xs text-muted-foreground mt-1">{detailError}</p>
                    </div>
                  </CardContent>
                </Card>
              ) : detail ? (
                <div className="space-y-4">
                  <button
                    onClick={() => { setSelected(null); setDetail(null); }}
                    className="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                  >
                    ← Back to overview
                  </button>
                  <DetailPanel detail={detail} />
                </div>
              ) : loading ? null : (
                <OverviewPanel
                  businesses={businesses}
                  onSelect={(biz) => selectBusiness(biz.bizName, biz.session, biz.bestRanks)}
                />
              )}
            </div>
          </ScrollArea>
        )}
      </main>
    </div>
  );
}
