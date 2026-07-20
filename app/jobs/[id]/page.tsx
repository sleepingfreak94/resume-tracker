"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import ATSScorePanel from "@/components/ATSScorePanel";
import ATSScoreBadge from "@/components/ATSScoreBadge";
import ActivityTimeline from "@/components/ActivityTimeline";
import StatusBadge from "@/components/StatusBadge";
import JobResumeChat, { getChatMessageCount } from "@/components/JobResumeChat";
import { toDriveFilename } from "@/lib/resume-format";
import {
  STATUS_CONFIG,
  USER_SELECTABLE_STATUSES,
  type JobStatus,
} from "@/lib/job-status";

const MarkdownPreview = dynamic(() => import("@/components/MarkdownPreview"), { ssr: false });
const SaveToDriveButton = dynamic(() => import("@/components/SaveToDriveButton"), { ssr: false });

interface Job {
  id: number;
  company: string;
  title: string;
  description: string;
  job_link: string | null;
  status: JobStatus;
  tailored_resume_path: string | null;
  agent_id: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

type Tab = "resume" | "cover-letter" | "jd" | "notes" | "ats" | "activity";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function formatDateLong(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = Number(id);

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("resume");
  const [resumeContent, setResumeContent] = useState<string | null>(null);
  const [notesContent, setNotesContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(true);
  const [atsScore, setAtsScore] = useState<number | null>(null);
  const [chatCount, setChatCount] = useState(0);
  const [statusChanging, setStatusChanging] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingCoverLetter, setGeneratingCoverLetter] = useState(false);
  const [coverLetterContent, setCoverLetterContent] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ company: "", title: "", description: "", job_link: "" });

  const fetchJob = useCallback(async () => {
    const res = await fetch(`/api/jobs/${id}`);
    if (!res.ok) { router.push("/"); return; }
    const data = await res.json();
    setJob(data);
    setEditDraft({ company: data.company, title: data.title, description: data.description, job_link: data.job_link ?? "" });
    setLoading(false);
  }, [id, router]);

  const fetchContent = useCallback(async () => {
    setContentLoading(true);
    const [rRes, nRes, clRes] = await Promise.all([
      fetch(`/api/resume/tailored/${id}`),
      fetch(`/api/resume/notes/${id}`),
      fetch(`/api/resume/cover-letter/${id}`),
    ]);
    const [rData, nData, clData] = await Promise.all([rRes.json(), nRes.json(), clRes.json()]);
    setResumeContent(rData.exists ? rData.content : null);
    setNotesContent(nData.exists ? nData.content : null);
    setCoverLetterContent(clData.exists ? clData.content : null);
    setContentLoading(false);
  }, [id]);

  useEffect(() => {
    let ignore = false;
    const chatTimer = window.setTimeout(() => {
      setChatCount(getChatMessageCount(jobId));
    }, 0);

    fetch(`/api/jobs/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          router.push("/");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!ignore && data) {
          setJob(data);
          setEditDraft({ company: data.company, title: data.title, description: data.description, job_link: data.job_link ?? "" });
          setLoading(false);
        }
      })
      .catch(() => {
        if (!ignore) router.push("/");
      });

    Promise.all([
      fetch(`/api/resume/tailored/${id}`).then((res) => res.json()),
      fetch(`/api/resume/notes/${id}`).then((res) => res.json()),
      fetch(`/api/resume/cover-letter/${id}`).then((res) => res.json()),
    ])
      .then(([resumeData, notesData, coverLetterData]) => {
        if (ignore) return;
        setResumeContent(resumeData.exists ? resumeData.content : null);
        setNotesContent(notesData.exists ? notesData.content : null);
        setCoverLetterContent(coverLetterData.exists ? coverLetterData.content : null);
      })
      .finally(() => {
        if (!ignore) setContentLoading(false);
      });

    fetch(`/api/ats-score/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (!ignore && d.exists && d.overall_score != null) setAtsScore(d.overall_score);
      })
      .catch(() => {});

    return () => {
      ignore = true;
      window.clearTimeout(chatTimer);
    };
  }, [id, jobId, router]);

  const handleStatusChange = async (status: JobStatus) => {
    if (!job) return;
    setStatusChanging(true);
    await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await fetchJob();
    setStatusChanging(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setJob((j) => j ? { ...j, status: "generating" } : j);
    try {
      const res = await fetch(`/api/tailor/${id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setNotice(`Generation failed: ${data.error || "Unknown error"}`);
      } else {
        await Promise.all([fetchJob(), fetchContent()]);
      }
    } catch {
      setNotice("Generation failed because the server could not be reached.");
      await fetchJob();
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateCoverLetter = async () => {
    setGeneratingCoverLetter(true);
    try {
      const res = await fetch(`/api/cover-letter/${id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setNotice(`Cover letter generation failed: ${data.error || "Unknown error"}`);
      } else {
        const clRes = await fetch(`/api/resume/cover-letter/${id}`);
        const clData = await clRes.json();
        setCoverLetterContent(clData.exists ? clData.content : null);
        setTab("cover-letter");
      }
    } catch {
      setNotice("Cover letter generation failed because the server could not be reached.");
    } finally {
      setGeneratingCoverLetter(false);
    }
  };

  const handleDelete = async () => {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    router.push("/");
  };

  const handleSaveDetails = async () => {
    const response = await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editDraft, job_link: editDraft.job_link || null }),
    });
    const data = await response.json();
    if (!response.ok) {
      setNotice(data.error || "Unable to update job details.");
      return;
    }
    setJob(data);
    setEditing(false);
    setNotice("Job details updated.");
  };

  async function downloadDocx() {
    if (!resumeContent) return;
    setConverting(true);
    try {
      const res = await fetch("/api/resume/docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: resumeContent, filename: `resume-job-${id}.docx` }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resume-job-${id}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setConverting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!job) return null;

  const needsDataReview = job.title.length > 100 || /show more|applicants|reposted|promoted|\d+\s+(minute|hour|day)s? ago/i.test(job.title);

  const tabs: { id: Tab; label: string; dot?: boolean }[] = [
    { id: "resume", label: "Tailored Resume", dot: !!resumeContent },
    { id: "cover-letter", label: "Cover Letter", dot: !!coverLetterContent },
    { id: "jd", label: "Job Description" },
    { id: "notes", label: "Change Notes", dot: !!notesContent },
    { id: "ats", label: "ATS Score", dot: atsScore != null },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="space-y-0 -mt-2">
      {notice && (
        <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-indigo-900 bg-indigo-950/40 px-4 py-3 text-sm text-indigo-100">
          <span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)} className="text-indigo-300 hover:text-white">×</button>
        </div>
      )}
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-5">
        <Link href="/" className="hover:text-gray-300 transition-colors">Dashboard</Link>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300 truncate">{job.company}</span>
      </div>

      {/* Hero header */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
        {needsDataReview && !editing && <div className="mb-4 rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">This imported title may include job-board page text. Use “Edit details” to clean it up before generating a resume.</div>}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-white break-words">{job.company}</h1>
              <StatusBadge status={job.status} />
              {atsScore != null && <ATSScoreBadge score={atsScore} size="md" />}
            </div>
            <div className="mt-1 flex items-center gap-2 min-w-0">
              {job.job_link ? (
                <a
                  href={job.job_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-indigo-400 hover:underline inline-flex items-start gap-1 text-sm transition-colors break-words min-w-0"
                >
                  {job.title}
                  <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              ) : (
                <span className="text-gray-400 text-sm break-words">{job.title}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-gray-400">
              <span>Added {formatDate(job.created_at)}</span>
              {job.last_activity_at && (
                <span>Last activity {daysSince(job.last_activity_at)}d ago</span>
              )}
              {job.agent_id && (
                <span className="font-mono opacity-60">agent: {job.agent_id.slice(0, 8)}…</span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto lg:flex-shrink-0">
            <button type="button" onClick={() => setEditing((value) => !value)} className="flex items-center px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-sm font-medium border border-gray-700">
              {editing ? "Cancel edit" : "Edit details"}
            </button>
            {(job.status === "pending" || job.status === "ready") && (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <svg className={`w-4 h-4 ${generating ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {generating ? "Generating..." : job.status === "ready" ? "Re-generate" : "Generate Resume"}
              </button>
            )}

            <button
              onClick={handleGenerateCoverLetter}
              disabled={generatingCoverLetter}
              className="flex items-center gap-1.5 px-3 py-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <svg className={`w-4 h-4 ${generatingCoverLetter ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {generatingCoverLetter ? "Generating..." : coverLetterContent ? "Re-generate Cover Letter" : "Generate Cover Letter"}
            </button>

            {resumeContent && job.job_link && (
              <button
                onClick={() => {
                  const url = new URL(job.job_link!);
                  url.hash = `rt_job_id=${job.id}`;
                  window.open(url.toString(), "_blank");
                }}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
                title="Opens the application page — click Auto Apply in the extension"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Auto Apply
              </button>
            )}

            {resumeContent && (
              <>
                <Link
                  href={`/resume/view/${id}`}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm font-medium transition-colors border border-gray-700"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Full View
                </Link>
                <button
                  onClick={downloadDocx}
                  disabled={converting}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg text-sm font-medium border border-gray-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V19a2 2 0 002 2h14a2 2 0 002-2v-2" />
                  </svg>
                  {converting ? "..." : "DOCX"}
                </button>
                <SaveToDriveButton
                  content={resumeContent}
                  filename={toDriveFilename(job.company)}
                  storageKey={`job-${id}`}
                  returnTo={`/jobs/${id}`}
                />
              </>
            )}

            {/* Status select */}
            <select
              aria-label={`Status for ${job.title} at ${job.company}`}
              value={job.status}
              onChange={(e) => handleStatusChange(e.target.value as JobStatus)}
              disabled={statusChanging || job.status === "generating"}
              className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 outline-none hover:border-gray-600 transition-colors disabled:opacity-50"
            >
              {USER_SELECTABLE_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
              ))}
            </select>

            {/* Delete */}
            {deleteConfirm ? (
              <div className="flex items-center gap-1.5">
                <button onClick={handleDelete} className="text-sm text-red-400 hover:text-red-300 font-medium px-2">Confirm delete</button>
                <button onClick={() => setDeleteConfirm(false)} className="text-sm text-gray-500 hover:text-gray-300 px-2">Cancel</button>
              </div>
            ) : (
              <button
                aria-label={`Delete ${job.title} at ${job.company}`}
                onClick={() => setDeleteConfirm(true)}
                className="p-2 text-gray-600 hover:text-red-400 rounded-lg hover:bg-gray-800 border border-transparent hover:border-gray-700 transition-colors"
                title="Delete job"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>
        {editing && (
          <div className="mt-5 grid gap-4 border-t border-gray-800 pt-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm text-gray-300">Company<input value={editDraft.company} onChange={(event) => setEditDraft((draft) => ({ ...draft, company: event.target.value }))} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white" /></label>
              <label className="grid gap-1.5 text-sm text-gray-300">Job title<input value={editDraft.title} onChange={(event) => setEditDraft((draft) => ({ ...draft, title: event.target.value }))} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white" /></label>
            </div>
            <label className="grid gap-1.5 text-sm text-gray-300">Job link<input type="url" value={editDraft.job_link} onChange={(event) => setEditDraft((draft) => ({ ...draft, job_link: event.target.value }))} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white" /></label>
            <label className="grid gap-1.5 text-sm text-gray-300">Description<textarea rows={10} value={editDraft.description} onChange={(event) => setEditDraft((draft) => ({ ...draft, description: event.target.value }))} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white" /></label>
            <button type="button" onClick={handleSaveDetails} className="w-fit rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Save details</button>
          </div>
        )}
      </div>

      {/* Main content: tabs on left, chat on right */}
      <div className="flex flex-col xl:flex-row gap-6 items-stretch xl:items-start min-w-0">
        {/* Tabs panel */}
        <div className="flex-1 min-w-0 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-gray-800 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-3 text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  tab === t.id
                    ? "text-white border-b-2 border-indigo-500"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {t.label}
                {t.dot && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-5 min-h-[400px]">
            {contentLoading && (tab === "resume" || tab === "notes" || tab === "cover-letter") ? (
              <div className="flex items-center justify-center h-40">
                <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full" />
              </div>
            ) : tab === "resume" ? (
              resumeContent ? (
                <MarkdownPreview content={resumeContent} />
              ) : (
                <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
                  <svg className="w-10 h-10 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-gray-500 text-sm">No tailored resume yet.</p>
                  <button
                    onClick={handleGenerate}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    Generate Now
                  </button>
                </div>
              )
            ) : tab === "cover-letter" ? (
              coverLetterContent ? (
                <MarkdownPreview content={coverLetterContent} />
              ) : (
                <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
                  <svg className="w-10 h-10 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <p className="text-gray-500 text-sm">No cover letter yet.</p>
                  <button
                    onClick={handleGenerateCoverLetter}
                    disabled={generatingCoverLetter}
                    className="px-3 py-1.5 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    {generatingCoverLetter ? "Generating..." : "Generate Now"}
                  </button>
                </div>
              )
            ) : tab === "jd" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Job Description</p>
                  {job.job_link && (
                    <a
                      href={job.job_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
                    >
                      Open listing
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}
                </div>
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-800">
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed font-sans">{job.description}</pre>
                </div>
              </div>
            ) : tab === "notes" ? (
              notesContent ? (
                <MarkdownPreview content={notesContent} />
              ) : (
                <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
                  <p className="text-gray-500 text-sm">No change notes yet.</p>
                  <p className="text-gray-600 text-xs">Generate the resume to see AI change notes.</p>
                </div>
              )
            ) : tab === "ats" ? (
              <ATSScorePanel jobId={jobId} onScoreChange={setAtsScore} />
            ) : (
              <ActivityTimeline jobId={jobId} />
            )}
          </div>
        </div>

        {/* Chat sidebar */}
        <div className="w-full xl:w-[360px] xl:flex-shrink-0 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
            <p className="text-sm font-medium text-white">Resume Chat</p>
            {chatCount > 0 && (
              <span className="bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                {chatCount}
              </span>
            )}
          </div>
          <JobResumeChat
            jobId={jobId}
            className="h-[560px]"
            onMessagesChange={setChatCount}
            onResumeUpdated={(updated) => {
              setResumeContent(updated);
              setTab("resume");
            }}
          />
        </div>
      </div>

      {/* Meta footer */}
      <div className="mt-4 flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-gray-400 break-all">
        <span>Created {formatDateLong(job.created_at)}</span>
        <span>·</span>
        <span>Updated {formatDateLong(job.updated_at)}</span>
        {job.agent_id && (
          <>
            <span>·</span>
            <span className="font-mono">Agent run: {job.agent_id}</span>
          </>
        )}
      </div>
    </div>
  );
}
