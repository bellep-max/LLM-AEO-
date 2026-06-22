import { useEffect, useReducer } from "react";

export interface GlobalChatMsg {
  role: "user" | "assistant";
  content: string;
  traceUrl?: string | null;
}

const CHAT_STORAGE_KEY = "signal-aeo-chat-messages";
const BIZNAME_STORAGE_KEY = "signal-aeo-chat-bizname";

function loadMessages(): GlobalChatMsg[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GlobalChatMsg[]) : [];
  } catch {
    return [];
  }
}

function saveMessages(msgs: GlobalChatMsg[]) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(msgs));
  } catch {}
}

// ── Module-level state — survives component unmounts and route changes ──────────
let _messages: GlobalChatMsg[] = loadMessages();
let _loading  = false;
let _bizName  = (() => { try { return localStorage.getItem(BIZNAME_STORAGE_KEY) ?? ""; } catch { return ""; } })();

const _stateListeners      = new Set<() => void>();
const _completionListeners = new Set<(msg: GlobalChatMsg, bizName: string) => void>();

function _notify() { _stateListeners.forEach(fn => fn()); }

async function _send(text: string) {
  const trimmed = text.trim();
  if (!trimmed || _loading) return;

  _messages = [..._messages, { role: "user", content: trimmed }];
  _loading  = true;
  saveMessages(_messages);
  _notify();

  const snapshot = _messages;

  try {
    const res = await fetch("/api/csv/aeo/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: snapshot,
        businessName: _bizName || undefined,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const raw = await res.text();
    let d: { content?: string; error?: string; traceUrl?: string | null } = {};
    try { d = JSON.parse(raw); } catch {
      const preview = raw.slice(0, 200).replace(/<[^>]+>/g, "").trim();
      throw new Error(res.ok ? "Server returned invalid JSON" : `Server error ${res.status}: ${preview}`);
    }

    const content = res.ok
      ? (d.content ?? "No response.")
      : `Error from server: ${d.error ?? res.statusText}`;

    const assistantMsg: GlobalChatMsg = { role: "assistant", content, traceUrl: d.traceUrl ?? null };
    _messages = [..._messages, assistantMsg];
    saveMessages(_messages);

    if (res.ok) {
      _completionListeners.forEach(fn => fn(assistantMsg, _bizName));
    }
  } catch (e: unknown) {
    const msg  = e instanceof Error ? e.message : String(e);
    const isTO = msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("abort");
    _messages  = [..._messages, {
      role: "assistant",
      content: isTO
        ? "Request timed out (120 s). The LLM may be under load — please try again."
        : `Could not reach the AI service: ${msg}`,
    }];
    saveMessages(_messages);
  } finally {
    _loading = false;
    _notify();
  }
}

// ── Hook — subscribe any component to the module-level state ──────────────────
export function useGlobalChat() {
  const [, tick] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    _stateListeners.add(tick);
    return () => { _stateListeners.delete(tick); };
  }, [tick]);

  return {
    messages:   _messages,
    loading:    _loading,
    bizName:    _bizName,
    setBizName: (name: string) => {
      _bizName = name;
      try { localStorage.setItem(BIZNAME_STORAGE_KEY, name); } catch {}
      _notify();
    },
    send:  _send,
    clear: () => {
      _messages = [];
      _bizName  = "";
      saveMessages([]);
      try { localStorage.removeItem(BIZNAME_STORAGE_KEY); } catch {}
      _notify();
    },
  };
}

// ── Completion event registration (for history bridge) ────────────────────────
export function onChatCompletion(fn: (msg: GlobalChatMsg, bizName: string) => void) {
  _completionListeners.add(fn);
  return () => { _completionListeners.delete(fn); };
}
