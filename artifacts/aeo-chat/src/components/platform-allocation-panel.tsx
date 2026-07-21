import { useState } from "react";
import { cn } from "@/lib/utils";
import { Search, ChevronDown, ChevronRight, Loader2, RotateCcw, Save, AlertTriangle } from "lucide-react";

// ── Types (mirrors artifacts/api-server/src/lib/platform-allocation.ts) ────────
export type AllocationStatus = "COMPLETE" | "DEVIATION" | "PARTIAL" | "MISSED";
export type PlatformAllocStatus = "MET" | "SHORT" | "EXCESS" | "ZERO";

export interface PlatformAllocationEntry {
  actual: number;
  target: number;
  status: PlatformAllocStatus;
}

export interface PlatformAllocationDay {
  date: string;
  totalActual: number;
  totalExpected: number;
  status: AllocationStatus;
  chatgpt: PlatformAllocationEntry;
  gemini: PlatformAllocationEntry;
  perplexity: PlatformAllocationEntry;
}

export interface CampaignAllocation {
  campaignId: string;
  campaignName: string;
  bizName: string;
  clientName: string;
  target: {
    expectedSessions: number;
    chatgptTarget: number;
    geminiTarget: number;
    perplexityTarget: number;
    mode: "auto" | "fixed";
  };
  today: PlatformAllocationDay;
  platformGaps: string[];
  history: PlatformAllocationDay[];
}

export interface AllocationSummary {
  COMPLETE: number;
  DEVIATION: number;
  PARTIAL: number;
  MISSED: number;
  platformGap: number;
  excess: number;
}

// ── Shared config ────────────────────────────────────────────────────────────
export const STATUS_CFG: Record<AllocationStatus, { label: string; emoji: string; text: string; bg: string; ring: string; dot: string }> = {
  COMPLETE:  { label: "Complete",  emoji: "✅", text: "text-emerald-700", bg: "bg-emerald-50 dark:bg-emerald-950/40", ring: "border-emerald-400", dot: "bg-emerald-500" },
  DEVIATION: { label: "Deviation", emoji: "⚠️", text: "text-amber-700",   bg: "bg-amber-50 dark:bg-amber-950/40",   ring: "border-amber-400",   dot: "bg-amber-500" },
  PARTIAL:   { label: "Partial",   emoji: "🟠", text: "text-orange-700",  bg: "bg-orange-50 dark:bg-orange-950/40", ring: "border-orange-400",  dot: "bg-orange-500" },
  MISSED:    { label: "Missed",    emoji: "🚨", text: "text-blue-700",    bg: "bg-blue-50 dark:bg-blue-950/40",     ring: "border-blue-400",    dot: "bg-blue-500" },
};

const PLATFORM_TEXT: Record<"chatgpt" | "gemini" | "perplexity", { label: string; text: string }> = {
  chatgpt:    { label: "ChatGPT",    text: "text-emerald-700" },
  gemini:     { label: "Gemini",     text: "text-blue-700" },
  perplexity: { label: "Perplexity", text: "text-violet-700" },
};

function platformStatusColor(status: PlatformAllocStatus): string {
  switch (status) {
    case "MET": return "text-emerald-600";
    case "SHORT": return "text-amber-600 font-bold";
    case "EXCESS": return "text-violet-600 font-bold";
    case "ZERO": return "text-blue-600 font-bold";
  }
}

