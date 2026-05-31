import {
  useGetKeywordRotationStatus,
  useTriggerKeywordRotation,
} from "@workspace/api-client-react";
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
  Play,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

// ── Score colour helper ────────────────────────────────────────────────────────
function scoreColor(score: number): string {
  if (score >= 0.7) return "text-emerald-500";
  if (score >= 0.4) return "text-amber-500";
  return "text-rose-500";
}

function scoreBg(score: number): string {
  if (score >= 0.7) return "bg-emerald-500";
  if (score >= 0.4) return "bg-amber-500";
  return "bg-rose-500";
}

// ── Score bar ──────────────────────────────────────────────────────────────────
function ScoreBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${scoreBg(value)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-mono font-semibold w-10 text-right ${scoreColor(value)}`}>
        {pct}%
      </span>
    </div>
  );
}

// ── Keyword row ────────────────────────────────────────────────────────────────
interface KeywordItemProps {
  keyword: string;
  brand: string;
  locked: boolean;
  last_score: number;
  days_idle: number;
  consecutive_top: number;
  rotation_priority: number;
}

function KeywordRow({
  keyword,
  brand,
  locked,
  last_score,
  days_idle,
  consecutive_top,
  rotation_priority,
}: KeywordItemProps) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" title={keyword}>
            {keyword}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Brand: {brand}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {locked ? (
            <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 gap-1">
              <Lock className="w-3 h-3" />
              Top-3 Locked
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <Target className="w-3 h-3" />
              Active
            </Badge>
          )}
        </div>
      </div>

      {/* Score bar */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">AEO Visibility Score</p>
        <ScoreBar value={last_score} />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {days_idle}d idle
        </span>
        <span className="flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />
          {consecutive_top}/3 top checks
        </span>
        {!locked && (
          <span className="flex items-center gap-1 ml-auto">
            <BarChart2 className="w-3 h-3" />
            Priority: {rotation_priority.toFixed(2)}
          </span>
        )}
      </div>

      {/* Consecutive progress bar (only when unlocked and scoring) */}
      {!locked && consecutive_top > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            Consecutive top-3 checks ({consecutive_top}/3 to lock)
          </p>
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`flex-1 h-1.5 rounded-full ${
                  i < consecutive_top ? "bg-primary" : "bg-secondary"
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export function KeywordRotationPage() {
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } =
    useGetKeywordRotationStatus({
      query: { refetchInterval: 30000 },
    });

  const { mutate: triggerRun, isPending: isTriggering } =
    useTriggerKeywordRotation({
      mutation: {
        onSuccess: (res) => {
          setTriggerMsg(res.message ?? "Rotation started.");
          setTimeout(() => setTriggerMsg(null), 6000);
          setTimeout(() => refetch(), 5000);
        },
        onError: () => {
          setTriggerMsg("Failed to trigger rotation. Is the AEO LLM service running?");
          setTimeout(() => setTriggerMsg(null), 6000);
        },
      },
    });

  const clusters = data?.clusters ?? [];
  const lastUpdated = data?.last_updated
    ? format(new Date(data.last_updated), "MMM d, yyyy HH:mm")
    : "Never";

  const totalKeywords  = clusters.reduce((s, c) => s + c.total_count, 0);
  const lockedKeywords = clusters.reduce((s, c) => s + c.locked_count, 0);
  const avgScore =
    clusters.length === 0
      ? 0
      : clusters.reduce((s, c) => {
          const clusterAvg =
            c.keywords.length === 0
              ? 0
              : c.keywords.reduce((ks, k) => ks + k.last_score, 0) / c.keywords.length;
          return s + clusterAvg;
        }, 0) / clusters.length;

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-background">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Keyword Rotation</h1>
          <p className="text-muted-foreground mt-1">
            AEO visibility monitoring with automatic rotation — powered by DeepSeek + Langfuse.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => triggerRun({ data: {} })}
            disabled={isTriggering}
          >
            <Play className="w-4 h-4 mr-2" />
            {isTriggering ? "Starting…" : "Run Rotation Now"}
          </Button>
        </div>
      </div>

      {/* Trigger feedback banner */}
      {triggerMsg && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {triggerMsg}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Keywords</CardTitle>
            <Target className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? "—" : totalKeywords}</div>
            <p className="text-xs text-muted-foreground mt-1">across {clusters.length} clusters</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Locked (Top-3)</CardTitle>
            <Lock className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">{isLoading ? "—" : lockedKeywords}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {totalKeywords > 0
                ? `${Math.round((lockedKeywords / totalKeywords) * 100)}% of total`
                : "—"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Visibility</CardTitle>
            <TrendingUp className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${isLoading ? "" : scoreColor(avgScore)}`}>
              {isLoading ? "—" : `${Math.round(avgScore * 100)}%`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">across all keywords</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Last Run</CardTitle>
            <Clock className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-bold">{isLoading ? "—" : lastUpdated}</div>
            <p className="text-xs text-muted-foreground mt-1">state file timestamp</p>
          </CardContent>
        </Card>
      </div>

      {/* Error state */}
      {isError && (
        <Card className="border-rose-500/30 bg-rose-500/10">
          <CardContent className="flex items-center gap-2 pt-4 text-rose-500">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm">
              Could not load rotation data. Make sure the AEO LLM service is
              running at <code>http://localhost:8000</code>.
            </span>
          </CardContent>
        </Card>
      )}

      {/* How it works explanation */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base">How the Rotation System Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <p className="font-semibold text-foreground">1. Daily Scoring</p>
              <p>
                Each day the script queries <strong>DeepSeek</strong> with your keyword and
                calculates a visibility score (0–100%) from two signals: whether your brand
                is cited verbatim (40%) and how semantically close the answer is to your
                ground-truth answer (60%).
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-foreground">2. Lock &amp; Rotate</p>
              <p>
                If a keyword scores ≥70% for <strong>3 consecutive checks</strong> it is
                locked as "Top-3" and rotation shifts focus to the next highest-priority
                keyword in the cluster — calculated as{" "}
                <code className="text-xs">(1 − score) × (days_idle + 1)</code>.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-foreground">3. Langfuse Flywheel</p>
              <p>
                Every LLM call and score is traced in <strong>Langfuse</strong>. High-scoring
                answers are automatically used as few-shot examples on the next run, creating
                a self-improving feedback loop without fine-tuning.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cluster cards */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading keyword clusters…</div>
      ) : clusters.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>No keyword clusters found.</p>
            <p className="text-xs mt-1">
              Add clusters to{" "}
              <code className="text-xs">aeo-llm/data/keyword_clusters.yaml</code> and run the
              rotation script.
            </p>
          </CardContent>
        </Card>
      ) : (
        clusters.map((cluster) => {
          // Sort: locked → by rotation_priority desc
          const sorted = [...cluster.keywords].sort((a, b) => {
            if (a.locked !== b.locked) return a.locked ? 1 : -1;
            return b.rotation_priority - a.rotation_priority;
          });
          const nextTarget = sorted.find((k) => !k.locked);

          return (
            <Card key={cluster.cluster} className="bg-card border-border">
              <CardHeader className="flex flex-row items-start justify-between pb-4">
                <div>
                  <CardTitle className="text-base capitalize">
                    {cluster.cluster.replace(/_/g, " ")}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {cluster.locked_count}/{cluster.total_count} keywords locked
                    {nextTarget && (
                      <> · Next target: <span className="text-primary">{nextTarget.keyword}</span></>
                    )}
                  </p>
                </div>
                <Badge
                  className={
                    cluster.locked_count === cluster.total_count
                      ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                      : "bg-primary/10 text-primary border-primary/20"
                  }
                >
                  {cluster.locked_count === cluster.total_count ? "All Locked" : "In Progress"}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {sorted.map((kw) => (
                    <KeywordRow key={kw.keyword} {...kw} />
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
