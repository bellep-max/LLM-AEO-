import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Sparkles, Calendar, BarChart2, FileText, Search, Loader2, AlertTriangle, CheckCircle2, Copy, Download } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type Keyword = {
  keyword: string;
  intent: "informational" | "commercial" | "transactional";
  estimated_volume: "low" | "medium" | "high";
  confidence: number;
  neighborhood_specific?: boolean;
};

type DailyResult = {
  city: string;
  date: string;
  data_quality: string;
  improvements: { keyword: string; change: string }[];
  declines: { keyword: string; change: string }[];
  top10_entered: string[];
  top10_exited: string[];
  hallucination_flags: string[];
  summary_text: string;
  next_action: string;
};

type WeeklyResult = {
  city: string;
  date_range: string;
  data_quality: string;
  top_improvers: { keyword: string; avg_rank: number; change: string }[];
  top_decliners: { keyword: string; avg_rank: number; change: string }[];
  patterns: string;
  hallucination_flags: string[];
  new_keyword_suggestions: string[];
  summary_text: string;
};

type MonthlyResult = {
  city: string;
  month: string;
  data_quality: string;
  top_roi_keywords: { keyword: string; roi_score: number; calls: number; directions: number }[];
  vanity_keywords: string[];
  hidden_gems: { keyword: string; rank: number; calls: number }[];
  stop_tracking: string[];
  hallucination_flags: string[];
  strategy_summary: string;
};