// ── Summary tiles ────────────────────────────────────────────────────────────
export function AllocationSummaryTiles({
  summary, activeFilter, onFilterChange,
}: {
  summary: AllocationSummary;
  activeFilter: AllocationStatus | "PLATFORM_GAP" | "all";
  onFilterChange: (f: AllocationStatus | "PLATFORM_GAP" | "all") => void;
}) {
  const tiles: { key: AllocationStatus | "PLATFORM_GAP"; label: string; emoji: string; val: number; cfg: { text: string; bg: string; ring: string } }[] = [
    { key: "COMPLETE", label: "Complete", emoji: "✅", val: summary.COMPLETE, cfg: STATUS_CFG.COMPLETE },
    { key: "DEVIATION", label: "Deviation", emoji: "⚠️", val: summary.DEVIATION, cfg: STATUS_CFG.DEVIATION },
    { key: "PARTIAL", label: "Partial", emoji: "🟠", val: summary.PARTIAL, cfg: STATUS_CFG.PARTIAL },
    { key: "MISSED", label: "Missed", emoji: "🚨", val: summary.MISSED, cfg: STATUS_CFG.MISSED },
    { key: "PLATFORM_GAP", label: "Platform Gap", emoji: "🕳️", val: summary.platformGap, cfg: { text: "text-blue-700", bg: "bg-blue-50 dark:bg-blue-950/40", ring: "border-blue-400" } },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {tiles.map((t) => {
        const active = activeFilter === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onFilterChange(active ? "all" : t.key)}
            className={cn(
              "rounded-lg border-2 p-3 text-left transition-all hover:shadow-sm",
              active ? t.cfg.ring : "border-border/40",
              active ? t.cfg.bg : "bg-transparent",
            )}
          >
            <p className={cn("text-[9px] font-semibold uppercase tracking-wide", t.cfg.text)}>{t.emoji} {t.label}</p>
            <p className="text-2xl font-bold mt-0.5">{t.val}</p>
          </button>
        );
      })}
    </div>
  );
}

