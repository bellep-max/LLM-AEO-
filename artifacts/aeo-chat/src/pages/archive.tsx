import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, RotateCcw, Building2, AlertCircle, CheckCircle2 } from "lucide-react";

interface ArchiveData {
  archived: string[];
  total: number;
}

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api";

async function fetchArchive(): Promise<ArchiveData> {
  const res = await fetch(`${API}/csv/archive`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function reactivate(bizName: string): Promise<void> {
  const res = await fetch(`${API}/csv/archive/${encodeURIComponent(bizName)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export function ArchivePage() {
  const qc = useQueryClient();
  const [reactivated, setReactivated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["archive"],
    queryFn: fetchArchive,
    staleTime: 10_000,
  });

  const mutation = useMutation({
    mutationFn: reactivate,
    onSuccess: (_data, bizName) => {
      qc.invalidateQueries({ queryKey: ["archive"] });
      qc.invalidateQueries({ queryKey: ["csv-daily-overview"] });
      qc.invalidateQueries({ queryKey: ["csv-sessions-overview"] });
      qc.invalidateQueries({ queryKey: ["csv-rankings-businesses"] });
      setReactivated(bizName);
      setError(null);
      setTimeout(() => setReactivated(null), 4000);
    },
    onError: (err: Error) => {
      setError(err.message);
      setTimeout(() => setError(null), 5000);
    },
  });

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="max-w-3xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <Archive className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Business Archive</h1>
            <p className="text-sm text-muted-foreground">
              Free trial businesses removed from all analysis. Reactivate to restore full tracking.
            </p>
          </div>
        </div>

        {/* Toast notifications */}
        {reactivated && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span><strong>{reactivated}</strong> has been reactivated and will appear in all dashboards.</span>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Stats bar */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
          <Building2 className="w-4 h-4" />
          <span>
            {isLoading ? "Loading…" : `${data?.total ?? 0} archived business${(data?.total ?? 0) !== 1 ? "es" : ""}`}
          </span>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : !data?.archived.length ? (
          <div className="text-center py-16 text-muted-foreground">
            <Archive className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No archived businesses</p>
            <p className="text-xs mt-1">All businesses are currently active in the analysis.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.archived.map((bizName) => (
              <div
                key={bizName}
                className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-card hover:bg-secondary/30 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-sm font-medium truncate">{bizName}</span>
                </div>
                <button
                  onClick={() => mutation.mutate(bizName)}
                  disabled={mutation.isPending && mutation.variables === bizName}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0 ml-4"
                >
                  <RotateCcw className="w-3 h-3" />
                  {mutation.isPending && mutation.variables === bizName ? "Reactivating…" : "Reactivate"}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Info box */}
        {(data?.archived.length ?? 0) > 0 && (
          <div className="px-4 py-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
            <strong>How reactivation works:</strong> Clicking "Reactivate" immediately restores the business to all dashboards — Rankings, Daily Overview, Health Monitor, and AI Chat analysis. The server cache is cleared automatically so the change takes effect on the next page refresh.
          </div>
        )}
      </div>
    </div>
  );
}
