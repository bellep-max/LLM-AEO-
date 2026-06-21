import { useState } from "react";
import {
  Loader2, MapPin, Building2, TrendingUp, Zap, Target, Globe,
  Search, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

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

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AEOKeywordStrategyPage() {
  const [selectedCities, setSelectedCities] = useState<string[]>(["New York", "Los Angeles", "Chicago", "Miami", "Atlanta", "Houston"]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(BUSINESS_CATEGORIES);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AEOStrategyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("local");
  const [activeCategory, setActiveCategory] = useState<string>("");

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
      <main className="flex-1 overflow-y-auto">
        {/* Empty state */}
        {!loading && !result && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-4">
            <Globe className="h-12 w-12 text-muted-foreground/30" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">No strategy generated yet</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
                Select cities and business categories on the left, then click Generate to build your AEO keyword strategy for AI answer engines.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-2 text-center">
              {["ChatGPT", "Perplexity", "Google AI", "Claude", "Gemini", "Bing AI"].map(engine => (
                <div key={engine} className="rounded-lg border bg-muted/30 px-3 py-2">
                  <div className="text-[11px] font-medium text-muted-foreground">{engine}</div>
                </div>
              ))}
            </div>
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
          <div className="p-6 space-y-4">

            {/* Stats bar */}
            <div className="grid grid-cols-4 gap-3">
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

            {/* Main tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-9">
                <TabsTrigger value="local" className="text-xs">Local Areas</TabsTrigger>
                <TabsTrigger value="cities" className="text-xs">City Profiles</TabsTrigger>
                <TabsTrigger value="keywords" className="text-xs">AEO Keywords</TabsTrigger>
                <TabsTrigger value="strategy" className="text-xs">Strategy &amp; Tips</TabsTrigger>
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
