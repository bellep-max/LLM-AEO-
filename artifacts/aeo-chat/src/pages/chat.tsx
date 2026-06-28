import { useState, useRef, useEffect, useCallback } from "react";

// ── localStorage helpers ──────────────────────────────────────────────────────
const LS = {
  get: <T,>(key: string): T | null => {
    try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; }
    catch { return null; }
  },
  set: (key: string, val: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  },
  del: (key: string) => { try { localStorage.removeItem(key); } catch {} },
};
const LS_VIEW      = "aeo-active-view";
const LS_BIZ_NAME  = "aeo-biz-name";
const LS_BIZ_DESC  = "aeo-biz-desc";
const LS_ANALYSIS  = "aeo-analysis-result";
const LS_AUDIT     = "aeo-audit-result";
const LS_BACKLINKS = "aeo-backlinks-result";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Plus, Trash2, TerminalSquare, Sparkles, Link2, Target, RotateCcw, FileDown } from "lucide-react";
import {
  openPrintWindow,
  buildAnalyzerPdf,
  buildAuditPdf,
  buildBacklinksPdf,
  buildChatPdf,
  buildSingleAuditKeyword,
  buildSingleAuditPrompt,
  buildSingleBacklinkOpp,
  buildSingleLinkProspect,
  buildSingleChatMessage,
} from "@/lib/pdf-export";
import {
  useListOpenaiConversations,
  getListOpenaiConversationsQueryKey,
  useCreateOpenaiConversation,
  useDeleteOpenaiConversation,
  useListOpenaiMessages,
  getListOpenaiMessagesQueryKey,
  useInjectKeywordCluster,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useHistory } from "@/contexts/history-context";

type AnalysisKeyword = {
  phrase: string;
  intent: string;
  priority: string;
  score: number;
  best_prompt?: string;
  prompt_score?: number;
  prompt_tuning_type?: string;
  prompt_tuning_reason?: string;
};

type AnalysisBacklink = {
  site: string;
  type: string;
  reason: string;
};

type BusinessAnalysisResult = {
  data: {
    business_name?: string;
    summary?: string;
    keywords?: AnalysisKeyword[];
    aeo_score?: {
      overall?: number;
      answer_first?: number;
      citability?: number;
      clarity?: number;
      structured_data?: number;
      rationale?: string;
    };
    backlinks?: AnalysisBacklink[];
    recommended_prompt?: {
      prompt?: string;
      score?: number;
      reason?: string;
    };
  };
  tokens_used: number;
  trace_url?: string | null;
};

type AuditKeyword = {
  keyword: string;
  impact: number;
  confidence: number;
  ease: number;
  ease_adj: number;
  ice: number;
  found_on_site: boolean;
  priority: string;
  // legacy compat
  effort?: number;
  weighted_ice?: number;
};

type BacklinkOpportunity = {
  platform_name: string;
  platform_url: string;
  type: string;
  domain_authority_estimate: number;
  relevance: "high" | "medium" | "low";
  do_follow: boolean;
  effort: string;
  instructions: string;
  competitor_insight: string;
  why_this_works: string;
};

type LinkProspect = {
  rank: number;
  website_url: string;
  injection_type: string;
  domain_authority_estimate: number;
  relevance_score: number;
  do_follow: boolean;
  click_probability: "high" | "medium" | "low";
  reason: string;
  existence_evidence: string;
  content_insertion_guide?: {
    target_page_type?: string;
    suggested_anchor_text?: string;
    insertion_context?: string;
    value_to_host?: string;
  };
};

type LinkProspectsResult = {
  data: {
    target_keyword?: string;
    target_url?: string;
    prospects?: LinkProspect[];
    conclusion?: string;
    hallucination_self_audit?: {
      total_prospects_generated?: number;
      prospects_with_high_certainty?: number;
      any_domain_excluded_due_to_uncertainty?: boolean;
      domains_i_am_uncertain_about?: string[];
      overall_confidence_score?: number;
      audit_notes?: string;
    };
  };
  tokens_used: number;
  trace_url?: string | null;
};

type ContentWriterResult = {
  content: string;
  tokens_used: number;
  trace_url?: string | null;
};

type BacklinksResult = {
  data: {
    business_type?: string;
    target_keyword?: string;
    target_url?: string;
    competitors_analysed?: string[];
    self_creatable_backlinks?: BacklinkOpportunity[];
    strategy_summary?: string;
    hallucination_self_audit?: {
      total_opportunities_generated?: number;
      opportunities_with_verified_real_domains?: number;
      any_platform_excluded_due_to_uncertainty?: boolean;
      platforms_i_am_uncertain_about?: string[];
      overall_confidence_score?: number;
      audit_notes?: string;
    };
  };
  tokens_used: number;
  trace_url?: string | null;
};

type BusinessAuditResult = {
  data: {
    // v2 fields
    executive_summary?: {
      ars?: number;
      ars_status?: "Green" | "Amber" | "Red";
      ars_calculation?: string;
      summary?: string;
    };
    local_advantage?: {
      la_value?: number;
      rule_applied?: string;
      ease_boost_applied?: boolean;
      summary?: string;
    };
    keywords?: AuditKeyword[];
    content_coverage?: {
      ccs?: number;
      keywords_found?: number;
      keywords_total?: number;
      found_keywords?: string[];
      missing_keywords?: string[];
    };
    website_analysis?: {
      url?: string;
      ssl?: boolean;
      mobile_responsive?: boolean;
      word_count?: number;
      meta_title?: string;
      meta_description?: string;
      h1s?: string[];
      wqm_adjustments?: string[];
      wqm_pc_adj?: number;
      overview?: string;
    };
    pqs?: {
      pc_avg_base?: number;
      pc_avg_adjusted?: number;
      rc_avg?: number;
      pqs_score?: number;
      meets_threshold?: boolean;
      example_prompt?: string;
    };
    required_searches?: {
      competitor_count?: number;
      ymyl_penalty?: number;
      la_value?: number;
      weekly_prompts?: number;
      formula_used?: string;
      // legacy compat
      total_prompts?: number;
    };
    location_analysis?: {
      location?: string;
      market_overview?: string;
      local_aeo_opportunities?: string[];
      location_optimization_score?: number;
    };
    recommendations?: {
      priority?: number;
      action?: string;
      impact?: string;
      effort?: string;
      rationale?: string;
    }[];
    disclaimer?: string;
    // legacy v1 compat
    business_type?: string;
    business_size?: string;
    example_prompt?: { text?: string; pqs_score?: number; pc_avg?: number; rc_avg?: number; meets_threshold?: boolean; };
    backlink_strategy?: { source_type?: string; clickable?: boolean; estimated_bqs?: number; reasoning?: string; }[];
    website_analysis_legacy?: unknown;
  };
  tokens_used: number;
  trace_url?: string | null;
};

type ActiveView = "analyzer" | "analysis" | "backlinks" | "chat";

