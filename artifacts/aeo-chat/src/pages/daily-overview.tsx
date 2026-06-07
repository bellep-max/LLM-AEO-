import { useState, useEffect, useCallback } from "react";
import { AeoChatPanel } from "@/components/aeo-chat-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Calendar, RefreshCw, Search, Loader2, AlertCircle,
  TrendingUp, TrendingDown, Minus, AlertTriangle,
  BarChart2, CheckCircle2, ChevronDown, ChevronRight, MessageSquare,
  ClipboardList, Zap, Eye, Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────
type Prediction = "ON_TRACK" | "AT_RISK" | "STABLE" | "TOO_EARLY";
type RankLabel =
  | "SUDDEN_IMPROVEMENT" | "STEADY_IMPROVEMENT" | "NO_CHANGE"
  | "STEADY_DROP" | "SUDDEN_DROP" | "BASELINE"
  | "NOT_FOUND_CRITICAL" | "REAPPEARED";

interface PlatformWindow {
  platform: string;
  sessionsLast3Days: number;
  sessionsLast5Days: number;
  consecutiveDaysSilent: number;
  status: "ACTIVE" | "NO_SESSIONS";
}

interface BizRow {
  bizName: string; clientName: string; rankLabel: RankLabel; prediction: Prediction;
  predictionEmoji: string; predictionLabel: string; latestRankDate: string;
  sessionsToday: number; targetPerDay: number; avg7DaySessions: number;
  avg7DaySuccessRate: number; gapDays7: number;
  hasSessionData: boolean;
  isFirstRunOnly: boolean;
  bestRanks: Record<string, number | null>;
  campaignName: string; daysActive: number; phase: number; phaseLabel: string;
  firstDate: string; latestDate: string; nextRankingRunDue: string;
  why: string; action: string;
  platformWindows: PlatformWindow[];
  missedKeywords3Plus: string[]; missedKeywords5Plus: string[];
  keywordsHitToday: string[]; platformsToday: Record<string, number>;
  allKeywords: string[];
  successRateToday: number;
}

interface AtRiskBiz {
  bizName: string; prediction: Prediction; predictionEmoji: string;
  why: string; action: string; gapDays7: number; avg7DaySuccessRate: number;
  missedKeywords5Plus: string[]; silentPlatform: string | null;
  rankLabel: RankLabel; latestRankDate: string;
}

interface RankAlert {
  bizName: string; label: RankLabel; platform: string; keyword: string;
  prevRank: number | null; currentRank: number | null; spotsChanged: number | null;
  sessionPrediction: Prediction; sessionPredictionEmoji: string;
  sessionWhy: string; sessionAction: string;
  gapDays7: number; avg7DaySuccessRate: number;
}

interface DailyOverview {
  asOfDate: string;
  totalBusinesses: number;
  totalWithRankings: number;
  totalWithComparableRankings: number;
  phase1to2Count: number;
  phase4to6Count: number;
  rankingsSummary: {
    suddenDrops: number; suddenImprovements: number; steadyDrop: number;
    steadyImprovement: number; baseline: number; noChange: number;
  };
  sessionsSummary: { onTrack: number; atRisk: number; stable: number; tooEarly: number };
  mostImprovedBiz: { bizName: string; label: RankLabel; keyword: string; platform: string; spotsChanged: number } | null;
  mostDeclinedBiz: { bizName: string; label: RankLabel; keyword: string; platform: string; spotsChanged: number } | null;
  atRiskBusinesses: AtRiskBiz[];
  rankAlerts: RankAlert[];
  businesses: BizRow[];
}

interface ByDateBiz {
  bizName: string; total: number; success: number;
  successRate: number; platforms: Record<string, number>; keywords: string[]; hadSessions: boolean;
}
interface ByDateData { date: string; businesses: ByDateBiz[]; total: number; }

