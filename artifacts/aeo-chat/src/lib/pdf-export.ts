import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true } as Parameters<typeof marked.setOptions>[0]);

function mdToHtml(content: string): string {
  return marked.parse(content) as string;
}

const BRAND_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px; color: #111827; background: #fff; padding: 32px 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 18px; border-bottom: 2px solid #111827; margin-bottom: 24px; }
  .brand { font-size: 18px; font-weight: 700; color: #111827; }
  .brand-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .meta { text-align: right; font-size: 11px; color: #6b7280; }
  .meta strong { color: #111827; font-size: 13px; display: block; margin-bottom: 2px; }
  .badge { display: inline-block; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 20px; padding: 2px 8px; font-size: 10px; font-weight: 600; color: #374151; margin-right: 4px; }
  .badge-blue { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
  .badge-green { background: #f0fdf4; border-color: #bbf7d0; color: #15803d; }
  .badge-red { background: #fef2f2; border-color: #fecaca; color: #dc2626; }
  .badge-amber { background: #fffbeb; border-color: #fde68a; color: #b45309; }
  .section { margin-bottom: 28px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; }
  .card-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
  .card-sub { font-size: 11px; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; padding: 7px 10px; background: #f9fafb; border-bottom: 2px solid #e5e7eb; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; }
  td { padding: 8px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #f9fafb; }
  .score-box { display: inline-block; background: #111827; color: #fff; border-radius: 6px; padding: 2px 8px; font-weight: 700; font-size: 13px; }
  .highlight { background: #f0fdf4; border-left: 3px solid #16a34a; padding: 10px 14px; border-radius: 0 6px 6px 0; font-size: 12px; }
  .warning { background: #fffbeb; border-left: 3px solid #f59e0b; padding: 10px 14px; border-radius: 0 6px 6px 0; font-size: 12px; }
  .mono { font-family: 'Courier New', monospace; font-size: 11px; background: #f9fafb; padding: 8px 12px; border-radius: 6px; border: 1px solid #e5e7eb; white-space: pre-wrap; word-break: break-all; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .kv-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
  .kv-row:last-child { border-bottom: none; }
  .kv-label { color: #6b7280; }
  .kv-value { font-weight: 600; }
  .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 10px; color: #9ca3af; }
  .chat-body { font-size: 12px; line-height: 1.7; color: #111827; }
  .chat-body h1, .chat-body h2, .chat-body h3, .chat-body h4 { font-weight: 700; margin: 14px 0 6px; line-height: 1.3; color: #111827; }
  .chat-body h1 { font-size: 16px; } .chat-body h2 { font-size: 14px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; } .chat-body h3 { font-size: 13px; } .chat-body h4 { font-size: 12px; }
  .chat-body p { margin: 6px 0; }
  .chat-body ul, .chat-body ol { padding-left: 20px; margin: 6px 0; }
  .chat-body li { margin: 2px 0; }
  .chat-body strong { font-weight: 600; }
  .chat-body em { font-style: italic; }
  .chat-body code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 11px; font-family: 'SFMono-Regular', Consolas, monospace; }
  .chat-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }
  .chat-body blockquote { border-left: 3px solid #d1d5db; margin: 8px 0; padding: 6px 12px; color: #6b7280; }
  .chat-body table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 10px 0; }
  .chat-body thead tr { background: #f9fafb; }
  .chat-body th { padding: 7px 10px; text-align: left; border: 1px solid #e5e7eb; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
  .chat-body td { padding: 6px 10px; border: 1px solid #e5e7eb; vertical-align: top; }
  @media print {
    body { padding: 20px 28px; }
    .no-print { display: none !important; }
    @page { margin: 0.6in 0.5in; size: A4; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    .section { page-break-inside: avoid; }
  }
`;

function header(title: string, subtitle: string, date: string): string {
  return `
    <div class="header">
      <div>
        <div class="brand">Signal AEO LLM Platform</div>
        <div class="brand-sub">Answer Engine Optimization — Internal Report</div>
      </div>
      <div class="meta">
        <strong>${title}</strong>
        ${subtitle ? `<span>${subtitle}</span><br>` : ""}
        <span>Generated: ${date}</span>
      </div>
    </div>`;
}

function footer(): string {
  return `<div class="footer"><span>Signal AEO LLM Platform — Internal Use Only</span><span>Confidential</span></div>`;
}

export function openPrintWindow(title: string, subtitle: string, bodyHtml: string): void {
  const date = new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title><style>${BRAND_CSS}</style></head><body>
    ${header(title, subtitle, date)}
    ${bodyHtml}
    ${footer()}
    <script>window.onload = () => { window.print(); }<\/script>
  </body></html>`;
  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

// ── Per-tab PDF builders ──────────────────────────────────────────────────────

export function buildAnalyzerPdf(data: any, businessName: string): string {
  const score = data?.aeo_score;
  const keywords = data?.keywords ?? [];
  const backlinks = data?.backlinks ?? [];
  const recommended = data?.recommended_prompt;

  const scoreSection = score ? `
    <div class="section">
      <div class="section-title">AEO Score</div>
      <div class="two-col">
        <div class="card">
          <div style="font-size:32px;font-weight:700;color:#111827">${score.overall ?? "—"}<span style="font-size:14px;color:#6b7280">/10</span></div>
          <div style="font-size:11px;color:#6b7280;margin-top:4px">Overall AEO Score</div>
        </div>
        <div class="card">
          ${["answer_first","citability","clarity","structured_data"].map(k =>
            `<div class="kv-row"><span class="kv-label">${k.replace(/_/g," ")}</span><span class="kv-value">${score[k] ?? "—"}/10</span></div>`
          ).join("")}
        </div>
      </div>
      ${score.rationale ? `<div class="highlight">${score.rationale}</div>` : ""}
    </div>` : "";

  const summary = data?.summary ? `
    <div class="section">
      <div class="section-title">Summary</div>
      <div class="card"><p>${data.summary}</p></div>
    </div>` : "";

  const kwSection = keywords.length > 0 ? `
    <div class="section">
      <div class="section-title">Keywords (${keywords.length})</div>
      <table>
        <thead><tr><th>Keyword</th><th>Intent</th><th>Priority</th><th>Score</th><th>Best Prompt</th></tr></thead>
        <tbody>${keywords.map((k: any) => `
          <tr>
            <td><strong>${k.phrase}</strong></td>
            <td><span class="badge">${k.intent}</span></td>
            <td><span class="badge ${k.priority === "high" ? "badge-green" : k.priority === "medium" ? "badge-blue" : ""}">${k.priority}</span></td>
            <td>${k.score}</td>
            <td style="font-size:11px;color:#6b7280">${k.best_prompt || "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : "";

  const blSection = backlinks.length > 0 ? `
    <div class="section">
      <div class="section-title">Backlink Targets (${backlinks.length})</div>
      <table>
        <thead><tr><th>Site</th><th>Type</th><th>Reason</th></tr></thead>
        <tbody>${backlinks.map((b: any) => `
          <tr><td><strong>${b.site}</strong></td><td><span class="badge">${b.type}</span></td><td style="font-size:11px">${b.reason}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>` : "";

  const recSection = recommended?.prompt ? `
    <div class="section">
      <div class="section-title">Recommended Prompt</div>
      <div class="mono">${recommended.prompt}</div>
      ${recommended.reason ? `<div class="card-sub" style="margin-top:8px">${recommended.reason}</div>` : ""}
    </div>` : "";

  return `${summary}${scoreSection}${kwSection}${blSection}${recSection}`;
}

export function buildAuditPdf(data: any, businessName: string, websiteUrl?: string, location?: string): string {
  const keywords = data?.keywords ?? [];
  const backlinks = data?.backlink_strategy ?? [];
  const prompt = data?.example_prompt;
  const searches = data?.required_searches;

  const meta = `
    <div class="section">
      <div class="section-title">Business Details</div>
      <div class="card">
        <div class="kv-row"><span class="kv-label">Business Name</span><span class="kv-value">${businessName}</span></div>
        ${websiteUrl ? `<div class="kv-row"><span class="kv-label">Website</span><span class="kv-value">${websiteUrl}</span></div>` : ""}
        ${location ? `<div class="kv-row"><span class="kv-label">Location</span><span class="kv-value">${location}</span></div>` : ""}
        <div class="kv-row"><span class="kv-label">Business Type</span><span class="kv-value">${data?.business_type || "—"}</span></div>
        <div class="kv-row"><span class="kv-label">Business Size</span><span class="kv-value">${data?.business_size || "—"}</span></div>
      </div>
    </div>`;

  const kwSection = keywords.length > 0 ? `
    <div class="section">
      <div class="section-title">Keyword ICE Scores</div>
      <table>
        <thead><tr><th>Keyword</th><th style="text-align:center">Impact</th><th style="text-align:center">Confidence</th><th style="text-align:center">Effort</th><th style="text-align:center">ICE</th><th style="text-align:center">Priority</th></tr></thead>
        <tbody>${keywords.map((k: any) => `
          <tr>
            <td><strong>${k.keyword}</strong></td>
            <td style="text-align:center">${k.impact}</td>
            <td style="text-align:center">${k.confidence}</td>
            <td style="text-align:center">${k.effort}</td>
            <td style="text-align:center"><strong>${k.weighted_ice?.toFixed(2)}</strong></td>
            <td style="text-align:center"><span class="badge ${k.priority === "high" ? "badge-green" : k.priority === "medium" ? "badge-blue" : ""}">${k.priority}</span></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : "";

  const promptSection = prompt?.text ? `
    <div class="section">
      <div class="section-title">Example AEO Prompt</div>
      <div class="mono">${prompt.text}</div>
      <div class="two-col" style="margin-top:10px">
        <div class="card">
          <div class="kv-row"><span class="kv-label">PQS Score</span><span class="kv-value">${prompt.pqs_score?.toFixed(2) ?? "—"}</span></div>
          <div class="kv-row"><span class="kv-label">PC Average</span><span class="kv-value">${prompt.pc_avg?.toFixed(2) ?? "—"}</span></div>
          <div class="kv-row"><span class="kv-label">RC Average</span><span class="kv-value">${prompt.rc_avg?.toFixed(2) ?? "—"}</span></div>
          <div class="kv-row"><span class="kv-label">Meets Threshold</span><span class="kv-value">${prompt.meets_threshold ? "✓ Yes" : "✗ No"}</span></div>
        </div>
        ${searches ? `<div class="card">
          <div class="kv-row"><span class="kv-label">Total Prompts</span><span class="kv-value">${searches.total_prompts}</span></div>
          <div class="kv-row"><span class="kv-label">Weekly Prompts</span><span class="kv-value">${searches.weekly_prompts}</span></div>
          ${searches.formula_used ? `<div style="margin-top:8px;font-size:10px;color:#6b7280;font-family:monospace">${searches.formula_used}</div>` : ""}
        </div>` : ""}
      </div>
    </div>` : "";

  const blSection = backlinks.length > 0 ? `
    <div class="section">
      <div class="section-title">Backlink Strategy (${backlinks.length} sources)</div>
      <table>
        <thead><tr><th>Source Type</th><th style="text-align:center">BQS</th><th style="text-align:center">Clickable</th><th>Reasoning</th></tr></thead>
        <tbody>${backlinks.map((b: any) => `
          <tr>
            <td><strong>${b.source_type}</strong></td>
            <td style="text-align:center">${b.estimated_bqs?.toFixed(2) ?? "—"}</td>
            <td style="text-align:center">${b.clickable ? "Yes" : "No"}</td>
            <td style="font-size:11px">${b.reasoning}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : "";

  const disclaimer = data?.disclaimer ? `<div class="warning">${data.disclaimer}</div>` : "";

  return `${meta}${kwSection}${promptSection}${blSection}${disclaimer}`;
}

export function buildBacklinksPdf(data: any): string {
  const links = data?.self_creatable_backlinks ?? [];
  const audit = data?.hallucination_self_audit;

  const intro = `
    <div class="section">
      <div class="section-title">Overview</div>
      <div class="card">
        <div class="kv-row"><span class="kv-label">Business Type</span><span class="kv-value">${data?.business_type || "—"}</span></div>
        <div class="kv-row"><span class="kv-label">Target Keyword</span><span class="kv-value">${data?.target_keyword || "—"}</span></div>
        <div class="kv-row"><span class="kv-label">Target URL</span><span class="kv-value">${data?.target_url || "—"}</span></div>
      </div>
      ${data?.strategy_summary ? `<div class="highlight" style="margin-top:10px">${data.strategy_summary}</div>` : ""}
    </div>`;

  const linksSection = links.length > 0 ? `
    <div class="section">
      <div class="section-title">Self-Creatable Backlinks (${links.length})</div>
      ${links.map((l: any, i: number) => `
        <div class="card" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
            <div class="card-title">${i + 1}. ${l.platform_name}</div>
            <div>
              <span class="badge ${l.relevance === "high" ? "badge-green" : l.relevance === "medium" ? "badge-blue" : ""}">${l.relevance}</span>
              <span class="badge">DA ${l.domain_authority_estimate}</span>
              <span class="badge">${l.effort}</span>
            </div>
          </div>
          <div class="card-sub" style="margin-bottom:6px">${l.type} · ${l.do_follow ? "DoFollow" : "NoFollow"}</div>
          <p style="font-size:12px;margin-bottom:6px"><strong>Why it works:</strong> ${l.why_this_works}</p>
          <p style="font-size:11px;color:#374151"><strong>Instructions:</strong> ${l.instructions}</p>
        </div>`).join("")}
    </div>` : "";

  const auditSection = audit ? `
    <div class="section">
      <div class="section-title">Hallucination Self-Audit</div>
      <div class="card">
        <div class="kv-row"><span class="kv-label">Confidence Score</span><span class="kv-value">${audit.overall_confidence_score}</span></div>
        <div class="kv-row"><span class="kv-label">Verified Real Domains</span><span class="kv-value">${audit.opportunities_with_verified_real_domains} / ${audit.total_opportunities_generated}</span></div>
        ${audit.audit_notes ? `<div style="margin-top:8px;font-size:11px;color:#6b7280">${audit.audit_notes}</div>` : ""}
      </div>
    </div>` : "";

  return `${intro}${linksSection}${auditSection}`;
}

export function buildChatPdf(messages: any[], conversationTitle: string): string {
  if (messages.length === 0) return "<p>No messages in this conversation.</p>";
  return `
    <div class="section">
      <div class="section-title">Conversation — ${conversationTitle}</div>
      ${messages.map((m: any) => `
        <div class="card" style="margin-bottom:8px;border-left:3px solid ${m.role === "user" ? "#6366f1" : "#16a34a"}">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:${m.role === "user" ? "#6366f1" : "#15803d"};margin-bottom:8px">
            ${m.role === "user" ? "You" : "Signal AEO Assistant"}
            ${m.createdAt ? ` · ${new Date(m.createdAt).toLocaleTimeString()}` : ""}
          </div>
          <div class="chat-body">${m.role === "assistant" ? mdToHtml(m.content ?? "") : `<p>${(m.content ?? "").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>`}</div>
        </div>`).join("")}
    </div>`;
}

// ── Per-item PDF builders ─────────────────────────────────────────────────────

export function buildSingleAuditKeyword(kw: any, businessName: string): string {
  const ease = 6 - (kw.effort ?? 0);
  const priorityColor = kw.priority === "high" ? "#15803d" : kw.priority === "medium" ? "#1d4ed8" : "#6b7280";
  return `
    <div class="section">
      <div class="section-title">Business</div>
      <div class="card"><span class="kv-label">Name:</span> <strong>${businessName}</strong></div>
    </div>
    <div class="section">
      <div class="section-title">Keyword ICE Score</div>
      <div class="card">
        <div style="font-size:20px;font-weight:700;margin-bottom:12px">${kw.keyword}</div>
        <div class="kv-row"><span class="kv-label">Impact</span><span class="kv-value">${kw.impact} / 5</span></div>
        <div class="kv-row"><span class="kv-label">Confidence</span><span class="kv-value">${kw.confidence} / 5</span></div>
        <div class="kv-row"><span class="kv-label">Effort</span><span class="kv-value">${kw.effort} / 5</span></div>
        <div class="kv-row"><span class="kv-label">Ease (6 − Effort)</span><span class="kv-value">${ease}</span></div>
        <div class="kv-row" style="border-top:2px solid #e5e7eb;margin-top:8px;padding-top:8px">
          <span class="kv-label">Weighted ICE</span>
          <span class="kv-value" style="font-size:18px">${kw.weighted_ice?.toFixed(2) ?? "—"}</span>
        </div>
        <div class="kv-row">
          <span class="kv-label">Priority</span>
          <span class="kv-value" style="color:${priorityColor}">${kw.priority?.toUpperCase()}</span>
        </div>
      </div>
    </div>`;
}

export function buildSingleAuditPrompt(prompt: any, searches: any, businessName: string): string {
  return `
    <div class="section">
      <div class="section-title">Business</div>
      <div class="card"><span class="kv-label">Name:</span> <strong>${businessName}</strong></div>
    </div>
    <div class="section">
      <div class="section-title">Example AEO Prompt</div>
      <div class="mono">${(prompt?.text ?? "—").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
      <div class="card" style="margin-top:12px">
        <div class="kv-row"><span class="kv-label">PQS Score</span><span class="kv-value">${prompt?.pqs_score?.toFixed(2) ?? "—"}</span></div>
        <div class="kv-row"><span class="kv-label">PC Average</span><span class="kv-value">${prompt?.pc_avg?.toFixed(2) ?? "—"}</span></div>
        <div class="kv-row"><span class="kv-label">RC Average</span><span class="kv-value">${prompt?.rc_avg?.toFixed(2) ?? "—"}</span></div>
        <div class="kv-row"><span class="kv-label">Meets Threshold</span><span class="kv-value">${prompt?.meets_threshold ? "✓ Yes" : "✗ No"}</span></div>
      </div>
    </div>
    ${searches ? `
    <div class="section">
      <div class="section-title">Required Search Volume</div>
      <div class="card">
        <div class="kv-row"><span class="kv-label">Total Prompts</span><span class="kv-value">${searches.total_prompts ?? "—"}</span></div>
        <div class="kv-row"><span class="kv-label">Weekly Prompts</span><span class="kv-value">${searches.weekly_prompts ?? "—"}</span></div>
        ${searches.formula_used ? `<div style="margin-top:8px;font-size:10px;font-family:monospace;color:#6b7280">${searches.formula_used}</div>` : ""}
      </div>
    </div>` : ""}`;
}

export function buildSingleBacklinkOpp(opp: any, index: number, targetKeyword: string): string {
  return `
    <div class="section">
      <div class="section-title">Target Keyword</div>
      <div class="card"><strong>${targetKeyword}</strong></div>
    </div>
    <div class="section">
      <div class="section-title">Backlink Opportunity #${index + 1}</div>
      <div class="card">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px">${opp.platform_name}</div>
        <div class="kv-row"><span class="kv-label">URL</span><span class="kv-value" style="font-size:11px">${opp.platform_url || "—"}</span></div>
        <div class="kv-row"><span class="kv-label">Type</span><span class="kv-value">${opp.type}</span></div>
        <div class="kv-row"><span class="kv-label">Relevance</span><span class="kv-value">${opp.relevance}</span></div>
        <div class="kv-row"><span class="kv-label">Domain Authority (est.)</span><span class="kv-value">${opp.domain_authority_estimate}</span></div>
        <div class="kv-row"><span class="kv-label">Link Type</span><span class="kv-value">${opp.do_follow ? "DoFollow" : "NoFollow"}</span></div>
        <div class="kv-row"><span class="kv-label">Effort</span><span class="kv-value">${opp.effort}</span></div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Why This Works</div>
      <div class="highlight">${opp.why_this_works || "—"}</div>
    </div>
    <div class="section">
      <div class="section-title">Step-by-Step Instructions</div>
      <div class="card" style="white-space:pre-wrap;font-size:12px;line-height:1.7">${(opp.instructions || "—").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
    </div>
    ${opp.competitor_insight ? `
    <div class="section">
      <div class="section-title">Competitor Insight</div>
      <div class="card-sub" style="font-size:12px">${opp.competitor_insight}</div>
    </div>` : ""}`;
}

export function buildSingleLinkProspect(p: any, targetKeyword: string): string {
  const cig = p.content_insertion_guide;
  return `
    <div class="section">
      <div class="section-title">Target Keyword</div>
      <div class="card"><strong>${targetKeyword}</strong></div>
    </div>
    <div class="section">
      <div class="section-title">Link Prospect #${p.rank}</div>
      <div class="card">
        <div style="font-size:16px;font-weight:700;margin-bottom:10px">${p.website_url}</div>
        <div class="kv-row"><span class="kv-label">Injection Type</span><span class="kv-value">${p.injection_type}</span></div>
        <div class="kv-row"><span class="kv-label">Domain Authority (est.)</span><span class="kv-value">${p.domain_authority_estimate}</span></div>
        <div class="kv-row"><span class="kv-label">Relevance Score</span><span class="kv-value">${p.relevance_score?.toFixed(1) ?? "—"}</span></div>
        <div class="kv-row"><span class="kv-label">Link Type</span><span class="kv-value">${p.do_follow ? "DoFollow" : "NoFollow"}</span></div>
        <div class="kv-row"><span class="kv-label">Click Probability</span><span class="kv-value">${p.click_probability}</span></div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Why This Prospect</div>
      <div class="highlight">${p.reason || "—"}</div>
    </div>
    ${cig ? `
    <div class="section">
      <div class="section-title">Content Insertion Guide</div>
      <div class="card">
        <div class="kv-row"><span class="kv-label">Target Page Type</span><span class="kv-value">${cig.target_page_type || "—"}</span></div>
        <div class="kv-row"><span class="kv-label">Anchor Text</span><span class="kv-value"><code style="background:#f3f4f6;padding:1px 5px;border-radius:3px">${cig.suggested_anchor_text || "—"}</code></span></div>
        ${cig.insertion_context ? `<div style="margin-top:10px"><div class="kv-label" style="margin-bottom:4px">Insertion Context</div><div class="mono">${cig.insertion_context.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div></div>` : ""}
        ${cig.value_to_host ? `<div style="margin-top:8px"><div class="kv-label" style="margin-bottom:4px">Value to Host</div><div style="font-size:12px;color:#374151">${cig.value_to_host}</div></div>` : ""}
      </div>
    </div>` : ""}
    <div class="section">
      <div class="section-title">Existence Evidence</div>
      <div class="card-sub" style="font-size:12px;font-style:italic">${p.existence_evidence || "—"}</div>
    </div>`;
}

export function buildSingleChatMessage(msg: any, convTitle: string): string {
  const isUser = msg.role === "user";
  const accentColor = isUser ? "#6366f1" : "#16a34a";
  const label = isUser ? "You" : "Signal AEO Assistant";
  const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
  return `
    <div class="section">
      <div class="section-title">Conversation: ${convTitle}</div>
    </div>
    <div class="card" style="border-left:4px solid ${accentColor}">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:${accentColor};margin-bottom:10px">
        ${label}${time ? ` · ${time}` : ""}
      </div>
      <div class="chat-body">${isUser ? `<p style="font-size:13px;line-height:1.75">${(msg.content ?? "").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>` : mdToHtml(msg.content ?? "")}</div>
    </div>`;
}