export function ChatPage() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>(() => LS.get<ActiveView>(LS_VIEW) ?? "analyzer");
  const [input, setInput] = useState("");
  const [businessName, setBusinessName] = useState<string>(() => LS.get<string>(LS_BIZ_NAME) ?? "");
  const [businessDescription, setBusinessDescription] = useState<string>(() => LS.get<string>(LS_BIZ_DESC) ?? "");
  const [analysisResult, setAnalysisResult] = useState<BusinessAnalysisResult | null>(() => LS.get<BusinessAnalysisResult>(LS_ANALYSIS));
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [injectMessage, setInjectMessage] = useState<string | null>(null);
  // ── Backlinks tab ──────────────────────────────────────────────────────────
  const [blSubTab, setBlSubTab]               = useState<"self-create" | "prospects" | "content-writer">("self-create");
  const [blBusinessType, setBlBusinessType]   = useState("local");
  const [blKeyword, setBlKeyword]             = useState("");
  const [blTargetUrl, setBlTargetUrl]         = useState("");
  const [blCompetitors, setBlCompetitors]     = useState("");
  const [backlinksResult, setBacklinksResult] = useState<BacklinksResult | null>(() => LS.get<BacklinksResult>(LS_BACKLINKS));
  const [backlinksError, setBacklinksError]   = useState<string | null>(null);
  const [isGeneratingBl, setIsGeneratingBl]   = useState(false);
  const [expandedBl, setExpandedBl]           = useState<number | null>(null);
  // ── Link Prospects sub-tab ─────────────────────────────────────────────────
  const [lpKeyword, setLpKeyword]                     = useState("");
  const [lpTargetUrl, setLpTargetUrl]                 = useState("");
  const [lpResult, setLpResult]                       = useState<LinkProspectsResult | null>(null);
  const [lpError, setLpError]                         = useState<string | null>(null);
  const [isGeneratingLp, setIsGeneratingLp]           = useState(false);
  const [expandedLp, setExpandedLp]                   = useState<number | null>(null);
  // ── Content Writer sub-tab ─────────────────────────────────────────────────
  const [cwPlatform, setCwPlatform]           = useState("forum comment");
  const [cwTargetUrl, setCwTargetUrl]         = useState("");
  const [cwAnchor, setCwAnchor]               = useState("");
  const [cwTopic, setCwTopic]                 = useState("");
  const [cwStyle, setCwStyle]                 = useState("casual");
  const [cwResult, setCwResult]               = useState<ContentWriterResult | null>(null);
  const [cwError, setCwError]                 = useState<string | null>(null);
  const [isGeneratingCw, setIsGeneratingCw]   = useState(false);
  const [cwCopied, setCwCopied]               = useState(false);
  // ── Inject into existing content ──────────────────────────────────────────
  const [ciExisting, setCiExisting]           = useState("");
  const [ciTargetUrl, setCiTargetUrl]         = useState("");
  const [ciAnchor, setCiAnchor]               = useState("");
  const [ciResult, setCiResult]               = useState<ContentWriterResult | null>(null);
  const [ciError, setCiError]                 = useState<string | null>(null);
  const [isInjectingCi, setIsInjectingCi]     = useState(false);
  const [ciCopied, setCiCopied]               = useState(false);
  // ── Audit form (Full AEO Audit + Backlinks tabs) ───────────────────────────
  const [businessType, setBusinessType] = useState("B2B SaaS");
  const [businessTypeOther, setBusinessTypeOther] = useState("");
  const [businessSize, setBusinessSize] = useState("small");
  const [competitorDensity, setCompetitorDensity] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [location, setLocation] = useState("");
  const [auditResult, setAuditResult] = useState<BusinessAuditResult | null>(() => LS.get<BusinessAuditResult>(LS_AUDIT));
  const [auditError, setAuditError] = useState<string | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { addEntry, selectedEntry, selectEntry } = useHistory();

  // ── Persist state so navigating away and back restores everything ─────────
  useEffect(() => { LS.set(LS_VIEW, activeView); }, [activeView]);
  useEffect(() => { LS.set(LS_BIZ_NAME, businessName); }, [businessName]);
  useEffect(() => { LS.set(LS_BIZ_DESC, businessDescription); }, [businessDescription]);
  useEffect(() => { analysisResult  ? LS.set(LS_ANALYSIS,  analysisResult)  : LS.del(LS_ANALYSIS);  }, [analysisResult]);
  useEffect(() => { auditResult     ? LS.set(LS_AUDIT,     auditResult)     : LS.del(LS_AUDIT);     }, [auditResult]);
  useEffect(() => { backlinksResult ? LS.set(LS_BACKLINKS, backlinksResult) : LS.del(LS_BACKLINKS); }, [backlinksResult]);

  const { data: conversations = [], isLoading: loadingConversations } = useListOpenaiConversations();
  const { data: messages = [], isLoading: loadingMessages } = useListOpenaiMessages(
    activeId ?? 0,
    { query: { enabled: !!activeId, queryKey: getListOpenaiMessagesQueryKey(activeId ?? 0) } }
  );

  const createConv = useCreateOpenaiConversation();
  const deleteConv = useDeleteOpenaiConversation();
  const injectCluster = useInjectKeywordCluster();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  // Restore result view when a history entry is selected from the sidebar
  useEffect(() => {
    if (!selectedEntry) return;
    if (selectedEntry.type === "Business Analyzer") {
      setAnalysisResult(selectedEntry.result as BusinessAnalysisResult);
      setActiveView("analyzer");
    } else if (selectedEntry.type === "Full AEO Audit") {
      setAuditResult(selectedEntry.result as BusinessAuditResult);
      setActiveView("analysis");
    } else if (selectedEntry.type === "Backlinks") {
      setBacklinksResult(selectedEntry.result as BacklinksResult);
      setActiveView("backlinks");
    } else if (selectedEntry.type === "AEO Chat") {
      setActiveView("chat");
    }
    selectEntry(null); // consume so re-selecting same entry works again
  }, [selectedEntry]);

  const [clearAllConfirm, setClearAllConfirm] = useState(false);

  const handleNewConversation = () => {
    setActiveView("chat");
    setActiveId(null);
  };

  const clearAnalyzer = () => {
    setBusinessName("");
    setBusinessDescription("");
    setAnalysisResult(null);
    setAnalysisError(null);
    LS.del(LS_BIZ_NAME); LS.del(LS_BIZ_DESC); LS.del(LS_ANALYSIS);
  };

  const clearAudit = () => {
    setBusinessName("");
    setBusinessDescription("");
    setBusinessType("B2B SaaS");
    setBusinessTypeOther("");
    setBusinessSize("small");
    setCompetitorDensity("");
    setWebsiteUrl("");
    setLocation("");
    setAuditResult(null);
    setAuditError(null);
    LS.del(LS_BIZ_NAME); LS.del(LS_BIZ_DESC); LS.del(LS_AUDIT);
  };

  const clearSelfCreatable = () => {
    setBlKeyword("");
    setBlTargetUrl("");
    setBlCompetitors("");
    setBlBusinessType("local");
    setBacklinksResult(null);
    setBacklinksError(null);
    setExpandedBl(null);
    LS.del(LS_BACKLINKS);
  };

  const clearLinkProspects = () => {
    setLpKeyword("");
    setLpTargetUrl("");
    setLpResult(null);
    setLpError(null);
    setExpandedLp(null);
  };

  const clearContentWriter = () => {
    setCwTargetUrl("");
    setCwAnchor("");
    setCwTopic("");
    setCwResult(null);
    setCwError(null);
    setCwCopied(false);
  };

  const clearInjectContent = () => {
    setCiExisting("");
    setCiTargetUrl("");
    setCiAnchor("");
    setCiResult(null);
    setCiError(null);
    setCiCopied(false);
  };

  const handleClearAll = async () => {
    if (!clearAllConfirm) { setClearAllConfirm(true); return; }
    setClearAllConfirm(false);
    await fetch("/api/openai/conversations", { method: "DELETE" });
    setActiveId(null);
    queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
  };

  const handleDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteConv.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
        if (activeId === id) setActiveId(null);
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userContent = input.trim();
    setInput("");

    let targetId = activeId;

    if (!targetId) {
      try {
        const newConv = await createConv.mutateAsync({
          data: { title: userContent.substring(0, 50) + (userContent.length > 50 ? "..." : "") }
        });
        targetId = newConv.id;
        setActiveId(targetId);
        queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
      } catch (e) {
        console.error("Failed to create conversation", e);
        return;
      }
    }

    queryClient.setQueryData(getListOpenaiMessagesQueryKey(targetId), (old: any) => {
      return [...(old || []), { id: Date.now(), role: "user", content: userContent, createdAt: new Date().toISOString() }];
    });

    setIsStreaming(true);
    setStreamingText("");

    try {
      const res = await fetch(`/api/openai/conversations/${targetId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userContent })
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);

        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          if (!jsonStr) continue;
          try {
            const json = JSON.parse(jsonStr);
            if (json.done) break;
            if (json.content) setStreamingText(prev => prev + json.content);
          } catch {
            // ignore parse errors in SSE stream
          }
        }
      }
    } catch (error) {
      console.error("Streaming error", error);
    } finally {
      setIsStreaming(false);
      queryClient.invalidateQueries({ queryKey: getListOpenaiMessagesQueryKey(targetId) });
      queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
    }
  };

  const handleAnalyzeBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessName.trim() || !businessDescription.trim() || isAnalyzing) return;

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const res = await fetch("/api/openai/business-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          description: businessDescription.trim(),
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Business analysis failed");
      }

      setAnalysisResult(payload as BusinessAnalysisResult);
      setActiveView("analysis");
      addEntry({
        type: "Business Analyzer",
        businessName: (payload as BusinessAnalysisResult).data?.business_name || businessName,
        traceUrl: (payload as BusinessAnalysisResult).trace_url,
        result: payload,
      });
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Business analysis failed");
      setAnalysisResult(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleInjectToRotation = () => {
    if (!analysisData) return;
    const name = analysisData.business_name || businessName;
    injectCluster.mutate({
      data: {
        business_name: name,
        brand: name,
        keywords: (analysisData.keywords ?? []).map((kw) => ({
          keyword: kw.phrase,
          ground_truth: kw.best_prompt || kw.phrase,
        })),
        backlinks: (analysisData.backlinks ?? []).map((bl) => ({
          site: bl.site,
          type: bl.type,
          reason: bl.reason,
        })),
      },
    }, {
      onSuccess: (res) => {
        setInjectMessage(res.message ?? `${res.keyword_count} keywords injected into rotation cluster "${res.cluster}".`);
        setTimeout(() => setInjectMessage(null), 8000);
      },
      onError: () => {
        setInjectMessage("Inject failed — is the AEO LLM service running at localhost:8000?");
        setTimeout(() => setInjectMessage(null), 8000);
      },
    });
  };

  const handleRunAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessName.trim() || !businessDescription.trim() || isAuditing) return;
    setIsAuditing(true);
    setAuditError(null);
    try {
      const res = await fetch("/api/openai/business-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          description: businessDescription.trim(),
          businessType: businessType === "other" && businessTypeOther.trim()
            ? businessTypeOther.trim()
            : businessType,
          businessSize,
          competitorDensity,
          websiteUrl: websiteUrl.trim() || undefined,
          location: location.trim() || undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Audit failed");
      setAuditResult(payload as BusinessAuditResult);
      addEntry({
        type: "Full AEO Audit",
        businessName,
        traceUrl: (payload as BusinessAuditResult).trace_url,
        result: payload,
      });
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : "Audit failed");
      setAuditResult(null);
    } finally {
      setIsAuditing(false);
    }
  };

  const handleInjectAuditToRotation = () => {
    if (!auditResult?.data) return;
    const name = businessName;
    injectCluster.mutate({
      data: {
        business_name: name,
        brand: name,
        keywords: (auditResult.data.keywords ?? []).map((kw) => ({
          keyword: kw.keyword,
          ground_truth: auditResult.data.example_prompt?.text || kw.keyword,
        })),
        backlinks: (auditResult.data.backlink_strategy ?? []).map((bl) => ({
          source_type: bl.source_type,
          clickable: bl.clickable,
          estimated_bqs: bl.estimated_bqs,
          reasoning: bl.reasoning,
        })),
      },
    }, {
      onSuccess: (res) => {
        setInjectMessage(res.message ?? `${res.keyword_count} keywords injected into cluster "${res.cluster}".`);
        setTimeout(() => setInjectMessage(null), 8000);
      },
      onError: () => {
        setInjectMessage("Inject failed — is the AEO LLM service running at localhost:8000?");
        setTimeout(() => setInjectMessage(null), 8000);
      },
    });
  };

  const handleGenerateBacklinks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blKeyword.trim() || !blTargetUrl.trim() || isGeneratingBl) return;
    setIsGeneratingBl(true);
    setBacklinksError(null);
    setExpandedBl(null);
    try {
      const res = await fetch("/api/openai/generate-backlinks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessType: blBusinessType,
          targetKeyword: blKeyword.trim(),
          targetUrl: blTargetUrl.trim(),
          competitorUrls: blCompetitors.trim(),
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Backlinks generation failed");
      setBacklinksResult(payload as BacklinksResult);
      addEntry({
        type: "Backlinks",
        businessName: blKeyword.trim(),
        traceUrl: (payload as BacklinksResult).trace_url ?? null,
        result: payload,
      });
    } catch (err) {
      setBacklinksError(err instanceof Error ? err.message : "Failed to generate backlinks");
      setBacklinksResult(null);
    } finally {
      setIsGeneratingBl(false);
    }
  };

  const handleGenerateLinkProspects = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lpKeyword.trim() || !lpTargetUrl.trim() || isGeneratingLp) return;
    setIsGeneratingLp(true);
    setLpError(null);
    setExpandedLp(null);
    try {
      const res = await fetch("/api/openai/generate-link-prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetKeyword: lpKeyword.trim(), targetUrl: lpTargetUrl.trim() }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Link prospects generation failed");
      setLpResult(payload as LinkProspectsResult);
    } catch (err) {
      setLpError(err instanceof Error ? err.message : "Failed to generate link prospects");
      setLpResult(null);
    } finally {
      setIsGeneratingLp(false);
    }
  };

  const handleGenerateContent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cwTargetUrl.trim() || !cwTopic.trim() || isGeneratingCw) return;
    setIsGeneratingCw(true);
    setCwError(null);
    setCwCopied(false);
    try {
      const res = await fetch("/api/openai/generate-backlink-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformType: cwPlatform,
          targetUrl: cwTargetUrl.trim(),
          topic: cwTopic.trim(),
          anchorText: cwAnchor.trim(),
          writingStyle: cwStyle,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Content generation failed");
      setCwResult(payload as ContentWriterResult);
    } catch (err) {
      setCwError(err instanceof Error ? err.message : "Failed to generate content");
      setCwResult(null);
    } finally {
      setIsGeneratingCw(false);
    }
  };

  const handleInjectBacklink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ciExisting.trim() || !ciTargetUrl.trim() || isInjectingCi) return;
    setIsInjectingCi(true);
    setCiError(null);
    setCiCopied(false);
    try {
      const res = await fetch("/api/openai/inject-backlink-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          existingContent: ciExisting.trim(),
          targetUrl: ciTargetUrl.trim(),
          anchorText: ciAnchor.trim(),
          platformType: cwPlatform,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Injection failed");
      setCiResult(payload as ContentWriterResult);
    } catch (err) {
      setCiError(err instanceof Error ? err.message : "Injection failed");
      setCiResult(null);
    } finally {
      setIsInjectingCi(false);
    }
  };

  const analysisData = analysisResult?.data;
  const keywordRows = analysisData?.keywords ?? [];
  const backlinkRows = analysisData?.backlinks ?? [];
  const score = analysisData?.aeo_score;

  const auditData = auditResult?.data;
  const auditKeywords = auditData?.keywords ?? [];

  // helper: priority badge colour
  const priorityClass = (p: string) =>
    p === "high" ? "bg-primary text-primary-foreground" :
    p === "medium" ? "bg-secondary text-foreground" :
    "bg-muted text-muted-foreground";

  // helper: BQS / status badge colour
  const statusClass = (s: string) =>
    s === "Acceptable" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" :
    s === "Borderline"  ? "bg-amber-500/15 text-amber-600 border-amber-500/30" :
    "bg-rose-500/15 text-rose-600 border-rose-500/30";

  // Shared audit form rendered in both tabs
  // AuditForm JSX is inlined directly in the Full AEO Audit tab below (not a component)
  // to prevent React remounting inputs on every keystroke (focus-loss bug).

  return (
    <div className="flex h-full w-full flex-col">
      <Tabs value={activeView} onValueChange={(v) => setActiveView(v as ActiveView)} className="flex h-full flex-col">
        <div className="border-b border-border bg-card/30 px-4 py-3 sm:px-8">
          <TabsList>
            <TabsTrigger value="analyzer">Business Analyzer</TabsTrigger>
            <TabsTrigger value="analysis">Full AEO Audit</TabsTrigger>
            <TabsTrigger value="backlinks">Backlinks Injection</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
          </TabsList>
        </div>

          {/* ── Tab 1: Business Analyzer ──────────────────────────────────── */}
        <TabsContent value="analyzer" className="mt-0 flex-1 overflow-y-auto p-4 sm:p-8">
            <div className="mx-auto max-w-3xl flex flex-col gap-6">
              <Card className="border-primary/20 shadow-none">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" />
                        AEO Business Analyzer
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Enter your business details to run a full AEO analysis — keywords, scoring, prompts, and backlink targets.
                      </CardDescription>
                    </div>
                    {(businessName || businessDescription || analysisResult) && (
                      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground shrink-0" onClick={clearAnalyzer}>
                        <RotateCcw className="h-3.5 w-3.5" />
                        Clear
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleAnalyzeBusiness} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label>Business name</Label>
                      <Input
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        placeholder="e.g. American Plumbing Co."
                        disabled={isAnalyzing}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>What does your business do?</Label>
                      <Textarea
                        value={businessDescription}
                        onChange={(e) => setBusinessDescription(e.target.value)}
                        placeholder="Describe the business, offer, market, and what you want AEO to optimize for."
                        className="min-h-32"
                        disabled={isAnalyzing}
                      />
                    </div>
                    <Button
                      type="submit"
                      className="gap-2 self-start"
                      disabled={!businessName.trim() || !businessDescription.trim() || isAnalyzing}
                    >
                      <Target className="h-4 w-4" />
                      {isAnalyzing ? "Analyzing..." : "Run AEO Analysis"}
                    </Button>
                  </form>
                  {analysisError && <p className="mt-3 text-sm text-destructive">{analysisError}</p>}
                </CardContent>
              </Card>

              {analysisData ? (
                <Card className="shadow-none">
                  <CardHeader>
                    <CardTitle>{analysisData.business_name || businessName}</CardTitle>
                    <CardDescription>{analysisData.summary || "Analysis complete."}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Overall</div>
                        <div className="mt-1 text-2xl font-semibold">
                          {score?.overall ?? "-"}<span className="text-sm text-muted-foreground">/10</span>
                        </div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Answer First</div>
                        <div className="mt-1 text-2xl font-semibold">
                          {score?.answer_first ?? "-"}<span className="text-sm text-muted-foreground">/10</span>
                        </div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Citability</div>
                        <div className="mt-1 text-2xl font-semibold">
                          {score?.citability ?? "-"}<span className="text-sm text-muted-foreground">/10</span>
                        </div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Clarity</div>
                        <div className="mt-1 text-2xl font-semibold">
                          {score?.clarity ?? "-"}<span className="text-sm text-muted-foreground">/10</span>
                        </div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Structured Data</div>
                        <div className="mt-1 text-2xl font-semibold">
                          {score?.structured_data ?? "-"}<span className="text-sm text-muted-foreground">/10</span>
                        </div>
                      </div>
                    </div>
                    {score?.rationale && <p className="text-sm text-muted-foreground">{score.rationale}</p>}
                    <div className="flex gap-3 flex-wrap pt-2">
                      <Button variant="outline" size="sm" onClick={() => setActiveView("analysis")}>
                        View Full AEO Analysis →
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setActiveView("backlinks")}>
                        View Backlinks Injection →
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-muted-foreground"
                        title="Download full Business Analyzer report as PDF"
                        onClick={() => openPrintWindow(
                          "Business Analyzer",
                          analysisData?.business_name || businessName,
                          buildAnalyzerPdf(analysisData, businessName)
                        )}
                      >
                        <FileDown className="h-3.5 w-3.5" />
                        Full Report PDF
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : !analysisError && (
                <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed text-center text-muted-foreground">
                  <Sparkles className="mb-4 h-10 w-10 opacity-40" />
                  <p className="max-w-md text-sm">
                    Run a business analysis to pull keywords, prompt targets, backlink opportunities, scoring, and Langfuse trace metadata from your AEO-LLM workspace.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

        {/* ── Tab 2: Full AEO Audit ─────────────────────────────────────── */}
        <TabsContent value="analysis" className="mt-0 flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="mx-auto max-w-6xl space-y-6">
            <Card className="border-primary/20 shadow-none">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      Full AEO Audit
                    </CardTitle>
                    <CardDescription className="mt-1">
                      ICE keyword scoring, example prompt PQS, required search volume, and backlink strategy — all in one run. Traced in Langfuse.
                    </CardDescription>
                  </div>
                  {(businessName || businessDescription || auditResult) && (
                    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground shrink-0" onClick={clearAudit}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Clear
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRunAudit} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label>Business name</Label>
                    <Input
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="e.g. American Plumbing Co."
                      disabled={isAuditing}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>What does your business do?</Label>
                    <Textarea
                      value={businessDescription}
                      onChange={(e) => setBusinessDescription(e.target.value)}
                      placeholder="Describe the business, offer, and market — the more specific, the better the audit."
                      className="min-h-32"
                      disabled={isAuditing}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <Label>What type of business?</Label>
                      <Select value={businessType} onValueChange={setBusinessType} disabled={isAuditing}>
                        <SelectTrigger><SelectValue placeholder="Business type" /></SelectTrigger>
                        <SelectContent>
                          {["B2B SaaS", "B2C", "eCommerce", "local service", "agency", "other"].map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>How big is the business?</Label>
                      <Select value={businessSize} onValueChange={setBusinessSize} disabled={isAuditing}>
                        <SelectTrigger><SelectValue placeholder="Business size" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="small">Small (&lt;50)</SelectItem>
                          <SelectItem value="medium">Medium (50–500)</SelectItem>
                          <SelectItem value="large">Large (500+)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>How many competitors?</Label>
                      <Input
                        value={competitorDensity}
                        onChange={(e) => setCompetitorDensity(e.target.value)}
                        placeholder="e.g. low, medium, high"
                        disabled={isAuditing}
                      />
                    </div>
                  </div>
                  {businessType === "other" && (
                    <Input
                      value={businessTypeOther}
                      onChange={(e) => setBusinessTypeOther(e.target.value)}
                      placeholder="Describe your business type"
                      disabled={isAuditing}
                    />
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label>Website URL <span className="text-xs text-muted-foreground">(optional)</span></Label>
                      <Input
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="e.g. https://americanplumbing.com"
                        disabled={isAuditing}
                        type="url"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Location / City <span className="text-xs text-muted-foreground">(optional)</span></Label>
                      <Input
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="e.g. San Diego, CA"
                        disabled={isAuditing}
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="gap-2 self-start"
                    disabled={!businessName.trim() || !businessDescription.trim() || isAuditing}
                  >
                    <Sparkles className="h-4 w-4" />
                    {isAuditing ? "Auditing..." : "Run Full Audit"}
                  </Button>
                </form>
                {auditError && <p className="mt-3 text-sm text-destructive">{auditError}</p>}
              </CardContent>
            </Card>

            {auditData && (() => {
              const es  = auditData.executive_summary;
              const la  = auditData.local_advantage;
              const cc  = auditData.content_coverage;
              const wa  = auditData.website_analysis;
              const loa = auditData.location_analysis;
              const pqs = auditData.pqs;
              const rs  = auditData.required_searches;
              const recs = auditData.recommendations ?? [];

              const arsColor =
                es?.ars_status === "Green" ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" :
                es?.ars_status === "Amber" ? "text-amber-600 bg-amber-500/10 border-amber-500/30" :
                es?.ars_status === "Red"   ? "text-rose-600 bg-rose-500/10 border-rose-500/30" :
                "text-muted-foreground bg-muted border-border";

              const arsNum =
                es?.ars_status === "Green" ? "text-emerald-700" :
                es?.ars_status === "Amber" ? "text-amber-700" :
                es?.ars_status === "Red"   ? "text-rose-700" : "text-foreground";

              return (
                <>
                {/* ── 1. Executive Summary ──────────────────────────────── */}
                {es && (
                  <Card className={cn("shadow-none border", arsColor.split(" ").slice(1).join(" "))}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <CardTitle className="text-base">AEO Readiness Report</CardTitle>
                          <CardDescription className="mt-0.5 text-xs">
                            {businessName}{websiteUrl && ` · ${websiteUrl}`}{location && ` · ${location}`}
                          </CardDescription>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={cn("text-4xl font-black leading-none", arsNum)}>
                            {es.ars?.toFixed(1) ?? "—"}
                          </div>
                          <div className={cn("mt-1 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold", arsColor)}>
                            {es.ars_status ?? "—"}
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    {es.summary && (
                      <CardContent className="pt-0 space-y-3">
                        <p className="text-sm leading-relaxed">{es.summary}</p>
                        {es.ars_calculation && (
                          <div className="rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                            {es.ars_calculation}
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>
                )}

                {/* ── 2. Website & Location Analysis (always shown) ────── */}
                {(wa || loa) && (
                  <div className={`grid gap-4 ${wa && loa ? "xl:grid-cols-2" : "grid-cols-1"}`}>
                    {wa && (
                      <Card className="shadow-none">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Target className="h-3.5 w-3.5 text-primary" />
                            Website Analysis
                            {wa.ssl != null && (
                              <span className={cn("ml-auto text-[10px] font-semibold rounded-full border px-2 py-0.5",
                                wa.ssl ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" : "text-rose-600 bg-rose-500/10 border-rose-500/30"
                              )}>
                                {wa.ssl ? "HTTPS ✓" : "HTTP ✗"}
                              </span>
                            )}
                          </CardTitle>
                          {wa.url ? (
                            <CardDescription className="text-xs">
                              <a href={wa.url} target="_blank" rel="noreferrer" className="text-primary hover:underline underline-offset-2">{wa.url}</a>
                              {wa.word_count ? <span className="ml-2 text-muted-foreground">{wa.word_count.toLocaleString()} words</span> : null}
                              {wa.mobile_responsive != null && (
                                <span className={cn("ml-2", wa.mobile_responsive ? "text-emerald-600" : "text-amber-600")}>
                                  {wa.mobile_responsive ? "Mobile ✓" : "Mobile ?"}
                                </span>
                              )}
                            </CardDescription>
                          ) : (
                            <CardDescription className="text-xs text-muted-foreground">Inferred from business description</CardDescription>
                          )}
                        </CardHeader>
                        <CardContent className="pt-0">
                          {wa.overview && <p className="text-sm leading-relaxed text-foreground">{wa.overview}</p>}
                          {wa.meta_title && (
                            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                              <div><span className="font-medium text-foreground">Title:</span> {wa.meta_title}</div>
                              {wa.meta_description && <div><span className="font-medium text-foreground">Description:</span> {wa.meta_description}</div>}
                              {(wa.h1s ?? []).length > 0 && <div><span className="font-medium text-foreground">H1:</span> {wa.h1s!.join(" / ")}</div>}
                            </div>
                          )}
                          {(wa.wqm_adjustments ?? []).length > 0 && (
                            <div className="mt-3 space-y-0.5">
                              {wa.wqm_adjustments!.map((adj, i) => (
                                <div key={i} className="text-[11px] font-mono text-muted-foreground">{adj}</div>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                    {loa && (
                      <Card className="shadow-none">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                            {loa.location || location ? `Local Market — ${loa.location || location}` : "Market Overview"}
                          </CardTitle>
                          {loa.location_optimization_score != null && (
                            <CardDescription className="text-xs">
                              Local optimization score:{" "}
                              <span className="font-bold text-foreground">{loa.location_optimization_score}/10</span>
                            </CardDescription>
                          )}
                        </CardHeader>
                        <CardContent className="pt-0">
                          {loa.market_overview && <p className="text-sm leading-relaxed text-foreground">{loa.market_overview}</p>}
                          {(loa.local_aeo_opportunities ?? []).length > 0 && (
                            <ul className="mt-3 space-y-1">
                              {loa.local_aeo_opportunities!.map((opp, i) => (
                                <li key={i} className="text-xs text-muted-foreground flex gap-2">
                                  <span className="shrink-0 text-primary font-bold">→</span>
                                  {opp}
                                </li>
                              ))}
                            </ul>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}

                {/* ── 3. Main grid: keywords left, scores right ─────────── */}
                <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
                  {/* LEFT */}
                  <div className="space-y-4">

                    {/* ICE Keyword Table */}
                    <Card className="shadow-none">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">ICE Keyword Scores</CardTitle>
                        <CardDescription className="font-mono text-[11px]">
                          ICE = (Impact×0.4) + (Conf×0.3) + (Ease_adj×0.3) · Ease_adj = Ease{la?.ease_boost_applied ? " + 0.5 geo-boost" : ""}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border">
                                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-muted-foreground">Keyword</th>
                                <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">I</th>
                                <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">C</th>
                                <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">E</th>
                                <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">E+</th>
                                <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">ICE</th>
                                <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">Site</th>
                                <th className="px-3 py-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">Priority</th>
                                <th className="px-1 py-2 w-6"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {auditKeywords.map((kw) => (
                                <tr key={kw.keyword} className="border-b border-border last:border-0 hover:bg-muted/30 group">
                                  <td className="px-3 py-2.5 font-medium text-sm">{kw.keyword}</td>
                                  <td className="px-2 py-2.5 text-center text-xs">{kw.impact}</td>
                                  <td className="px-2 py-2.5 text-center text-xs">{kw.confidence}</td>
                                  <td className="px-2 py-2.5 text-center text-xs">{kw.ease ?? kw.effort}</td>
                                  <td className="px-2 py-2.5 text-center text-xs font-medium">{kw.ease_adj?.toFixed(1) ?? "—"}</td>
                                  <td className="px-2 py-2.5 text-center text-xs font-bold">{(kw.ice ?? kw.weighted_ice)?.toFixed(2)}</td>
                                  <td className="px-2 py-2.5 text-center text-xs">
                                    {kw.found_on_site
                                      ? <span className="text-emerald-600 font-bold">✓</span>
                                      : <span className="text-rose-400">✗</span>}
                                  </td>
                                  <td className="px-3 py-2.5 text-center">
                                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", priorityClass(kw.priority))}>
                                      {kw.priority}
                                    </span>
                                  </td>
                                  <td className="px-1 py-2.5 text-center">
                                    <button title="Download as PDF"
                                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                                      onClick={() => openPrintWindow("Keyword ICE Score", kw.keyword, buildSingleAuditKeyword(kw, businessName))}>
                                      <FileDown className="h-3 w-3" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Content Coverage Score */}
                    {cc && (
                      <Card className="shadow-none">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm">Content Coverage Score</CardTitle>
                            <div className="text-right">
                              <span className="text-2xl font-black">{cc.ccs?.toFixed(1) ?? "—"}</span>
                              <span className="text-sm text-muted-foreground">%</span>
                            </div>
                          </div>
                          <CardDescription className="text-xs">
                            {cc.keywords_found ?? 0} of {cc.keywords_total ?? auditKeywords.length} keywords found on site
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="pt-0 space-y-3">
                          {(cc.found_keywords ?? []).length > 0 && (
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Found on site</div>
                              <div className="flex flex-wrap gap-1">
                                {cc.found_keywords!.map(k => (
                                  <span key={k} className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium bg-emerald-500/10 border-emerald-500/30 text-emerald-700">{k}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {(cc.missing_keywords ?? []).length > 0 && (
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Missing from site</div>
                              <div className="flex flex-wrap gap-1">
                                {cc.missing_keywords!.map(k => (
                                  <span key={k} className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium bg-rose-500/10 border-rose-500/30 text-rose-600">{k}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </div>

                  {/* RIGHT */}
                  <div className="space-y-4">

                    {/* Local Advantage */}
                    {la && (
                      <Card className="shadow-none">
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm">Local Advantage</CardTitle>
                            <span className="text-xl font-black">{la.la_value}</span>
                          </div>
                          <CardDescription className="text-[11px] font-mono">{la.rule_applied}</CardDescription>
                        </CardHeader>
                        {la.summary && (
                          <CardContent className="pt-0">
                            <p className="text-xs text-muted-foreground leading-relaxed">{la.summary}</p>
                          </CardContent>
                        )}
                      </Card>
                    )}

                    {/* PQS */}
                    {pqs && (
                      <Card className="shadow-none">
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <CardTitle className="text-sm">Prompt Quality Score</CardTitle>
                              <CardDescription className="font-mono text-[11px]">PQS = (PC_adj × 0.4) + (RC × 0.6)</CardDescription>
                            </div>
                            <button title="Download prompt as PDF"
                              className="text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                              onClick={() => openPrintWindow("Example AEO Prompt", businessName,
                                buildSingleAuditPrompt({ text: pqs.example_prompt, pqs_score: pqs.pqs_score, pc_avg: pqs.pc_avg_adjusted, rc_avg: pqs.rc_avg, meets_threshold: pqs.meets_threshold }, rs, businessName))}>
                              <FileDown className="h-4 w-4" />
                            </button>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3 pt-0">
                          {pqs.example_prompt && (
                            <div className="rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed text-foreground">
                              {pqs.example_prompt}
                            </div>
                          )}
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { label: "PQS",    value: pqs.pqs_score },
                              { label: "PC adj", value: pqs.pc_avg_adjusted },
                              { label: "RC avg", value: pqs.rc_avg },
                            ].map(({ label, value }) => (
                              <div key={label} className="rounded-lg border p-2 text-center">
                                <div className="text-[10px] text-muted-foreground">{label}</div>
                                <div className="text-lg font-semibold">{value?.toFixed(2) ?? "—"}</div>
                              </div>
                            ))}
                          </div>
                          {pqs.meets_threshold != null && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground">Threshold:</span>
                              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                pqs.meets_threshold ? "bg-emerald-500/15 text-emerald-600" : "bg-rose-500/15 text-rose-600")}>
                                {pqs.meets_threshold ? "Met ✓" : "Not Met ✗"}
                              </span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Prompt Volume Target */}
                    {rs && (
                      <Card className="shadow-none">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">Prompt Volume Target</CardTitle>
                          <CardDescription className="text-xs">Prompts needed to maintain AI answer engine visibility</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 pt-0">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg border p-3 text-center">
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Total / Month</div>
                              <div className="text-2xl font-black">{rs.total_prompts ?? "—"}</div>
                            </div>
                            <div className="rounded-lg border p-3 text-center">
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Per Week</div>
                              <div className="text-2xl font-black">{rs.weekly_prompts ?? "—"}</div>
                            </div>
                          </div>
                          {rs.formula_used && (
                            <div className="rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] text-muted-foreground leading-relaxed">
                              {rs.formula_used}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Langfuse Trace */}
                    <Card className="shadow-none">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Langfuse Trace</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1.5 pt-0 text-sm">
                        <div className="text-xs text-muted-foreground">Tokens: {auditResult?.tokens_used ?? "—"}</div>
                        {auditResult?.trace_url
                          ? <a className="text-xs text-primary underline-offset-4 hover:underline" href={auditResult.trace_url} target="_blank" rel="noreferrer">Open Langfuse trace →</a>
                          : <div className="text-xs text-muted-foreground">No trace — set LANGFUSE_PUBLIC_KEY in .env</div>}
                      </CardContent>
                    </Card>
                  </div>
                </div>

                {/* ── 4. Recommendations ───────────────────────────────── */}
                {recs.length > 0 && (
                  <Card className="shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Prioritized Recommendations</CardTitle>
                      <CardDescription className="text-xs">Ranked by impact — highest first</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-2">
                      {recs.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)).map((rec, i) => (
                        <div key={i} className="rounded-lg border px-3 py-2.5 flex gap-3">
                          <div className="shrink-0 text-xs font-black text-muted-foreground mt-0.5 w-4 text-right">{rec.priority ?? i + 1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground">{rec.action}</div>
                            {rec.rationale && <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{rec.rationale}</div>}
                          </div>
                          <div className="shrink-0 flex flex-col gap-1 items-end">
                            <span className={cn("text-[10px] rounded-full border px-1.5 py-0.5 font-semibold",
                              rec.impact === "high" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600" :
                              rec.impact === "medium" ? "bg-amber-500/10 border-amber-500/30 text-amber-600" :
                              "bg-muted border-border text-muted-foreground")}>
                              {rec.impact}
                            </span>
                            <span className={cn("text-[10px] rounded-full border px-1.5 py-0.5 font-semibold",
                              rec.effort === "low" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600" :
                              rec.effort === "high" ? "bg-rose-500/10 border-rose-500/30 text-rose-600" :
                              "bg-muted border-border text-muted-foreground")}>
                              {rec.effort} effort
                            </span>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {auditData.disclaimer && (
                  <p className="text-xs text-muted-foreground border-l-2 border-muted pl-3">{auditData.disclaimer}</p>
                )}
                </>
              );
            })()}
          </div>
        </TabsContent>

        {/* ── Tab 3: Backlinks Injection ────────────────────────────────── */}
        <TabsContent value="backlinks" className="mt-0 flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="mx-auto max-w-4xl space-y-6">

            {/* Partial analysis from Business Analyzer */}
            {analysisData?.backlinks && analysisData.backlinks.length > 0 && (
              <Card className="border-blue-500/20 bg-blue-500/5 shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2 text-blue-600">
                    <Sparkles className="h-4 w-4" />
                    From Business Analysis — {analysisData.business_name || businessName}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Backlink targets identified during your last Business Analyzer run. Use these as a reference when filling in the forms below.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {analysisData.backlinks.map((bl, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-md border bg-background px-3 py-2 text-xs">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">{bl.site}</p>
                          <p className="text-muted-foreground mt-0.5">{bl.reason}</p>
                        </div>
                        <span className="shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                          {bl.type}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Sub-tab switcher */}
            <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
              {(["self-create", "prospects", "content-writer"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setBlSubTab(mode)}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                    blSubTab === mode
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode === "self-create" ? "Self-Creatable" : mode === "prospects" ? "Link Prospects" : "Content Writer"}
                </button>
              ))}
            </div>

            {/* ── Self-Creatable sub-tab ─────────────────────────────────── */}
            {blSubTab === "self-create" && (
              <>
            {/* Form */}
            <Card className="border-primary/20 shadow-none">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Link2 className="h-5 w-5 text-primary" />
                      Backlinks Injection
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Generate self-creatable backlink opportunities with step-by-step instructions, DA estimates, and a hallucination self-audit. Traced in Langfuse.
                    </CardDescription>
                  </div>
                  {(blKeyword || blTargetUrl || backlinksResult) && (
                    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground shrink-0" onClick={clearSelfCreatable}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Clear
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleGenerateBacklinks} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                    <div className="space-y-3">
                      <div className="flex flex-col gap-1.5">
                        <Label>Target keyword</Label>
                        <Input
                          value={blKeyword}
                          onChange={(e) => setBlKeyword(e.target.value)}
                          placeholder="e.g. emergency plumber San Diego"
                          disabled={isGeneratingBl}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Target URL</Label>
                        <Input
                          value={blTargetUrl}
                          onChange={(e) => setBlTargetUrl(e.target.value)}
                          placeholder="e.g. https://example.com/plumbing"
                          disabled={isGeneratingBl}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Competitor URLs</Label>
                        <Textarea
                          value={blCompetitors}
                          onChange={(e) => setBlCompetitors(e.target.value)}
                          placeholder="Optional, comma-separated, up to 3"
                          className="min-h-16 resize-none"
                          disabled={isGeneratingBl}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 min-w-[160px]">
                      <div className="flex flex-col gap-1.5">
                        <Label>Business type</Label>
                        <Select value={blBusinessType} onValueChange={setBlBusinessType} disabled={isGeneratingBl}>
                          <SelectTrigger><SelectValue placeholder="Business type" /></SelectTrigger>
                          <SelectContent>
                            {["local", "small", "medium"].map(t => (
                              <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="submit"
                        className="gap-2 w-full mt-auto"
                        disabled={!blKeyword.trim() || !blTargetUrl.trim() || isGeneratingBl}
                      >
                        <Link2 className="h-4 w-4" />
                        {isGeneratingBl ? "Generating…" : "Find Backlinks"}
                      </Button>
                    </div>
                  </div>
                  {backlinksError && <p className="text-sm text-destructive">{backlinksError}</p>}
                </form>
              </CardContent>
            </Card>

            {/* Results */}
            {backlinksResult?.data && (() => {
              const bd = backlinksResult.data;
              const opps = bd.self_creatable_backlinks ?? [];
              const audit = bd.hallucination_self_audit;
              return (
                <>
                  {/* Strategy summary */}
                  {bd.strategy_summary && (
                    <Card className="shadow-none">
                      <CardHeader>
                        <CardTitle>Strategy Summary</CardTitle>
                        <CardDescription>
                          {opps.length} opportunities for <span className="font-medium">{bd.target_keyword}</span>
                          {bd.competitors_analysed?.length ? ` · ${bd.competitors_analysed.length} competitor(s) analysed` : ""}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">{bd.strategy_summary}</p>
                      </CardContent>
                    </Card>
                  )}

                  {/* Backlink cards */}
                  <div className="space-y-3">
                    {opps.map((opp, i) => (
                      <Card key={i} className="shadow-none">
                        <CardHeader
                          className="cursor-pointer pb-3"
                          onClick={() => setExpandedBl(expandedBl === i ? null : i)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <a
                                  href={opp.platform_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-sm font-semibold text-primary hover:underline"
                                >
                                  {opp.platform_name}
                                </a>
                                <Badge variant="outline" className="text-xs">{opp.type}</Badge>
                                <span className={cn(
                                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                                  opp.relevance === "high"   ? "bg-emerald-500/15 text-emerald-600" :
                                  opp.relevance === "medium" ? "bg-amber-500/15 text-amber-600" :
                                  "bg-muted text-muted-foreground"
                                )}>
                                  {opp.relevance}
                                </span>
                                <Badge variant="outline" className="text-xs font-mono">
                                  DA {opp.domain_authority_estimate}
                                </Badge>
                                <Badge variant={opp.do_follow ? "default" : "secondary"} className="text-xs">
                                  {opp.do_follow ? "dofollow" : "nofollow"}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {opp.effort.split(" ")[0]}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground truncate">{opp.platform_url}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 mt-1">
                              <button
                                title="Download this backlink as PDF"
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPrintWindow(
                                    "Backlink Opportunity",
                                    opp.platform_name,
                                    buildSingleBacklinkOpp(opp, i, bd.target_keyword || blKeyword)
                                  );
                                }}
                              >
                                <FileDown className="h-3.5 w-3.5" />
                              </button>
                              <span className="text-xs text-muted-foreground">
                                {expandedBl === i ? "▲ hide" : "▼ show"}
                              </span>
                            </div>
                          </div>
                        </CardHeader>

                        {expandedBl === i && (
                          <CardContent className="pt-0 space-y-4 text-sm">
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Instructions</div>
                              <p className="leading-relaxed text-foreground whitespace-pre-line">{opp.instructions}</p>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Competitor Insight</div>
                                <p className="text-muted-foreground leading-relaxed">{opp.competitor_insight}</p>
                              </div>
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Why This Works</div>
                                <p className="text-muted-foreground leading-relaxed">{opp.why_this_works}</p>
                              </div>
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    ))}
                  </div>

                  {/* Hallucination self-audit */}
                  {audit && (
                    <Card className="shadow-none border-amber-500/30">
                      <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                          Hallucination Self-Audit
                          <span className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                            (audit.overall_confidence_score ?? 0) >= 0.9 ? "bg-emerald-500/15 text-emerald-600" :
                            (audit.overall_confidence_score ?? 0) >= 0.7 ? "bg-amber-500/15 text-amber-600" :
                            "bg-rose-500/15 text-rose-600"
                          )}>
                            Confidence {((audit.overall_confidence_score ?? 0) * 100).toFixed(0)}%
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="rounded border p-2">
                            <div className="text-muted-foreground">Total generated</div>
                            <div className="font-semibold">{audit.total_opportunities_generated ?? "-"}</div>
                          </div>
                          <div className="rounded border p-2">
                            <div className="text-muted-foreground">Verified real domains</div>
                            <div className="font-semibold">{audit.opportunities_with_verified_real_domains ?? "-"}</div>
                          </div>
                        </div>
                        {(audit.platforms_i_am_uncertain_about ?? []).length > 0 && (
                          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                            <div className="font-semibold text-amber-600 mb-1">Uncertain platforms:</div>
                            <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                              {audit.platforms_i_am_uncertain_about!.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          </div>
                        )}
                        {audit.audit_notes && (
                          <p className="text-xs text-muted-foreground">{audit.audit_notes}</p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Langfuse trace */}
                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>Langfuse Trace</CardTitle>
                      <CardDescription>Backlinks generation logged on every run.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div>Tokens used: {backlinksResult.tokens_used ?? "-"}</div>
                      {backlinksResult.trace_url ? (
                        <a className="text-primary underline-offset-4 hover:underline" href={backlinksResult.trace_url} target="_blank" rel="noreferrer">
                          Open Langfuse trace →
                        </a>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          No trace URL — configure LANGFUSE_PUBLIC_KEY in the AEO workspace .env to enable tracing.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              );
            })()}
          </>
        )}

            {/* ── Link Prospects sub-tab ─────────────────────────────────── */}
            {blSubTab === "prospects" && (
              <>
                {/* Form */}
                <Card className="border-primary/20 shadow-none">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Target className="h-5 w-5 text-primary" />
                          Link Prospects
                        </CardTitle>
                        <CardDescription className="mt-1">
                          Find real outreach targets with injection type, DA, relevance, and an exact content insertion guide — every prospect self-audited for hallucinations. Traced in Langfuse.
                        </CardDescription>
                      </div>
                      {(lpKeyword || lpTargetUrl || lpResult) && (
                        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground shrink-0" onClick={clearLinkProspects}>
                          <RotateCcw className="h-3.5 w-3.5" />
                          Clear
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleGenerateLinkProspects} className="space-y-3">
                      <div className="flex flex-col gap-1.5">
                        <Label>Target keyword</Label>
                        <Input
                          value={lpKeyword}
                          onChange={(e) => setLpKeyword(e.target.value)}
                          placeholder="e.g. emergency plumber San Diego"
                          disabled={isGeneratingLp}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Target URL</Label>
                        <div className="flex gap-3">
                          <Input
                            className="flex-1"
                            value={lpTargetUrl}
                            onChange={(e) => setLpTargetUrl(e.target.value)}
                            placeholder="e.g. https://example.com/plumbing"
                            disabled={isGeneratingLp}
                          />
                          <Button
                            type="submit"
                            className="gap-2 shrink-0"
                            disabled={!lpKeyword.trim() || !lpTargetUrl.trim() || isGeneratingLp}
                          >
                            <Target className="h-4 w-4" />
                            {isGeneratingLp ? "Generating…" : "Find Prospects"}
                          </Button>
                        </div>
                      </div>
                      {lpError && <p className="text-sm text-destructive">{lpError}</p>}
                    </form>
                  </CardContent>
                </Card>

                {/* Results */}
                {lpResult?.data && (() => {
                  const ld = lpResult.data;
                  const prospects = ld.prospects ?? [];
                  const audit = ld.hallucination_self_audit;

                  const cpClass = (cp: string) =>
                    cp === "high"   ? "bg-emerald-500/15 text-emerald-600" :
                    cp === "medium" ? "bg-amber-500/15 text-amber-600" :
                    "bg-muted text-muted-foreground";

                  return (
                    <>
                      {/* Conclusion */}
                      {ld.conclusion && (
                        <Card className="shadow-none">
                          <CardHeader>
                            <CardTitle>Strategy Conclusion</CardTitle>
                            <CardDescription>{prospects.length} prospects for <span className="font-medium">{ld.target_keyword}</span></CardDescription>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-muted-foreground">{ld.conclusion}</p>
                          </CardContent>
                        </Card>
                      )}

                      {/* Prospect cards */}
                      <div className="space-y-3">
                        {prospects.map((p, i) => (
                          <Card key={i} className="shadow-none">
                            <CardHeader
                              className="cursor-pointer pb-3"
                              onClick={() => setExpandedLp(expandedLp === i ? null : i)}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0 space-y-1.5">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-mono text-muted-foreground">#{p.rank}</span>
                                    <a
                                      href={p.website_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-sm font-semibold text-primary hover:underline truncate max-w-xs"
                                    >
                                      {p.website_url}
                                    </a>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <Badge variant="outline" className="text-xs">{p.injection_type}</Badge>
                                    <Badge variant="outline" className="text-xs font-mono">DA {p.domain_authority_estimate}</Badge>
                                    <Badge variant="outline" className="text-xs font-mono">Relevance {p.relevance_score?.toFixed(1)}</Badge>
                                    <Badge variant={p.do_follow ? "default" : "secondary"} className="text-xs">
                                      {p.do_follow ? "dofollow" : "nofollow"}
                                    </Badge>
                                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", cpClass(p.click_probability))}>
                                      {p.click_probability} click
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 mt-1">
                                  <button
                                    title="Download this prospect as PDF"
                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openPrintWindow(
                                        "Link Prospect",
                                        p.website_url,
                                        buildSingleLinkProspect(p, ld.target_keyword || lpKeyword)
                                      );
                                    }}
                                  >
                                    <FileDown className="h-3.5 w-3.5" />
                                  </button>
                                  <span className="text-xs text-muted-foreground">
                                    {expandedLp === i ? "▲" : "▼"}
                                  </span>
                                </div>
                              </div>
                            </CardHeader>

                            {expandedLp === i && (
                              <CardContent className="pt-0 space-y-4 text-sm">
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Why This Prospect</div>
                                  <p className="text-foreground leading-relaxed">{p.reason}</p>
                                </div>

                                {p.content_insertion_guide && (
                                  <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Content Insertion Guide</div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <div>
                                        <div className="text-xs text-muted-foreground mb-0.5">Target Page Type</div>
                                        <p className="text-foreground">{p.content_insertion_guide.target_page_type || "—"}</p>
                                      </div>
                                      <div>
                                        <div className="text-xs text-muted-foreground mb-0.5">Suggested Anchor Text</div>
                                        <code className="text-xs bg-background rounded px-1.5 py-0.5 border text-foreground">
                                          {p.content_insertion_guide.suggested_anchor_text || "—"}
                                        </code>
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-xs text-muted-foreground mb-0.5">Insertion Context</div>
                                      <div className="rounded bg-background border px-3 py-2 text-xs leading-relaxed font-mono text-foreground">
                                        {p.content_insertion_guide.insertion_context || "—"}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-xs text-muted-foreground mb-0.5">Value to Host</div>
                                      <p className="text-xs text-muted-foreground">{p.content_insertion_guide.value_to_host || "—"}</p>
                                    </div>
                                  </div>
                                )}

                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Existence Evidence</div>
                                  <p className="text-xs text-muted-foreground italic leading-relaxed">{p.existence_evidence}</p>
                                </div>
                              </CardContent>
                            )}
                          </Card>
                        ))}
                      </div>

                      {/* Hallucination self-audit */}
                      {audit && (
                        <Card className="shadow-none border-amber-500/30">
                          <CardHeader>
                            <CardTitle className="text-sm flex items-center gap-2">
                              Hallucination Self-Audit
                              <span className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                                (audit.overall_confidence_score ?? 0) >= 0.9 ? "bg-emerald-500/15 text-emerald-600" :
                                (audit.overall_confidence_score ?? 0) >= 0.7 ? "bg-amber-500/15 text-amber-600" :
                                "bg-rose-500/15 text-rose-600"
                              )}>
                                Confidence {((audit.overall_confidence_score ?? 0) * 100).toFixed(0)}%
                              </span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2 text-sm">
                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div className="rounded border p-2">
                                <div className="text-muted-foreground">Total generated</div>
                                <div className="font-semibold">{audit.total_prospects_generated ?? "-"}</div>
                              </div>
                              <div className="rounded border p-2">
                                <div className="text-muted-foreground">High certainty</div>
                                <div className="font-semibold">{audit.prospects_with_high_certainty ?? "-"}</div>
                              </div>
                            </div>
                            {(audit.domains_i_am_uncertain_about ?? []).length > 0 && (
                              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                                <div className="font-semibold text-amber-600 mb-1">Uncertain domains:</div>
                                <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                                  {audit.domains_i_am_uncertain_about!.map((d, i) => <li key={i}>{d}</li>)}
                                </ul>
                              </div>
                            )}
                            {audit.audit_notes && <p className="text-xs text-muted-foreground">{audit.audit_notes}</p>}
                          </CardContent>
                        </Card>
                      )}

                      {/* Langfuse trace */}
                      <Card className="shadow-none">
                        <CardHeader>
                          <CardTitle>Langfuse Trace</CardTitle>
                          <CardDescription>Link prospects generation logged on every run.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                          <div>Tokens used: {lpResult.tokens_used ?? "-"}</div>
                          {lpResult.trace_url ? (
                            <a className="text-primary underline-offset-4 hover:underline" href={lpResult.trace_url} target="_blank" rel="noreferrer">
                              Open Langfuse trace →
                            </a>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              No trace URL — configure LANGFUSE_PUBLIC_KEY in the AEO workspace .env.
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </>
                  );
                })()}
              </>
            )}

            {/* ── Content Writer sub-tab ─────────────────────────────────── */}
            {blSubTab === "content-writer" && (
              <>
                {/* Form */}
                <Card className="border-primary/20 shadow-none">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-primary" />
                          Content Writer
                        </CardTitle>
                        <CardDescription className="mt-1">
                          Generate human-sounding content with one backlink naturally embedded — designed to pass AI-content detectors and spam filters. Traced in Langfuse.
                        </CardDescription>
                      </div>
                      {(cwTargetUrl || cwTopic || cwResult) && (
                        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground shrink-0" onClick={clearContentWriter}>
                          <RotateCcw className="h-3.5 w-3.5" />
                          Clear
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleGenerateContent} className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <Label>Platform</Label>
                          <Select value={cwPlatform} onValueChange={setCwPlatform} disabled={isGeneratingCw}>
                            <SelectTrigger><SelectValue placeholder="Platform type" /></SelectTrigger>
                            <SelectContent>
                              {[
                                "forum comment",
                                "blog comment",
                                "directory listing description",
                                "Facebook group post",
                                "LinkedIn comment",
                                "Q&A site answer",
                                "resource page suggestion",
                                "Reddit comment",
                                "Quora answer",
                              ].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>Writing style</Label>
                          <Select value={cwStyle} onValueChange={setCwStyle} disabled={isGeneratingCw}>
                            <SelectTrigger><SelectValue placeholder="Writing style" /></SelectTrigger>
                            <SelectContent>
                              {["casual", "helpful", "professional", "enthusiastic", "brief"].map(s => (
                                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Target URL</Label>
                        <Input
                          value={cwTargetUrl}
                          onChange={(e) => setCwTargetUrl(e.target.value)}
                          placeholder="e.g. https://americanplumbing.com"
                          disabled={isGeneratingCw}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Anchor text</Label>
                        <Input
                          value={cwAnchor}
                          onChange={(e) => setCwAnchor(e.target.value)}
                          placeholder="Optional — leave blank to let the model choose naturally"
                          disabled={isGeneratingCw}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Topic / context</Label>
                        <Textarea
                          value={cwTopic}
                          onChange={(e) => setCwTopic(e.target.value)}
                          placeholder="Describe the discussion this content fits into (e.g. 'Thread asking for reliable emergency plumbers in San Diego')"
                          className="min-h-20 resize-none"
                          disabled={isGeneratingCw}
                        />
                      </div>
                      <Button
                        type="submit"
                        className="gap-2"
                        disabled={!cwTargetUrl.trim() || !cwTopic.trim() || isGeneratingCw}
                      >
                        <Sparkles className="h-4 w-4" />
                        {isGeneratingCw ? "Writing…" : "Generate Content"}
                      </Button>
                      {cwError && <p className="text-sm text-destructive">{cwError}</p>}
                    </form>
                  </CardContent>
                </Card>

                {/* Result */}
                {cwResult && (
                  <>
                    <Card className="shadow-none">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle>Generated Content</CardTitle>
                            <CardDescription className="capitalize">{cwPlatform} · {cwStyle} style · {cwResult.tokens_used} tokens</CardDescription>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(cwResult.content);
                              setCwCopied(true);
                              setTimeout(() => setCwCopied(false), 2000);
                            }}
                          >
                            {cwCopied ? "Copied!" : "Copy"}
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="rounded-lg border bg-muted/20 p-4 text-sm leading-relaxed whitespace-pre-wrap font-sans">
                          {cwResult.content}
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">
                          Review before posting. Verify the backlink URL appears correctly and adjust phrasing if needed.
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="shadow-none">
                      <CardHeader>
                        <CardTitle>Langfuse Trace</CardTitle>
                        <CardDescription>Content generation logged on every run.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <div>Tokens used: {cwResult.tokens_used ?? "-"}</div>
                        {cwResult.trace_url ? (
                          <a className="text-primary underline-offset-4 hover:underline" href={cwResult.trace_url} target="_blank" rel="noreferrer">
                            Open Langfuse trace →
                          </a>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            No trace URL — configure LANGFUSE_PUBLIC_KEY in the AEO workspace .env.
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </>
                )}

                {/* ── Inject Backlink into Existing Content ──────────────── */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">or inject into your own content</span>
                  </div>
                </div>

                <Card className="border-primary/20 shadow-none">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Link2 className="h-5 w-5 text-primary" />
                          Inject Backlink into Existing Content
                        </CardTitle>
                        <CardDescription className="mt-1">
                          Paste any existing text and specify a URL — the model weaves the backlink in naturally without changing your voice.
                        </CardDescription>
                      </div>
                      {(ciExisting || ciTargetUrl || ciResult) && (
                        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground shrink-0" onClick={clearInjectContent}>
                          <RotateCcw className="h-3.5 w-3.5" />
                          Clear
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleInjectBacklink} className="space-y-3">
                      <div className="flex flex-col gap-1.5">
                        <Label>Existing content</Label>
                        <Textarea
                          value={ciExisting}
                          onChange={(e) => setCiExisting(e.target.value)}
                          placeholder="Paste your existing content here…"
                          className="min-h-32 resize-y font-sans"
                          disabled={isInjectingCi}
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <Label>Target URL</Label>
                          <Input
                            value={ciTargetUrl}
                            onChange={(e) => setCiTargetUrl(e.target.value)}
                            placeholder="e.g. https://americanplumbing.com"
                            disabled={isInjectingCi}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>Anchor text</Label>
                          <Input
                            value={ciAnchor}
                            onChange={(e) => setCiAnchor(e.target.value)}
                            placeholder="Optional"
                            disabled={isInjectingCi}
                          />
                        </div>
                      </div>
                      <Button
                        type="submit"
                        variant="outline"
                        className="gap-2"
                        disabled={!ciExisting.trim() || !ciTargetUrl.trim() || isInjectingCi}
                      >
                        <Link2 className="h-4 w-4" />
                        {isInjectingCi ? "Injecting…" : "Inject Backlink"}
                      </Button>
                      {ciError && <p className="text-sm text-destructive">{ciError}</p>}
                    </form>
                  </CardContent>
                </Card>

                {ciResult && (
                  <Card className="shadow-none">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle>Content with Backlink Injected</CardTitle>
                          <CardDescription>{ciResult.tokens_used} tokens used</CardDescription>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(ciResult.content);
                            setCiCopied(true);
                            setTimeout(() => setCiCopied(false), 2000);
                          }}
                        >
                          {ciCopied ? "Copied!" : "Copy"}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-lg border bg-muted/20 p-4 text-sm leading-relaxed whitespace-pre-wrap font-sans">
                        {ciResult.content}
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Review that the link appears where intended and that the surrounding text reads naturally.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

          </div>
        </TabsContent>

        {/* ── Tab 4: Chat ───────────────────────────────────────────────── */}
        <TabsContent value="chat" className="mt-0 flex flex-1 min-h-0">
          {/* Conversation sidebar */}
          <div className="w-64 border-r border-border bg-card/50 flex flex-col shrink-0">
            {/* Header */}
            <div className="p-3 border-b border-border space-y-2">
              <Button
                className="w-full gap-2"
                onClick={handleNewConversation}
                disabled={createConv.isPending}
                data-testid="button-new-conversation"
              >
                <Plus className="w-4 h-4" />
                New Conversation
              </Button>

              {conversations.length > 0 && (
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs text-muted-foreground">
                    {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
                  </span>
                  {clearAllConfirm ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-destructive">Sure?</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={handleClearAll}
                      >
                        Yes
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-xs text-muted-foreground"
                        onClick={() => setClearAllConfirm(false)}
                      >
                        No
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                      onClick={handleClearAll}
                    >
                      Clear all
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Conversation list */}
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-0.5">
                {loadingConversations ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
                ) : conversations.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    <TerminalSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No conversations yet
                  </div>
                ) : (
                  conversations.map(conv => (
                    <div
                      key={conv.id}
                      onClick={() => { setActiveId(conv.id); setActiveView("chat"); }}
                      className={cn(
                        "flex items-start justify-between p-2.5 rounded-md cursor-pointer transition-colors group",
                        activeId === conv.id
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                      )}
                      data-testid={`conv-item-${conv.id}`}
                    >
                      <div className="flex-1 min-w-0 pr-1">
                        <p className="text-sm truncate font-medium leading-snug">
                          {conv.title || "Untitled"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {conv.messageCount ?? 0} message{(conv.messageCount ?? 0) !== 1 ? "s" : ""}
                          {" · "}
                          {new Date(conv.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive mt-0.5"
                        onClick={(e) => handleDelete(conv.id, e)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Chat messages + input */}
          <div className="flex-1 flex flex-col bg-background min-h-0">
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6"
            >
              {!activeId && messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                  <TerminalSquare className="w-12 h-12 mb-4" />
                  <p>I am your Signal AEO Assistant.</p>
                </div>
              ) : (
                <>
                  {loadingMessages && activeId ? (
                    <div className="text-center text-muted-foreground">Loading messages...</div>
                  ) : messages.map((msg: any) => {
                    const conv = conversations.find(c => c.id === activeId);
                    const convTitle = conv?.title || "Signal AEO Assistant";
                    return (
                    <div
                      key={msg.id}
                      className={cn(
                        "max-w-2xl flex flex-col group",
                        msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
                      )}
                    >
                      <div
                        className={cn(
                          "px-4 py-3 rounded-lg text-sm leading-relaxed",
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-foreground prose prose-sm dark:prose-invert max-w-none prose-table:w-full prose-th:text-left prose-td:align-top"
                        )}
                      >
                        {msg.role === "user" ? msg.content : (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        )}
                      </div>
                      <div className={cn(
                        "flex items-center gap-2 mt-1 px-1",
                        msg.role === "user" ? "flex-row-reverse" : "flex-row"
                      )}>
                        {msg.role === "assistant" && (msg.tokensUsed || msg.responseTimeMs) && (
                          <div className="text-[10px] text-muted-foreground flex gap-2">
                            {msg.tokensUsed && <span>{msg.tokensUsed} tokens</span>}
                            {msg.responseTimeMs && <span>{msg.responseTimeMs}ms</span>}
                          </div>
                        )}
                        <button
                          title="Download this message as PDF"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                          onClick={() => openPrintWindow(
                            msg.role === "assistant" ? "AEO Assistant Response" : "Your Message",
                            convTitle,
                            buildSingleChatMessage(msg, convTitle)
                          )}
                        >
                          <FileDown className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    );
                  })}

                  {isStreaming && streamingText && (
                    <div className="max-w-2xl mr-auto items-start flex flex-col">
                      <div className="px-4 py-3 rounded-lg text-sm leading-relaxed bg-secondary text-foreground border border-primary/20 prose prose-sm dark:prose-invert max-w-none prose-table:w-full prose-th:text-left prose-td:align-top">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                        <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-primary animate-pulse" />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-4 border-t border-border bg-card/30">
              <form
                onSubmit={handleSubmit}
                className="max-w-3xl mx-auto relative flex items-center"
              >
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Ask Signal AEO Assistant anything..."
                  className="pr-12 bg-card border-muted focus-visible:ring-primary/50"
                  disabled={isStreaming}
                />
                <Button
                  type="submit"
                  size="icon"
                  className="absolute right-1 h-8 w-8"
                  disabled={!input.trim() || isStreaming}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
