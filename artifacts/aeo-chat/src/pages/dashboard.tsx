import { useState, useEffect } from "react";
import { useGetDashboardStats, useGetDashboardActivity, useGetDailyVolume } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Users, Clock, Zap, Activity, BarChart2, AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

// ── Rankings + Health Monitor summary types ───────────────────────────────────
interface RankingsSummary {
  total: number;
  platforms: string[];
  businesses: Array<{
    name: string;
    overall_latest_nrs: number | null;
    snapshot_count: number;
    last_checked: string | null;
    platform_stats: Record<string, { latest_nrs: number | null; nrs_change: number | null; latest_rank_summary: string | null }>;
  }>;
}

interface HealthSummary {
  total: number;
  summary: { improving: number; stable: number; getting_worse: number; flagged: number };
  businesses: Array<{
    name: string;
    client_name: string;
    current_status: string;
    current_health: number;
    health_change: number;
    active_flags: string[];
    track_score_latest: number | null;
  }>;
}

// ── Mini score bar ────────────────────────────────────────────────────────────
function MiniBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  const color = value >= 60 ? "bg-emerald-500" : value >= 35 ? "bg-amber-500" : "bg-rose-500";
  const textColor = value >= 60 ? "text-emerald-500" : value >= 35 ? "text-amber-500" : "text-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-[10px] font-mono w-8 text-right shrink-0", textColor)}>
        {value.toFixed(0)}
      </span>
    </div>
  );
}

