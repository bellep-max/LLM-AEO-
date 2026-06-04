import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Lock,
  RefreshCw,
  Target,
  TrendingUp,
  Clock,
  BarChart2,
  AlertCircle,
  Hash,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────────
interface RankingKeyword {
  keyword: string;
  priority: number;
  locked: boolean;
  locked_since: string | null;
  top3_days: number | null;
  top3_stability: number | null;
  current_rank: number | null;
}

interface RankingStatus {
  last_run: string | null;
  selected_keyword: string | null;
  generated_content: string | null;
  keywords: RankingKeyword[];
  total_keywords: number;
  locked_count: number;
  active_count: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function stabilityColor(v: number): string {
  if (v >= 0.7) return "text-emerald-500";
  if (v >= 0.4) return "text-amber-500";
  return "text-rose-500";
}
function stabilityBg(v: number): string {
  if (v >= 0.7) return "bg-emerald-500";
  if (v >= 0.4) return "bg-amber-500";
  return "bg-rose-500";
}
function rankBadgeClass(rank: number | null): string {
  if (rank === null) return "bg-secondary text-muted-foreground border-border";
  if (rank <= 1)     return "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
  if (rank <= 3)     return "bg-blue-500/15 text-blue-500 border-blue-500/30";
  return "bg-secondary text-muted-foreground border-border";
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function StabilityBar({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-xs text-muted-foreground">No data yet</span>;
  }
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${stabilityBg(value)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-mono font-semibold w-10 text-right ${stabilityColor(value)}`}>
        {pct}%
      </span>
    </div>
  );
}

function KeywordCard({ kw, isSelected }: { kw: RankingKeyword; isSelected: boolean }) {
  return (
    <div
      className={`border rounded-lg p-4 space-y-3 transition-colors ${
        isSelected
          ? "border-primary/50 bg-primary/5"
          : "border-border"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isSelected && <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />}
            <p className="text-sm font-medium truncate" title={kw.keyword}>
              {kw.keyword}
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Priority #{kw.priority}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Current rank badge */}
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${rankBadgeClass(kw.current_rank)}`}>
            <Hash className="w-3 h-3" />
            {kw.current_rank ?? "–"}
          </span>
          {/* Lock badge */}
          {kw.locked ? (
            <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 gap-1">
              <Lock className="w-3 h-3" />
              Locked
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <Target className="w-3 h-3" />
              Active
            </Badge>
          )}
        </div>
      </div>

      {/* Top-3 stability bar */}
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">
          Top-3 Stability
          {kw.top3_days !== null && (
            <span className="ml-1 font-medium text-foreground">
              ({kw.top3_days}/7 days)
            </span>
          )}
        </p>
        <StabilityBar value={kw.top3_stability} />
      </div>

      {/* Lock info */}
      {kw.locked && kw.locked_since && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Locked since {format(new Date(kw.locked_since), "MMM d, yyyy")}
        </p>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export function KeywordRotationPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<RankingStatus>({
    queryKey: ["keyword-rotation-ranking"],
    queryFn: async () => {
      const res = await fetch("/api/keyword-rotation/ranking-status");
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const keywords      = data?.keywords ?? [];
  const selectedKw    = data?.selected_keyword ?? null;
  const lastRun       = data?.last_run
    ? format(new Date(data.last_run), "MMM d, yyyy")
    : "Never";

  // Sort: selected first, then active by current_rank, then locked
  const sorted = [...keywords].sort((a, b) => {
    if (a.keyword === selectedKw) return -1;
    if (b.keyword === selectedKw) return  1;
    if (a.locked !== b.locked)   return a.locked ? 1 : -1;
    const ra = a.current_rank ?? 999;
    const rb = b.current_rank ?? 999;
    return ra - rb;
  });

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-background">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Keyword Rotation</h1>
          <p className="text-muted-foreground mt-1">
            5-of-7 rule — keywords ranking top-3 for 5+ days are locked. Active keyword with the
            lowest position is selected for AEO content generation.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Keywords</CardTitle>
            <Target className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? "—" : data?.total_keywords ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">in keywords.json</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Locked (Top-3)</CardTitle>
            <Lock className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">
              {isLoading ? "—" : data?.locked_count ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data && data.total_keywords > 0
                ? `${Math.round(((data.locked_count) / data.total_keywords) * 100)}% of total`
                : "—"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Selected Today</CardTitle>
            <TrendingUp className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-bold truncate">{isLoading ? "—" : selectedKw ?? "None"}</div>
            <p className="text-xs text-muted-foreground mt-1">lowest active rank</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Last Run</CardTitle>
            <Clock className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-bold">{isLoading ? "—" : lastRun}</div>
            <p className="text-xs text-muted-foreground mt-1">
              <BarChart2 className="inline w-3 h-3 mr-1" />
              ChatGPT · 7-day window
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Error state */}
      {isError && (
        <Card className="border-rose-500/30 bg-rose-500/10">
          <CardContent className="flex items-center gap-2 pt-4 text-rose-500">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm">
              Could not load rotation data. Run the script first:{" "}
              <code className="text-xs">python3 automation/keyword_rotation.py</code>
            </span>
          </CardContent>
        </Card>
      )}

      {/* Keyword grid */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading keyword data…</div>
      ) : keywords.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <p className="font-medium">No keywords found.</p>
            <p className="text-xs">
              Add keywords to <code>automation/keywords.json</code> and run{" "}
              <code>python3 automation/keyword_rotation.py</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Keywords — Last 7-Day Window
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sorted.map((kw) => (
              <KeywordCard
                key={kw.keyword}
                kw={kw}
                isSelected={kw.keyword === selectedKw}
              />
            ))}
          </div>
        </div>
      )}

      {/* Generated content */}
      {data?.generated_content && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Generated AEO Content
              {selectedKw && (
                <Badge variant="outline" className="ml-2 text-xs font-normal">
                  {selectedKw}
                </Badge>
              )}
              {data.last_run && (
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {format(new Date(data.last_run), "MMM d, yyyy")}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
              {data.generated_content}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* How it works */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base">How the 5-of-7 Rotation Works</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-muted-foreground">
          <div className="space-y-1">
            <p className="font-semibold text-foreground">1. Fetch Rankings</p>
            <p>
              Each day the script pulls the last <strong>7 days</strong> of ranking data from
              your AEO ranking API (<code className="text-xs">rankingPosition</code> field) for
              every keyword.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-foreground">2. 5-of-7 Lock Rule</p>
            <p>
              If a keyword had <code className="text-xs">rankingPosition ≤ 3</code> on 5 or
              more of those 7 days, it's marked <strong>Locked</strong>. No content is
              generated for locked keywords.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-foreground">3. Select &amp; Generate</p>
            <p>
              Among active keywords, the one with the <strong>lowest current rank</strong> is
              selected. DeepSeek generates AEO-optimized content using the keyword's
              ground-truth answer as the factual anchor.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
