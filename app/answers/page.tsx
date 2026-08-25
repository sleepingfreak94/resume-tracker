"use client";

import { useEffect, useMemo, useState } from "react";
import ResumeDocumentPanel from "@/components/ResumeDocumentPanel";

type AnswerValue = string | number | boolean;

interface StoredAnswer {
  id: number;
  canonical_question: string;
  answer: AnswerValue;
  answer_type: string;
  source: string;
  confidence: string;
  scope: "global" | "job";
  job_id: number | null;
  is_confirmed: number;
  use_count: number;
  category: string;
  correction_count: number;
  last_confirmed_at: string | null;
  last_used_at: string | null;
  aliases: { id: number; question_text: string }[];
}

interface PendingQuestion {
  id: number;
  question_text: string;
  question_kind: string;
  options: string[];
  page_url: string | null;
  job_id: number | null;
  suggested_answer: AnswerValue | null;
  occurrence_count: number;
  last_seen_at: string;
}

interface AutomationSettings {
  auto_continue: boolean;
  wait_seconds: number;
  final_review: boolean;
  pause_on_unknown: boolean;
  resume_format: "docx" | "pdf";
}

interface LibraryData {
  answers: StoredAnswer[];
  pending: PendingQuestion[];
  settings: AutomationSettings;
}

const EMPTY_SETTINGS: AutomationSettings = {
  auto_continue: false,
  wait_seconds: 5,
  final_review: true,
  pause_on_unknown: true,
  resume_format: "docx",
};

const CATEGORY_LABELS: Record<string, string> = {
  identity: "Identity",
  contact: "Contact details",
  work_authorization: "Work authorization",
  availability: "Availability & location",
  compensation: "Compensation",
  experience: "Experience & skills",
  education: "Education",
  preferences: "Work preferences",
  job_specific: "Job-specific answers",
  other: "Other questions",
};

function Toggle({ checked, onChange, label, description }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7f36b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090b10] ${
          checked ? "border-[#c7f36b] bg-[#c7f36b]" : "border-gray-600 bg-gray-700"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_5px_rgba(0,0,0,0.45)] transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

