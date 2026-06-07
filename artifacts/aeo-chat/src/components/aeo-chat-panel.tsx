import { useState, useEffect, useRef } from "react";
import { useGlobalChat } from "@/hooks/use-global-chat";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, X, FileDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface ChatBiz { bizName: string }
interface ChatMsg { role: "user" | "assistant"; content: string; traceUrl?: string | null }

// ── Quick prompts ──────────────────────────────────────────────────────────────
const PORTFOLIO_PROMPTS = [
  "Give me today's full portfolio health summary",
  "Which businesses need immediate attention?",
  "List all businesses in the Critical AEO tier",
  "What are the most common causes of ranking drops?",
  "Which businesses improved the most this cycle?",
  "Show me all businesses with session gaps today",
];

function bizPrompts(bizName: string) {
  return [
    `What is the ideal flow for ${bizName}?`,
    `Give me a full performance overview for ${bizName}`,
    `Why is ${bizName} declining in rankings?`,
    `What are the priority actions for ${bizName} this week?`,
    `How are sessions impacting ${bizName}'s AEO rankings?`,
    `What is the general process to improve ${bizName}'s score?`,
  ];
}

// ── PDF export from rendered chat message ─────────────────────────────────────
function exportMsgAsPdf(innerHTML: string, bizName: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const timeStr = new Date().toLocaleString("en-US");
  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>AEO Report${bizName ? ` — ${bizName}` : ""}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px 40px;color:#111827;max-width:960px;margin:0 auto;font-size:13px;line-height:1.65}
  .report-header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #111827;margin-bottom:24px}
  .report-header h1{margin:0;font-size:20px;font-weight:700}
  .report-header .meta{font-size:11px;color:#6b7280;margin-top:4px}
  .print-btn{padding:8px 18px;background:#111827;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
  h1,h2,h3,h4{font-weight:700;margin:18px 0 8px;line-height:1.3}
  h1{font-size:20px}h2{font-size:16px;border-bottom:1px solid #e5e7eb;padding-bottom:6px}h3{font-size:14px}h4{font-size:12px}
  p{margin:7px 0}
  ul,ol{padding-left:22px;margin:8px 0}li{margin:3px 0}
  strong{font-weight:600}em{font-style:italic}
  code{background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:11px;font-family:'SFMono-Regular',Consolas,monospace}
  pre{background:#f3f4f6;padding:14px;border-radius:6px;overflow-x:auto;font-size:11px}
  table{width:100%;border-collapse:collapse;font-size:12px;margin:12px 0}
  thead tr{background:#f9fafb}
  th{padding:8px 10px;text-align:left;border:1px solid #e5e7eb;font-weight:600;font-size:11px}
  td{padding:6px 10px;border:1px solid #e5e7eb;vertical-align:top}
  hr{border:none;border-top:1px solid #e5e7eb;margin:18px 0}
  blockquote{border-left:3px solid #d1d5db;margin:0;padding:8px 14px;color:#6b7280}
  .report-footer{margin-top:32px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between}
  @media print{.print-btn{display:none!important}.report-header{page-break-after:avoid}}
</style>
</head>
<body>
<div class="report-header">
  <div>
    <h1>AEO Analysis Report</h1>
    <p class="meta">${bizName ? `Business: ${bizName} · ` : "Portfolio Overview · "}${dateStr}</p>
  </div>
  <button class="print-btn" onclick="window.print()">⬇ Save as PDF</button>
</div>
${innerHTML}
<div class="report-footer">
  <span>Signal AEO Dashboard</span>
  <span>Generated: ${timeStr}</span>
</div>
<script>window.onload=function(){window.print();}</script>
</body>
</html>`);
  win.document.close();
}

// ── AeoChatPanel ───────────────────────────────────────────────────────────────
export function AeoChatPanel({
  businesses,
  initialBizName,
}: {
  businesses: ChatBiz[];
  initialBizName?: string | null;
}) {
  const { messages, loading, bizName, setBizName, send: globalSend, clear } = useGlobalChat();
  const [input, setInput] = useState("");
  const bottomRef         = useRef<HTMLDivElement>(null);
  const msgRefs           = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (initialBizName !== undefined && initialBizName !== null && initialBizName !== bizName) {
      setBizName(initialBizName);
      clear();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBizName]);

  function send(text: string) {
    setInput("");
    globalSend(text);
  }

  const quickPrompts = bizName ? bizPrompts(bizName) : PORTFOLIO_PROMPTS;
  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Selector + clear ─────────────────────────────────── */}
      <div className="p-3 border-b border-border space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          <select
            value={bizName}
            onChange={e => { setBizName(e.target.value); clear(); }}
            className="flex-1 text-xs border border-border rounded px-2 h-7 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            <option value="">📊 Portfolio Overview</option>
            {businesses.map(b => (
              <option key={b.bizName} value={b.bizName}>{b.bizName}</option>
            ))}
          </select>
          {messages.length > 0 && (
            <button
              onClick={clear}
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 shrink-0"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>

        {/* Quick chips when conversation is active */}
        {!isEmpty && (
          <div className="flex gap-1.5 flex-wrap">
            {quickPrompts.slice(0, 3).map(p => (
              <button
                key={p}
                onClick={() => send(p)}
                disabled={loading}
                className="text-[9px] border border-border rounded-full px-2 py-0.5 text-muted-foreground hover:bg-secondary/60 disabled:opacity-40 transition-colors truncate max-w-[230px]"
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Messages ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {isEmpty ? (
          <div className="py-6 space-y-4 text-center">
            <div className="text-3xl">🤖</div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {bizName ? `Ask anything about ${bizName}` : "Ask about any business or the portfolio"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
                I have full context — health scores, rankings, session data, flags, and can generate ideal flows and weekly action plans.
              </p>
            </div>
            <div className="space-y-1.5 text-left max-w-sm mx-auto">
              {quickPrompts.map(p => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  disabled={loading}
                  className="w-full text-left text-[10px] border border-border rounded-lg px-3 py-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-40 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}>
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs shrink-0 mt-0.5">🤖</div>
              )}
              <div className="flex flex-col gap-1 max-w-[88%]">
                <div className={cn(
                  "rounded-xl px-3 py-2 text-xs leading-relaxed",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-none"
                    : "bg-secondary text-foreground rounded-tl-none",
                )}>
                  {msg.role === "assistant" ? (
                    <div
                      ref={el => { msgRefs.current[i] = el; }}
                      className="prose prose-sm dark:prose-invert max-w-none text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mt-2 [&_h4]:text-[11px] [&_h4]:font-semibold [&_h4]:mt-1.5 [&_strong]:font-semibold [&_code]:text-[10px] [&_code]:bg-background/60 [&_code]:px-1 [&_code]:rounded [&_table]:text-[10px] [&_th]:font-semibold [&_td]:py-0.5"
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : msg.content}
                </div>

                {/* PDF + Langfuse links — assistant messages only */}
                {msg.role === "assistant" && !msg.content.startsWith("Could not reach") && !msg.content.startsWith("Request timed out") && (
                  <div className="self-start flex items-center gap-3">
                    <button
                      onClick={() => {
                        const el = msgRefs.current[i];
                        if (el) exportMsgAsPdf(el.innerHTML, bizName);
                      }}
                      className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-primary transition-colors px-1 py-0.5 rounded hover:bg-secondary/60"
                      title="Download this response as PDF"
                    >
                      <FileDown className="w-3 h-3" />
                      Download PDF
                    </button>
                    {msg.traceUrl && (
                      <a
                        href={msg.traceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-violet-600 transition-colors px-1 py-0.5 rounded hover:bg-secondary/60"
                        title="View this trace in Langfuse"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Langfuse trace
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="flex gap-2 items-center">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs shrink-0">🤖</div>
            <div className="bg-secondary rounded-xl rounded-tl-none px-3 py-2 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Analyzing data…</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ────────────────────────────────────────────── */}
      <div className="p-3 border-t border-border shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder={bizName ? `Ask about ${bizName}…` : "Ask about any business or the portfolio…"}
            disabled={loading}
            className="flex-1 text-xs border border-border rounded-lg px-3 h-8 bg-background focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="h-8 w-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-opacity"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[9px] text-muted-foreground mt-1.5 text-center">
          Responses use live rankings, session, and AEO health score data · Click "Download PDF" under any response to export
        </p>
      </div>
    </div>
  );
}