type CompetitorResult = {
  keyword: string;
  city: string;
  common_patterns: string[];
  content_gaps: { gap: string; rationale: string }[];
  recommended_topics: string[];
  confidence_note: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const INTENT_BADGE: Record<string, string> = {
  informational: "bg-blue-100 text-blue-700 border-blue-200",
  commercial:    "bg-amber-100 text-amber-700 border-amber-200",
  transactional: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const VOLUME_BADGE: Record<string, string> = {
  low:    "bg-slate-100 text-slate-600",
  medium: "bg-violet-100 text-violet-700",
  high:   "bg-rose-100 text-rose-700",
};

const QUALITY_COLOR: Record<string, string> = {
  good:    "text-emerald-600",
  partial: "text-amber-600",
  missing: "text-red-500",
};

function confidenceColor(c: number) {
  if (c >= 0.8) return "text-emerald-600";
  if (c >= 0.6) return "text-amber-600";
  return "text-red-500";
}

async function callApi(action: string, body: Record<string, string>): Promise<{ data: unknown; tokens_used: number; trace_url: string | null }> {
  const res = await fetch("/api/openai/keyword-generator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function downloadCsv(keywords: Keyword[], city: string) {
  const header = "keyword,intent,estimated_volume,confidence,neighborhood_specific";
  const rows = keywords.map(k =>
    `"${k.keyword.replace(/"/g, '""')}",${k.intent},${k.estimated_volume},${k.confidence},${k.neighborhood_specific ?? false}`
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `keywords-${city.toLowerCase().replace(/\s+/g, "-")}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Shared field components ──────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-foreground uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";
const textareaCls = `${inputCls} resize-none font-mono text-[11px] leading-relaxed`;

function RunButton({ loading, label = "Generate", disabled }: { loading: boolean; label?: string; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className={cn(
        "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors",
        loading || disabled
          ? "bg-muted text-muted-foreground cursor-not-allowed"
          : "bg-primary text-primary-foreground hover:bg-primary/90"
      )}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
      {loading ? "Generating…" : label}
    </button>
  );
}

function HallucinationFlags({ flags }: { flags: string[] }) {
  if (!flags || flags.length === 0) return (
    <div className="flex items-center gap-2 text-emerald-600 text-xs">
      <CheckCircle2 className="w-3.5 h-3.5" /> No hallucination flags detected
    </div>
  );
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1.5">
      <p className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5" /> {flags.length} hallucination flag{flags.length > 1 ? "s" : ""}
      </p>
      {flags.map((f, i) => <p key={i} className="text-xs text-amber-700 ml-5">{f}</p>)}
    </div>
  );
}

function DataQualityBadge({ quality }: { quality: string }) {
  return (
    <span className={cn("text-xs font-semibold", QUALITY_COLOR[quality] ?? "text-foreground")}>
      Data quality: {quality}
    </span>
  );
}

function TokensUsed({ tokens, traceUrl }: { tokens: number; traceUrl: string | null }) {
  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
      <span>{tokens.toLocaleString()} tokens used</span>
      {traceUrl && <a href={traceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">View trace</a>}
    </div>
  );
}

// ── Tab: Keyword Generator ────────────────────────────────────────────────────

const BUSINESS_TYPES = [
  "home services", "legal", "medical / dental", "restaurant", "retail",
  "salon / beauty", "real estate", "automotive", "education", "HVAC / plumbing",
  "landscaping", "cleaning services", "pet services", "fitness / gym", "other",
];

function KeywordsTab() {
  const [city, setCity] = useState("");
  const [population, setPopulation] = useState("");
  const [businessType, setBusinessType] = useState("home services");
  const [service, setService] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ keywords: Keyword[]; tokens: number; traceUrl: string | null } | null>(null);
  const [sortBy, setSortBy] = useState<"confidence" | "volume" | "intent">("confidence");
  const [filterIntent, setFilterIntent] = useState<string>("all");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!city || !service) { setError("City and Core Service are required."); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const { data, tokens_used, trace_url } = await callApi("keywords", { city, population, businessType, service });
      const kws = (Array.isArray(data) ? data : []) as Keyword[];
      setResult({ keywords: kws, tokens: tokens_used, traceUrl: trace_url });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const sorted = result?.keywords
    .filter(k => filterIntent === "all" || k.intent === filterIntent)
    .sort((a, b) => {
      if (sortBy === "confidence") return b.confidence - a.confidence;
      if (sortBy === "volume") {
        const ord = { high: 3, medium: 2, low: 1 };
        return (ord[b.estimated_volume] ?? 0) - (ord[a.estimated_volume] ?? 0);
      }
      return a.intent.localeCompare(b.intent);
    }) ?? [];

  const lowConf = sorted.filter(k => k.confidence < 0.6);

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="City *">
            <input className={inputCls} placeholder="e.g. San Diego, CA" value={city} onChange={e => setCity(e.target.value)} />
          </Field>
          <Field label="City Population (approx.)">
            <input className={inputCls} placeholder="e.g. 1,400,000" value={population} onChange={e => setPopulation(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Business Type">
            <select className={inputCls} value={businessType} onChange={e => setBusinessType(e.target.value)}>
              {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Core Service *">
            <input className={inputCls} placeholder="e.g. roof replacement" value={service} onChange={e => setService(e.target.value)} />
          </Field>
        </div>
        {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 px-3 py-2">{error}</p>}
        <div className="flex items-center gap-3">
          <RunButton loading={loading} label="Generate 30 Keywords" />
          {result && (
            <button type="button" onClick={() => downloadCsv(result.keywords, city)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg border border-border hover:bg-secondary transition-colors">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          )}
        </div>
      </form>

      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-sm font-semibold">{result.keywords.length} keywords generated for <span className="text-primary">{city}</span></p>
              <TokensUsed tokens={result.tokens} traceUrl={result.traceUrl} />
            </div>
          </div>

          {/* Confidence summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "High confidence (≥0.8)", count: result.keywords.filter(k => k.confidence >= 0.8).length, color: "text-emerald-600" },
              { label: "Medium (0.6–0.79)", count: result.keywords.filter(k => k.confidence >= 0.6 && k.confidence < 0.8).length, color: "text-amber-600" },
              { label: "Low (<0.6) — verify", count: lowConf.length, color: "text-red-500" },
            ].map(({ label, count, color }) => (
              <div key={label} className="rounded-lg border border-border bg-card p-3 text-center">
                <p className={cn("text-xl font-bold", color)}>{count}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          {lowConf.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3">
              <p className="text-xs font-bold text-amber-700 mb-1 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> {lowConf.length} low-confidence keyword{lowConf.length > 1 ? "s" : ""} — validate with Google Trends or a keyword tool before using
              </p>
              <p className="text-[10px] text-amber-600">{lowConf.map(k => k.keyword).join(" · ")}</p>
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              {["all", "informational", "commercial", "transactional"].map(intent => (
                <button key={intent} onClick={() => setFilterIntent(intent)}
                  className={cn("text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors",
                    filterIntent === intent ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-secondary")}>
                  {intent === "all" ? "All" : intent.charAt(0).toUpperCase() + intent.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 ml-auto text-[10px] text-muted-foreground">
              Sort:
              {(["confidence", "volume", "intent"] as const).map(s => (
                <button key={s} onClick={() => setSortBy(s)}
                  className={cn("px-2 py-0.5 rounded", sortBy === s ? "text-primary font-semibold" : "hover:text-foreground")}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground w-8">#</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Keyword</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Intent</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Volume</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((kw, i) => (
                  <tr key={i} className={cn("hover:bg-muted/30 transition-colors", kw.neighborhood_specific && "bg-blue-50/40 dark:bg-blue-950/10")}>
                    <td className="px-3 py-2 text-[10px] text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{kw.keyword}</span>
                        {kw.neighborhood_specific && <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full border border-blue-200">local</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", INTENT_BADGE[kw.intent] ?? "bg-muted text-muted-foreground border-border")}>
                        {kw.intent}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", VOLUME_BADGE[kw.estimated_volume] ?? "bg-muted text-muted-foreground")}>
                        {kw.estimated_volume}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={cn("font-mono font-bold", confidenceColor(kw.confidence))}>
                        {Math.round(kw.confidence * 100)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Daily Review ─────────────────────────────────────────────────────────

function DailyTab() {
  const [city, setCity] = useState("");
  const [csvData, setCsvData] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DailyResult | null>(null);
  const [tokens, setTokens] = useState(0);
  const [traceUrl, setTraceUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!city) { setError("City is required."); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const { data, tokens_used, trace_url } = await callApi("daily", { city, csvData });
      setResult(data as DailyResult);
      setTokens(tokens_used);
      setTraceUrl(trace_url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="City *">
          <input className={inputCls} placeholder="e.g. San Diego, CA" value={city} onChange={e => setCity(e.target.value)} />
        </Field>
        <Field label="Today's Ranking CSV (paste data)">
          <textarea className={textareaCls} rows={8}
            placeholder={"keyword,organic_rank,local_pack_present,screenshot_url\n\"best plumber near me\",3,true,\n\"emergency plumber san diego\",7,false,"}
            value={csvData} onChange={e => setCsvData(e.target.value)} />
        </Field>
        {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 px-3 py-2">{error}</p>}
        <RunButton loading={loading} label="Run Daily Review" />
      </form>

      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <DataQualityBadge quality={result.data_quality} />
            <TokensUsed tokens={tokens} traceUrl={traceUrl} />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-foreground leading-relaxed">{result.summary_text}</p>
            {result.next_action && <p className="mt-2 text-xs text-primary font-medium">→ {result.next_action}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-2">Improvements ({result.improvements.length})</p>
              {result.improvements.length === 0
                ? <p className="text-xs text-muted-foreground">None</p>
                : result.improvements.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-foreground">{r.keyword}</span>
                    <span className="text-emerald-600 font-mono font-bold">{r.change}</span>
                  </div>
                ))}
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-red-600 mb-2">Declines ({result.declines.length})</p>
              {result.declines.length === 0
                ? <p className="text-xs text-muted-foreground">None</p>
                : result.declines.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-foreground">{r.keyword}</span>
                    <span className="text-red-500 font-mono font-bold">{r.change}</span>
                  </div>
                ))}
            </div>
          </div>

          {(result.top10_entered.length > 0 || result.top10_exited.length > 0) && (
            <div className="grid grid-cols-2 gap-4">
              {result.top10_entered.length > 0 && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Entered Top 10</p>
                  {result.top10_entered.map((k, i) => <p key={i} className="text-xs text-emerald-600">✓ {k}</p>)}
                </div>
              )}
              {result.top10_exited.length > 0 && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Exited Top 10</p>
                  {result.top10_exited.map((k, i) => <p key={i} className="text-xs text-red-500">✗ {k}</p>)}
                </div>
              )}
            </div>
          )}

          <HallucinationFlags flags={result.hallucination_flags} />
        </div>
      )}
    </div>
  );
}

// ── Tab: Weekly Analysis ──────────────────────────────────────────────────────

function WeeklyTab() {
  const [city, setCity] = useState("");
  const [csvData, setCsvData] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WeeklyResult | null>(null);
  const [tokens, setTokens] = useState(0);
  const [traceUrl, setTraceUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!city) { setError("City is required."); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const { data, tokens_used, trace_url } = await callApi("weekly", { city, csvData });
      setResult(data as WeeklyResult);
      setTokens(tokens_used);
      setTraceUrl(trace_url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="City *">
          <input className={inputCls} placeholder="e.g. San Diego, CA" value={city} onChange={e => setCity(e.target.value)} />
        </Field>
        <Field label="7-Day Ranking CSV (paste data)">
          <textarea className={textareaCls} rows={10}
            placeholder={"date,keyword,organic_rank,local_pack_present\n2026-06-07,\"best plumber\",5,true\n2026-06-08,\"best plumber\",3,true\n..."}
            value={csvData} onChange={e => setCsvData(e.target.value)} />
        </Field>
        {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 px-3 py-2">{error}</p>}
        <RunButton loading={loading} label="Run Weekly Analysis" />
      </form>

      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <DataQualityBadge quality={result.data_quality} />
              {result.date_range && <span className="text-[10px] text-muted-foreground ml-3">{result.date_range}</span>}
            </div>
            <TokensUsed tokens={tokens} traceUrl={traceUrl} />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-foreground leading-relaxed">{result.summary_text}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3 space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Top Improvers</p>
              {result.top_improvers.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-foreground truncate">{r.keyword}</span>
                  <span className="text-emerald-600 font-mono font-bold shrink-0 ml-2">{r.change} (avg {r.avg_rank})</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-red-600">Top Decliners</p>
              {result.top_decliners.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-foreground truncate">{r.keyword}</span>
                  <span className="text-red-500 font-mono font-bold shrink-0 ml-2">{r.change} (avg {r.avg_rank})</span>
                </div>
              ))}
            </div>
          </div>

          {result.patterns && result.patterns !== "insufficient data" && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Patterns</p>
              <p className="text-xs text-foreground">{result.patterns}</p>
            </div>
          )}

          {result.new_keyword_suggestions?.length > 0 && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-primary mb-2">Suggested Keywords for Next Week</p>
              <div className="flex gap-2 flex-wrap">
                {result.new_keyword_suggestions.map((k, i) => (
                  <span key={i} className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">{k}</span>
                ))}
              </div>
            </div>
          )}

          <HallucinationFlags flags={result.hallucination_flags} />
        </div>
      )}
    </div>
  );
}

// ── Tab: Monthly Audit ────────────────────────────────────────────────────────

function MonthlyTab() {
  const [city, setCity] = useState("");
  const [rankingsCSV, setRankingsCSV] = useState("");
  const [outcomesCSV, setOutcomesCSV] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MonthlyResult | null>(null);
  const [tokens, setTokens] = useState(0);
  const [traceUrl, setTraceUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!city) { setError("City is required."); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const { data, tokens_used, trace_url } = await callApi("monthly", { city, rankingsCSV, outcomesCSV });
      setResult(data as MonthlyResult);
      setTokens(tokens_used);
      setTraceUrl(trace_url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="City *">
          <input className={inputCls} placeholder="e.g. San Diego, CA" value={city} onChange={e => setCity(e.target.value)} />
        </Field>
        <Field label="30-Day Rankings CSV">
          <textarea className={textareaCls} rows={6}
            placeholder={"date,keyword,organic_rank,local_pack_present\n2026-05-01,\"best plumber\",5,true\n..."}
            value={rankingsCSV} onChange={e => setRankingsCSV(e.target.value)} />
        </Field>
        <Field label="Business Outcomes CSV">
          <textarea className={textareaCls} rows={6}
            placeholder={"keyword,calls,direction_requests\n\"best plumber\",12,4\n..."}
            value={outcomesCSV} onChange={e => setOutcomesCSV(e.target.value)} />
        </Field>
        {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 px-3 py-2">{error}</p>}
        <RunButton loading={loading} label="Run Monthly Audit" />
      </form>

      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <DataQualityBadge quality={result.data_quality} />
            <TokensUsed tokens={tokens} traceUrl={traceUrl} />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-foreground leading-relaxed">{result.strategy_summary}</p>
          </div>

          {result.top_roi_keywords?.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="bg-muted/40 px-3 py-2 border-b border-border">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Top ROI Keywords</p>
              </div>
              <table className="w-full text-xs">
                <thead className="border-b border-border">
                  <tr>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground">Keyword</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground">ROI Score</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground">Calls</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground">Directions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.top_roi_keywords.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{r.keyword}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-primary">{r.roi_score}</td>
                      <td className="px-3 py-2 text-right text-emerald-600">{r.calls}</td>
                      <td className="px-3 py-2 text-right text-blue-600">{r.directions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {result.vanity_keywords?.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-2">Vanity Keywords (top 10, zero outcomes)</p>
                {result.vanity_keywords.map((k, i) => <p key={i} className="text-xs text-amber-700">• {k}</p>)}
              </div>
            )}
            {result.hidden_gems?.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-2">Hidden Gems (rank &gt;30, &gt;5 calls)</p>
                {result.hidden_gems.map((g, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-emerald-700">
                    <span>{g.keyword}</span>
                    <span className="font-mono">rank {g.rank} · {g.calls} calls</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {result.stop_tracking?.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Recommended: Stop Tracking</p>
              <div className="flex gap-2 flex-wrap">
                {result.stop_tracking.map((k, i) => (
                  <span key={i} className="text-[10px] line-through text-muted-foreground bg-muted px-2 py-0.5 rounded">{k}</span>
                ))}
              </div>
            </div>
          )}

          <HallucinationFlags flags={result.hallucination_flags} />
        </div>
      )}
    </div>
  );
}

// ── Tab: Competitor Gap ───────────────────────────────────────────────────────

function CompetitorTab() {
  const [keyword, setKeyword] = useState("");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompetitorResult | null>(null);
  const [tokens, setTokens] = useState(0);
  const [traceUrl, setTraceUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword || !city) { setError("Keyword and City are required."); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const { data, tokens_used, trace_url } = await callApi("competitor", { keyword, city });
      setResult(data as CompetitorResult);
      setTokens(tokens_used);
      setTraceUrl(trace_url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Target Keyword *">
            <input className={inputCls} placeholder='e.g. "best roof repair company"' value={keyword} onChange={e => setKeyword(e.target.value)} />
          </Field>
          <Field label="City *">
            <input className={inputCls} placeholder="e.g. San Diego, CA" value={city} onChange={e => setCity(e.target.value)} />
          </Field>
        </div>
        {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 px-3 py-2">{error}</p>}
        <RunButton loading={loading} label="Analyze Competitor Gap" />
      </form>

      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Gap analysis for <span className="text-primary">"{result.keyword}"</span> in {result.city}</p>
            <TokensUsed tokens={tokens} traceUrl={traceUrl} />
          </div>

          {result.common_patterns?.length > 0 && (
            <div className="rounded-lg border border-border p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Common Patterns in Top 10 Results</p>
              <ul className="space-y-1">
                {result.common_patterns.map((p, i) => <li key={i} className="text-xs text-foreground flex gap-2"><span className="text-muted-foreground">·</span>{p}</li>)}
              </ul>
            </div>
          )}

          {result.content_gaps?.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Content Gaps — Opportunities to Outrank</p>
              {result.content_gaps.map((g, i) => (
                <div key={i} className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="text-xs font-semibold text-primary mb-1">Gap {i + 1}: {g.gap}</p>
                  <p className="text-[10px] text-muted-foreground">{g.rationale}</p>
                </div>
              ))}
            </div>
          )}

          {result.recommended_topics?.length > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-2">Recommended Content Topics</p>
              <div className="flex gap-2 flex-wrap">
                {result.recommended_topics.map((t, i) => (
                  <span key={i} className="text-xs bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full border border-emerald-200">{t}</span>
                ))}
              </div>
            </div>
          )}

          {result.confidence_note && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3">
              <p className="text-[10px] font-bold text-amber-700 mb-1 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Confidence Note
              </p>
              <p className="text-xs text-amber-700">{result.confidence_note}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function KeywordGeneratorPage() {
  const [activeTab, setActiveTab] = useState("keywords");

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Sparkles className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Keyword Generator</h1>
            <span className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">DeepSeek · Anti-Hallucination</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Generate city-specific keywords and analyze ranking data with built-in hallucination detection. All outputs include confidence scores and self-audit flags.
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-9 w-full justify-start">
            <TabsTrigger value="keywords" className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Keywords
            </TabsTrigger>
            <TabsTrigger value="daily" className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Daily
            </TabsTrigger>
            <TabsTrigger value="weekly" className="flex items-center gap-1.5">
              <BarChart2 className="w-3.5 h-3.5" /> Weekly
            </TabsTrigger>
            <TabsTrigger value="monthly" className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Monthly
            </TabsTrigger>
            <TabsTrigger value="competitor" className="flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" /> Competitor Gap
            </TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="keywords" className={cn(activeTab !== "keywords" && "hidden")}>
              <KeywordsTab />
            </TabsContent>
            <TabsContent value="daily" className={cn(activeTab !== "daily" && "hidden")}>
              <DailyTab />
            </TabsContent>
            <TabsContent value="weekly" className={cn(activeTab !== "weekly" && "hidden")}>
              <WeeklyTab />
            </TabsContent>
            <TabsContent value="monthly" className={cn(activeTab !== "monthly" && "hidden")}>
              <MonthlyTab />
            </TabsContent>
            <TabsContent value="competitor" className={cn(activeTab !== "competitor" && "hidden")}>
              <CompetitorTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