export default function ApplicationAnswersPage() {
  const [data, setData] = useState<LibraryData>({ answers: [], pending: [], settings: EMPTY_SETTINGS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [newAliases, setNewAliases] = useState("");
  const [pendingAnswers, setPendingAnswers] = useState<Record<number, string>>({});
  const [pendingCanonicals, setPendingCanonicals] = useState<Record<number, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");

  async function load() {
    const res = await fetch("/api/application-library");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Unable to load application answers");
    setData(body);
    setLoading(false);
  }

  useEffect(() => {
    let ignore = false;
    fetch("/api/application-library")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Unable to load application answers");
        if (!ignore) {
          setData(body);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
          setLoading(false);
        }
      });
    return () => { ignore = true; };
  }, []);

  const globalAnswers = useMemo(() => data.answers.filter((answer) => answer.scope === "global"), [data.answers]);
  const answersByCategory = useMemo(() => {
    const groups = new Map<string, StoredAnswer[]>();
    for (const answer of data.answers) {
      const category = answer.category || "other";
      groups.set(category, [...(groups.get(category) ?? []), answer]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) =>
      (CATEGORY_LABELS[left] ?? left).localeCompare(CATEGORY_LABELS[right] ?? right)
    );
  }, [data.answers]);
  const learnedCount = data.answers.filter((answer) => !answer.is_confirmed).length;

  function flash(type: "success" | "error", text: string) {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 3500);
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const res = await fetch("/api/application-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data.settings),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Unable to save automation settings");
      setData((current) => ({ ...current, settings: body }));
      flash("success", "Automation settings saved. The extension will use them on its next run.");
    } catch (err) {
      flash("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function addAnswer() {
    if (!newQuestion.trim() || !newAnswer.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/application-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalQuestion: newQuestion,
          answer: newAnswer,
          answerType: "text",
          aliases: newAliases.split("\n").map((item) => item.trim()).filter(Boolean),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Unable to add answer");
      setNewQuestion("");
      setNewAnswer("");
      setNewAliases("");
      await load();
      flash("success", "Answer added to the reusable library.");
    } catch (err) {
      flash("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function resolveQuestion(question: PendingQuestion) {
    const answer = (pendingAnswers[question.id] ?? (question.suggested_answer === null ? "" : String(question.suggested_answer))).trim();
    if (!answer) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/application-questions/${question.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve",
          answer,
          answerType: question.question_kind,
          canonicalQuestion: pendingCanonicals[question.id] || question.question_text,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Unable to resolve question");
      await load();
      flash("success", "Saved. Equivalent questions will reuse this answer.");
    } catch (err) {
      flash("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function dismissQuestion(id: number) {
    await fetch(`/api/application-questions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    });
    await load();
  }

  async function saveEdit(answer: StoredAnswer) {
    const res = await fetch(`/api/application-library/${answer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canonicalQuestion: editQuestion, answer: editAnswer, confirmed: true }),
    });
    const body = await res.json();
    if (!res.ok) return flash("error", body.error || "Unable to update answer");
    setEditingId(null);
    await load();
    flash("success", "Answer updated and confirmed.");
  }

  async function deleteAnswer(id: number) {
    const res = await fetch(`/api/application-library/${id}`, { method: "DELETE" });
    if (!res.ok) return flash("error", "Unable to delete answer");
    await load();
  }

  if (loading) {
    return <div className="dashboard-loading" role="status"><span className="dashboard-loading-mark" /><p>Loading application intelligence</p></div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(199,243,107,0.12),transparent_34%),linear-gradient(145deg,#11151c,#0b0e13)] p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c7f36b]">Application intelligence</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">Teach it once. Reuse it everywhere.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-gray-400">The extension groups differently worded questions by meaning, remembers confirmed answers, and sends uncertain questions here for your decision.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              [globalAnswers.length, "Reusable"],
              [data.pending.length, "Need you"],
              [learnedCount, "AI learned"],
            ].map(([value, label]) => (
              <div key={String(label)} className="min-w-24 rounded-2xl border border-white/[0.07] bg-black/20 px-4 py-3">
                <strong className="block text-2xl text-white">{value}</strong>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {message && (
        <div role={message.type === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${message.type === "error" ? "border-red-800 bg-red-950/60 text-red-300" : "border-[#c7f36b]/25 bg-[#c7f36b]/10 text-[#dfffa0]"}`}>
          {message.text}
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-white/[0.07] bg-[#0d1016] p-5 sm:p-6">
          <div className="mb-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-600">Automation</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Multi-step controls</h2>
          </div>
          <div className="space-y-3">
            <Toggle checked={data.settings.auto_continue} onChange={(value) => setData((current) => ({ ...current, settings: { ...current.settings, auto_continue: value } }))} label="Automatically click Next" description="Continue through completed application steps after the countdown." />
            <Toggle checked={data.settings.final_review} onChange={(value) => setData((current) => ({ ...current, settings: { ...current.settings, final_review: value } }))} label="Pause for final review" description="When off, the extension may submit after the countdown if every safety check passes." />
            <Toggle checked={data.settings.pause_on_unknown} onChange={(value) => setData((current) => ({ ...current, settings: { ...current.settings, pause_on_unknown: value } }))} label="Pause on unknown questions" description="Stop when a required or uncertain answer needs your decision." />
            <fieldset className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
              <legend className="px-0 text-sm font-semibold text-white">Auto-apply resume format</legend>
              <p className="mt-1 text-xs text-gray-500">Choose which tailored file the extension attaches to application forms.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(["docx", "pdf"] as const).map((format) => {
                  const selected = data.settings.resume_format === format;
                  return (
                    <label key={format} className={`cursor-pointer rounded-xl border px-3 py-3 transition ${selected ? "border-[#c7f36b]/60 bg-[#c7f36b]/10" : "border-white/[0.07] bg-black/15 hover:border-white/15"}`}>
                      <input type="radio" name="resume-format" value={format} checked={selected} onChange={() => setData((current) => ({ ...current, settings: { ...current.settings, resume_format: format } }))} className="sr-only" />
                      <span className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-bold uppercase tracking-wider ${selected ? "text-[#dfffa0]" : "text-gray-400"}`}>{format}</span>
                        <span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded-full border ${selected ? "border-[#c7f36b]" : "border-gray-600"}`}>
                          {selected && <span className="h-2 w-2 rounded-full bg-[#c7f36b]" />}
                        </span>
                      </span>
                      <span className="mt-1 block text-[10px] text-gray-600">{format === "docx" ? "Recommended default" : "Preserve exact layout"}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
              <label htmlFor="wait-seconds" className="text-sm font-semibold text-white">Wait before clicking</label>
              <p className="mt-1 text-xs text-gray-500">A visible countdown lets you cancel before Next or Submit.</p>
              <div className="mt-3 flex items-center gap-3">
                <input id="wait-seconds" type="number" min={0} max={60} value={data.settings.wait_seconds} onChange={(event) => setData((current) => ({ ...current, settings: { ...current.settings, wait_seconds: Math.min(60, Math.max(0, Number(event.target.value))) } }))} className="w-24 rounded-xl border border-white/10 bg-[#080a0f] px-3 py-2 text-sm text-white outline-none focus:border-[#c7f36b]/50" />
                <span className="text-xs text-gray-500">seconds</span>
              </div>
            </div>
          </div>
          <button type="button" onClick={saveSettings} disabled={saving} className="mt-4 w-full rounded-xl bg-[#c7f36b] px-4 py-3 text-sm font-bold text-[#111318] transition hover:bg-[#d8ff83] disabled:opacity-50">{saving ? "Saving…" : "Save automation settings"}</button>
        </div>

        <div className="rounded-3xl border border-white/[0.07] bg-[#0d1016] p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-400">Review queue</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Questions that need you</h2>
            </div>
            <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">{data.pending.length} pending</span>
          </div>
          <div className="max-h-[38rem] space-y-3 overflow-y-auto pr-1">
            {data.pending.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center">
                <p className="text-sm font-medium text-gray-300">Nothing needs your attention.</p>
                <p className="mt-1 text-xs text-gray-600">New unknown questions will appear here after an autofill run.</p>
              </div>
            ) : data.pending.map((question) => (
              <article key={question.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium leading-5 text-gray-200">{question.question_text}</p>
                  {question.occurrence_count > 1 && <span className="shrink-0 rounded-full bg-violet-400/10 px-2 py-1 text-[10px] font-bold text-violet-300">Seen {question.occurrence_count}×</span>}
                </div>
                <label className="mt-4 block text-[10px] font-bold uppercase tracking-wider text-gray-600">Canonical question</label>
                <input value={pendingCanonicals[question.id] ?? question.question_text} onChange={(event) => setPendingCanonicals((current) => ({ ...current, [question.id]: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/10 bg-[#080a0f] px-3 py-2 text-sm text-gray-300 outline-none focus:border-violet-400/50" />
                <label className="mt-3 block text-[10px] font-bold uppercase tracking-wider text-gray-600">Your answer</label>
                {question.options.length > 0 ? (
                  <select value={pendingAnswers[question.id] ?? (question.suggested_answer === null ? "" : String(question.suggested_answer))} onChange={(event) => setPendingAnswers((current) => ({ ...current, [question.id]: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/10 bg-[#080a0f] px-3 py-2 text-sm text-gray-200 outline-none focus:border-[#c7f36b]/50">
                    <option value="">Choose an answer…</option>
                    {question.options.map((option) => <option key={option}>{option}</option>)}
                  </select>
                ) : (
                  <textarea value={pendingAnswers[question.id] ?? (question.suggested_answer === null ? "" : String(question.suggested_answer))} onChange={(event) => setPendingAnswers((current) => ({ ...current, [question.id]: event.target.value }))} rows={2} className="mt-1 w-full resize-y rounded-xl border border-white/10 bg-[#080a0f] px-3 py-2 text-sm text-gray-200 outline-none focus:border-[#c7f36b]/50" placeholder="Answer once and reuse it later" />
                )}
                {question.suggested_answer !== null && <p className="mt-2 text-[10px] text-violet-300">AI suggestion — review it before saving.</p>}
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={saving || !(pendingAnswers[question.id] ?? (question.suggested_answer === null ? "" : String(question.suggested_answer))).trim()} onClick={() => resolveQuestion(question)} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-[#111318] disabled:opacity-40">Save answer</button>
                  <button type="button" onClick={() => dismissQuestion(question.id)} className="rounded-lg px-3 py-2 text-xs font-semibold text-gray-500 hover:bg-white/5 hover:text-gray-300">Dismiss</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/[0.07] bg-[#0d1016] p-5 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-400">Add knowledge</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Create a reusable answer</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">Use aliases for alternative wording. The matcher also compares meaning, so exact phrasing is not required.</p>
          </div>
          <div className="grid gap-3">
            <input value={newQuestion} onChange={(event) => setNewQuestion(event.target.value)} placeholder="Canonical question, e.g. Do you require sponsorship?" className="rounded-xl border border-white/10 bg-[#080a0f] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50" />
            <textarea value={newAnswer} onChange={(event) => setNewAnswer(event.target.value)} rows={2} placeholder="Saved answer" className="resize-y rounded-xl border border-white/10 bg-[#080a0f] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50" />
            <textarea value={newAliases} onChange={(event) => setNewAliases(event.target.value)} rows={2} placeholder="Alternative wordings, one per line (optional)" className="resize-y rounded-xl border border-white/10 bg-[#080a0f] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50" />
            <button type="button" onClick={addAnswer} disabled={saving || !newQuestion.trim() || !newAnswer.trim()} className="justify-self-start rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-2.5 text-sm font-bold text-cyan-200 disabled:opacity-40">Add to answer library</button>
          </div>
        </div>
      </section>

      <ResumeDocumentPanel />

      <section className="rounded-3xl border border-white/[0.07] bg-[#0d1016] p-5 sm:p-6">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-600">Memory</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Saved questionnaire</h2>
          </div>
          <span className="text-xs text-gray-600">{data.answers.length} saved answers</span>
        </div>
        <div className="space-y-6">
          {data.answers.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center text-sm text-gray-600">The library will grow as the extension encounters application questions.</p>
          ) : answersByCategory.map(([category, answers]) => (
            <div key={category}>
              <div className="mb-3 flex items-center gap-3">
                <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-400">{CATEGORY_LABELS[category] ?? category}</h3>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-gray-600">{answers.length}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
              {answers.map((answer) => (
              <article key={answer.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
              {editingId === answer.id ? (
                <div className="space-y-3">
                  <input value={editQuestion} onChange={(event) => setEditQuestion(event.target.value)} className="w-full rounded-lg border border-white/10 bg-[#080a0f] px-3 py-2 text-sm text-white" />
                  <textarea value={editAnswer} onChange={(event) => setEditAnswer(event.target.value)} rows={3} className="w-full rounded-lg border border-white/10 bg-[#080a0f] px-3 py-2 text-sm text-white" />
                  <div className="flex gap-2"><button type="button" onClick={() => saveEdit(answer)} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-black">Save</button><button type="button" onClick={() => setEditingId(null)} className="px-3 py-2 text-xs text-gray-500">Cancel</button></div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold leading-5 text-white">{answer.canonical_question}</p>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${answer.is_confirmed ? "bg-[#c7f36b]/10 text-[#c7f36b]" : "bg-violet-400/10 text-violet-300"}`}>{answer.is_confirmed ? "Confirmed" : "AI learned"}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap rounded-xl bg-black/20 px-3 py-2 text-sm leading-5 text-gray-300">{String(answer.answer)}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-gray-600"><span>{answer.aliases.length} wording{answer.aliases.length === 1 ? "" : "s"}</span><span>·</span><span>Used {answer.use_count}×</span><span>·</span><span>{answer.scope === "job" ? `Job-specific${answer.job_id ? ` #${answer.job_id}` : ""}` : "Reusable"}</span><span>·</span><span>{answer.source === "manual" ? "Learned from your review" : answer.source}</span><span>·</span><span>{answer.confidence} confidence</span>{answer.correction_count > 0 && <><span>·</span><span>Corrected {answer.correction_count}×</span></>}</div>
                  {answer.aliases.length > 1 && <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-gray-600">Also matches: {answer.aliases.slice(1).map((alias) => alias.question_text).join(" · ")}</p>}
                  <div className="mt-3 flex gap-2"><button type="button" onClick={() => { setEditingId(answer.id); setEditQuestion(answer.canonical_question); setEditAnswer(String(answer.answer)); }} className="rounded-lg px-2 py-1 text-xs font-semibold text-gray-400 hover:bg-white/5 hover:text-white">Edit</button><button type="button" onClick={() => deleteAnswer(answer.id)} className="rounded-lg px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-red-500/10 hover:text-red-300">Delete</button></div>
                </>
              )}
            </article>
              ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
