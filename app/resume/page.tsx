"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";

const MarkdownPreview = dynamic(() => import("@/components/MarkdownPreview"), { ssr: false });
const SaveToDriveButton = dynamic(() => import("@/components/SaveToDriveButton"), { ssr: false });

export default function ResumePage() {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/resume")
      .then((r) => r.json())
      .then((data) => {
        if (data.exists && data.content) {
          setContent(data.content);
          setSavedContent(data.content);
          setExists(true);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function downloadDocx() {
    if (!content.trim()) return;
    setConverting(true);
    try {
      const res = await fetch("/api/resume/docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, filename: "base-resume.docx" }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "base-resume.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setConverting(false);
    }
  }

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setSavedContent(content);
      setExists(true);
      setMessage({ type: "success", text: "Base resume saved successfully." });
    } catch (err) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".md")) {
      setMessage({ type: "error", text: "Please upload a .md (Markdown) file." });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => setContent(e.target?.result as string);
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const isDirty = content !== savedContent;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Base Resume</h1>
          <p className="text-gray-400 mt-1 text-sm">
            Upload or paste your base resume in Markdown format. The Cursor AI agent will tailor it for each job.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isDirty && (
            <span className="text-xs text-yellow-400 font-medium">Unsaved changes</span>
          )}
          <button
            onClick={downloadDocx}
            disabled={converting || !content.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-700 disabled:text-gray-500 text-gray-300 rounded-lg text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V19a2 2 0 002 2h14a2 2 0 002-2v-2" />
            </svg>
            {converting ? "Converting..." : "Download DOCX"}
          </button>
          <SaveToDriveButton
            content={content}
            filename="base-resume.docx"
            storageKey="base"
            returnTo="/resume"
            size="md"
            onError={(text) => setMessage({ type: "error", text })}
            onSuccess={() =>
              setMessage({ type: "success", text: "Resume saved to Google Drive." })
            }
          />
          <button
            onClick={handleSave}
            disabled={saving || !content.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? "Saving..." : "Save Resume"}
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`px-4 py-3 rounded-lg text-sm ${
            message.type === "success"
              ? "bg-green-900/50 border border-green-800 text-green-300"
              : "bg-red-900/50 border border-red-800 text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Drag & Drop upload */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-indigo-400 bg-indigo-900/20"
            : "border-gray-700 hover:border-gray-600 bg-gray-900/30"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".md"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <svg className="w-8 h-8 mx-auto text-gray-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-gray-400 text-sm">
          {exists ? "Drop a new .md file to replace, or " : "Drop your resume .md file here, or "}
          <span className="text-indigo-400 font-medium">click to browse</span>
        </p>
      </div>

      {/* Editor / Preview tabs */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex border-b border-gray-800">
          {(["edit", "preview"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-medium transition-colors capitalize ${
                tab === t
                  ? "text-white border-b-2 border-indigo-500 bg-gray-900"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {t}
            </button>
          ))}
          {content && (
            <div className="ml-auto flex items-center pr-4">
              <span className="text-xs text-gray-600">
                {content.split("\n").length} lines · {content.length} chars
              </span>
            </div>
          )}
        </div>

        {tab === "edit" ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`# Your Name\n\n## Summary\nBrief professional summary...\n\n## Experience\n\n### Company Name — Job Title\n*Month Year – Month Year*\n- Achievement with metric\n\n## Skills\n- Skill 1, Skill 2\n\n## Education\n\n### Degree, University\n*Year*`}
            className="w-full h-[480px] p-5 bg-transparent text-gray-200 text-sm font-mono resize-none outline-none placeholder-gray-700 leading-relaxed"
          />
        ) : (
          <div className="p-6 h-[480px] overflow-y-auto">
            {content ? (
              <MarkdownPreview content={content} />
            ) : (
              <p className="text-gray-600 text-sm italic">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
