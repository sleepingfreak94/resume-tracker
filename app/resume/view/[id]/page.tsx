"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getLocalResumeFilename } from "@/lib/resume-filename-client";
import JobResumeChat, { getChatMessageCount } from "@/components/JobResumeChat";
import ATSScorePanel from "@/components/ATSScorePanel";
import ATSScoreBadge from "@/components/ATSScoreBadge";

const MarkdownPreview = dynamic(() => import("@/components/MarkdownPreview"), { ssr: false });
const SaveToDriveButton = dynamic(() => import("@/components/SaveToDriveButton"), { ssr: false });

export default function ResumeViewPage() {
  const { id } = useParams<{ id: string }>();
  const jobId = Number(id);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [atsPanelOpen, setAtsPanelOpen] = useState(true);
  const [chatCount, setChatCount] = useState(0);
  const [jobMeta, setJobMeta] = useState<{ company: string; title: string } | null>(null);
  const [atsScore, setAtsScore] = useState<number | null>(null);

  useEffect(() => {
    const chatTimer = window.setTimeout(() => {
      setChatCount(getChatMessageCount(jobId));
    }, 0);
    fetch(`/api/resume/tailored/${id}`)
      .then((r) => r.json())
      .then((d) => setContent(d.exists ? d.content : null))
      .finally(() => setLoading(false));
    fetch(`/api/jobs/${id}`)
      .then((r) => r.json())
      .then((d) => { if (d.company) setJobMeta({ company: d.company, title: d.title }); })
      .catch(() => {});
    fetch(`/api/ats-score/${id}`)
      .then((r) => r.json())
      .then((d) => { if (d.exists && d.overall_score != null) setAtsScore(d.overall_score); })
      .catch(() => {});
    return () => window.clearTimeout(chatTimer);
  }, [id, jobId]);

  async function downloadDocx() {
    if (!content) return;
    setConverting(true);
    try {
      const filename = await getLocalResumeFilename();
      const res = await fetch("/api/resume/docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, filename }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setConverting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!content) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500 text-sm">
        Resume not found or not generated yet.
      </div>
    );
  }

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -my-8">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-gray-300 truncate">
            {jobMeta ? `${jobMeta.company} — ${jobMeta.title}` : "Tailored Resume"}
          </span>
          {atsScore != null && <ATSScoreBadge score={atsScore} size="md" />}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* ATS toggle */}
          <button
            onClick={() => setAtsPanelOpen((o) => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              atsPanelOpen
                ? "bg-indigo-900/50 border-indigo-700 text-indigo-300"
                : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200"
            }`}
            title="Toggle ATS score panel"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            ATS Score
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(content)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium border border-gray-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy MD
          </button>
          <button
            onClick={downloadDocx}
            disabled={converting}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V19a2 2 0 002 2h14a2 2 0 002-2v-2" />
            </svg>
            {converting ? "Converting..." : "DOCX"}
          </button>
          <SaveToDriveButton
            content={content}
            company={jobMeta?.company}
            storageKey={`job-${id}`}
            returnTo={`/resume/view/${id}`}
          />
        </div>
      </div>

      {/* Body: resume + optional ATS sidebar */}
      <div className="flex min-h-screen">
        {/* Resume content */}
        <div className={`flex-1 min-w-0 px-6 py-10 ${atsPanelOpen ? "max-w-3xl" : "max-w-3xl mx-auto"}`}>
          <MarkdownPreview content={content} />
        </div>

        {/* ATS sidebar */}
        {atsPanelOpen && (
          <div className="w-80 flex-shrink-0 border-l border-gray-800 bg-gray-900/50 sticky top-[57px] h-[calc(100vh-57px)] overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">ATS Score</h3>
                <button
                  onClick={() => setAtsPanelOpen(false)}
                  className="p-1 text-gray-600 hover:text-gray-400 rounded transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <ATSScorePanel
                jobId={jobId}
                onScoreChange={(s) => setAtsScore(s)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Floating chat panel */}
      <div
        className={`fixed bottom-20 right-6 z-30 w-[400px] h-[520px] bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex-col ${
          chatOpen ? "flex" : "hidden"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">Resume Chat</p>
            {jobMeta && (
              <p className="text-xs text-gray-500 truncate">{jobMeta.company} — {jobMeta.title}</p>
            )}
          </div>
          <button
            onClick={() => setChatOpen(false)}
            className="p-1 text-gray-500 hover:text-gray-300 rounded transition-colors flex-shrink-0 ml-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <JobResumeChat
          jobId={jobId}
          className="flex-1 min-h-0"
          onMessagesChange={setChatCount}
          onResumeUpdated={setContent}
        />
      </div>

      {/* Chat FAB */}
      <button
        onClick={() => setChatOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-30 flex items-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg shadow-indigo-900/40 transition-colors"
        title="Chat about this resume"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span className="text-sm font-medium">Chat</span>
        {!chatOpen && chatCount > 0 && (
          <span className="bg-white text-indigo-600 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
            {chatCount}
          </span>
        )}
      </button>
    </div>
  );
}