// ── Editable target row ──────────────────────────────────────────────────────
function TargetEditor({
  campaign, onSaved, onCancel,
}: {
  campaign: CampaignAllocation;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [expected, setExpected] = useState(campaign.target.expectedSessions);
  const [chatgpt, setChatgpt] = useState(campaign.target.chatgptTarget);
  const [gemini, setGemini] = useState(campaign.target.geminiTarget);
  const [perplexity, setPerplexity] = useState(campaign.target.perplexityTarget);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sum = chatgpt + gemini + perplexity;
  const sumOk = sum === expected;

  const save = async () => {
    if (!sumOk) { setError(`Targets must sum to expected sessions (${chatgpt} + ${gemini} + ${perplexity} = ${sum}, expected ${expected})`); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform-allocation/${encodeURIComponent(campaign.campaignId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedSessions: expected, chatgptTarget: chatgpt, geminiTarget: gemini, perplexityTarget: perplexity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const resetToAuto = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform-allocation/${encodeURIComponent(campaign.campaignId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to reset");
    } finally {
      setSaving(false);
    }
  };

  const NumField = ({ label, value, onChange, colorText }: { label: string; value: number; onChange: (n: number) => void; colorText: string }) => (
    <div>
      <label className={cn("text-[9px] font-semibold uppercase tracking-wide", colorText)}>{label}</label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
        className="mt-0.5 w-full h-7 text-xs rounded border border-border bg-background px-2 focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );

  return (
    <div className="p-3 bg-muted/30 border-t border-border/50 space-y-2">
      <div className="grid grid-cols-4 gap-2">
        <NumField label="Expected/day" value={expected} onChange={setExpected} colorText="text-foreground" />
        <NumField label="ChatGPT target" value={chatgpt} onChange={setChatgpt} colorText={PLATFORM_TEXT.chatgpt.text} />
        <NumField label="Gemini target" value={gemini} onChange={setGemini} colorText={PLATFORM_TEXT.gemini.text} />
        <NumField label="Perplexity target" value={perplexity} onChange={setPerplexity} colorText={PLATFORM_TEXT.perplexity.text} />
      </div>
      {!sumOk && (
        <p className="text-[10px] text-amber-600 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          ChatGPT + Gemini + Perplexity must equal Expected sessions ({chatgpt} + {gemini} + {perplexity} = {sum}, expected {expected})
        </p>
      )}
      {error && <p className="text-[10px] text-blue-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving || !sumOk}
          className={cn(
            "flex items-center gap-1 text-[10px] font-semibold rounded px-2.5 py-1 border transition-colors",
            saving || !sumOk ? "border-border text-muted-foreground cursor-not-allowed" : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
          )}
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
        </button>
        {campaign.target.mode === "fixed" && (
          <button
            onClick={resetToAuto}
            disabled={saving}
            className="flex items-center gap-1 text-[10px] font-medium rounded px-2.5 py-1 border border-border text-muted-foreground hover:bg-muted"
          >
            <RotateCcw className="w-3 h-3" /> Reset to auto
          </button>
        )}
        <button onClick={onCancel} className="text-[10px] font-medium text-muted-foreground hover:text-foreground px-2 py-1">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Platform cell ────────────────────────────────────────────────────────────
function PlatformCell({ entry, label }: { entry: PlatformAllocationEntry; label: string }) {
  return (
    <div className="text-center">
      <p className={cn("text-[9px] font-semibold uppercase tracking-wide", PLATFORM_TEXT[label as keyof typeof PLATFORM_TEXT]?.text ?? "text-muted-foreground")}>
        {label}
      </p>
      <p className={cn("text-xs font-mono", platformStatusColor(entry.status))}>
        {entry.actual}/{entry.target}
      </p>
    </div>
  );
}

// ── Main table ───────────────────────────────────────────────────────────────
export function AllocationTable({
  campaigns, filter, search, onSaved, showBizName = true,
}: {
  campaigns: CampaignAllocation[];
  filter: AllocationStatus | "PLATFORM_GAP" | "all";
  search: string;
  onSaved: () => void;
  showBizName?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = campaigns.filter((c) => {
    if (filter === "PLATFORM_GAP" && c.platformGaps.length === 0) return false;
    if (filter !== "all" && filter !== "PLATFORM_GAP" && c.today.status !== filter) return false;
    if (search && !`${c.bizName} ${c.campaignName}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (filtered.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-8">No campaigns match this filter.</p>;
  }

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      <div className="max-h-[600px] overflow-y-auto divide-y divide-border/30">
        {filtered.map((c) => {
          const cfg = STATUS_CFG[c.today.status];
          const isOpen = expanded === c.campaignId;
          return (
            <div key={c.campaignId}>
              <button
                onClick={() => setExpanded(isOpen ? null : c.campaignId)}
                className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-muted/30 transition-colors"
              >
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                <div className="min-w-0 flex-1">
                  {showBizName && <p className="text-xs font-semibold truncate" title={c.bizName}>{c.bizName}</p>}
                  <p className="text-[10px] text-muted-foreground truncate" title={c.campaignName}>{c.campaignName || "—"}</p>
                </div>
                <div className="shrink-0 flex items-center gap-4">
                  {c.platformGaps.length > 0 && (
                    <span className="text-[9px] font-semibold text-blue-600 flex items-center gap-1" title={`${c.platformGaps.join(", ")} — 0 sessions for 3 consecutive expected-run days`}>
                      <AlertTriangle className="w-3 h-3" /> Gap: {c.platformGaps.join(", ")}
                    </span>
                  )}
                  <div className="text-center w-14">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
                    <p className="text-xs font-mono font-bold">{c.today.totalActual}/{c.today.totalExpected}</p>
                  </div>
                  <PlatformCell entry={c.today.chatgpt} label="chatgpt" />
                  <PlatformCell entry={c.today.gemini} label="gemini" />
                  <PlatformCell entry={c.today.perplexity} label="perplexity" />
                  <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 w-24 text-center", cfg.text, cfg.bg, cfg.ring)}>
                    {cfg.emoji} {cfg.label}
                  </span>
                </div>
              </button>
              {isOpen && (
                <TargetEditor campaign={c} onSaved={() => { onSaved(); }} onCancel={() => setExpanded(null)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AllocationSearchBar({ search, onSearchChange }: { search: string; onSearchChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
      <input
        placeholder="Filter campaigns by business or campaign name…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="pl-8 h-8 text-xs w-full rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}
