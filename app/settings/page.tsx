"use client";

import { useEffect, useState } from "react";

const OPENAI_MODELS = [
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", note: "Frontier quality for resume and cover-letter generation." },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", note: "Balanced intelligence, speed, and cost for conversation." },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", note: "Efficient choice for parsing and routine analysis." },
] as const;

type OpenAIModel = (typeof OPENAI_MODELS)[number]["id"];
type Provider = "openai" | "codex" | "cursor";
type CodexAuthStatus = "subscription" | "signed_out" | "api_key" | "unavailable";

interface AISettingsResponse {
  provider: Provider;
  generationModel: OpenAIModel;
  chatModel: OpenAIModel;
  routineModel: OpenAIModel;
  codexGenerationModel: OpenAIModel;
  codexChatModel: OpenAIModel;
  codexRoutineModel: OpenAIModel;
  reasoningEffort: "high";
  openaiConfigured: boolean;
  cursorConfigured: boolean;
  codexAuthStatus: CodexAuthStatus;
}

const EMPTY_SETTINGS: AISettingsResponse = {
  provider: "openai",
  generationModel: "gpt-5.6-sol",
  chatModel: "gpt-5.6-terra",
  routineModel: "gpt-5.6-luna",
  codexGenerationModel: "gpt-5.6-sol",
  codexChatModel: "gpt-5.6-terra",
  codexRoutineModel: "gpt-5.6-luna",
  reasoningEffort: "high",
  openaiConfigured: false,
  cursorConfigured: false,
  codexAuthStatus: "unavailable",
};

