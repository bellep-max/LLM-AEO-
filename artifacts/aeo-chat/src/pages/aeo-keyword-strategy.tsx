import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2, MapPin, Building2, TrendingUp, Zap, Target,
  Search, ChevronDown, ChevronUp, MessageSquare, Copy, Check,
  Send, Bot, User, Calendar, FileDown, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

// ── localStorage helpers ──────────────────────────────────────────────────────

const ls = {
  get: <T,>(key: string): T | null => {
    try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
  },
  set: <T,>(key: string, val: T) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  },
};

const CHAT_HISTORY_KEY = "aeo-strategy-chat-history";

// ── Constants ─────────────────────────────────────────────────────────────────

const US_CITIES = [
  // Top 10 by population
  "New York",      "Los Angeles",  "Chicago",     "Houston",      "Phoenix",
  "Philadelphia",  "San Antonio",  "San Diego",   "Dallas",       "San Jose",
  // Major economic/cultural hubs
  "Miami",         "Atlanta",      "Seattle",      "Boston",       "Denver",
  "Las Vegas",     "Portland",     "Nashville",    "Austin",       "Charlotte",
  "Minneapolis",   "Tampa",        "New Orleans",  "Washington DC","San Francisco",
];

const BUSINESS_CATEGORIES = [
  "Home Services", "Health & Wellness", "Food & Beverage", "Retail",
  "Professional Services", "Automotive", "Personal Services",
  "Education", "Technology/IT", "Hospitality",
];

// ── Types ─────────────────────────────────────────────────────────────────────

type LocalArea = {
  name: string;
  population: string;
  zip_codes: string[];
  why_target: string;
};

type CityProfile = {
  name: string;
  population: string;
  metro_population: string;
  aeo_potential: string;
  classification: string;
  key_industries: string[];
  local_areas: LocalArea[];
};

type AEOKeyword = {
  type: "big_city" | "local" | "near_me";
  keyword: string;
  location: string;
  volume: string;
  competition: string;
  intent: string;
  conversion: string;
  aeo_angle: string;
  explanation: string;
};

type CategoryKeywords = {
  category: string;
  city: string;
  items: AEOKeyword[];
};

type Strategy = {
  big_city_rationale: string;
  local_rationale: string;
  combined_approach: string;
  content_strategy: string;
  aeo_tips: string[];
};

type AEOStrategyResult = {
  cities: CityProfile[];
  keywords: CategoryKeywords[];
  strategy: Strategy;
  tokens_used?: number;
  trace_url?: string | null;
};

// ── Badge helpers ─────────────────────────────────────────────────────────────

function VolumeBadge({ level }: { level: string }) {
  const cls =
    level === "High" || level === "Very High"
      ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
      : level === "Medium"
      ? "bg-amber-500/15 text-amber-700 border-amber-500/30"
      : "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", cls)}>
      {level}
    </span>
  );
}

function CompBadge({ level }: { level: string }) {
  const cls =
    level === "Very High" || level === "High"
      ? "bg-rose-500/15 text-rose-700 border-rose-500/30"
      : level === "Medium"
      ? "bg-amber-500/15 text-amber-700 border-amber-500/30"
      : "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", cls)}>
      {level}
    </span>
  );
}

function IntentBadge({ intent }: { intent: string }) {
  const cls =
    intent === "Transactional"
      ? "bg-violet-500/15 text-violet-700 border-violet-500/30"
      : intent === "Commercial"
      ? "bg-blue-500/15 text-blue-700 border-blue-500/30"
      : "bg-slate-500/15 text-slate-600 border-slate-500/30";
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", cls)}>
      {intent}
    </span>
  );
}

// ── Keyword Table ─────────────────────────────────────────────────────────────