export function DashboardPage() {
  const [, navigate] = useLocation();

  const { data: stats, isLoading: loadingStats } = useGetDashboardStats({ query: { refetchInterval: 30000 } });
  const { data: activity, isLoading: loadingActivity } = useGetDashboardActivity({ query: { refetchInterval: 30000 } });
  const { data: volume, isLoading: loadingVolume } = useGetDailyVolume({ query: { refetchInterval: 30000 } });

  const [rankingsData, setRankingsData] = useState<RankingsSummary | null>(null);
  const [healthData, setHealthData] = useState<HealthSummary | null>(null);
  const [loadingRankings, setLoadingRankings] = useState(true);
  const [loadingHealth, setLoadingHealth] = useState(true);

  useEffect(() => {
    fetch("/api/rankings/businesses")
      .then(r => r.json())
      .then(d => { setRankingsData(d); setLoadingRankings(false); })
      .catch(() => setLoadingRankings(false));

    fetch("/api/health-monitor/overview")
      .then(r => r.json())
      .then(d => { setHealthData(d); setLoadingHealth(false); })
      .catch(() => setLoadingHealth(false));
  }, []);

  // Top 5 rankings by latest NRS
  const topRanked = (rankingsData?.businesses ?? [])
    .filter(b => b.overall_latest_nrs !== null)
    .sort((a, b) => (b.overall_latest_nrs ?? 0) - (a.overall_latest_nrs ?? 0))
    .slice(0, 5);

  // Top 5 flagged health businesses
  const topFlagged = (healthData?.businesses ?? [])
    .filter(b => b.active_flags.length > 0)
    .slice(0, 5);

  // Top 5 improving health
  const topImproving = (healthData?.businesses ?? [])
    .filter(b => b.current_status === "🟢")
    .sort((a, b) => b.health_change - a.health_change)
    .slice(0, 5);

  const hs = healthData?.summary;

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-background">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Platform analytics, ranking health, and business performance overview.</p>
      </div>

      {/* ── Chat Stats ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Messages</CardTitle>
            <MessageSquare className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loadingStats ? "-" : stats?.totalMessages.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">{stats?.messagesLast7Days.toLocaleString()} in last 7 days</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Conversations</CardTitle>
            <Users className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loadingStats ? "-" : stats?.totalConversations.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">{stats?.conversationsToday.toLocaleString()} today</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Response Time</CardTitle>
            <Clock className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loadingStats || stats?.avgResponseTimeMs == null ? "-" : `${Math.round(stats.avgResponseTimeMs)}ms`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">End-to-end latency</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tokens Consumed</CardTitle>
            <Zap className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loadingStats ? "-" : stats?.totalTokensUsed.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Total platform usage</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Rankings + Health Monitor summary ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Health Monitor summary counts */}
        <Card
          className="cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => navigate("/health-monitor")}
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Health Monitor
              <Badge variant="outline" className="text-[10px] ml-auto">{healthData?.total ?? "—"} businesses</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loadingHealth ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : hs ? (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "🟢 Improving",    value: hs.improving,     color: "text-emerald-500" },
                  { label: "🟡 Stable",       value: hs.stable,        color: "text-amber-500" },
                  { label: "🔴 Getting Worse",value: hs.getting_worse, color: "text-rose-500" },
                  { label: "🚨 Flagged",      value: hs.flagged,       color: "text-orange-500" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="text-center border border-border rounded-md py-2">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className={cn("text-xl font-bold", color)}>{value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No data</p>
            )}
            <p className="text-[10px] text-muted-foreground mt-3 text-right">Click to open →</p>
          </CardContent>
        </Card>

        {/* Rankings summary counts */}
        <Card
          className="cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => navigate("/rankings")}
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-primary" />
              Rankings
              <Badge variant="outline" className="text-[10px] ml-auto">{rankingsData?.total ?? "—"} businesses</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loadingRankings ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : rankingsData ? (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Top 5 by NRS</p>
                {topRanked.map(b => (
                  <div key={b.name} className="flex items-center gap-2">
                    <p className="text-[10px] text-foreground truncate flex-1" title={b.name}>{b.name}</p>
                    <span className="text-[10px] font-mono text-emerald-500 shrink-0">
                      {b.overall_latest_nrs !== null ? `${Math.round(b.overall_latest_nrs * 100)}%` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No data</p>
            )}
            <p className="text-[10px] text-muted-foreground mt-3 text-right">Click to open →</p>
          </CardContent>
        </Card>

        {/* Flagged businesses quick view */}
        <Card
          className="cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => navigate("/health-monitor")}
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              Needs Attention
              <Badge variant="outline" className="text-[10px] ml-auto border-orange-500/30 text-orange-600">
                {topFlagged.length} shown
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {loadingHealth ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : topFlagged.length === 0 ? (
              <p className="text-xs text-muted-foreground">No flagged businesses</p>
            ) : topFlagged.map(b => (
              <div key={b.name} className="border border-border rounded-md p-2 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{b.current_status}</span>
                  <p className="text-[10px] font-medium text-foreground truncate flex-1">{b.name}</p>
                  <span className={cn("text-[9px] font-semibold shrink-0", b.health_change >= 0 ? "text-emerald-500" : "text-rose-500")}>
                    {b.health_change >= 0 ? "+" : ""}{b.health_change}
                  </span>
                </div>
                <MiniBar value={b.current_health} />
                {b.active_flags[0] && (
                  <p className="text-[9px] text-orange-600 truncate">{b.active_flags[0]}</p>
                )}
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground mt-1 text-right">Click to open →</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Volume chart + Activity + Health trends ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Chart */}
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader>
            <CardTitle>Daily Message Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] w-full">
              {!volume || loadingVolume ? (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">Loading chart…</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volume} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tickFormatter={(val) => format(new Date(val), 'MMM d')} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} labelFormatter={(val) => format(new Date(val), 'MMM d, yyyy')} />
                    <Bar dataKey="messageCount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="w-4 h-4" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {loadingActivity ? (
                <div className="text-center text-sm text-muted-foreground">Loading…</div>
              ) : activity?.slice(0, 8).map((item) => (
                <div key={item.id} className="flex gap-3">
                  <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-primary shrink-0" />
                  <div className="flex-1 space-y-0.5 min-w-0">
                    <p className="text-xs font-medium leading-none truncate">
                      {item.role === 'user' ? 'User · ' : 'Assistant · '}
                      <span className="text-muted-foreground font-normal">{item.conversationTitle || 'Untitled'}</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground line-clamp-1">{item.lastMessage}</p>
                    <p className="text-[9px] text-muted-foreground">{format(new Date(item.createdAt), 'h:mm a')}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Health Monitor — improving vs declining ─────────────────────────── */}
      {!loadingHealth && healthData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                Top Improving Businesses
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {topImproving.length === 0 ? (
                <p className="text-xs text-muted-foreground">No improving businesses today</p>
              ) : (
                <div className="space-y-2">
                  {topImproving.map(b => (
                    <div key={b.name} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-foreground truncate">{b.name}</p>
                        <span className="text-[10px] text-emerald-500 font-semibold shrink-0">+{b.health_change}</span>
                      </div>
                      <MiniBar value={b.current_health} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-rose-500" />
                Top Declining Businesses
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {(() => {
                const declining = (healthData.businesses ?? [])
                  .filter(b => b.current_status === "🔴")
                  .sort((a, b) => a.health_change - b.health_change)
                  .slice(0, 5);
                return declining.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No declining businesses today</p>
                ) : (
                  <div className="space-y-2">
                    {declining.map(b => (
                      <div key={b.name} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-foreground truncate">{b.name}</p>
                          <span className="text-[10px] text-rose-500 font-semibold shrink-0">{b.health_change}</span>
                        </div>
                        <MiniBar value={b.current_health} />
                      </div>
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
