import { Link, useLocation } from "wouter";
import { MessageSquare, LayoutDashboard, Terminal, ExternalLink, Trash2, BarChart2, Activity, Calendar, Archive, Loader2, Sparkles, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHistory } from "@/contexts/history-context";
import { useGlobalChat } from "@/hooks/use-global-chat";
import { format } from "date-fns";

interface LayoutProps {
  children: React.ReactNode;
}

const TYPE_BADGE: Record<string, string> = {
  "Business Analyzer": "bg-blue-500/15 text-blue-600 border-blue-500/30",
  "Full AEO Audit":    "bg-violet-500/15 text-violet-600 border-violet-500/30",
  "Backlinks":         "bg-amber-500/15 text-amber-600 border-amber-500/30",
  "AEO Chat":          "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
};

export function Layout({ children }: LayoutProps) {
  const [location, navigate] = useLocation();
  const { entries, selectedEntry, selectEntry, clearHistory } = useHistory();
  const { loading: chatLoading, bizName: chatBizName } = useGlobalChat();

  const navItems = [
    { href: "/", label: "Chat", icon: MessageSquare },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/rankings", label: "Rankings", icon: BarChart2 },
    { href: "/health-monitor", label: "Health Monitor", icon: Activity },
    { href: "/daily-overview", label: "Daily Overview", icon: Calendar },
    { href: "/keyword-generator", label: "Keyword Generator", icon: Sparkles },
    { href: "/aeo-keyword-strategy", label: "AEO City Strategy", icon: Globe },
    { href: "/backend", label: "Backend Logs", icon: Terminal },
    { href: "/archive", label: "Archive", icon: Archive },
  ];

  const handleSelectEntry = (entry: typeof entries[number]) => {
    selectEntry(entry);
    if (location !== "/") navigate("/");
  };

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-6 border-b border-border">
          <h1 className="text-xl font-bold tracking-tight text-primary">Signal AEO LLM Platform</h1>
          <p className="text-xs text-muted-foreground mt-1">Answer Engine Optimization</p>
        </div>

        {/* AI Chat in-progress indicator */}
        {chatLoading && (
          <div className="mx-3 mb-0 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2">
            <Loader2 className="w-3 h-3 text-emerald-600 animate-spin shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-emerald-700 leading-tight">AI Chat generating…</p>
              <p className="text-[9px] text-emerald-600 truncate">{chatBizName || "Portfolio Overview"}</p>
            </div>
          </div>
        )}

        <nav className="p-4 space-y-1 border-b border-border">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer group",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                  data-testid={`nav-link-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* History section */}
        <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</span>
            {entries.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-muted-foreground hover:text-destructive transition-colors"
                title="Clear history"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {entries.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">No runs yet. Results will appear here after you run an analysis or audit.</p>
          ) : (
            <div className="px-2 pb-4 space-y-1">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => handleSelectEntry(entry)}
                  className={cn(
                    "group rounded-md px-3 py-2.5 cursor-pointer transition-colors",
                    selectedEntry?.id === entry.id
                      ? "bg-primary/10"
                      : "hover:bg-secondary/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className={cn(
                      "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                      TYPE_BADGE[entry.type] ?? "bg-muted text-muted-foreground"
                    )}>
                      {entry.type}
                    </span>
                    {entry.traceUrl && (
                      <a
                        href={entry.traceUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="Open Langfuse trace"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <p className="text-xs font-medium text-foreground truncate">{entry.businessName}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {format(new Date(entry.timestamp), "MMM d, h:mm a")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border text-xs text-muted-foreground">
          System Status: <span className="text-emerald-500 font-medium">Online</span>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