function KeywordTable({ keywords, showLocation }: { keywords: AEOKeyword[]; showLocation?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Keyword</th>
            {showLocation && (
              <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Area</th>
            )}
            <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Volume</th>
            <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Competition</th>
            <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Intent</th>
            <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Convert</th>
            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">AEO Angle</th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((kw, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
              <td className="px-3 py-2.5 min-w-[180px]">
                <div className="font-semibold text-foreground">{kw.keyword}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{kw.explanation}</div>
              </td>
              {showLocation && (
                <td className="px-2 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">{kw.location}</td>
              )}
              <td className="px-2 py-2.5 text-center"><VolumeBadge level={kw.volume} /></td>
              <td className="px-2 py-2.5 text-center"><CompBadge level={kw.competition} /></td>
              <td className="px-2 py-2.5 text-center"><IntentBadge intent={kw.intent} /></td>
              <td className="px-2 py-2.5 text-center"><VolumeBadge level={kw.conversion} /></td>
              <td className="px-3 py-2.5 text-[11px] text-muted-foreground max-w-[240px] leading-relaxed">{kw.aeo_angle}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── City Card ─────────────────────────────────────────────────────────────────

function CityCard({ city }: { city: CityProfile }) {
  const [expanded, setExpanded] = useState(true);
  const potentialCls =
    city.aeo_potential === "Very High"
      ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
      : city.aeo_potential === "High"
      ? "bg-blue-500/15 text-blue-700 border-blue-500/30"
      : "bg-muted text-muted-foreground border-border";

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              {city.name}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              City: {city.population} · Metro: {city.metro_population}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn("text-[10px] font-bold rounded-full border px-2.5 py-1", potentialCls)}>
              AEO: {city.aeo_potential}
            </span>
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">{city.classification}</p>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">Key Industries</div>
            <div className="flex flex-wrap gap-1">
              {(city.key_industries ?? []).map(ind => (
                <span key={ind} className="text-[11px] rounded-full border bg-muted/50 px-2 py-0.5">{ind}</span>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
              Local Target Areas ({(city.local_areas ?? []).length})
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {(city.local_areas ?? []).map(area => (
                <div key={area.name} className="rounded-lg border bg-muted/20 p-2.5">
                  <div className="font-semibold text-xs text-foreground">{area.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    Pop: {area.population}
                    {area.zip_codes?.length > 0 && ` · ZIP: ${area.zip_codes.join(", ")}`}
                  </div>
                  <div className="text-[11px] text-foreground mt-1.5 leading-relaxed">{area.why_target}</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── Category Keywords Panel ────────────────────────────────────────────────────

function CategoryPanel({ sets }: { sets: CategoryKeywords[] }) {
  return (
    <div className="space-y-6">
      {sets.map(set => {
        const bigCity = set.items.filter(k => k.type === "big_city");
        const local   = set.items.filter(k => k.type === "local");
        const nearMe  = set.items.filter(k => k.type === "near_me");

        return (
          <Card key={`${set.category}-${set.city}`} className="shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-primary" />
                {set.city}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-0">

              {/* Big City */}
              {bigCity.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingUp className="h-3 w-3 text-blue-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Big City Keywords — High Volume · High Competition
                    </span>
                  </div>
                  <KeywordTable keywords={bigCity} />
                </div>
              )}

              {/* Local */}
              {local.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Target className="h-3 w-3 text-emerald-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Local Neighborhood Keywords — Lower Competition · Higher Conversion
                    </span>
                  </div>
                  <KeywordTable keywords={local} showLocation />
                </div>
              )}

              {/* Near Me */}
              {nearMe.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Zap className="h-3 w-3 text-amber-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      "Near Me" — Highest Intent · Triggers AI Local Answers
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {nearMe.map((kw, i) => (
                      <div key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                        <div className="font-semibold text-sm text-foreground">{kw.keyword}</div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          <VolumeBadge level={kw.volume} />
                          <CompBadge level={kw.competition} />
                          <IntentBadge intent={kw.intent} />
                        </div>
                        <div className="text-[11px] text-primary mt-2 font-medium leading-relaxed">{kw.aeo_angle}</div>
                        <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{kw.explanation}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── Markdown Chat Bubble ──────────────────────────────────────────────────────

function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold mb-1.5 mt-3 first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2.5 first:mt-0">{children}</h3>,
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ children }) => (
          <code className="bg-muted rounded px-1 py-0.5 text-[11px] font-mono">{children}</code>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary/40 pl-3 text-muted-foreground italic mb-2">{children}</blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto mb-2 rounded-lg border">
            <table className="w-full text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
        th: ({ children }) => (
          <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-b">{children}</th>
        ),
        td: ({ children }) => <td className="px-3 py-2 border-b border-border/50 last:border-0">{children}</td>,
        hr: () => <hr className="border-border my-3" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AEOKeywordStrategyPage() {
  const [selectedCities, setSelectedCities] = useState<string[]>(["New York", "Los Angeles", "Chicago", "Miami", "Atlanta", "Houston"]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(BUSINESS_CATEGORIES);
  const [selectedPeriod, setSelectedPeriod] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AEOStrategyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("local");
  const [activeCategory, setActiveCategory] = useState<string>("");

  // Campaign generator state
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignResult, setCampaignResult] = useState<string | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [campaignTraceUrl, setCampaignTraceUrl] = useState<string | null>(null);
  const [campaignTokens, setCampaignTokens] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const campaignRef = useRef<HTMLDivElement>(null);

  // AI Advisor chat state
  type ChatMsg = { role: "user" | "assistant"; content: string };
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>(() => ls.get<ChatMsg[]>(CHAT_HISTORY_KEY) ?? []);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  function toggleCity(city: string) {
    setSelectedCities(prev =>
      prev.includes(city) ? prev.filter(c => c !== city) : [...prev, city]
    );
  }

  function toggleCategory(cat: string) {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  }

  async function generate() {
    if (!selectedCities.length || !selectedCategories.length) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/openai/aeo-keyword-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cities: selectedCities, categories: selectedCategories }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt);
      }
      const data: AEOStrategyResult = await res.json();
      setResult(data);
      setActiveTab("local");
      const firstCat = data.keywords?.[0]?.category ?? "";
      setActiveCategory(firstCat);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function generateCampaigns() {
    if (!selectedCities.length) return;
    setCampaignLoading(true);
    setCampaignError(null);
    setCampaignResult(null);
    setCampaignTraceUrl(null);
    try {
      const res = await fetch("/api/openai/aeo-city-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cities: selectedCities }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt);
      }
      const data: { content: string; tokens_used: number; trace_url?: string | null } = await res.json();
      setCampaignResult(data.content);
      setCampaignTokens(data.tokens_used ?? 0);
      setCampaignTraceUrl(data.trace_url ?? null);
    } catch (e: unknown) {
      setCampaignError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCampaignLoading(false);
    }
  }

  function handleCopy() {
    if (!campaignResult) return;
    navigator.clipboard.writeText(campaignResult).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  useEffect(() => {
    ls.set(CHAT_HISTORY_KEY, chatMsgs);
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs]);

  function clearChatHistory() {
    setChatMsgs([]);
    ls.set(CHAT_HISTORY_KEY, []);
  }

  const handleExportPDF = useCallback(() => {
    const style = document.createElement("style");
    style.id = "__aeo-print-style";
    style.textContent = `
      @media print {
        body > * { display: none !important; }
        #aeo-print-root { display: block !important; }
        #aeo-print-root { position: fixed; inset: 0; overflow: auto; background: white; padding: 16px; }
        @page { margin: 16mm; size: A4; }
      }
    `;
    document.head.appendChild(style);

    const el = resultsRef.current;
    if (el) {
      el.id = "aeo-print-root";
      window.print();
      el.removeAttribute("id");
    }

    document.head.removeChild(style);
  }, []);

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const userMsg: ChatMsg = { role: "user", content: text };
    const next = [...chatMsgs, userMsg];
    setChatMsgs(next);
    setChatInput("");
    setChatLoading(true);
    try {
      const res = await fetch("/api/openai/aeo-strategy-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          cities: selectedCities,
          categories: selectedCategories,
          period: selectedPeriod,
        }),
      });
      const data: { content?: string; error?: string } = await res.json();
      setChatMsgs(prev => [
        ...prev,
        { role: "assistant", content: res.ok ? (data.content ?? "No response.") : `Error: ${data.error ?? "Unknown"}` },
      ]);
    } catch (e: unknown) {
      setChatMsgs(prev => [...prev, { role: "assistant", content: `Could not reach server: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  const kwByCat = result?.keywords.reduce<Record<string, CategoryKeywords[]>>((acc, kw) => {
    if (!acc[kw.category]) acc[kw.category] = [];
    acc[kw.category].push(kw);
    return acc;
  }, {}) ?? {};

  const totalKeywords = result?.keywords.reduce((s, k) => s + k.items.length, 0) ?? 0;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Config sidebar ─────────────────────────────────────── */}
      <aside className="w-60 border-r border-border bg-card flex flex-col overflow-y-auto shrink-0">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-bold text-foreground">AEO Keyword Strategy</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            AI search query strategy for local businesses — ChatGPT, Perplexity, Google AI, Gemini
          </p>
        </div>

        {/* City selector */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Target Cities ({selectedCities.length}/{US_CITIES.length})
            </span>
            <button
              className="text-[10px] text-primary hover:underline"
              onClick={() =>
                selectedCities.length === US_CITIES.length
                  ? setSelectedCities([])
                  : setSelectedCities([...US_CITIES])
              }
            >
              {selectedCities.length === US_CITIES.length ? "None" : "All"}
            </button>
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {US_CITIES.map(city => (
              <label key={city} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={selectedCities.includes(city)}
                  onChange={() => toggleCity(city)}
                  className="h-3 w-3 accent-primary shrink-0"
                />
                <span className="text-xs text-foreground group-hover:text-primary transition-colors">{city}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Category selector */}
        <div className="p-4 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Categories</span>
            <button
              className="text-[10px] text-primary hover:underline"
              onClick={() =>
                selectedCategories.length === BUSINESS_CATEGORIES.length
                  ? setSelectedCategories([])
                  : setSelectedCategories([...BUSINESS_CATEGORIES])
              }
            >
              {selectedCategories.length === BUSINESS_CATEGORIES.length ? "None" : "All"}
            </button>
          </div>
          <div className="space-y-1.5">
            {BUSINESS_CATEGORIES.map(cat => (
              <label key={cat} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={selectedCategories.includes(cat)}
                  onChange={() => toggleCategory(cat)}
                  className="h-3 w-3 accent-primary shrink-0"
                />
                <span className="text-xs text-foreground group-hover:text-primary transition-colors">{cat}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Period selector */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-1.5 mb-2">
            <Calendar className="h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Content Schedule</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(["daily", "weekly", "monthly"] as const).map(p => (
              <button
                key={p}
                onClick={() => setSelectedPeriod(p)}
                className={cn(
                  "rounded-md border py-1.5 text-[11px] font-semibold capitalize transition-colors",
                  selectedPeriod === p
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/60"
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="mt-2 rounded-md bg-muted/30 border px-2.5 py-2 text-[10px] text-muted-foreground leading-relaxed">
            {selectedPeriod === "daily"  && <>🔥 <strong>Near Me</strong> keywords — highest intent, daily GBP updates + fresh content</>}
            {selectedPeriod === "weekly" && <>📍 <strong>Local neighbourhood</strong> keywords — 1–2 landing pages/week per city</>}
            {selectedPeriod === "monthly"&& <>🏙️ <strong>Big city authority</strong> pages — 1 comprehensive page/month per city</>}
          </div>
        </div>

        <div className="p-4 border-t border-border space-y-2">
          <Button
            className="w-full"
            size="sm"
            onClick={generate}
            disabled={loading || !selectedCities.length || !selectedCategories.length}
          >
            {loading ? (
              <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Generating…</>
            ) : (
              <><Search className="h-3.5 w-3.5 mr-2" />Generate Strategy</>
            )}
          </Button>
          <p className="text-[10px] text-muted-foreground text-center">
            {selectedCities.length} cities · {selectedCategories.length} categories
          </p>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Always-visible AI Advisor when no strategy generated */}
        {!loading && !result && !error && (
          <div className="flex flex-col h-full p-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  AI Strategy Advisor
                  {chatMsgs.length > 0 && (
                    <span className="text-[10px] font-normal text-muted-foreground">
                      ({chatMsgs.length} messages saved)
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  Ask about your AEO strategy — no need to generate first. Use the sidebar to set context then chat.
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap gap-1.5 justify-end">
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold shrink-0",
                    selectedPeriod === "daily"   ? "bg-rose-500/10 text-rose-700 border-rose-500/20" :
                    selectedPeriod === "weekly"  ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" :
                                                   "bg-blue-500/10 text-blue-700 border-blue-500/20"
                  )}>
                    <Calendar className="h-2.5 w-2.5" />
                    {selectedPeriod}
                  </span>
                  {selectedCities.slice(0, 3).map(c => (
                    <span key={c} className="inline-flex items-center gap-1 rounded-full border bg-primary/10 text-primary border-primary/20 px-2 py-0.5 text-[10px] font-semibold">
                      <MapPin className="h-2.5 w-2.5" />{c}
                    </span>
                  ))}
                  {selectedCities.length > 3 && (
                    <span className="text-[10px] text-muted-foreground self-center">+{selectedCities.length - 3}</span>
                  )}
                </div>
                {chatMsgs.length > 0 && (
                  <button
                    onClick={clearChatHistory}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-rose-600 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear history
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto rounded-lg border bg-muted/10 p-4 space-y-4 mb-3">
              {chatMsgs.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-6">
                  <Bot className="h-10 w-10 text-muted-foreground/25" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Start asking about your AEO strategy</p>
                    <p className="text-xs text-muted-foreground mt-1">Context is already set from the sidebar — no generation needed</p>
                  </div>
                  <div className="grid gap-2 w-full max-w-lg">
                    {[
                      `Which ${selectedPeriod} keywords should I target for ${selectedCities[0] ?? "my cities"}?`,
                      `How do I make ${selectedCities[0] ?? "NYC"} and ${selectedCities[1] ?? "LA"} campaigns complement instead of compete?`,
                      "What content should I publish first to get cited in ChatGPT and Perplexity?",
                      `Give me a ${selectedPeriod} AEO content plan for Home Services`,
                    ].map(q => (
                      <button
                        key={q}
                        onClick={() => setChatInput(q)}
                        className="text-left rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chatMsgs.map((msg, i) => (
                <div key={i} className={cn("flex gap-2.5", msg.role === "user" ? "justify-end" : "justify-start")}>
                  {msg.role === "assistant" && (
                    <div className="h-6 w-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="h-3 w-3 text-primary" />
                    </div>
                  )}
                  <div className={cn(
                    "rounded-xl px-3.5 py-2.5 text-sm leading-relaxed max-w-[80%]",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm whitespace-pre-wrap"
                      : "bg-card border border-border rounded-tl-sm text-foreground"
                  )}>
                    {msg.role === "assistant" ? <MarkdownMessage content={msg.content} /> : msg.content}
                  </div>
                  {msg.role === "user" && (
                    <div className="h-6 w-6 rounded-full bg-muted border flex items-center justify-center shrink-0 mt-0.5">
                      <User className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                </div>
              ))}

              {chatLoading && (
                <div className="flex gap-2.5 justify-start">
                  <div className="h-6 w-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <Bot className="h-3 w-3 text-primary" />
                  </div>
                  <div className="rounded-xl rounded-tl-sm border bg-card px-3.5 py-2.5 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                placeholder={`Ask about ${selectedPeriod} AEO strategy for ${selectedCities[0] ?? "your cities"}…`}
                disabled={chatLoading}
                className="flex-1 rounded-lg border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
              />
              <Button size="sm" onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()} className="h-auto px-3">
                {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>

            {/* Generate nudge */}
            <p className="text-[10px] text-muted-foreground text-center mt-2">
              Tip: click <strong>Generate Strategy</strong> on the left to also get keyword tables, city profiles, and campaigns
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">Generating AEO keyword strategy…</p>
            <p className="text-xs text-muted-foreground">
              {selectedCities.length} cities · {selectedCategories.length} categories
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-6">
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div ref={resultsRef} className="flex-1 overflow-y-auto p-6 space-y-4">

            {/* Stats bar */}
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="grid grid-cols-4 gap-3 flex-1">
              {[
                { label: "Cities", value: result.cities?.length ?? 0 },
                { label: "Local Areas", value: result.cities?.reduce((s, c) => s + (c.local_areas?.length ?? 0), 0) ?? 0 },
                { label: "Category Sets", value: result.keywords?.length ?? 0 },
                { label: "Total AEO Keywords", value: totalKeywords },
              ].map(stat => (
                <Card key={stat.label} className="shadow-none">
                  <CardContent className="p-3 text-center">
                    <div className="text-2xl font-black">{stat.value}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{stat.label}</div>
                  </CardContent>
                </Card>
              ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportPDF}
                className="shrink-0 gap-1.5 h-auto py-2"
              >
                <FileDown className="h-3.5 w-3.5" />
                Export PDF
              </Button>
            </div>

            {/* Main tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-9">
                <TabsTrigger value="local" className="text-xs">Local Areas</TabsTrigger>
                <TabsTrigger value="cities" className="text-xs">City Profiles</TabsTrigger>
                <TabsTrigger value="keywords" className="text-xs">AEO Keywords</TabsTrigger>
                <TabsTrigger value="strategy" className="text-xs">Strategy &amp; Tips</TabsTrigger>
                <TabsTrigger value="campaigns" className="text-xs flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  Campaign Generator
                </TabsTrigger>
                <TabsTrigger value="advisor" className="text-xs flex items-center gap-1">
                  <Bot className="h-3 w-3" />
                  AI Advisor
                </TabsTrigger>
              </TabsList>

              {/* LOCAL AREAS TAB */}
              <TabsContent value="local" className="mt-4 space-y-4">
                {(result.cities ?? []).map(city => (
                  <Card key={city.name} className="shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-primary" />
                        {city.name}
                        <span className="text-xs font-normal text-muted-foreground ml-1">— {(city.local_areas ?? []).length} local target areas</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {(city.local_areas ?? []).map(area => (
                          <div key={area.name} className="rounded-lg border bg-muted/20 p-3">
                            <div className="font-semibold text-sm text-foreground">{area.name}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Pop: {area.population}
                              {area.zip_codes?.length > 0 && (
                                <span className="ml-2">ZIP: {area.zip_codes.join(", ")}</span>
                              )}
                            </div>
                            <div className="text-xs text-foreground mt-2 leading-relaxed border-t pt-2">{area.why_target}</div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>

              {/* CITY PROFILES TAB */}
              <TabsContent value="cities" className="mt-4 space-y-4">
                {(result.cities ?? []).map(city => (
                  <CityCard key={city.name} city={city} />
                ))}
              </TabsContent>

              {/* KEYWORDS TAB */}
              <TabsContent value="keywords" className="mt-4">
                {Object.keys(kwByCat).length > 0 ? (
                  <Tabs value={activeCategory} onValueChange={setActiveCategory}>
                    <ScrollArea className="w-full pb-1">
                      <TabsList className="flex w-max gap-0.5 h-auto p-1 flex-wrap">
                        {Object.keys(kwByCat).map(cat => (
                          <TabsTrigger key={cat} value={cat} className="text-[11px] px-3 py-1.5 h-auto">
                            {cat}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </ScrollArea>

                    {Object.entries(kwByCat).map(([cat, sets]) => (
                      <TabsContent key={cat} value={cat} className="mt-4">
                        <div className="mb-3">
                          <h3 className="text-sm font-bold text-foreground">{cat}</h3>
                          <p className="text-xs text-muted-foreground">
                            {sets.reduce((s, k) => s + k.items.filter(i => i.type === "big_city").length, 0)} big city ·{" "}
                            {sets.reduce((s, k) => s + k.items.filter(i => i.type === "local").length, 0)} local ·{" "}
                            {sets.reduce((s, k) => s + k.items.filter(i => i.type === "near_me").length, 0)} near me keywords
                          </p>
                        </div>
                        <CategoryPanel sets={sets} />
                      </TabsContent>
                    ))}
                  </Tabs>
                ) : (
                  <div className="text-center py-12 text-sm text-muted-foreground">No keywords generated.</div>
                )}
              </TabsContent>

              {/* AI ADVISOR TAB */}
              <TabsContent value="advisor" className="mt-4">
                <div className="flex flex-col h-[calc(100vh-240px)] min-h-[480px]">

                  {/* Context bar */}
                  <div className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-lg border bg-muted/20">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground shrink-0">Context:</span>
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      selectedPeriod === "daily"   ? "bg-rose-500/10 text-rose-700 border-rose-500/20" :
                      selectedPeriod === "weekly"  ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" :
                                                     "bg-blue-500/10 text-blue-700 border-blue-500/20"
                    )}>
                      <Calendar className="h-2.5 w-2.5" />
                      {selectedPeriod.charAt(0).toUpperCase() + selectedPeriod.slice(1)}
                    </span>
                    {selectedCities.slice(0, 4).map(c => (
                      <span key={c} className="inline-flex items-center gap-1 rounded-full border bg-primary/10 text-primary border-primary/20 px-2 py-0.5 text-[10px] font-semibold">
                        <MapPin className="h-2.5 w-2.5" />{c}
                      </span>
                    ))}
                    {selectedCities.length > 4 && (
                      <span className="text-[10px] text-muted-foreground">+{selectedCities.length - 4} more</span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">{selectedCategories.length} categories</span>
                    {chatMsgs.length > 0 && (
                      <button
                        onClick={clearChatHistory}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-rose-600 transition-colors shrink-0"
                      >
                        <Trash2 className="h-3 w-3" />
                        Clear history
                      </button>
                    )}
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto rounded-lg border bg-muted/10 p-4 space-y-4 mb-3">
                    {chatMsgs.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
                        <Bot className="h-10 w-10 text-muted-foreground/25" />
                        <p className="text-sm font-medium text-foreground">Ask anything about your AEO strategy</p>
                        <div className="grid gap-2 w-full max-w-sm">
                          {[
                            `Which keywords should I focus on this ${selectedPeriod}?`,
                            `How do I make ${selectedCities[0] ?? "NYC"} and ${selectedCities[1] ?? "LA"} campaigns complement each other?`,
                            "What content should I publish first to rank in AI answers?",
                          ].map(q => (
                            <button
                              key={q}
                              onClick={() => { setChatInput(q); }}
                              className="text-left rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {chatMsgs.map((msg, i) => (
                      <div key={i} className={cn("flex gap-2.5", msg.role === "user" ? "justify-end" : "justify-start")}>
                        {msg.role === "assistant" && (
                          <div className="h-6 w-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                            <Bot className="h-3 w-3 text-primary" />
                          </div>
                        )}
                        <div className={cn(
                          "rounded-xl px-3.5 py-2.5 text-sm leading-relaxed max-w-[80%] whitespace-pre-wrap",
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-tr-sm"
                            : "bg-card border border-border rounded-tl-sm text-foreground"
                        )}>
                          {msg.content}
                        </div>
                        {msg.role === "user" && (
                          <div className="h-6 w-6 rounded-full bg-muted border flex items-center justify-center shrink-0 mt-0.5">
                            <User className="h-3 w-3 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    ))}

                    {chatLoading && (
                      <div className="flex gap-2.5 justify-start">
                        <div className="h-6 w-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                          <Bot className="h-3 w-3 text-primary" />
                        </div>
                        <div className="rounded-xl rounded-tl-sm border bg-card px-3.5 py-2.5 flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                      placeholder={`Ask about your ${selectedPeriod} AEO strategy for ${selectedCities[0] ?? "your cities"}…`}
                      disabled={chatLoading}
                      className="flex-1 rounded-lg border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                    />
                    <Button size="sm" onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()} className="h-auto px-3">
                      {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* CAMPAIGN GENERATOR TAB */}
              <TabsContent value="campaigns" className="mt-4 space-y-4">
                <Card className="shadow-none">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <CardTitle className="text-sm flex items-center gap-2">
                          <MessageSquare className="h-3.5 w-3.5 text-primary" />
                          City AEO Campaign Generator
                        </CardTitle>
                        <CardDescription className="text-xs mt-1 leading-relaxed">
                          Generates unique, non-competing AEO campaigns for each selected city — with keyword clusters, content plans, competitor analysis, and conversion strategies tailored to each city's local signals.
                        </CardDescription>
                      </div>
                      <Button
                        size="sm"
                        onClick={generateCampaigns}
                        disabled={campaignLoading || !selectedCities.length}
                        className="shrink-0"
                      >
                        {campaignLoading ? (
                          <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Generating…</>
                        ) : (
                          <><Search className="h-3.5 w-3.5 mr-2" />Generate Campaigns</>
                        )}
                      </Button>
                    </div>

                    {/* City chips */}
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {selectedCities.map(city => (
                        <span key={city} className="inline-flex items-center gap-1 rounded-full border bg-primary/10 text-primary border-primary/20 px-2 py-0.5 text-[10px] font-semibold">
                          <MapPin className="h-2.5 w-2.5" />
                          {city}
                        </span>
                      ))}
                    </div>
                  </CardHeader>
                </Card>

                {/* Loading */}
                {campaignLoading && (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm font-medium text-foreground">Generating city campaigns…</p>
                    <p className="text-xs text-muted-foreground">
                      Building unique AEO strategies for {selectedCities.length} cities — this may take 30–60 seconds
                    </p>
                  </div>
                )}

                {/* Error */}
                {campaignError && !campaignLoading && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
                    {campaignError}
                  </div>
                )}

                {/* Result */}
                {campaignResult && !campaignLoading && (
                  <Card className="shadow-none">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-muted-foreground">
                          {campaignTokens > 0 && <span>Tokens used: {campaignTokens.toLocaleString()}</span>}
                          {campaignTraceUrl && (
                            <> · <a href={campaignTraceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">Langfuse trace →</a></>
                          )}
                        </div>
                        <Button variant="outline" size="sm" onClick={handleCopy} className="h-7 text-xs gap-1.5">
                          {copied ? <><Check className="h-3 w-3 text-emerald-500" />Copied</> : <><Copy className="h-3 w-3" />Copy</>}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div ref={campaignRef} className="rounded-lg border bg-muted/20 p-4 max-h-[70vh] overflow-y-auto">
                        <pre className="text-xs text-foreground leading-relaxed whitespace-pre-wrap font-sans">
                          {campaignResult}
                        </pre>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Idle state */}
                {!campaignResult && !campaignLoading && !campaignError && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                    <MessageSquare className="h-10 w-10 text-muted-foreground/25" />
                    <p className="text-sm font-medium text-foreground">No campaigns generated yet</p>
                    <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                      Click "Generate Campaigns" to create unique, city-specific AEO campaigns with keyword clusters, content plans, and competitor analysis for your {selectedCities.length} selected cities.
                    </p>
                  </div>
                )}
              </TabsContent>

              {/* STRATEGY TAB */}
              <TabsContent value="strategy" className="mt-4 space-y-4">
                {result.strategy ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Card className="shadow-none">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <TrendingUp className="h-3.5 w-3.5 text-blue-500" />
                            Why Big City Keywords?
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <p className="text-sm text-muted-foreground leading-relaxed">{result.strategy.big_city_rationale}</p>
                        </CardContent>
                      </Card>
                      <Card className="shadow-none">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Target className="h-3.5 w-3.5 text-emerald-500" />
                            Why Local Keywords?
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <p className="text-sm text-muted-foreground leading-relaxed">{result.strategy.local_rationale}</p>
                        </CardContent>
                      </Card>
                    </div>

                    <Card className="shadow-none">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Combined AEO Approach</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <p className="text-sm text-muted-foreground leading-relaxed">{result.strategy.combined_approach}</p>
                      </CardContent>
                    </Card>

                    <Card className="shadow-none">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Recommended Content Strategy</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <p className="text-sm text-muted-foreground leading-relaxed">{result.strategy.content_strategy}</p>
                      </CardContent>
                    </Card>

                    {(result.strategy.aeo_tips ?? []).length > 0 && (
                      <Card className="shadow-none">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Zap className="h-3.5 w-3.5 text-amber-500" />
                            AEO-Specific Tips
                          </CardTitle>
                          <CardDescription className="text-xs">How to get into AI-generated answers</CardDescription>
                        </CardHeader>
                        <CardContent className="pt-0 space-y-2">
                          {result.strategy.aeo_tips.map((tip, i) => (
                            <div key={i} className="flex gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                              <span className="text-xs font-black text-primary shrink-0 mt-0.5">{i + 1}</span>
                              <p className="text-sm text-muted-foreground leading-relaxed">{tip}</p>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    )}

                    {result.trace_url && (
                      <div className="text-xs text-muted-foreground">
                        Tokens used: {result.tokens_used} ·{" "}
                        <a href={result.trace_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          Langfuse trace →
                        </a>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12 text-sm text-muted-foreground">No strategy data returned.</div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>
    </div>
  );
}
