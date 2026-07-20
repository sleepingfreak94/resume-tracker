"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface JobResumeChatProps {
  jobId: number;
  onResumeUpdated?: (content: string) => void;
  onMessagesChange?: (count: number) => void;
  className?: string;
}

function loadMessages(jobId: number): Message[] {
  try {
    const raw = localStorage.getItem(`chat-messages-${jobId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMessages(jobId: number, msgs: Message[]) {
  try {
    localStorage.setItem(`chat-messages-${jobId}`, JSON.stringify(msgs));
  } catch { /* quota */ }
}

function loadAgentId(jobId: number): string | undefined {
  return localStorage.getItem(`chat-agent-${jobId}`) ?? undefined;
}

function saveAgentId(jobId: number, agentId: string) {
  localStorage.setItem(`chat-agent-${jobId}`, agentId);
}

const MODELS = [
  { id: "composer-2.5-fast", label: "Fast" },
  { id: "composer-2.5", label: "Balanced" },
  { id: "claude-sonnet-5", label: "Best" },
] as const;

type ModelId = typeof MODELS[number]["id"];
const VALID_MODEL_IDS: ReadonlySet<string> = new Set(MODELS.map((m) => m.id));
const MODEL_STORAGE_KEY = "chat-model";
const DEFAULT_MODEL: ModelId = "composer-2.5";

function loadModel(): ModelId {
  try {
    const saved = localStorage.getItem(MODEL_STORAGE_KEY);
    // ponytail: evict stale model IDs (e.g. from a previous model list)
    if (saved && VALID_MODEL_IDS.has(saved)) return saved as ModelId;
    localStorage.removeItem(MODEL_STORAGE_KEY);
    return DEFAULT_MODEL;
  } catch { return DEFAULT_MODEL; }
}

export default function JobResumeChat({ jobId, onResumeUpdated, onMessagesChange, className = "" }: JobResumeChatProps) {
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(jobId));
  const [agentId, setAgentId] = useState<string | undefined>(() => loadAgentId(jobId));
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [proposal, setProposal] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [model, setModel] = useState<ModelId>(() => loadModel());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(loadMessages(jobId));
    setAgentId(loadAgentId(jobId));
    setInput("");
    setProposal(null);
  }, [jobId]);

  useEffect(() => {
    saveMessages(jobId, messages);
    onMessagesChange?.(Math.floor(messages.length / 2));
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps -- save only when messages change; jobId reload is handled above

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput("");
    setSending(true);
    setProposal(null);
    setMessages((prev) => [...prev, { role: "user", text: msg }, { role: "assistant", text: "" }]);
    scrollToBottom();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, message: msg, agentId, model }),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const evt = JSON.parse(line.slice(6));
          if (evt.type === "chunk") {
            setMessages((prev) => {
              const msgs = [...prev];
              msgs[msgs.length - 1] = { role: "assistant", text: msgs[msgs.length - 1].text + evt.text };
              return msgs;
            });
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          } else if (evt.type === "done") {
            if (evt.agentId) {
              setAgentId(evt.agentId);
              saveAgentId(jobId, evt.agentId);
            }
            if (evt.proposal) setProposal(evt.proposal);
          } else if (evt.type === "error") {
            setMessages((prev) => {
              const msgs = [...prev];
              msgs[msgs.length - 1] = { role: "assistant", text: `Error: ${evt.error}` };
              return msgs;
            });
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const msgs = [...prev];
        msgs[msgs.length - 1] = { role: "assistant", text: `Error: ${String(err)}` };
        return msgs;
      });
    } finally {
      setSending(false);
    }
  };

  const handleApplyProposal = async () => {
    if (!proposal) return;
    setApplying(true);
    try {
      await fetch("/api/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, content: proposal }),
      });
      const res = await fetch(`/api/resume/tailored/${jobId}`);
      const data = await res.json();
      if (data.exists) onResumeUpdated?.(data.content);
      setProposal(null);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-gray-600">
            <svg className="w-8 h-8 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm">Ask anything about this resume.</p>
            <p className="text-xs text-gray-700">e.g. &ldquo;Why did you change the summary?&rdquo; or &ldquo;Make the skills section more concise&rdquo;</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                msg.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-200"
              }`}>
                {msg.text || (sending && i === messages.length - 1 ? (
                  <span className="inline-flex gap-1">
                    <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                ) : "")}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {proposal && (
        <div className="mx-4 mb-2 p-3 bg-green-900/40 border border-green-800 rounded-lg">
          <p className="text-xs text-green-300 font-medium mb-2">Resume update proposed</p>
          <div className="flex gap-2">
            <button
              onClick={handleApplyProposal}
              disabled={applying}
              className="flex-1 px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
            >
              {applying ? "Applying..." : "Apply & Update Resume"}
            </button>
            <button
              onClick={() => setProposal(null)}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg text-xs transition-colors"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-gray-800 px-3 pt-2 pb-1 flex items-center justify-between">
        <label htmlFor={`chat-model-${jobId}`} className="text-xs text-gray-400">Model</label>
        <select
          id={`chat-model-${jobId}`}
          value={model}
          onChange={(e) => { const v = e.target.value as ModelId; setModel(v); try { localStorage.setItem(MODEL_STORAGE_KEY, v); } catch { /* quota */ } }}
          disabled={sending}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-300 outline-none focus:border-indigo-500 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
      <div className="px-3 pb-3 flex gap-2">
        <input
          aria-label="Message resume coach"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          disabled={sending}
          placeholder="Ask about the resume or request changes..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-100 placeholder-gray-600 outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
        />
        <button
          type="button"
          aria-label={sending ? "Sending message" : "Send message"}
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className="p-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
        >
          {sending ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

export function getChatMessageCount(jobId: number): number {
  return Math.floor(loadMessages(jobId).length / 2);
}
