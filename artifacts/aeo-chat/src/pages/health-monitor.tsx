import { useState, useEffect } from "react";
import { AeoChatPanel } from "@/components/aeo-chat-panel";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Activity, Search, Loader2, AlertCircle, ChevronRight,
  TrendingUp, TrendingDown, Minus, Calendar, RefreshCw, MessageSquare,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
type Prediction = "ON_TRACK" | "AT_RISK" | "STABLE" | "TOO_EARLY";

interface PlatformWindow {
  platform: string;
  sessionsLast3Days: number;
  sessionsLast5Days: number;
  consecutiveDaysSilent: number;
  status: "ACTIVE" | "NO_SESSIONS";
}

interface KeywordCoverage {
  keyword: string;
  daysSinceLastHit: number;
  status: "OK" | "WARNING" | "CRITICAL";
}

interface DayRecord {
  date: string;
  total: number;
  success: number;
  successRate: number;
  platforms: Record<string, number>;
  keywords: string[];
}

interface BusinessOverview {
  bizName: string;
  clientName: string;
  campaignName: string;
  numCampaigns: number;
  targetPerDay: number;
  daysActive: number;
  totalSessions: number;
  firstDate: string;
  latestDate: string;
  phase: number;
  phaseLabel: string;
  sessionsToday: number;
  successRateToday: number;
  avg7DaySessions: number;
  avg7DaySuccessRate: number;
  gapDays7: number;
  missedKeywords3Plus: string[];
  missedKeywords5Plus: string[];
  platformWindows: PlatformWindow[];
  prediction: Prediction;
  predictionLabel: string;
  predictionEmoji: string;
  nextRankingRunDue: string;
}

interface BusinessDetail extends BusinessOverview {
  allKeywords: string[];
  keywordCoverages: KeywordCoverage[];
  keywordVariants: Record<string, string[]>;
  // inherited from BusinessOverview: clientName
  keywordsHitToday: string[];
  platformsToday: Record<string, number>;
  why: string;
  action: string;
  recentDays: DayRecord[];
}

// ── Config ─────────────────────────────────────────────────────────────────────
const PRED: Record<Prediction, { label: string; emoji: string; dot: string; ring: string; text: string; bg: string }> = {
  AT_RISK:   { label: "At Risk of Drop",          emoji: "🚨", dot: "bg-blue-500",    ring: "border-blue-400",   text: "text-blue-700",    bg: "bg-blue-50 dark:bg-blue-950/40" },
  STABLE:    { label: "Stable — Holding Position", emoji: "➡️", dot: "bg-amber-500",   ring: "border-amber-400",  text: "text-amber-700",   bg: "bg-amber-50 dark:bg-amber-950/40" },
  ON_TRACK:  { label: "On Track for Improvement",  emoji: "📈", dot: "bg-emerald-500", ring: "border-emerald-400",text: "text-emerald-700", bg: "bg-emerald-50 dark:bg-emerald-950/40" },
  TOO_EARLY: { label: "Too Early to Assess",        emoji: "⏳", dot: "bg-slate-400",   ring: "border-slate-300",  text: "text-slate-600",   bg: "bg-slate-50 dark:bg-slate-900/60" },
};

const PLATFORM_BADGE: Record<string, string> = {
  ChatGPT:    "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  Gemini:     "bg-blue-500/10 text-blue-700 border-blue-500/30",
  Perplexity: "bg-violet-500/10 text-violet-700 border-violet-500/30",
};

