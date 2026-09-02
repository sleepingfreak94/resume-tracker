"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { getLocalResumeFilename } from "@/lib/resume-filename-client";

const MarkdownPreview = dynamic(() => import("@/components/MarkdownPreview"), { ssr: false });

type ExportFormat = "pdf" | "docx";

export default function ResumeDocumentPanel() {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [filename, setFilename] = useState("base-resume.md");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState<ExportFormat | null>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<"edit" | "preview">("preview");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/resume")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load the base resume");
        if (active && body.exists && typeof body.content === "string") {
          setContent(body.content);
          setSavedContent(body.content);
        }
      })
      .catch((error) => {
        if (active) setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  function flash(type: "success" | "error", text: string) {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 4000);
  }

  function readFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".md")) {
      flash("error", "Choose a Markdown (.md) resume file.");
      return;
    }
    if (file.size > 1_000_000) {
      flash("error", "The Markdown resume must be under 1 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result ?? ""));
      setFilename(file.name);
      setView("preview");
      flash("success", `${file.name} is ready. Save it as the base resume or export it now.`);
    };
    reader.onerror = () => flash("error", "The selected file could not be read.");
    reader.readAsText(file);
  }

  async function saveResume() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save resume");
      setSavedContent(content);
      flash("success", "This Markdown file is now your base resume and will be used by autofill AI.");
    } catch (error) {
      flash("error", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function download(format: ExportFormat) {
    if (!content.trim()) return;
    setGenerating(format);
    try {
      const downloadFilename = await getLocalResumeFilename(format);
      const response = await fetch(`/api/resume/${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, filename: downloadFilename }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || `Unable to generate ${format.toUpperCase()}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadFilename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash("success", `${format.toUpperCase()} generated successfully.`);
    } catch (error) {
      flash("error", error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(null);
    }
  }

  const dirty = content !== savedContent;

  return (
    <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-[#0d1016]">
      <div className="grid gap-6 border-b border-white/[0.07] p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">Resume documents</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Add Markdown once. Export it anywhere.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">Choose a .md resume, review it here, set it as the base resume for AI answers, or generate an ATS-friendly PDF or DOCX immediately.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => download("pdf")} disabled={!content.trim() || generating !== null} className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#111318] transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40">
            {generating === "pdf" ? "Generating PDF…" : "Download PDF"}
          </button>
          <button type="button" onClick={() => download("docx")} disabled={!content.trim() || generating !== null} className="rounded-xl border border-violet-300/25 bg-violet-300/10 px-4 py-2.5 text-sm font-bold text-violet-200 transition hover:bg-violet-300/15 disabled:cursor-not-allowed disabled:opacity-40">
            {generating === "docx" ? "Generating DOCX…" : "Download DOCX"}
          </button>
        </div>
      </div>

      {message && (
        <div role={message.type === "error" ? "alert" : "status"} className={`mx-5 mt-5 rounded-xl border px-4 py-3 text-sm sm:mx-6 ${message.type === "error" ? "border-red-800 bg-red-950/60 text-red-300" : "border-violet-300/20 bg-violet-300/10 text-violet-200"}`}>
          {message.text}
        </div>
      )}

      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[0.72fr_1.28fr]">
        <div className="space-y-4">
          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) readFile(file);
            }}
            className={`rounded-2xl border border-dashed p-5 transition ${dragging ? "border-violet-300 bg-violet-300/10" : "border-white/15 bg-black/15"}`}
          >
            <input ref={inputRef} type="file" accept=".md,text/markdown,text/plain" className="sr-only" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) readFile(file);
              event.target.value = "";
            }} />
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200" aria-hidden="true">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 16V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4" /></svg>
            </div>
            <p className="mt-4 text-sm font-semibold text-white">Drop a Markdown resume here</p>
            <p className="mt-1 text-xs leading-5 text-gray-600">Maximum 1 MB. Your file stays in this local Resume Tracker app.</p>
            <button type="button" onClick={() => inputRef.current?.click()} className="mt-4 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-300 transition hover:bg-white/5 hover:text-white">Choose .md file</button>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-200">{filename}</p>
                <p className="mt-1 text-xs text-gray-600">{content ? `${content.split(/\r?\n/).length} lines · ${content.length.toLocaleString()} characters` : "No resume loaded"}</p>
              </div>
              {dirty && content && <span className="shrink-0 rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-bold text-amber-300">Not saved</span>}
            </div>
            <button type="button" onClick={saveResume} disabled={saving || !content.trim() || !dirty} className="mt-4 w-full rounded-xl bg-[#c7f36b] px-4 py-3 text-sm font-bold text-[#111318] transition hover:bg-[#d8ff83] disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? "Saving resume…" : dirty ? "Set as base resume" : "Saved as base resume"}
            </button>
          </div>
        </div>

        <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#080a0f]">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4">
            <div className="flex">
              {(["preview", "edit"] as const).map((tab) => (
                <button type="button" key={tab} onClick={() => setView(tab)} className={`border-b-2 px-3 py-3 text-xs font-bold capitalize transition ${view === tab ? "border-violet-300 text-white" : "border-transparent text-gray-600 hover:text-gray-300"}`}>{tab}</button>
              ))}
            </div>
            {loading && <span className="text-xs text-gray-600">Loading resume…</span>}
          </div>
          {view === "edit" ? (
            <textarea value={content} onChange={(event) => setContent(event.target.value)} aria-label="Resume Markdown" className="h-[22rem] w-full resize-y bg-transparent p-5 font-mono text-xs leading-6 text-gray-300 outline-none placeholder:text-gray-700" placeholder="# Your Name\n\n## Summary\n\nYour professional summary…" />
          ) : (
            <div className="h-[22rem] overflow-y-auto p-5">
              {content ? <MarkdownPreview content={content} /> : <div className="flex h-full items-center justify-center text-center"><div><p className="text-sm font-medium text-gray-500">Your resume preview will appear here.</p><p className="mt-1 text-xs text-gray-700">Choose a .md file or switch to Edit to paste Markdown.</p></div></div>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