function CredentialStatus({ label, configured, variable }: { label: string; configured: boolean; variable: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="mt-1 font-mono text-[11px] text-gray-600">{variable}</p>
      </div>
      <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${configured ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-amber-400/25 bg-amber-400/10 text-amber-300"}`}>
        {configured ? "Configured" : "Missing"}
      </span>
    </div>
  );
}

function ModelField({ id, label, description, value, onChange }: {
  id: string;
  label: string;
  description: string;
  value: OpenAIModel;
  onChange: (value: OpenAIModel) => void;
}) {
  const selected = OPENAI_MODELS.find((model) => model.id === value)!;
  return (
    <label htmlFor={id} className="block rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
      <span className="flex items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-semibold text-white">{label}</span>
          <span className="mt-1 block text-xs leading-5 text-gray-500">{description}</span>
        </span>
        <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-violet-200">High reasoning</span>
      </span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as OpenAIModel)} className="mt-4 w-full rounded-xl border border-white/10 bg-[#080a0f] px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-[#c7f36b]/50">
        {OPENAI_MODELS.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      <span className="mt-2 block text-[11px] text-gray-600">{selected.note}</span>
    </label>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshingAuth, setRefreshingAuth] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch("/api/ai-settings", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load AI settings");
        if (!ignore) setSettings(body);
      })
      .catch((error) => !ignore && setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) }))
      .finally(() => !ignore && setLoading(false));
    return () => { ignore = true; };
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/ai-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: settings.provider,
          generationModel: settings.generationModel,
          chatModel: settings.chatModel,
          routineModel: settings.routineModel,
          codexGenerationModel: settings.codexGenerationModel,
          codexChatModel: settings.codexChatModel,
          codexRoutineModel: settings.codexRoutineModel,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save AI settings");
      setSettings(body);
      window.dispatchEvent(new CustomEvent("ai-settings-changed", { detail: body }));
      setMessage({ type: "success", text: "AI settings saved. New requests will use this provider and routing profile." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  async function refreshCodexStatus() {
    setRefreshingAuth(true);
    setMessage(null);
    try {
      const response = await fetch("/api/ai-settings", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to refresh Codex status");
      setSettings(body);
      setMessage({ type: "success", text: body.codexAuthStatus === "subscription" ? "Codex ChatGPT subscription authentication is ready." : "Codex is not signed in with a ChatGPT subscription." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setRefreshingAuth(false);
    }
  }

  async function copyLoginCommand() {
    await navigator.clipboard.writeText("npm run codex:login");
    setMessage({ type: "success", text: "Copied npm run codex:login" });
  }

  if (loading) return <div className="dashboard-loading" role="status"><span className="dashboard-loading-mark" /><p>Loading AI settings</p></div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.18),transparent_34%),linear-gradient(145deg,#11151c,#0b0e13)] p-6 sm:p-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">AI control center</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">Choose how every AI task runs.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">Choose OpenAI API, ChatGPT-subscription Codex, or Cursor. The app never switches providers silently.</p>
      </section>

      {message && <div role={message.type === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${message.type === "error" ? "border-red-800 bg-red-950/60 text-red-300" : "border-[#c7f36b]/25 bg-[#c7f36b]/10 text-[#dfffa0]"}`}>{message.text}</div>}

      <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-white/[0.07] bg-[#0d1016] p-5 sm:p-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-600">Provider</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Active AI service</h2>
            <div className="mt-5 grid gap-3">
              {(["openai", "codex", "cursor"] as const).map((provider) => {
                const selected = settings.provider === provider;
                const providerName = provider === "openai" ? "OpenAI" : provider === "codex" ? "Codex" : "Cursor";
                const providerNote = provider === "openai" ? "Responses API with workload-specific GPT-5.6 models." : provider === "codex" ? "Codex CLI using your ChatGPT subscription; no API-key fallback." : "Retained compatibility using the Cursor Agent SDK.";
                return (
                  <button key={provider} type="button" onClick={() => {
                    if (provider === "codex" && settings.codexAuthStatus !== "subscription") {
                      setMessage({ type: "error", text: "Sign in with ChatGPT using npm run codex:login, then refresh status." });
                      return;
                    }
                    setSettings((current) => ({ ...current, provider }));
                  }} className={`rounded-2xl border p-4 text-left transition ${selected ? "border-[#c7f36b]/50 bg-[#c7f36b]/10" : "border-white/[0.07] bg-white/[0.025] hover:border-white/15"}`}>
                    <span className="flex items-center justify-between gap-3">
                      <strong className={selected ? "text-[#dfffa0]" : "text-white"}>{providerName}</strong>
                      <span className={`grid h-5 w-5 place-items-center rounded-full border ${selected ? "border-[#c7f36b]" : "border-gray-600"}`}>{selected && <span className="h-2.5 w-2.5 rounded-full bg-[#c7f36b]" />}</span>
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-gray-500">{providerNote}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-white/[0.07] bg-[#0d1016] p-5 sm:p-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-600">Credentials</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Server-only keys</h2>
            <p className="mt-2 text-xs leading-5 text-gray-500">Values stay in <span className="font-mono">.env.local</span>. This page receives status only.</p>
            <div className="mt-4 space-y-3">
              <CredentialStatus label="OpenAI API" variable="OPENAI_API_KEY" configured={settings.openaiConfigured} />
              <CredentialStatus label="Cursor API" variable="CURSOR_API_KEY" configured={settings.cursorConfigured} />
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-sm font-semibold text-white">Codex subscription</p><p className="mt-1 text-[11px] text-gray-600">ChatGPT login required</p></div>
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${settings.codexAuthStatus === "subscription" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-amber-400/25 bg-amber-400/10 text-amber-300"}`}>{settings.codexAuthStatus.replace("_", " ")}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={copyLoginCommand} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-gray-300">Copy login command</button>
                  <button type="button" onClick={refreshCodexStatus} disabled={refreshingAuth} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-gray-300 disabled:opacity-50">{refreshingAuth ? "Checking…" : "Refresh"}</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/[0.07] bg-[#0d1016] p-5 sm:p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-600">{settings.provider === "codex" ? "Codex routing" : settings.provider === "cursor" ? "Cursor routing" : "OpenAI routing"}</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Model by workload</h2>
          <p className="mt-2 text-xs leading-5 text-gray-500">OpenAI and Codex choices are remembered independently. Every configured request uses high reasoning.</p>
          <div className="mt-5 space-y-3">
            {settings.provider === "codex" ? <>
              <ModelField id="codex-generation-model" label="Resume generation" description="Tailored resumes and cover letters." value={settings.codexGenerationModel} onChange={(codexGenerationModel) => setSettings((current) => ({ ...current, codexGenerationModel }))} />
              <ModelField id="codex-chat-model" label="Document chat" description="Resume and cover-letter proposals and revisions." value={settings.codexChatModel} onChange={(codexChatModel) => setSettings((current) => ({ ...current, codexChatModel }))} />
              <ModelField id="codex-routine-model" label="Routine intelligence" description="Job parsing, ATS analysis, and application answers." value={settings.codexRoutineModel} onChange={(codexRoutineModel) => setSettings((current) => ({ ...current, codexRoutineModel }))} />
            </> : settings.provider === "openai" ? <>
              <ModelField id="generation-model" label="Resume generation" description="Tailored resumes and cover letters." value={settings.generationModel} onChange={(generationModel) => setSettings((current) => ({ ...current, generationModel }))} />
              <ModelField id="chat-model" label="Document chat" description="Resume and cover-letter proposals and revisions." value={settings.chatModel} onChange={(chatModel) => setSettings((current) => ({ ...current, chatModel }))} />
              <ModelField id="routine-model" label="Routine intelligence" description="Job parsing, ATS analysis, and application answers." value={settings.routineModel} onChange={(routineModel) => setSettings((current) => ({ ...current, routineModel }))} />
            </> : <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 text-sm leading-6 text-gray-400">Cursor uses Composer 2.5 for generation, chat, parsing, ATS analysis, and application answers. Per-chat Cursor overrides remain available in the job document chat.</div>}
          </div>
          <button type="button" onClick={save} disabled={saving} className="mt-5 w-full rounded-xl bg-[#c7f36b] px-4 py-3 text-sm font-bold text-[#111318] transition hover:bg-[#d8ff83] disabled:opacity-50">{saving ? "Saving…" : "Save AI settings"}</button>
        </div>
      </section>
    </div>
  );
}