function fmt(date: string): string {
  if (!date) return "—";
  const d = new Date(date + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function kpiIcon(val: number, target: number, warnFrac = 0.9, critFrac = 0.7): "✅" | "⚠️" | "🚨" {
  if (val >= target * warnFrac) return "✅";
  if (val >= target * critFrac) return "⚠️";
  return "🚨";
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Row({ label, value, icon }: { label: string; value: string; icon?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0 w-40">{label}</span>
      <span className="text-xs font-medium text-right">{icon ? `${icon} ` : ""}{value}</span>
    </div>
  );
}

function KpiCard({ label, value, sub, status }: { label: string; value: string; sub: string; status: "green" | "warn" | "crit" | "neutral" }) {
  const color = status === "green" ? "border-emerald-500/30 bg-emerald-500/5"
    : status === "warn" ? "border-amber-500/30 bg-amber-500/5"
    : status === "crit" ? "border-blue-500/30 bg-blue-500/5"
    : "border-border/40";
  return (
    <div className={cn("rounded-lg border p-3", color)}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">{label}</p>
      <p className="text-base font-bold leading-tight">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5 truncate" title={sub}>{sub}</p>
    </div>
  );
}

function PlatformBlock({ pw }: { pw: PlatformWindow }) {
  const silent5 = pw.consecutiveDaysSilent >= 5;
  const silent3 = pw.consecutiveDaysSilent >= 3;
  const isActive = pw.sessionsLast3Days > 0;
  return (
    <div className={cn("rounded-lg border p-3 flex items-center justify-between",
      silent5 ? "border-blue-500/40 bg-blue-500/5"
      : silent3 ? "border-amber-500/40 bg-amber-500/5"
      : "border-border/40"
    )}>
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border", PLATFORM_BADGE[pw.platform] ?? "bg-muted text-muted-foreground")}>{pw.platform}</span>
        <span className="text-xs font-mono text-muted-foreground">{pw.sessionsLast3Days} sessions (3d)</span>
      </div>
      <span className={cn("text-xs font-semibold",
        isActive ? "text-emerald-600" : silent5 ? "text-blue-600" : "text-amber-600"
      )}>
        {isActive ? "✅ Active" : silent5 ? "🚨 Silent 5+ days" : "⚠️ No sessions (3d)"}
      </span>
    </div>
  );
}

function TrendBar({ days, target }: { days: DayRecord[]; target: number }) {
  if (!days.length) return null;
  const maxH = Math.max(...days.map((d) => d.total), target, 1);
  return (
    <div className="relative flex items-end gap-0.5 h-12 mt-1">
      <div className="absolute left-0 right-0 border-t border-dashed border-primary/30 pointer-events-none"
        style={{ bottom: `${(target / maxH) * 100}%` }} />
      {days.map((d, i) => {
        const h = d.total > 0 ? Math.max((d.total / maxH) * 100, 6) : 3;
        const color = d.total === 0 ? "bg-blue-300 dark:bg-blue-700"
          : d.total >= target ? "bg-emerald-500"
          : d.total >= target * 0.6 ? "bg-amber-400"
          : "bg-blue-400";
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5"
            title={`${d.date}: ${d.total}/${target} sessions`}>
            <div className={cn("w-full rounded-sm", color)} style={{ height: `${h}%` }} />
          </div>
        );
      })}
    </div>
  );
}

// ── Detail Panel — Section 6 format ───────────────────────────────────────────
function DetailPanel({ detail, asOfDate }: { detail: BusinessDetail; asOfDate: string }) {
  const t = detail.targetPerDay;
  const pred = PRED[detail.prediction];

  const sessionIcon = kpiIcon(detail.sessionsToday, t, 0.8, 0.4);
  const successIcon = kpiIcon(detail.successRateToday, 1, 0.9, 0.7);
  const kwIcon = detail.keywordsHitToday.length >= detail.allKeywords.length ? "✅" : detail.keywordsHitToday.length > 0 ? "⚠️" : "🚨";
  const avg7Icon = kpiIcon(detail.avg7DaySessions, t, 0.8, 0.4);
  const avgSuccessIcon = kpiIcon(detail.avg7DaySuccessRate, 1, 0.9, 0.7);
  const gapIcon = detail.gapDays7 === 0 ? "✅" : detail.gapDays7 <= 1 ? "⚠️" : "🚨";
  const kwMissIcon = detail.missedKeywords5Plus.length > 0 ? "🚨" : detail.missedKeywords3Plus.length > 0 ? "⚠️" : "✅";

  const platformsStr = Object.entries(detail.platformsToday)
    .map(([p, n]) => `${p} ×${n}`)
    .join(", ") || "None";

  const kwHitStr = detail.keywordsHitToday.length > 0
    ? `${detail.keywordsHitToday.length} of ${detail.allKeywords.length} keywords hit`
    : `0 of ${detail.allKeywords.length} keywords hit`;

  const platformGaps = detail.platformWindows
    .filter((pw) => pw.consecutiveDaysSilent >= 3)
    .map((pw) => `${pw.platform} (${pw.consecutiveDaysSilent}d silent)`)
    .join(", ") || "None ✓";

  return (
    <div className="space-y-5 max-w-3xl">

      {/* ── Business header block ─────────────────────────────────────── */}
      <div className={cn("rounded-xl border-2 p-5", pred.ring, pred.bg)}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 flex-1 min-w-0">
            {detail.clientName && (
              <p className="text-[10px] text-muted-foreground font-medium">👤 Client: {detail.clientName}</p>
            )}
            <h2 className="text-lg font-bold text-foreground truncate">{detail.bizName}</h2>
            <p className="text-xs text-muted-foreground truncate" title={detail.campaignName}>{detail.campaignName}</p>
            <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground flex-wrap">
              <span><span className="font-semibold text-foreground">Report Date:</span> {fmt(asOfDate || detail.latestDate)}</span>
              <span><span className="font-semibold text-foreground">Latest Session:</span> {fmt(detail.latestDate)}</span>
              <span><span className="font-semibold text-foreground">Days Active:</span> {detail.daysActive}</span>
              <span><span className="font-semibold text-foreground">Phase:</span> {detail.phaseLabel}</span>
              <span><span className="font-semibold text-foreground">Next Ranking Run:</span> {fmt(detail.nextRankingRunDue)}</span>
            </div>
          </div>
          <div className={cn("rounded-lg border px-3 py-2 text-center shrink-0", pred.ring, pred.bg)}>
            <div className="text-xl">{pred.emoji}</div>
            <p className={cn("text-[10px] font-bold mt-0.5 max-w-[120px]", pred.text)}>{pred.label}</p>
          </div>
        </div>
      </div>

      {/* ── SESSION KPIs TODAY ────────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <span>📊</span> Session KPIs — Today ({fmt(detail.latestDate)})
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiCard
            label="Session Count"
            value={`${sessionIcon} ${detail.sessionsToday} / ${t}`}
            sub={`Target: ${t}/day`}
            status={detail.sessionsToday >= t ? "green" : detail.sessionsToday >= t * 0.6 ? "warn" : "crit"}
          />
          <KpiCard
            label="Success Rate"
            value={`${successIcon} ${pct(detail.successRateToday)}`}
            sub="Target: 90%+"
            status={detail.successRateToday >= 0.9 ? "green" : detail.successRateToday >= 0.7 ? "warn" : "crit"}
          />
          <KpiCard
            label="Keywords Hit Today"
            value={`${kwIcon} ${detail.keywordsHitToday.length} / ${detail.allKeywords.length}`}
            sub={detail.keywordsHitToday.slice(0, 2).join(", ") + (detail.keywordsHitToday.length > 2 ? "…" : "") || "None"}
            status={detail.keywordsHitToday.length >= detail.allKeywords.length ? "green" : detail.keywordsHitToday.length > 0 ? "warn" : "crit"}
          />
          <KpiCard
            label="Platforms Today"
            value={platformsStr}
            sub={`${Object.keys(detail.platformsToday).length} of 3 platforms`}
            status={Object.keys(detail.platformsToday).length >= 3 ? "green" : Object.keys(detail.platformsToday).length >= 1 ? "warn" : "crit"}
          />
        </div>
      </section>

      {/* ── ROLLING 7-DAY HEALTH ─────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <span>📈</span> Rolling 7-Day Session Health
        </h3>
        <div className="rounded-lg border border-border/50 divide-y divide-border/30">
          <Row label="Avg Sessions/Day" value={`${detail.avg7DaySessions.toFixed(1)} / ${t}`} icon={avg7Icon} />
          <Row label="Avg Success Rate" value={pct(detail.avg7DaySuccessRate)} icon={avgSuccessIcon} />
          <Row
            label="Session Gaps (zero days)"
            value={detail.gapDays7 === 0 ? "None ✓" : `${detail.gapDays7} day${detail.gapDays7 !== 1 ? "s" : ""} with no sessions`}
            icon={gapIcon}
          />
          <Row
            label="Keywords Missed 3+ days"
            value={detail.missedKeywords3Plus.length === 0 ? "None ✓" : detail.missedKeywords3Plus.slice(0, 3).join(", ") + (detail.missedKeywords3Plus.length > 3 ? "…" : "")}
            icon={kwMissIcon}
          />
          <Row
            label="Platform Gaps (3+ days)"
            value={platformGaps}
            icon={platformGaps === "None ✓" ? "✅" : "⚠️"}
          />
        </div>
      </section>

      {/* ── PLATFORM ROTATION ────────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
          <span>🔄</span> Platform Rotation — Last 3 Days
        </h3>
        <p className="text-[10px] text-muted-foreground mb-2">
          Random rotation per keyword is normal. Only flag if a platform gets 0 sessions across ALL keywords for 3+ consecutive days.
        </p>
        <div className="space-y-1.5">
          {detail.platformWindows.map((pw) => <PlatformBlock key={pw.platform} pw={pw} />)}
        </div>
      </section>

      {/* ── KEYWORD COVERAGE ─────────────────────────────────────────── */}
      {detail.keywordCoverages.length > 0 && (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <span>🔑</span> Keyword Coverage — {detail.allKeywords.length} keywords
          </h3>
          <div className="rounded-lg border border-border/50 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Keyword (Canonical)</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Variants Used</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Days Since Hit</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {detail.keywordCoverages.map((kw, i) => {
                  const variants = detail.keywordVariants?.[kw.keyword] ?? [];
                  return (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium max-w-[180px]">
                        <p className="truncate" title={kw.keyword}>{kw.keyword}</p>
                      </td>
                      <td className="px-3 py-2 max-w-[200px]">
                        {variants.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {variants.slice(0, 2).map((v, vi) => (
                              <span key={vi} className="text-[9px] text-muted-foreground truncate italic" title={v}>↳ {v}</span>
                            ))}
                            {variants.length > 2 && (
                              <span className="text-[9px] text-muted-foreground/60">+{variants.length - 2} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[9px] text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className={cn("px-3 py-2 font-mono",
                        kw.daysSinceLastHit === 0 ? "text-emerald-600"
                        : kw.daysSinceLastHit < 3 ? "text-muted-foreground"
                        : kw.daysSinceLastHit < 5 ? "text-amber-600"
                        : "text-blue-600"
                      )}>
                        {kw.daysSinceLastHit === 0 ? "Today ✓" : `${kw.daysSinceLastHit}d ago`}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold",
                          kw.status === "OK" ? "bg-emerald-500/10 text-emerald-700"
                          : kw.status === "WARNING" ? "bg-amber-500/10 text-amber-700"
                          : "bg-blue-500/10 text-blue-700"
                        )}>
                          {kw.status === "OK" ? "✅ OK" : kw.status === "WARNING" ? "⚠️ Warning" : "🚨 Critical"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── PREDICTION + WHY + ACTION ─────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <span>🚨</span> Prediction for Next Ranking Run
        </h3>
        <div className={cn("rounded-xl border-2 p-4 space-y-3", pred.ring, pred.bg)}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Prediction</p>
            <p className={cn("text-base font-bold mt-0.5", pred.text)}>{pred.emoji} {pred.label.toUpperCase()}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Why</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{detail.why}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Action</p>
            <p className="text-xs font-semibold text-foreground mt-0.5 leading-relaxed">{detail.action}</p>
          </div>
        </div>
      </section>

      {/* ── SESSION TREND ─────────────────────────────────────────────── */}
      {detail.recentDays.length > 1 && (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <span>📅</span> Session Trend — Last {detail.recentDays.length} days
            <span className="text-[9px] font-normal normal-case">(target {t}/day)</span>
          </h3>
          <div className="rounded-lg border border-border/50 p-3">
            <TrendBar days={detail.recentDays} target={t} />
            <div className="mt-3 space-y-1">
              {detail.recentDays.slice(-7).map((d, i) => (
                <div key={i} className="flex items-center gap-3 text-[10px]">
                  <span className="text-muted-foreground w-20 shrink-0">{d.date}</span>
                  <span className={cn("font-mono font-bold w-10 shrink-0",
                    d.total === 0 ? "text-blue-500"
                    : d.total >= t ? "text-emerald-500"
                    : "text-amber-500"
                  )}>{d.total}/{t}</span>
                  <span className={cn("w-16 shrink-0",
                    d.successRate >= 0.9 ? "text-emerald-500"
                    : d.successRate >= 0.7 ? "text-amber-500"
                    : "text-blue-500"
                  )}>{pct(d.successRate)} succ</span>
                  <span className="text-muted-foreground truncate">
                    {Object.entries(d.platforms).map(([p, n]) => `${p[0]}:${n}`).join(" ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export function HealthMonitorPage() {
  const [businesses, setBusinesses] = useState<BusinessOverview[]>([]);
  const [asOfDate, setAsOfDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterPred, setFilterPred] = useState<Prediction | "all">("all");
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [reportDate, setReportDate] = useState("");

  const [selected, setSelected] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  function loadList(date?: string) {
    setLoading(true);
    setListError(null);
    const url = date ? `/api/csv/sessions/overview?date=${date}` : "/api/csv/sessions/overview";
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        setBusinesses(d.businesses ?? []);
        if (d.asOfDate) setAsOfDate(d.asOfDate);
        setLoading(false);
      })
      .catch((e) => { setListError(e.message); setLoading(false); });
  }

  // Load available dates on mount, then load the list for the latest date
  useEffect(() => {
    fetch("/api/csv/sessions/dates")
      .then(r => r.json())
      .then(d => {
        const dates: string[] = d.dates ?? [];
        setAvailableDates(dates);
        const latest = dates[0] ?? "";
        setReportDate(latest);
        loadList(latest || undefined);
      })
      .catch(() => loadList());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the date picker changes, reload the list and re-fetch detail if open
  useEffect(() => {
    if (!reportDate) return;
    loadList(reportDate);
    if (selected) {
      setLoadingDetail(true);
      setDetail(null);
      fetch(`/api/csv/sessions/detail?business=${encodeURIComponent(selected)}&date=${reportDate}`)
        .then(r => r.json())
        .then(d => { setDetail(d); setLoadingDetail(false); })
        .catch(() => setLoadingDetail(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportDate]);

  async function selectBusiness(bizName: string) {
    if (selected === bizName && detail) return;
    setSelected(bizName);
    setLoadingDetail(true);
    setDetail(null);
    setDetailError(null);
    try {
      const dateParam = reportDate ? `&date=${reportDate}` : "";
      const r = await fetch(`/api/csv/sessions/detail?business=${encodeURIComponent(bizName)}${dateParam}`);
      const d = await r.json();
      if (!r.ok) setDetailError(d.error ?? "Failed to load");
      else setDetail(d);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDetail(false);
    }
  }

  const filtered = businesses.filter((b) => {
    const ms = b.bizName.toLowerCase().includes(search.toLowerCase());
    const mp = filterPred === "all" || b.prediction === filterPred;
    return ms && mp;
  });

  const counts = {
    all: businesses.length,
    AT_RISK:   businesses.filter((b) => b.prediction === "AT_RISK").length,
    STABLE:    businesses.filter((b) => b.prediction === "STABLE").length,
    ON_TRACK:  businesses.filter((b) => b.prediction === "ON_TRACK").length,
    TOO_EARLY: businesses.filter((b) => b.prediction === "TOO_EARLY").length,
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden">

      {/* ── Left sidebar ────────────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 border-r border-border flex flex-col min-h-0 bg-card">

        {/* Header */}
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold">Session Health Monitor</span>
            </div>
            <button onClick={() => loadList(reportDate || undefined)} title="Refresh" className="text-muted-foreground hover:text-primary">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* Date picker — selects the as-of date for all health predictions */}
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
            {availableDates.length > 0 ? (
              <select
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="flex-1 text-[11px] bg-muted border border-border rounded px-1.5 py-0.5 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {availableDates.map((d) => (
                  <option key={d} value={d}>{fmt(d)}</option>
                ))}
              </select>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                {asOfDate ? <>Data as of <strong className="text-foreground">{fmt(asOfDate)}</strong></> : "Loading…"}
              </span>
            )}
          </div>

          {/* Prediction filter pills */}
          {!loading && (
            <div className="grid grid-cols-2 gap-1">
              {(["AT_RISK", "STABLE", "ON_TRACK", "TOO_EARLY"] as Prediction[]).map((p) => {
                const cfg = PRED[p];
                const active = filterPred === p;
                return (
                  <button key={p}
                    onClick={() => setFilterPred((prev) => prev === p ? "all" : p)}
                    className={cn("text-[10px] font-medium py-1 px-2 rounded-md border transition-colors flex items-center gap-1 justify-center",
                      active ? "bg-primary/10 border-primary/40 text-primary" : "border-border hover:bg-secondary"
                    )}>
                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
                    {cfg.emoji} {cfg.label.split(" ")[0]} ({counts[p]})
                  </button>
                );
              })}
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search businesses…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          {!loading && (
            <p className="text-[10px] text-muted-foreground">
              {filtered.length} of {businesses.length} businesses
            </p>
          )}
        </div>

        {/* Business list */}
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : listError ? (
            <div className="p-4 flex gap-2 text-blue-500">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <p className="text-xs">{listError}</p>
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {filtered.map((biz) => {
                const isSelected = selected === biz.bizName;
                const cfg = PRED[biz.prediction];
                return (
                  <button key={biz.bizName}
                    onClick={() => selectBusiness(biz.bizName)}
                    className={cn("w-full text-left rounded-md px-3 py-2.5 border transition-colors",
                      isSelected ? "bg-primary/10 border-primary/20"
                      : "border-transparent hover:bg-secondary/60 hover:border-border"
                    )}>
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <p className={cn("text-xs font-semibold truncate flex-1",
                        isSelected ? "text-primary" : "text-foreground"
                      )} title={biz.bizName}>{biz.bizName}</p>
                      {isSelected && loadingDetail
                        ? <Loader2 className="w-3 h-3 animate-spin shrink-0 text-muted-foreground" />
                        : <ChevronRight className={cn("w-3 h-3 shrink-0", isSelected ? "text-primary" : "text-muted-foreground/40")} />
                      }
                    </div>
                    {biz.clientName && (
                      <p className="text-[9px] text-muted-foreground truncate mb-0.5" title={`Client: ${biz.clientName}`}>
                        👤 {biz.clientName}
                      </p>
                    )}

                    {/* Prediction */}
                    <div className="flex items-center gap-1 mb-1">
                      <div className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
                      <span className={cn("text-[10px] font-medium", cfg.text)}>
                        {cfg.emoji} {cfg.label}
                      </span>
                    </div>

                    {/* Quick stats */}
                    <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                      <span className={cn("font-mono",
                        biz.sessionsToday >= biz.targetPerDay ? "text-emerald-500"
                        : biz.sessionsToday > 0 ? "text-amber-500"
                        : "text-blue-500"
                      )}>{biz.sessionsToday}/{biz.targetPerDay}</span>
                      <span className={cn(
                        biz.avg7DaySuccessRate >= 0.9 ? "text-emerald-500"
                        : biz.avg7DaySuccessRate >= 0.7 ? "text-amber-500"
                        : "text-blue-500"
                      )}>{(biz.avg7DaySuccessRate * 100).toFixed(0)}% succ</span>
                      {biz.gapDays7 > 0 && <span className="text-blue-500">{biz.gapDays7}d gap</span>}
                      <span className="ml-auto text-[9px] text-muted-foreground/70">P{biz.phase}</span>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && !loading && (
                <p className="text-xs text-muted-foreground text-center py-8">No businesses match your filter.</p>
              )}
            </div>
          )}
        </ScrollArea>
      </aside>

      {/* ── Right panel ─────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col min-h-0">
        {/* Header with chat toggle */}
        <div className="flex items-center justify-end px-4 py-2 border-b border-border shrink-0">
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
          <div className="flex-1 min-h-0 overflow-hidden">
            <AeoChatPanel businesses={businesses} initialBizName={selected} />
          </div>
        ) : (
        <ScrollArea className="flex-1">
          <div className="p-6">
            {loadingDetail ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Loading report for <span className="font-semibold">{selected}</span>…
                </p>
              </div>
            ) : detailError ? (
              <div className="flex items-start gap-2 text-blue-500 max-w-md">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Failed to load business data</p>
                  <p className="text-xs text-muted-foreground mt-1">{detailError}</p>
                </div>
              </div>
            ) : detail ? (
              <DetailPanel detail={detail} asOfDate={asOfDate} />
            ) : (
              /* Welcome / summary state */
              <div className="space-y-5">
                {/* Summary stat tiles */}
                {!loading && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-3">
                      Session Health Summary — {businesses.length} businesses
                      {asOfDate && <span className="font-normal normal-case ml-2">as of {fmt(asOfDate)}</span>}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {(["AT_RISK", "STABLE", "ON_TRACK", "TOO_EARLY"] as Prediction[]).map((p) => {
                        const cfg = PRED[p];
                        const Icon = p === "AT_RISK" ? TrendingDown : p === "ON_TRACK" ? TrendingUp : p === "STABLE" ? Minus : Loader2;
                        return (
                          <button key={p}
                            onClick={() => setFilterPred((prev) => prev === p ? "all" : p)}
                            className={cn("rounded-xl border-2 p-4 text-left transition-all hover:shadow-sm", cfg.ring, cfg.bg)}>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <Icon className="w-3.5 h-3.5" />
                              <p className={cn("text-[10px] font-semibold uppercase tracking-wide", cfg.text)}>{cfg.emoji} {cfg.label.split(" ")[0]}</p>
                            </div>
                            <p className="text-3xl font-bold">{counts[p]}</p>
                            <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{cfg.label}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Activity className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Select a business to view its full report</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm leading-relaxed">
                      Each business report shows today's session KPIs, 7-day rolling health, 3-day platform rotation,
                      keyword coverage, and prediction for the next bi-weekly ranking run.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        )}
      </main>
    </div>
  );
}