// ── Config ─────────────────────────────────────────────────────────────────────
const PRED: Record<Prediction, { label: string; emoji: string; dot: string; text: string; bg: string; ring: string }> = {
  AT_RISK:   { label: "At Risk of Drop",          emoji: "🚨", dot: "bg-blue-500",    text: "text-blue-700",    bg: "bg-blue-50 dark:bg-blue-950/40",     ring: "border-blue-400" },
  STABLE:    { label: "Stable — Holding Position", emoji: "➡️", dot: "bg-amber-500",   text: "text-amber-700",   bg: "bg-amber-50 dark:bg-amber-950/40",   ring: "border-amber-400" },
  ON_TRACK:  { label: "On Track for Improvement",  emoji: "📈", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50 dark:bg-emerald-950/40",ring: "border-emerald-400" },
  TOO_EARLY: { label: "Too Early to Assess",        emoji: "⏳", dot: "bg-slate-400",   text: "text-slate-600",   bg: "bg-slate-50 dark:bg-slate-900/60",   ring: "border-slate-300" },
};

const RANK_CFG: Record<RankLabel, { label: string; color: string; icon: string }> = {
  SUDDEN_IMPROVEMENT: { label: "Sudden ↑",   color: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", icon: "✅" },
  STEADY_IMPROVEMENT: { label: "Steady ↑",   color: "bg-teal-500/15 text-teal-700 border-teal-500/30",         icon: "📈" },
  NO_CHANGE:          { label: "No Change",  color: "bg-slate-400/15 text-slate-600 border-slate-400/30",       icon: "—" },
  STEADY_DROP:        { label: "Steady ↓",   color: "bg-amber-500/15 text-amber-700 border-amber-500/30",       icon: "📉" },
  SUDDEN_DROP:        { label: "Sudden ↓",   color: "bg-blue-500/15 text-blue-700 border-blue-500/30",          icon: "📉" },
  NOT_FOUND_CRITICAL: { label: "Not Found",  color: "bg-blue-600/15 text-blue-800 border-blue-600/40",           icon: "📉" },
  REAPPEARED:         { label: "Re-appeared",color: "bg-cyan-500/15 text-cyan-700 border-cyan-500/30",          icon: "✨" },
  BASELINE:           { label: "Baseline",   color: "bg-slate-300/20 text-slate-500 border-slate-400/30",       icon: "📍" },
};

const PLATFORM_BADGE: Record<string, string> = {
  ChatGPT:    "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  Gemini:     "bg-blue-500/10 text-blue-700 border-blue-500/30",
  Perplexity: "bg-violet-500/10 text-violet-700 border-violet-500/30",
};

function fmt(d: string): string {
  if (!d) return "—";
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function pct(v: number): string { return `${(v * 100).toFixed(0)}%`; }

// ── Improved Businesses Sidebar ───────────────────────────────────────────────
function ImprovedSidebar({ businesses, excludeFirstRun }: { businesses: BizRow[]; excludeFirstRun: boolean }) {
  const improved = businesses.filter((b) => {
    if (excludeFirstRun && b.rankLabel === "BASELINE" && !b.hasSessionData) return false;
    return b.rankLabel === "STEADY_IMPROVEMENT" || b.rankLabel === "SUDDEN_IMPROVEMENT" || b.rankLabel === "REAPPEARED";
  });

  const PLATFORMS = ["ChatGPT", "Gemini", "Perplexity"] as const;

  return (
    <aside className="w-64 shrink-0 border-l border-border bg-card flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-emerald-50 dark:bg-emerald-950/30 shrink-0">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
          <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Improved Businesses</p>
          <span className="ml-auto bg-emerald-600 text-white text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0">
            {improved.length}
          </span>
        </div>
        <p className="text-[9px] text-muted-foreground mt-1">Rankings moved up since last bi-weekly run</p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2 space-y-1.5">
          {improved.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-[11px] text-muted-foreground">No rank improvements this cycle</p>
            </div>
          ) : (
            improved.map((biz) => {
              const cfg = RANK_CFG[biz.rankLabel];
              const predCfg = PRED[biz.prediction];
              return (
                <div
                  key={biz.bizName}
                  className="rounded-lg border border-border bg-background p-2.5 space-y-1.5 hover:bg-muted/40 transition-colors"
                >
                  {/* Business name + session emoji */}
                  <div className="flex items-start gap-1.5">
                    <span className="text-[10px] shrink-0 mt-0.5">{predCfg.emoji}</span>
                    <p className="text-[11px] font-semibold text-foreground leading-tight line-clamp-2 flex-1">
                      {biz.bizName}
                    </p>
                  </div>

                  {/* Rank label badge */}
                  <span className={cn("inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded border", cfg.color)}>
                    {cfg.icon} {cfg.label}
                  </span>

                  {/* Per-platform best ranks */}
                  <div className="flex gap-1 flex-wrap">
                    {PLATFORMS.map((p) => {
                      const rank = biz.bestRanks?.[p];
                      if (rank == null) return null;
                      const isGood = rank <= 5;
                      const isOk   = rank <= 10;
                      return (
                        <span
                          key={p}
                          className={cn(
                            "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded",
                            isGood ? "bg-emerald-100 text-emerald-700" :
                            isOk   ? "bg-amber-100 text-amber-700" :
                                     "bg-red-100 text-red-700"
                          )}
                        >
                          {p.slice(0, 3)} #{rank}
                        </span>
                      );
                    })}
                  </div>

                  {/* Days active + next run */}
                  {biz.nextRankingRunDue && (
                    <p className="text-[9px] text-muted-foreground">
                      Next run: {fmt(biz.nextRankingRunDue)}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}

// ── Date-specific session summary card ────────────────────────────────────────
function DateSummaryCard({ bd, allBizinesses }: { bd: ByDateData; allBizinesses: BizRow[] }) {
  const totalSessions   = bd.businesses.reduce((s, b) => s + b.total, 0);
  const totalSuccess    = bd.businesses.reduce((s, b) => s + b.success, 0);
  const overallRate     = totalSessions > 0 ? totalSuccess / totalSessions : 0;
  const platformTotals  = bd.businesses.reduce<Record<string, number>>((acc, b) => {
    Object.entries(b.platforms).forEach(([p, n]) => { acc[p] = (acc[p] ?? 0) + n; });
    return acc;
  }, {});
  const noSessions = allBizinesses
    .filter(b => !bd.businesses.find(d => d.bizName === b.bizName))
    .map(b => b.bizName);
  const topBusinesses = [...bd.businesses].sort((a, b) => b.total - a.total).slice(0, 5);

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/20 bg-primary/10">
        <Calendar className="w-4 h-4 text-primary" />
        <p className="text-sm font-bold text-primary">Session Summary — {fmt(bd.date)}</p>
      </div>
      <div className="p-4 space-y-4">

        {/* Top metrics row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Businesses with Sessions", val: bd.total, sub: `of ${allBizinesses.length} total`, color: "text-primary" },
            { label: "Total Sessions", val: totalSessions, sub: "that day", color: "text-foreground" },
            { label: "Successful Sessions", val: totalSuccess, sub: `${pct(overallRate)} success rate`, color: overallRate >= 0.9 ? "text-emerald-600" : overallRate >= 0.7 ? "text-amber-600" : "text-orange-600" },
            { label: "No Sessions", val: noSessions.length, sub: "businesses inactive", color: noSessions.length === 0 ? "text-emerald-600" : "text-orange-600" },
          ].map(({ label, val, sub, color }) => (
            <div key={label} className="rounded-lg border border-border bg-card p-3">
              <p className={cn("text-2xl font-bold", color)}>{val}</p>
              <p className="text-[10px] font-semibold text-foreground mt-0.5">{label}</p>
              <p className="text-[9px] text-muted-foreground">{sub}</p>
            </div>
          ))}
        </div>

        {/* Platform breakdown */}
        {Object.keys(platformTotals).length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Sessions by Platform</p>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(platformTotals).sort((a, b) => b[1] - a[1]).map(([p, n]) => (
                <span key={p} className={cn("text-xs font-semibold px-3 py-1 rounded-full border", PLATFORM_BADGE[p] ?? "bg-muted text-muted-foreground border-border")}>
                  {p}: {n} sessions
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Top 5 most active */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Top 5 Most Active Businesses</p>
          <div className="space-y-1">
            {topBusinesses.map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-center text-[10px] font-bold text-muted-foreground shrink-0">{i + 1}</span>
                <p className="flex-1 text-foreground truncate">{b.bizName}</p>
                <span className="font-mono text-muted-foreground shrink-0">{b.total} sessions</span>
                <span className={cn("text-[9px] font-semibold shrink-0",
                  b.successRate >= 0.9 ? "text-emerald-600" : b.successRate >= 0.7 ? "text-amber-600" : "text-orange-600"
                )}>{pct(b.successRate)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Inactive businesses */}
        {noSessions.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
              No Sessions on {fmt(bd.date)} ({noSessions.length} businesses)
            </p>
            <div className="flex flex-wrap gap-1">
              {noSessions.slice(0, 12).map((name, i) => (
                <span key={i} className="text-[10px] bg-orange-100 text-orange-700 border border-orange-300 rounded px-1.5 py-0.5">{name}</span>
              ))}
              {noSessions.length > 12 && (
                <span className="text-[10px] text-muted-foreground px-1.5 py-0.5">+{noSessions.length - 12} more</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Summary table (Section 10 overall summary) ─────────────────────────────────
function SummaryTable({ data }: { data: DailyOverview }) {
  const ss = data.sessionsSummary;
  const rs = data.rankingsSummary;
  const rows: [string, string][] = [
    ["Total businesses active (sessions)", String(data.totalBusinesses)],
    ["Businesses with comparable rankings (2+ runs)", String(data.totalWithComparableRankings ?? data.totalWithRankings)],
    ["Businesses — first run only (no comparison)", String(data.totalWithRankings - (data.totalWithComparableRankings ?? data.totalWithRankings))],
    ["Phase 1–2 — Launch / Warmup", String(data.phase1to2Count)],
    ["Phase 3–6 — Build / Sustain", String(data.phase4to6Count)],
    ["🟢 On Track for Improvement", String(ss.onTrack)],
    ["🟡 Stable — Holding Position", String(ss.stable)],
    ["🔴 At Risk of Drop", String(ss.atRisk)],
    ["⏳ Too Early to Assess", String(ss.tooEarly)],
    ["Ranking sudden improvements (last run)", String(rs.suddenImprovements)],
    ["Ranking sudden drops (last run)", String(rs.suddenDrops)],
    ["Most improved (ranking Δ)", data.mostImprovedBiz ? `${data.mostImprovedBiz.bizName} (+${data.mostImprovedBiz.spotsChanged})` : "—"],
    ["Most declined (ranking Δ)", data.mostDeclinedBiz ? `${data.mostDeclinedBiz.bizName} (${data.mostDeclinedBiz.spotsChanged})` : "—"],
  ];
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Metric</th>
            <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map(([metric, val], i) => (
            <tr key={i} className="hover:bg-muted/20">
              <td className="px-4 py-2 text-muted-foreground">{metric}</td>
              <td className="px-4 py-2 text-right font-semibold text-foreground">{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Rankings distribution bar ──────────────────────────────────────────────────
function RankBar({ rs, comparableCount }: { rs: DailyOverview["rankingsSummary"]; comparableCount: number }) {
  // Baseline = has 2+ run dates but keywords never overlapped between dates — not actionable, excluded from bar
  const segs = [
    { count: rs.suddenDrops,       color: "bg-blue-600",   label: `Sudden ↓ (${rs.suddenDrops})` },
    { count: rs.steadyDrop,        color: "bg-amber-500",  label: `Steady ↓ (${rs.steadyDrop})` },
    { count: rs.noChange,          color: "bg-slate-400",  label: `No Change (${rs.noChange})` },
    { count: rs.steadyImprovement, color: "bg-teal-400",   label: `Steady ↑ (${rs.steadyImprovement})` },
    { count: rs.suddenImprovements,color: "bg-emerald-500",label: `Sudden ↑ (${rs.suddenImprovements})` },
  ].filter((s) => s.count > 0);
  const total = segs.reduce((s, x) => s + x.count, 0);
  if (!total) return null;
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-3">
        Ranking Change Distribution — {comparableCount} businesses with 2+ runs
        <span className="font-normal normal-case ml-1 text-muted-foreground/70">(first-run-only excluded)</span>
      </p>
      <div className="flex items-center gap-0.5 h-4 rounded-full overflow-hidden">
        {segs.map((s, i) => (
          <div key={i} className={cn("h-full", s.color)} style={{ flex: s.count }} title={s.label} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
        {segs.map((s, i) => (
          <span key={i} className="text-[10px] text-muted-foreground">{s.label}</span>
        ))}
      </div>
    </div>
  );
}

// ── At Risk card ───────────────────────────────────────────────────────────────
function AtRiskCard({ biz }: { biz: AtRiskBiz }) {
  return (
    <div className="rounded-xl border-2 border-blue-400 bg-blue-50 dark:bg-blue-950/30 p-4">
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0">🚨</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap mb-1.5">
            <p className="text-sm font-bold text-foreground">{biz.bizName}</p>
            {biz.latestRankDate && (
              <span className="text-[10px] text-muted-foreground">Ranking: {RANK_CFG[biz.rankLabel]?.icon} {RANK_CFG[biz.rankLabel]?.label} ({fmt(biz.latestRankDate)})</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Why: </span>{biz.why}
          </p>
          <p className="text-xs text-blue-700 font-semibold mt-1">
            Action: {biz.action}
          </p>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {biz.gapDays7 >= 2 && (
              <span className="text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 border border-blue-300 rounded px-1.5 py-0.5">
                {biz.gapDays7} gap days
              </span>
            )}
            {biz.avg7DaySuccessRate < 0.7 && (
              <span className="text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 border border-blue-300 rounded px-1.5 py-0.5">
                {pct(biz.avg7DaySuccessRate)} success rate
              </span>
            )}
            {biz.silentPlatform && (
              <span className="text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 border border-amber-300 rounded px-1.5 py-0.5">
                {biz.silentPlatform} silent 5+ days
              </span>
            )}
            {biz.missedKeywords5Plus.length > 0 && (
              <span className="text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 border border-amber-300 rounded px-1.5 py-0.5">
                Keyword missed 5+ days
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Rank alert card ────────────────────────────────────────────────────────────
function RankAlertCard({ alert }: { alert: RankAlert }) {
  const cfg = RANK_CFG[alert.label];
  const isDrop = alert.label === "SUDDEN_DROP" || alert.label === "NOT_FOUND_CRITICAL";
  const isRise = alert.label === "SUDDEN_IMPROVEMENT" || alert.label === "REAPPEARED";
  const sessCfg = PRED[alert.sessionPrediction];
  return (
    <div className={cn("rounded-xl border p-4",
      isDrop ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30"
      : isRise ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
      : "border-border"
    )}>
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0">{cfg.icon}</span>
        <div className="flex-1 min-w-0">

          {/* Header row */}
          <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
            <p className="text-sm font-bold text-foreground">{alert.bizName}</p>
            <Badge variant="outline" className={cn("text-[10px]", cfg.color)}>{cfg.icon} {cfg.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {alert.platform} · <em>{alert.keyword}</em>
          </p>

          {/* Rank change row */}
          <div className="flex items-center gap-2 text-xs mb-3">
            <span className="text-muted-foreground">{alert.prevRank !== null ? `#${alert.prevRank}` : "Not Found"}</span>
            {isDrop
              ? <TrendingDown className="w-3 h-3 text-blue-500" />
              : <TrendingUp className="w-3 h-3 text-emerald-500" />}
            <span className={cn("font-bold", isDrop ? "text-blue-700" : "text-emerald-600")}>
              {alert.currentRank !== null ? `#${alert.currentRank}` : "Not Found"}
            </span>
            {alert.spotsChanged !== null && (
              <span className={cn("font-mono text-[10px] font-bold",
                alert.spotsChanged > 0 ? "text-emerald-600" : "text-blue-700"
              )}>
                ({alert.spotsChanged > 0 ? "+" : ""}{alert.spotsChanged} spots)
              </span>
            )}
          </div>

          {/* Session context badges */}
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-semibold", sessCfg.bg, sessCfg.text, sessCfg.ring)}>
              {sessCfg.emoji} Sessions: {sessCfg.label}
            </span>
            {alert.gapDays7 >= 2 && (
              <span className="text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 border border-blue-300 rounded-full px-2 py-0.5 font-semibold">
                {alert.gapDays7} session gap days
              </span>
            )}
            {alert.avg7DaySuccessRate > 0 && alert.avg7DaySuccessRate < 0.7 && (
              <span className="text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 border border-amber-300 rounded-full px-2 py-0.5 font-semibold">
                {pct(alert.avg7DaySuccessRate)} success rate
              </span>
            )}
          </div>

          {/* Why + Action (session-based reason for the change) */}
          {alert.sessionWhy && (
            <div className={cn("rounded-lg border p-3 space-y-1.5 text-xs",
              isDrop ? "border-blue-300 bg-blue-50/80 dark:bg-blue-950/40"
              : "border-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/40"
            )}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Why</p>
                <p className="text-muted-foreground mt-0.5 leading-relaxed">{alert.sessionWhy}</p>
              </div>
              {alert.sessionAction && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Action</p>
                  <p className={cn("font-semibold mt-0.5 leading-relaxed",
                    isDrop ? "text-blue-800 dark:text-blue-300" : "text-emerald-800 dark:text-emerald-300"
                  )}>{alert.sessionAction}</p>
                </div>
              )}
            </div>
          )}

          {/* Fallback message when no session data */}
          {!alert.sessionWhy && isDrop && (
            <p className="text-[10px] text-blue-700 font-medium">
              🔍 Check session gaps + error rate before next ranking run
            </p>
          )}
          {!alert.sessionWhy && isRise && (
            <p className="text-[10px] text-emerald-600 font-medium">
              ✨ Maintain current session strategy — document what worked
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Per-business expandable report card (Section 10 format) ───────────────────
function BizReportCard({ biz }: { biz: BizRow }) {
  const [expanded, setExpanded] = useState(false);
  const pred = PRED[biz.prediction];
  const rkCfg = RANK_CFG[biz.rankLabel];

  const platformWindows = biz.platformWindows ?? [];
  const missedKeywords3Plus = biz.missedKeywords3Plus ?? [];
  const missedKeywords5Plus = biz.missedKeywords5Plus ?? [];
  const keywordsHitToday = biz.keywordsHitToday ?? [];
  const allKeywords = biz.allKeywords ?? [];
  const platformsToday = biz.platformsToday ?? {};
  const sessionIcon = biz.sessionsToday >= biz.targetPerDay ? "✅" : biz.sessionsToday >= biz.targetPerDay * 0.6 ? "⚠️" : "🚨";
  const successIcon = biz.successRateToday >= 0.9 ? "✅" : biz.successRateToday >= 0.7 ? "⚠️" : "🚨";
  const gapIcon = biz.gapDays7 === 0 ? "✅" : biz.gapDays7 <= 1 ? "⚠️" : "🚨";
  const kwMissIcon = missedKeywords5Plus.length > 0 ? "🚨" : missedKeywords3Plus.length > 0 ? "⚠️" : "✅";
  const platformGaps = platformWindows.filter((pw) => pw.consecutiveDaysSilent >= 3).map((pw) => `${pw.platform} (${pw.consecutiveDaysSilent}d)`).join(", ") || "None ✓";
  const platformsStr = Object.entries(platformsToday).map(([p, n]) => `${p} ×${n}`).join(", ") || "None";

  return (
    <div className={cn("rounded-xl border overflow-hidden",
      biz.prediction === "AT_RISK" ? "border-blue-400" : "border-border"
    )}>
      {/* Compact header (always visible) */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className={cn("w-2 h-8 rounded-full shrink-0", pred.dot)} />
        <div className="flex-1 min-w-0">
          {biz.clientName && (
            <p className="text-[9px] text-muted-foreground truncate">👤 {biz.clientName}</p>
          )}
          <p className="text-sm font-semibold text-foreground truncate">{biz.bizName}</p>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
            <span>{pred.emoji} {pred.label}</span>
            <span className="text-border">·</span>
            <span>{biz.phaseLabel}</span>
            <span className="text-border">·</span>
            <span className={cn("font-mono", biz.sessionsToday >= biz.targetPerDay ? "text-emerald-500" : biz.sessionsToday > 0 ? "text-amber-500" : "text-blue-500")}>
              {biz.sessionsToday}/{biz.targetPerDay} today
            </span>
            {biz.gapDays7 > 0 && <span className="text-blue-500">{biz.gapDays7} gap days</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className={cn("text-[9px]", rkCfg.color)}>{rkCfg.icon} {rkCfg.label}</Badge>
          {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded detail (Section 10 format) */}
      {expanded && (
        <div className="border-t border-border/50 px-4 py-4 space-y-4 bg-muted/10">

          {/* Header info block */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
            {[
              biz.clientName ? ["Client", biz.clientName] : null,
              ["Business", biz.bizName],
              ["Campaign", biz.campaignName || "—"],
              ["Report Date", fmt(biz.latestDate)],
              ["Days Active", String(biz.daysActive)],
              ["Current Phase", biz.phaseLabel],
              ["Next Ranking Run", fmt(biz.nextRankingRunDue)],
            ].filter(Boolean).map(([k, v]) => (
              <div key={k}>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">{k}</span>
                <p className="font-medium text-foreground truncate" title={v}>{v}</p>
              </div>
            ))}
          </div>

          {/* SESSION KPIs TODAY */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">📊 Session KPIs — Today</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg border border-border/40 p-2">
                <p className="text-[9px] text-muted-foreground">Session Count</p>
                <p className="font-bold mt-0.5">{sessionIcon} {biz.sessionsToday} / {biz.targetPerDay}</p>
              </div>
              <div className="rounded-lg border border-border/40 p-2">
                <p className="text-[9px] text-muted-foreground">Success Rate</p>
                <p className="font-bold mt-0.5">{successIcon} {pct(biz.successRateToday)}</p>
              </div>
              <div className="rounded-lg border border-border/40 p-2">
                <p className="text-[9px] text-muted-foreground">Keywords Hit</p>
                <p className="font-bold mt-0.5">{keywordsHitToday.length > 0 ? "✅" : "🚨"} {keywordsHitToday.length} of {allKeywords.length}</p>
              </div>
              <div className="rounded-lg border border-border/40 p-2">
                <p className="text-[9px] text-muted-foreground">Platforms Today</p>
                <p className="font-bold mt-0.5 truncate text-[10px]" title={platformsStr}>{platformsStr || "None"}</p>
              </div>
            </div>
          </div>

          {/* ROLLING 7-DAY HEALTH */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">📈 Rolling 7-Day Session Health</p>
            <div className="rounded-lg border border-border/40 divide-y divide-border/30 text-xs">
              {[
                ["Avg Sessions/Day", `${biz.avg7DaySessions.toFixed(1)} / ${biz.targetPerDay}`, biz.avg7DaySessions >= biz.targetPerDay * 0.8 ? "✅" : "⚠️"],
                ["Avg Success Rate", pct(biz.avg7DaySuccessRate), biz.avg7DaySuccessRate >= 0.9 ? "✅" : biz.avg7DaySuccessRate >= 0.7 ? "⚠️" : "🚨"],
                ["Session Gaps (zero days)", biz.gapDays7 === 0 ? "None ✓" : `${biz.gapDays7} day${biz.gapDays7 !== 1 ? "s" : ""} with no sessions`, gapIcon],
                ["Keywords Missed 3+ days", missedKeywords3Plus.length === 0 ? "None ✓" : missedKeywords3Plus.slice(0, 3).join(", "), kwMissIcon],
                ["Platform Gaps (3+ days)", platformGaps, platformGaps === "None ✓" ? "✅" : "⚠️"],
              ].map(([label, val, icon]) => (
                <div key={String(label)} className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-right max-w-[50%] truncate" title={`${icon} ${val}`}>{icon} {val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* PLATFORM ROTATION */}
          {platformWindows.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">🔄 Platform Rotation — Last 3 Days</p>
              <div className="grid grid-cols-3 gap-2">
                {platformWindows.map((pw) => {
                  const active = pw.sessionsLast3Days > 0;
                  const silent5 = pw.consecutiveDaysSilent >= 5;
                  return (
                    <div key={pw.platform} className={cn("rounded-lg border p-2 text-xs",
                      silent5 ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30"
                      : !active ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30"
                      : "border-border/40"
                    )}>
                      <p className={cn("text-[10px] font-semibold mb-0.5", PLATFORM_BADGE[pw.platform]?.split(" ")[1] ?? "text-foreground")}>
                        {pw.platform}
                      </p>
                      <p className="font-bold">{pw.sessionsLast3Days} sessions</p>
                      <p className={cn("text-[9px]", active ? "text-emerald-600" : silent5 ? "text-blue-600" : "text-amber-600")}>
                        {active ? "✅ Active" : silent5 ? "🚨 Silent 5+d" : "⚠️ No sessions"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* RANKING STATUS */}
          {biz.latestRankDate && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">🎯 Ranking Status</p>
              <div className="rounded-lg border border-border/40 p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last ranking run</span>
                  <span className="font-medium">{fmt(biz.latestRankDate)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Overall change label</span>
                  <Badge variant="outline" className={cn("text-[9px]", RANK_CFG[biz.rankLabel].color)}>
                    {RANK_CFG[biz.rankLabel].icon} {RANK_CFG[biz.rankLabel].label}
                  </Badge>
                </div>
                {Object.entries(biz.bestRanks).length > 0 && (
                  <div>
                    <span className="text-muted-foreground block mb-1">Best current rank per platform</span>
                    <div className="flex gap-2">
                      {Object.entries(biz.bestRanks).map(([p, r]) => (
                        <span key={p} className={cn("text-[10px] px-2 py-0.5 rounded-full border font-semibold", PLATFORM_BADGE[p] ?? "bg-muted")}>
                          {p[0]}: {r !== null ? `#${r}` : "N/A"}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PREDICTION + WHY + ACTION */}
          <div className={cn("rounded-xl border-2 p-4 space-y-2", pred.ring, pred.bg)}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">🚨 Prediction for Next Ranking Run</p>
            <p className={cn("text-sm font-bold", pred.text)}>{pred.emoji} {pred.label.toUpperCase()}</p>
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Why</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{biz.why}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Action</p>
              <p className="text-xs font-semibold text-foreground mt-0.5 leading-relaxed">{biz.action}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── All businesses compact table ───────────────────────────────────────────────
function BizTable({ businesses, search, byDateData }: {
  businesses: BizRow[];
  search: string;
  byDateData?: ByDateData | null;
}) {
  const filtered = businesses.filter((b) =>
    b.bizName.toLowerCase().includes(search.toLowerCase())
  );
  const byDateMap = byDateData
    ? new Map(byDateData.businesses.map(b => [b.bizName, b]))
    : null;

  return (
    <div className="space-y-2">
      {byDateData && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs text-primary">
          <Calendar className="w-3 h-3 shrink-0" />
          <span>Showing session data for <strong>{fmt(byDateData.date)}</strong> — {byDateData.total} businesses had sessions</span>
        </div>
      )}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Business</th>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Session Prediction</th>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Ranking</th>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">
                {byDateData ? `Sessions (${fmt(byDateData.date)})` : "Today"}
              </th>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">7d Avg</th>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Phase</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {filtered.slice(0, 200).map((biz, i) => {
              const pCfg = PRED[biz.prediction];
              const rCfg = RANK_CFG[biz.rankLabel];
              const dateRow = byDateMap?.get(biz.bizName);
              const sessVal  = dateRow ? dateRow.total : biz.sessionsToday;
              const sessGood = dateRow ? dateRow.successRate >= 0.9 : biz.sessionsToday >= biz.targetPerDay;
              const sessMid  = dateRow ? dateRow.successRate >= 0.6 : biz.sessionsToday > 0;
              return (
                <tr key={i} className="hover:bg-muted/20">
                  <td className="px-3 py-2 max-w-[200px]">
                    {biz.clientName && <p className="text-[9px] text-muted-foreground truncate">👤 {biz.clientName}</p>}
                    <p className="font-medium truncate text-foreground" title={biz.bizName}>{biz.bizName}</p>
                    {biz.latestDate && <p className="text-[9px] text-muted-foreground">{biz.latestDate}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", pCfg.dot)} />
                      <span className={cn("text-[10px] font-medium", pCfg.text)}>{pCfg.emoji}</span>
                      <span className="text-[10px] text-muted-foreground">{pCfg.label.split(" ")[0]}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={cn("text-[9px]", rCfg.color)}>{rCfg.icon} {rCfg.label}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {byDateData ? (
                      dateRow ? (
                        <span className={cn("font-mono font-semibold",
                          sessGood ? "text-emerald-500" : sessMid ? "text-amber-500" : "text-blue-500"
                        )}>{sessVal} <span className="text-[9px] font-normal text-muted-foreground">({Math.round(dateRow.successRate * 100)}%)</span></span>
                      ) : (
                        <span className="text-muted-foreground font-mono text-[10px]">no data</span>
                      )
                    ) : (
                      <span className={cn("font-mono font-semibold",
                        sessGood ? "text-emerald-500" : sessMid ? "text-amber-500" : "text-blue-500"
                      )}>{sessVal}/{biz.targetPerDay}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{biz.avg7DaySessions.toFixed(1)}/d</td>
                  <td className="px-3 py-2 text-muted-foreground">P{biz.phase}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 200 && (
          <p className="text-[10px] text-muted-foreground text-center py-2 border-t border-border/30">
            Showing 200 of {filtered.length}
          </p>
        )}
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">No businesses match your search.</p>
        )}
      </div>
    </div>
  );
}

// ── Per-Business Reports with filters ─────────────────────────────────────────
function PerBusinessReports({ businesses, parentSearch }: { businesses: BizRow[]; parentSearch: string }) {
  const [localSearch, setLocalSearch]     = useState("");
  const [predFilter, setPredFilter]       = useState<Prediction | "all">("all");
  const [rankFilter, setRankFilter]       = useState<RankLabel | "all">("all");
  const [phaseFilter, setPhaseFilter]     = useState<"all" | "1-2" | "3+">("all");

  const effectiveSearch = localSearch || parentSearch;

  const filtered = businesses.filter(b => {
    if (effectiveSearch && !b.bizName.toLowerCase().includes(effectiveSearch.toLowerCase())) return false;
    if (predFilter !== "all" && b.prediction !== predFilter) return false;
    if (rankFilter !== "all" && b.rankLabel !== rankFilter) return false;
    if (phaseFilter === "1-2" && b.phase > 2) return false;
    if (phaseFilter === "3+" && b.phase < 3) return false;
    return true;
  });

  const counts: Record<Prediction | "all", number> = {
    all:       businesses.length,
    AT_RISK:   businesses.filter(b => b.prediction === "AT_RISK").length,
    STABLE:    businesses.filter(b => b.prediction === "STABLE").length,
    ON_TRACK:  businesses.filter(b => b.prediction === "ON_TRACK").length,
    TOO_EARLY: businesses.filter(b => b.prediction === "TOO_EARLY").length,
  };

  const predPills: { key: Prediction | "all"; label: string; cls: string }[] = [
    { key: "all",      label: "All",       cls: "border-border text-muted-foreground hover:bg-secondary/60" },
    { key: "AT_RISK",  label: "🚨 At Risk",  cls: "border-blue-300 text-blue-700 hover:bg-blue-50" },
    { key: "STABLE",   label: "➡️ Stable",   cls: "border-amber-300 text-amber-700 hover:bg-amber-50" },
    { key: "ON_TRACK", label: "📈 On Track", cls: "border-emerald-300 text-emerald-700 hover:bg-emerald-50" },
    { key: "TOO_EARLY",label: "⏳ Too Early", cls: "border-slate-300 text-slate-600 hover:bg-slate-50" },
  ];

  const hasRankedBizWithLabel = (label: RankLabel) => businesses.some(b => b.rankLabel === label);
  const rankLabels: { key: RankLabel | "all"; label: string }[] = [
    { key: "all",               label: "All Ranks" },
    { key: "SUDDEN_DROP",       label: "Sudden ↓" },
    { key: "NOT_FOUND_CRITICAL",label: "Not Found" },
    { key: "STEADY_DROP",       label: "Steady ↓" },
    { key: "NO_CHANGE",         label: "No Change" },
    { key: "STEADY_IMPROVEMENT",label: "Steady ↑" },
    { key: "SUDDEN_IMPROVEMENT",label: "Sudden ↑" },
    { key: "REAPPEARED",        label: "Re-appeared" },
    { key: "BASELINE",          label: "Baseline" },
  ].filter(r => r.key === "all" || hasRankedBizWithLabel(r.key as RankLabel));

  return (
    <div className="space-y-3">
      {/* Local search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Search businesses…"
          value={localSearch}
          onChange={e => setLocalSearch(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {/* Prediction filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {predPills.map(p => (
          <button
            key={p.key}
            onClick={() => setPredFilter(p.key)}
            className={cn(
              "text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors",
              p.cls,
              predFilter === p.key ? "ring-2 ring-offset-1 ring-current opacity-100" : "opacity-70"
            )}
          >
            {p.label}
            {counts[p.key] > 0 && <span className="ml-1 font-bold">({counts[p.key]})</span>}
          </button>
        ))}
      </div>

      {/* Secondary filters row */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={rankFilter}
          onChange={e => setRankFilter(e.target.value as RankLabel | "all")}
          className="h-7 text-xs rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {rankLabels.map(r => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>

        <select
          value={phaseFilter}
          onChange={e => setPhaseFilter(e.target.value as "all" | "1-2" | "3+")}
          className="h-7 text-xs rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All Phases</option>
          <option value="1-2">Phase 1–2 (Launch / Warmup)</option>
          <option value="3+">Phase 3+ (Build / Sustain)</option>
        </select>

        <span className="text-[10px] text-muted-foreground ml-auto">
          {filtered.length} of {businesses.length} businesses
        </span>

        {(predFilter !== "all" || rankFilter !== "all" || phaseFilter !== "all" || localSearch) && (
          <button
            onClick={() => { setPredFilter("all"); setRankFilter("all"); setPhaseFilter("all"); setLocalSearch(""); }}
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results */}
      {filtered.map((biz, i) => <BizReportCard key={i} biz={biz} />)}
      {filtered.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-10">No businesses match your filters.</p>
      )}
    </div>
  );
}

// ── Action Items Panel ─────────────────────────────────────────────────────────
const PAGE_SIZE = 10;
type SectionKey = "all" | "critical" | "monitor" | "atrisk" | "win";

function ActionItemsPanel({ data, search: parentSearch }: { data: DailyOverview; search: string }) {
  const [localSearch, setLocalSearch] = useState("");
  const [sectionFilter, setSectionFilter] = useState<SectionKey>("all");
  const search = localSearch || parentSearch;

  const bizMap    = new Map(data.businesses.map(b => [b.bizName, b]));
  const atRiskMap = new Map(data.atRiskBusinesses.map(b => [b.bizName, b]));

  // ── Group all rank alerts by business ────────────────────────────────────────
  type BizAlertGroup = {
    bizName: string;
    drops:    RankAlert[];
    improves: RankAlert[];
    sessRisk: AtRiskBiz | undefined;
    isCritical: boolean;
  };

  const groupMap = new Map<string, BizAlertGroup>();
  const ensure = (name: string) => {
    if (!groupMap.has(name)) groupMap.set(name, {
      bizName: name, drops: [], improves: [], sessRisk: atRiskMap.get(name), isCritical: false,
    });
    return groupMap.get(name)!;
  };

  for (const a of data.rankAlerts) {
    const g = ensure(a.bizName);
    if (a.label === "SUDDEN_DROP" || a.label === "NOT_FOUND_CRITICAL") {
      g.drops.push(a);
      if (a.sessionPrediction === "AT_RISK" || atRiskMap.has(a.bizName)) g.isCritical = true;
    } else if (a.label === "SUDDEN_IMPROVEMENT" || a.label === "REAPPEARED") {
      g.improves.push(a);
    }
  }

  // Session-only at-risk businesses (no rank alert)
  for (const b of data.atRiskBusinesses) {
    if (!groupMap.has(b.bizName)) {
      groupMap.set(b.bizName, { bizName: b.bizName, drops: [], improves: [], sessRisk: b, isCritical: false });
    }
  }

  const allGroups = [...groupMap.values()];
  const filtered = allGroups.filter(g =>
    search === "" || g.bizName.toLowerCase().includes(search.toLowerCase())
  );

  const criticalGroups = filtered.filter(g => g.drops.length > 0 && g.isCritical).sort((a, b) => b.drops.length - a.drops.length);
  const monitorGroups  = filtered.filter(g => g.drops.length > 0 && !g.isCritical).sort((a, b) => b.drops.length - a.drops.length);
  const atRiskGroups   = filtered.filter(g => g.drops.length === 0 && g.improves.length === 0 && g.sessRisk);
  const winGroups      = filtered.filter(g => g.improves.length > 0 && g.drops.length === 0).sort((a, b) => b.improves.length - a.improves.length);

  // ── Narrative reasoning per group ─────────────────────────────────────────────
  function dropNarrative(g: BizAlertGroup): { overview: string; causes: string[]; recs: string[] } {
    const biz  = bizMap.get(g.bizName);
    const sess = g.sessRisk;
    const gapDays   = sess?.gapDays7 ?? g.drops[0]?.gapDays7 ?? 0;
    const successPct = Math.round((sess?.avg7DaySuccessRate ?? g.drops[0]?.avg7DaySuccessRate ?? 1) * 100);
    const notFoundDrops = g.drops.filter(d => d.label === "NOT_FOUND_CRITICAL");
    const spotsDrops    = g.drops.filter(d => d.label === "SUDDEN_DROP");
    const platforms     = [...new Set(g.drops.map(d => d.platform))];
    const keywords      = [...new Set(g.drops.map(d => d.keyword))];
    const avgSpots      = spotsDrops.length > 0
      ? Math.round(spotsDrops.reduce((s, d) => s + Math.abs(d.spotsChanged ?? 0), 0) / spotsDrops.length)
      : 0;

    // Overview sentence
    const overviewParts: string[] = [];
    if (notFoundDrops.length > 0) {
      overviewParts.push(`disappeared from ${notFoundDrops.map(d => d.platform).join(" & ")} entirely for ${notFoundDrops.length} keyword${notFoundDrops.length > 1 ? "s" : ""}`);
    }
    if (spotsDrops.length > 0) {
      overviewParts.push(`dropped an average of ${avgSpots} spots across ${platforms.join(", ")} on ${spotsDrops.length} keyword${spotsDrops.length > 1 ? "s" : ""}`);
    }
    const overview = `${g.bizName} has ${overviewParts.join(" and ")} since the last ranking run.`;

    // Root causes
    const causes: string[] = [];
    if (g.isCritical && gapDays >= 2) {
      causes.push(`Session gaps (${gapDays} days with zero sessions in the past 7 days) — AI engines require daily signals to maintain positions. Missing ${gapDays} days breaks the recency signal that tells ${platforms.join("/")} this business is still active and relevant.`);
    } else if (g.isCritical && successPct < 80) {
      causes.push(`Low session success rate (${successPct}%) — only ${successPct}% of scheduled sessions are successfully delivering prompts to the AI engine. The engine is not receiving the full intended signal volume, which weakens the business association with these keywords.`);
    } else if (notFoundDrops.length > 0) {
      causes.push(`Not Found on ${notFoundDrops.map(d => d.platform).join(", ")} — the business has lost enough ranking signal that the AI engine no longer confidently surfaces it for ${notFoundDrops.map(d => `"${d.keyword}"`).join(", ")}. This is typically caused by a 1–2 week period of reduced or inconsistent sessions.`);
    } else {
      causes.push(`Competitive displacement — with sessions running at ${successPct}% success and ${gapDays} gap days, the signal volume is likely lower than competing businesses in the same category. ${platforms.join("/")} naturally promotes businesses with stronger recent signal presence.`);
    }

    if (notFoundDrops.length > 0 && spotsDrops.length > 0) {
      causes.push(`Multi-severity impact — some keywords dropped in position while others disappeared entirely. This suggests the issue is keyword-specific rather than a blanket account problem, pointing to coverage gaps for certain high-competition terms.`);
    }

    const missedKw = sess?.missedKeywords5Plus ?? biz?.missedKeywords5Plus ?? [];
    const overlapKw = keywords.filter(k => missedKw.includes(k));
    if (overlapKw.length > 0) {
      causes.push(`The dropped keyword${overlapKw.length > 1 ? "s" : ""} "${overlapKw.join('", "')}" also appear${overlapKw.length === 1 ? "s" : ""} in the 5+ day missed keyword list — these specific terms have had no session coverage for 5+ consecutive days, directly causing their position loss on those search terms.`);
    }

    if (biz?.phase !== undefined && biz.phase <= 2) {
      causes.push(`Early phase business (${biz.phaseLabel}, active ${biz.daysActive} days) — businesses in Phase 1–2 have limited accumulated signal history, making them more susceptible to volatility when any interruption occurs. Competitors with longer signal history hold positions more easily.`);
    }

    // Recommendations
    const recs: string[] = [];
    if (notFoundDrops.length > 0) {
      recs.push(`Immediate priority: restore daily sessions specifically targeting ${notFoundDrops.map(d => `"${d.keyword}" on ${d.platform}`).join(" and ")} — aim for 5 sessions/day minimum. The goal is to rebuild the AI engine's confidence score above the display threshold within 7–10 days.`);
    }
    if (spotsDrops.length > 0) {
      recs.push(`For the ${spotsDrops.length} keyword${spotsDrops.length > 1 ? "s" : ""} that dropped (avg ${avgSpots} spots): increase session frequency for these specific keywords over the next 14 days — the ranking run window requires sustained pressure to recover positions.`);
    }
    if (gapDays >= 2) {
      recs.push(`Eliminate session gaps immediately — schedule sessions 7 days/week with no tolerance for zero-session days. Even a single missed day resets the recency advantage built by the previous days' sessions.`);
    }
    if (successPct < 85) {
      recs.push(`Fix session delivery issues — with only ${successPct}% success, investigate proxy health, platform availability, and prompt formatting errors. Every failed session is a lost ranking signal that needs to be made up.`);
    }
    if (sess) {
      recs.push(sess.action);
    }
    recs.push(`Monitor these ${platforms.join("/")} position${platforms.length > 1 ? "s" : ""} closely over the next 7 days — if continued improvement in sessions occurs, expect partial recovery at the next bi-weekly ranking run.`);

    return { overview, causes, recs };
  }

  function improveNarrative(g: BizAlertGroup): { overview: string; causes: string[]; recs: string[] } {
    const biz = bizMap.get(g.bizName);
    const gapDays    = g.improves[0]?.gapDays7 ?? 0;
    const successPct = Math.round((g.improves[0]?.avg7DaySuccessRate ?? 1) * 100);
    const reappeared = g.improves.filter(i => i.label === "REAPPEARED");
    const gained     = g.improves.filter(i => i.label === "SUDDEN_IMPROVEMENT");
    const platforms  = [...new Set(g.improves.map(i => i.platform))];
    const totalSpots = gained.reduce((s, i) => s + (i.spotsChanged ?? 0), 0);
    const avgSpots   = gained.length > 0 ? Math.round(totalSpots / gained.length) : 0;

    const overviewParts: string[] = [];
    if (reappeared.length > 0) overviewParts.push(`re-appeared on ${reappeared.map(r => r.platform).join(" & ")} for ${reappeared.length} keyword${reappeared.length > 1 ? "s" : ""}`);
    if (gained.length > 0)     overviewParts.push(`jumped an average of +${avgSpots} spots across ${platforms.join(", ")} on ${gained.length} keyword${gained.length > 1 ? "s" : ""}`);
    const overview = `${g.bizName} ${overviewParts.join(" and ")} — a strong positive signal that the AEO strategy is working.`;

    const causes: string[] = [];
    if (successPct >= 90 && gapDays === 0) {
      causes.push(`Consistent, high-quality session delivery — ${successPct}% success rate with zero session gap days in the past 7 days. Every scheduled session successfully delivered a signal, giving the AI engine maximum recency and relevance data to work with.`);
    } else if (successPct >= 80) {
      causes.push(`Strong session consistency — ${successPct}% success rate over the past 7 days, ${gapDays === 0 ? "with no gap days" : `with only ${gapDays} gap day(s)`}. This level of signal delivery is at the threshold where AI engines begin to meaningfully rank businesses higher.`);
    }

    if (reappeared.length > 0) {
      causes.push(`Signal recovery after absence — the business was previously not found, but sustained daily sessions rebuilt the AI engine's confidence score above the display threshold. This re-emergence shows the 14-day AEO cycle working as intended: consistent sessions → stronger association → reappearance.`);
    }

    if (gained.length > 0) {
      const topGain = gained.sort((a, b) => (b.spotsChanged ?? 0) - (a.spotsChanged ?? 0))[0];
      causes.push(`Keyword-level signal accumulation — the biggest mover was "${topGain.keyword}" on ${topGain.platform} (+${topGain.spotsChanged} spots). This suggests session targeting for this keyword was particularly consistent, building a stronger business-keyword association than competing businesses maintained during the same period.`);
    }

    const activePlatforms = (biz?.platformWindows ?? []).filter(pw => pw.status === "ACTIVE").length;
    if (activePlatforms >= 3) {
      causes.push(`Multi-platform reinforcement — all three platforms (ChatGPT, Gemini, Perplexity) are actively receiving sessions. Cross-platform consistency creates a compounding authority signal: each platform's positive signal reinforces the others, accelerating ranking improvement beyond what single-platform activity would achieve.`);
    }

    if (biz && biz.phase >= 3) {
      causes.push(`Matured signal history — at ${biz.daysActive} days active (${biz.phaseLabel}), this business has built substantial cumulative session history. Older session data compounds with recent data, making each new session more impactful than it would be for a newer business.`);
    }

    const recs: string[] = [];
    recs.push(`Do not change what's working — maintain the exact same session volume, keyword targeting, and platform distribution that produced this improvement. Any reduction in the next 14 days risks losing the position gained.`);
    if (gained.length > 0) {
      const topPlatform = gained.sort((a, b) => (b.spotsChanged ?? 0) - (a.spotsChanged ?? 0))[0].platform;
      recs.push(`Replicate the ${topPlatform} strategy on the other platforms — use the same keyword mix and session frequency that drove the improvement on ${topPlatform} and apply it to ChatGPT, Gemini, and Perplexity equally.`);
    }
    if (reappeared.length > 0) {
      recs.push(`Now that the business has re-appeared, push for top-5 position — increase session variety for the re-appeared keywords with different prompt angles to strengthen the ranking signal beyond just visibility.`);
    }
    recs.push(`Use this as a template for the rest of the portfolio — document the session cadence, keyword focus, and prompt variety that drove this result and apply the same approach to businesses still in the "at risk" or "monitor" category.`);
    recs.push(`Schedule a ranking check in 14 days specifically for ${platforms.join(", ")} to confirm the improvement held and quantify the next round of gains.`);

    return { overview, causes, recs };
  }

  function sessRiskNarrative(b: AtRiskBiz): { overview: string; causes: string[]; recs: string[] } {
    const biz = bizMap.get(b.bizName);
    const successPct = Math.round(b.avg7DaySuccessRate * 100);

    const overview = `${b.bizName} is at risk of a ranking drop at the next bi-weekly run — session health metrics show ${
      b.gapDays7 >= 3 ? `${b.gapDays7} days with zero sessions` :
      successPct < 80 ? `only ${successPct}% session success rate` :
      b.missedKeywords5Plus.length > 0 ? `${b.missedKeywords5Plus.length} keyword(s) not covered for 5+ days` :
      b.silentPlatform ? `${b.silentPlatform} has been silent for 5+ days` :
      "declining session health"
    } in the past 7 days.`;

    const causes: string[] = [];
    if (b.gapDays7 >= 3) {
      causes.push(`${b.gapDays7} out of the last 7 days had zero sessions. AI engines continuously re-evaluate business relevance using recent activity. At 3+ gap days, the engine interprets the silence as the business being less active or less relevant — competitors running consistently during the same period move up into those positions.`);
    } else if (b.gapDays7 >= 1) {
      causes.push(`${b.gapDays7} gap day(s) in the last 7 days. Each missed day is a missed opportunity to reinforce the business's relevance to the AI engine. While 1–2 gaps won't cause an immediate drop, this pattern accumulates risk heading into the next ranking run.`);
    }

    if (successPct < 80) {
      causes.push(`Session success rate of ${successPct}% means ${100 - successPct}% of scheduled sessions are failing to deliver signals to the AI engine. This is a technical efficiency problem — the business may appear to be running sessions normally, but the AI engines are receiving significantly fewer signals than intended.`);
    }

    if (b.missedKeywords5Plus.length > 0) {
      causes.push(`${b.missedKeywords5Plus.length} keyword${b.missedKeywords5Plus.length > 1 ? "s" : ""} with zero session coverage for 5+ consecutive days: ${b.missedKeywords5Plus.slice(0, 4).join(", ")}${b.missedKeywords5Plus.length > 4 ? ` and ${b.missedKeywords5Plus.length - 4} more` : ""}. Each of these keywords is actively fading from the AI engine's association with this business — the next ranking run will likely show position losses specifically on these terms.`);
    } else if ((biz?.missedKeywords3Plus ?? []).length > 0) {
      const kw3 = biz!.missedKeywords3Plus;
      causes.push(`${kw3.length} keyword${kw3.length > 1 ? "s" : ""} not covered for 3+ days (${kw3.slice(0, 3).join(", ")}). These are approaching the 5-day critical threshold — if not addressed within the next 2 days, they become high-risk for position loss.`);
    }

    if (b.silentPlatform) {
      causes.push(`${b.silentPlatform} has received zero sessions for 5+ consecutive days. Platform-specific silence is particularly damaging — while other platforms maintain their positions, ${b.silentPlatform} will begin promoting competitors who maintained consistent activity during the same period.`);
    }

    const recs: string[] = [];
    recs.push(`Restore full daily session volume immediately — the goal is zero gap days for the next 14 days leading into the next ranking run. Even partial sessions are better than none.`);
    if (b.missedKeywords5Plus.length > 0) {
      recs.push(`Prioritize the ${b.missedKeywords5Plus.length} critical keywords in every session this week: ${b.missedKeywords5Plus.slice(0, 3).join(", ")}${b.missedKeywords5Plus.length > 3 ? ` +${b.missedKeywords5Plus.length - 3} more` : ""}. These have the highest probability of dropping at the next ranking run without immediate coverage.`);
    }
    if (b.silentPlatform) {
      recs.push(`Run a minimum of 3–5 sessions on ${b.silentPlatform} today across all keywords — breaking the 5-day silence streak should be treated as an emergency recovery action.`);
    }
    if (successPct < 80) {
      recs.push(`Investigate session failures — check proxy health, platform availability, and prompt formatting. A ${successPct}% success rate suggests a systemic technical issue rather than just low volume.`);
    }
    recs.push(b.action);

    return { overview, causes, recs };
  }

  // ── Card renderer ─────────────────────────────────────────────────────────────
  const sectionCfg = {
    critical: { icon: Zap,          label: "Immediate Action Required", bg: "bg-orange-50 dark:bg-orange-950/30",      border: "border-orange-300 dark:border-orange-800",     hdr: "bg-orange-100/60 dark:bg-orange-900/30",      tag: "bg-orange-100 text-orange-700",           badge: "bg-orange-100 text-orange-700 border-orange-300",           accent: "text-orange-600 dark:text-orange-400" },
    monitor:  { icon: Eye,           label: "Monitor Closely",            bg: "bg-sky-50 dark:bg-sky-950/30",       border: "border-sky-300 dark:border-sky-700",     hdr: "bg-sky-100/60 dark:bg-sky-900/30",      tag: "bg-sky-100 text-sky-700",           badge: "bg-sky-100 text-sky-700 border-sky-300",           accent: "text-sky-600 dark:text-sky-400" },
    atrisk:   { icon: AlertTriangle, label: "At Risk — Session Health",   bg: "bg-amber-50 dark:bg-amber-950/30",  border: "border-amber-300 dark:border-amber-700", hdr: "bg-amber-100/60 dark:bg-amber-900/30",  tag: "bg-amber-100 text-amber-700",       badge: "bg-amber-100 text-amber-700 border-amber-300",     accent: "text-amber-600 dark:text-amber-400" },
    win:      { icon: Trophy,        label: "Improvements & Wins",        bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-300 dark:border-emerald-700", hdr: "bg-emerald-100/60 dark:bg-emerald-900/30", tag: "bg-emerald-100 text-emerald-700", badge: "bg-emerald-100 text-emerald-700 border-emerald-300", accent: "text-emerald-600 dark:text-emerald-400" },
  };

  function BizCard({ g, sKey }: { g: BizAlertGroup; sKey: keyof typeof sectionCfg }) {
    const cfg = sectionCfg[sKey];
    const isWin = sKey === "win";

    const narrative = isWin
      ? improveNarrative(g)
      : g.drops.length > 0
        ? dropNarrative(g)
        : sessRiskNarrative(g.sessRisk!);

    const affectedItems = isWin
      ? g.improves.map(i => `${i.platform}: ${i.label === "REAPPEARED" ? "re-appeared" : `+${i.spotsChanged} spots`} on "${i.keyword}"`)
      : g.drops.map(d => `${d.platform}: ${d.label === "NOT_FOUND_CRITICAL" ? "not found" : `−${Math.abs(d.spotsChanged ?? 0)} spots`} on "${d.keyword}"`);

    return (
      <div className={cn("rounded-xl border overflow-hidden shadow-sm", cfg.bg, cfg.border)}>
        {/* Header */}
        <div className={cn("px-5 py-3.5 border-b", cfg.border, cfg.hdr)}>
          <p className="text-sm font-bold text-foreground">{g.bizName}</p>
          <p className={cn("text-xs mt-0.5 leading-snug", cfg.accent)}>{narrative.overview}</p>
        </div>

        {/* Affected keywords summary */}
        {affectedItems.length > 0 && (
          <div className="px-5 py-3 border-b border-border/30">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
              {isWin ? "What Improved" : "What Changed"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {affectedItems.slice(0, 8).map((item, i) => (
                <span key={i} className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border border-current/20", cfg.tag)}>
                  {item}
                </span>
              ))}
              {affectedItems.length > 8 && (
                <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", cfg.tag)}>
                  +{affectedItems.length - 8} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Root cause / why it happened */}
        <div className="px-5 py-4 border-b border-border/30">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
            {isWin ? "Why It Improved — Detailed Analysis" : "Why This Happened — Root Cause Analysis"}
          </p>
          <div className="space-y-3">
            {narrative.causes.map((c, i) => (
              <div key={i} className="flex gap-3">
                <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5", cfg.tag)}>{i + 1}</div>
                <p className="text-xs text-foreground leading-relaxed">{c}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Recommendations */}
        <div className="px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
            {isWin ? "How to Sustain & Grow This — Action Plan" : "Priority Recommendations — What To Do Now"}
          </p>
          <div className="space-y-2.5">
            {narrative.recs.map((r, i) => (
              <div key={i} className="flex gap-3">
                <div className={cn("w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5", isWin ? "bg-emerald-200 text-emerald-800" : sKey === "critical" ? "bg-orange-200 text-orange-800" : "bg-amber-200 text-amber-800")}>
                  {i + 1}
                </div>
                <p className="text-xs leading-relaxed">{r}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function Section({ groups, sKey }: { groups: BizAlertGroup[]; sKey: keyof typeof sectionCfg }) {
    const [page, setPage] = useState(0);
    const cfg = sectionCfg[sKey];
    const Icon = cfg.icon;
    if (groups.length === 0) return null;
    const totalPages = Math.ceil(groups.length / PAGE_SIZE);
    const pageGroups = groups.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 pt-1">
          <Icon className="w-4 h-4 shrink-0" />
          <p className="text-xs font-bold uppercase tracking-wide">{cfg.label}</p>
          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", cfg.badge)}>{groups.length} business{groups.length > 1 ? "es" : ""}</span>
        </div>
        {pageGroups.map((g, i) => <BizCard key={i} g={g} sKey={sKey} />)}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <p className="text-[10px] text-muted-foreground">Page {page + 1} of {totalPages} · {groups.length} total</p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-[10px] px-2.5 py-1 border border-border rounded disabled:opacity-40 hover:bg-secondary/60 transition-colors"
              >← Prev</button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="text-[10px] px-2.5 py-1 border border-border rounded disabled:opacity-40 hover:bg-secondary/60 transition-colors"
              >Next →</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Portfolio summary strip ───────────────────────────────────────────────────
  const totalDrop   = criticalGroups.length + monitorGroups.length;
  const totalRisk   = atRiskGroups.length;
  const totalWin    = winGroups.length;
  const topDropBiz  = criticalGroups[0] ?? monitorGroups[0];
  const topWinBiz   = winGroups[0];

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-emerald-500" />
        <p className="text-sm font-semibold">All businesses are performing well</p>
        <p className="text-xs mt-1">No action items at this time{search ? " for your search" : ""}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Local search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Search businesses in action items…"
          value={localSearch}
          onChange={e => setLocalSearch(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {/* Section filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {([
          { key: "all",      label: "All",                       count: criticalGroups.length + monitorGroups.length + atRiskGroups.length + winGroups.length, cls: "border-border text-muted-foreground hover:bg-secondary/60" },
          { key: "critical", label: "Immediate Action Required", count: criticalGroups.length, cls: "border-orange-300 text-orange-700 hover:bg-orange-50" },
          { key: "monitor",  label: "Monitor Closely",           count: monitorGroups.length,  cls: "border-sky-300 text-sky-700 hover:bg-sky-50" },
          { key: "atrisk",   label: "Session Risk",              count: atRiskGroups.length,   cls: "border-amber-300 text-amber-700 hover:bg-amber-50" },
          { key: "win",      label: "Wins",                      count: winGroups.length,      cls: "border-emerald-300 text-emerald-700 hover:bg-emerald-50" },
        ] as { key: SectionKey; label: string; count: number; cls: string }[]).map(f => (
          <button
            key={f.key}
            onClick={() => setSectionFilter(f.key)}
            className={cn(
              "text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors",
              f.cls,
              sectionFilter === f.key ? "ring-2 ring-offset-1 ring-current opacity-100" : "opacity-70"
            )}
          >
            {f.label} {f.count > 0 && <span className="font-bold">({f.count})</span>}
          </button>
        ))}
      </div>

      {/* Portfolio overview strip */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Portfolio Overview — Action Summary</p>
        <p className="text-sm text-foreground leading-relaxed">
          {totalDrop > 0 && <><span className="font-semibold text-orange-600">{totalDrop} business{totalDrop > 1 ? "es" : ""} with ranking drops</span>{totalDrop > 0 && topDropBiz && ` (most affected: ${topDropBiz.bizName} — ${topDropBiz.drops.length} keyword${topDropBiz.drops.length > 1 ? "s" : ""} dropped)`}. </>}
          {totalRisk > 0 && <><span className="font-semibold text-amber-600">{totalRisk} business{totalRisk > 1 ? "es" : ""} at risk of a drop</span> at the next ranking run based on session health metrics. </>}
          {totalWin > 0 && <><span className="font-semibold text-emerald-600">{totalWin} business{totalWin > 1 ? "es" : ""} with sudden improvements</span>{topWinBiz && ` (top win: ${topWinBiz.bizName} — ${topWinBiz.improves.length} keyword${topWinBiz.improves.length > 1 ? "s" : ""} improved)`}. </>}
          {totalDrop === 0 && totalRisk === 0 && totalWin === 0 && "All businesses are stable — no immediate actions required."}
        </p>
        <div className="flex gap-4 pt-1">
          {[
            ["🚨", criticalGroups.length, "Critical"],
            ["🔍", monitorGroups.length, "Monitor"],
            ["⚠️", atRiskGroups.length, "Session Risk"],
            ["✅", winGroups.length, "Wins"],
          ].map(([emoji, count, label]) => (
            <div key={label as string} className="text-center">
              <p className="text-lg font-bold">{count}</p>
              <p className="text-[9px] text-muted-foreground">{emoji} {label}</p>
            </div>
          ))}
        </div>
      </div>

      {(sectionFilter === "all" || sectionFilter === "critical") && <Section groups={criticalGroups} sKey="critical" />}
      {(sectionFilter === "all" || sectionFilter === "monitor")  && <Section groups={monitorGroups}  sKey="monitor" />}
      {(sectionFilter === "all" || sectionFilter === "atrisk")   && <Section groups={atRiskGroups}   sKey="atrisk" />}
      {(sectionFilter === "all" || sectionFilter === "win")      && <Section groups={winGroups}      sKey="win" />}
    </div>
  );
}
// ── Main Page ──────────────────────────────────────────────────────────────────
export function DailyOverviewPage() {
  const [data, setData] = useState<DailyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("summary");
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [reportDate, setReportDate] = useState("");
  const [byDateData, setByDateData] = useState<ByDateData | null>(null);
  const [excludeFirstRun, setExcludeFirstRun] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/csv/daily/overview")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => {
    fetch("/api/csv/sessions/dates")
      .then(r => r.json())
      .then(d => {
        const dates: string[] = d.dates ?? [];
        setAvailableDates(dates);
        if (dates.length > 0 && !reportDate) setReportDate(dates[0]);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a date is selected, re-fetch the overview computed for that date so that
  // health tiles (AT Risk / Stable / On Track / Too Early) and all predictions
  // reflect the 7-day window ending on the chosen date, not the latest date.
  useEffect(() => {
    if (!reportDate) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/csv/daily/overview?date=${reportDate}`).then(r => r.json()),
      fetch(`/api/csv/sessions/by-date?date=${reportDate}`).then(r => r.json()),
    ])
      .then(([overview, byDate]) => {
        setData(overview);
        setByDateData(byDate);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [reportDate]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading daily overview…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="rounded-xl border border-blue-400 bg-blue-50 dark:bg-blue-950/30 p-6 max-w-md flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-700">Failed to load overview</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
            <Button size="sm" variant="outline" className="mt-3 h-7 text-xs" onClick={load}>
              <RefreshCw className="w-3 h-3 mr-1" />Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const ss = data.sessionsSummary;
  const atRiskCount = data.atRiskBusinesses.length;
  // Only count session-health problems as alerts (not ranking changes — those are in the Rankings page)
  const alertCount = atRiskCount;

  const firstRunCount = data.businesses.filter((b) => b.rankLabel === "BASELINE" && !b.hasSessionData).length;
  const filteredBiz = data.businesses.filter((b) => {
    if (excludeFirstRun && b.rankLabel === "BASELINE" && !b.hasSessionData) return false;
    return search === "" || b.bizName.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Main content ──────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="p-6 space-y-5 max-w-5xl mx-auto">

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              <h1 className="text-xl font-bold text-foreground">AEO Daily Overview</h1>
              <Badge variant="outline" className="text-xs">
                Data as of {fmt(data.asOfDate)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.totalBusinesses} businesses with sessions · {data.totalWithComparableRankings ?? data.totalWithRankings} with comparable rankings
              {data.totalWithRankings !== (data.totalWithComparableRankings ?? data.totalWithRankings) && (
                <span className="ml-1 text-muted-foreground/60">
                  (+{data.totalWithRankings - (data.totalWithComparableRankings ?? data.totalWithRankings)} first-run only)
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {availableDates.length > 0 && (
              <div className="flex items-center gap-1.5">
                <select
                  value={reportDate}
                  onChange={e => { setReportDate(e.target.value); setActiveTab("summary"); }}
                  className="h-8 text-xs rounded-md border border-border bg-background px-2 py-0 focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {availableDates.map(d => (
                    <option key={d} value={d}>{fmt(d)}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 border-primary text-primary hover:bg-primary/5"
                  onClick={() => {
                    if (reportDate) window.open(`/api/csv/daily-report?date=${reportDate}`, "_blank");
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download PDF
                </Button>
              </div>
            )}
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={load}>
              <RefreshCw className="w-3 h-3" />Refresh
            </Button>
          </div>
        </div>

        {/* ── Session health tiles ─────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["AT_RISK", "STABLE", "ON_TRACK", "TOO_EARLY"] as Prediction[]).map((p) => {
            const cfg = PRED[p];
            const val = p === "AT_RISK" ? ss.atRisk : p === "ON_TRACK" ? ss.onTrack : p === "STABLE" ? ss.stable : ss.tooEarly;
            const Icon = p === "AT_RISK" ? TrendingDown : p === "ON_TRACK" ? TrendingUp : p === "STABLE" ? Minus : Loader2;
            return (
              <div key={p} className={cn("rounded-xl border-2 p-4 cursor-pointer hover:shadow-sm transition-all", cfg.ring, cfg.bg)}
                onClick={() => setActiveTab("businesses")}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Icon className="w-3.5 h-3.5" />
                  <p className={cn("text-[10px] font-semibold uppercase tracking-wide", cfg.text)}>{cfg.emoji}</p>
                </div>
                <p className="text-3xl font-bold">{val}</p>
                <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{cfg.label}</p>
              </div>
            );
          })}
        </div>

        {/* ── Rankings distribution bar ────────────────────────────── */}
        <RankBar rs={data.rankingsSummary} comparableCount={data.totalWithComparableRankings ?? data.totalWithRankings} />

        {/* ── Search + filters ────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter businesses…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExcludeFirstRun((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors",
                excludeFirstRun
                  ? "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600"
                  : "bg-background text-muted-foreground border-border hover:bg-muted/50"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", excludeFirstRun ? "bg-slate-500" : "bg-muted-foreground")} />
              First Run
              {excludeFirstRun && firstRunCount > 0 && (
                <span className="ml-0.5 text-[9px] text-slate-400">({firstRunCount} hidden)</span>
              )}
            </button>
            <p className="text-[10px] text-muted-foreground">
              {excludeFirstRun ? "Excluding businesses with no prior ranking comparison" : "Showing all businesses including first-run"}
            </p>
          </div>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-9 flex-wrap">
            <TabsTrigger value="summary" className="text-xs h-8 gap-1.5">
              <BarChart2 className="w-3 h-3" />Summary
            </TabsTrigger>
            <TabsTrigger value="actions" className="text-xs h-8 gap-1.5">
              <ClipboardList className="w-3 h-3" />
              Action Items
              {(data.atRiskBusinesses.length + data.rankAlerts.filter(a => a.label === "SUDDEN_DROP" || a.label === "NOT_FOUND_CRITICAL").length) > 0 && (
                <span className="text-orange-500 font-bold">
                  ({data.atRiskBusinesses.length + data.rankAlerts.filter(a => a.label === "SUDDEN_DROP" || a.label === "NOT_FOUND_CRITICAL").length})
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="alerts" className="text-xs h-8 gap-1.5">
              <AlertTriangle className="w-3 h-3" />
              Alerts {alertCount > 0 && <span className="text-blue-500 font-bold">({alertCount})</span>}
            </TabsTrigger>
            <TabsTrigger value="businesses" className="text-xs h-8 gap-1.5">
              <BarChart2 className="w-3 h-3" />
              All Businesses ({data.totalBusinesses})
            </TabsTrigger>
            <TabsTrigger value="reports" className="text-xs h-8 gap-1.5">
              <CheckCircle2 className="w-3 h-3" />Per-Business Reports
            </TabsTrigger>
            <TabsTrigger value="chat" className="text-xs h-8 gap-1.5">
              <MessageSquare className="w-3 h-3" />AI Chat
            </TabsTrigger>
          </TabsList>

          {/* Summary tab */}
          <TabsContent value="summary" className="mt-4 space-y-4">
            {byDateData && <DateSummaryCard bd={byDateData} allBizinesses={data.businesses} />}
            <SummaryTable data={data} />
            <div className="rounded-xl border border-border p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-3">Key Rules — Daily Session Health</p>
              <div className="space-y-2">
                {[
                  "5 sessions per campaign per day — maximum and target. Never run more.",
                  "Random platform rotation per keyword per day is NORMAL — do not flag it.",
                  "Only flag a platform if it receives ZERO sessions for 3+ consecutive days across ALL keywords.",
                  "Success rate 90%+ = sessions reaching AI platforms correctly.",
                  "Any keyword missed for 3+ consecutive days = that keyword will fade from AI results independently.",
                  "2+ zero-session days in 7 days = AT RISK of ranking drop on next bi-weekly run.",
                  "Sessions → rankings correlation takes 7–14 days to appear. No instant results.",
                ].map((rule, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="text-primary shrink-0">•</span>
                    <p className="text-muted-foreground">{rule}</p>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* Action Items tab */}
          <TabsContent value="actions" className="mt-4">
            <ActionItemsPanel data={data} search={search} />
          </TabsContent>

          {/* Alerts tab */}
          <TabsContent value="alerts" className="mt-4 space-y-4">
            {data.atRiskBusinesses.filter((b) =>
              search === "" || b.bizName.toLowerCase().includes(search.toLowerCase())
            ).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-blue-600 flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5" />
                  Sessions At Risk — {data.atRiskBusinesses.length} businesses
                </p>
                {data.atRiskBusinesses
                  .filter((b) => search === "" || b.bizName.toLowerCase().includes(search.toLowerCase()))
                  .map((b, i) => <AtRiskCard key={i} biz={b} />)}
              </div>
            )}

            {data.rankAlerts.filter((a) =>
              (a.label === "SUDDEN_DROP" || a.label === "NOT_FOUND_CRITICAL") &&
              (search === "" || a.bizName.toLowerCase().includes(search.toLowerCase()))
            ).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-blue-600 flex items-center gap-1.5">
                  <TrendingDown className="w-3.5 h-3.5" />
                  Ranking Sudden Drops
                </p>
                {data.rankAlerts
                  .filter((a) => (a.label === "SUDDEN_DROP" || a.label === "NOT_FOUND_CRITICAL") &&
                    (search === "" || a.bizName.toLowerCase().includes(search.toLowerCase())))
                  .map((a, i) => <RankAlertCard key={i} alert={a} />)}
              </div>
            )}

            {data.rankAlerts.filter((a) =>
              (a.label === "SUDDEN_IMPROVEMENT" || a.label === "REAPPEARED") &&
              (search === "" || a.bizName.toLowerCase().includes(search.toLowerCase()))
            ).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Ranking Sudden Improvements
                </p>
                {data.rankAlerts
                  .filter((a) => (a.label === "SUDDEN_IMPROVEMENT" || a.label === "REAPPEARED") &&
                    (search === "" || a.bizName.toLowerCase().includes(search.toLowerCase())))
                  .map((a, i) => <RankAlertCard key={i} alert={a} />)}
              </div>
            )}

            {alertCount === 0 && (
              <div className="text-center py-12">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-3" />
                <p className="text-sm font-semibold text-foreground">No critical alerts</p>
                <p className="text-xs text-muted-foreground mt-1">All businesses on track or stable</p>
              </div>
            )}
          </TabsContent>

          {/* All businesses tab */}
          <TabsContent value="businesses" className="mt-4">
            <BizTable businesses={filteredBiz} search={search} byDateData={byDateData} />
          </TabsContent>

          {/* Per-business reports tab (Section 10 format) */}
          <TabsContent value="reports" className="mt-4">
            <PerBusinessReports businesses={filteredBiz} parentSearch={search} />
          </TabsContent>

          {/* AI Chat tab — forceMount keeps the panel alive so fetches survive tab switches */}
          <TabsContent value="chat" forceMount className="mt-2 data-[state=inactive]:hidden">
            <div className="rounded-xl border border-border overflow-hidden" style={{ height: "calc(100vh - 260px)", minHeight: "520px" }}>
              <AeoChatPanel businesses={filteredBiz} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
      </div>

      {/* ── Improved businesses sidebar ────────────────────────────── */}
      <ImprovedSidebar businesses={data.businesses} excludeFirstRun={excludeFirstRun} />
    </div>
  );
}
