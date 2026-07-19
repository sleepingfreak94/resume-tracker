"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import StatusBadge from "@/components/StatusBadge";
import JobResumeChat, { getChatMessageCount } from "@/components/JobResumeChat";
import ATSScoreBadge from "@/components/ATSScoreBadge";
import ATSScorePanel from "@/components/ATSScorePanel";
import ActivityTimeline from "@/components/ActivityTimeline";
import {
  JobStatus,
  STATUS_CONFIG,
  USER_SELECTABLE_STATUSES,
  JOB_STATUSES,
} from "@/lib/job-status";

const MarkdownPreview = dynamic(() => import("@/components/MarkdownPreview"), { ssr: false });

function JobTitle({ title, jobLink }: { title: string; jobLink: string | null }) {
  if (jobLink) {
    return (
      <a
        href={jobLink}
        target="_blank"
        rel="noopener noreferrer"
        className="text-gray-500 text-xs mt-0.5 hover:text-indigo-400 hover:underline inline-flex items-center gap-1"
        title="Open job listing"
      >
        {title}
        <svg className="w-3 h-3 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    );
  }
  return <div className="text-gray-500 text-xs mt-0.5">{title}</div>;
}

type Status = JobStatus;

interface Job {
  id: number;
  company: string;
  title: string;
  description: string;
  job_link: string | null;
  status: Status;
  tailored_resume_path: string | null;
  agent_id: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ATSScoreMap {
  [jobId: number]: number | null;
}

const STATUS_FILTERS: { label: string; value: Status | "all" }[] = [
  { label: "All", value: "all" },
  ...JOB_STATUSES.map((value) => ({ label: STATUS_CONFIG[value].label, value })),
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type PreviewTab = "resume" | "notes" | "ats" | "activity" | "chat";

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [generating, setGenerating] = useState<Set<number>>(new Set());
  const [previewJob, setPreviewJob] = useState<Job | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [notesContent, setNotesContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTab, setPreviewTab] = useState<PreviewTab>("resume");
  const [copied, setCopied] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [chatCount, setChatCount] = useState(0);
  const [atsScores, setAtsScores] = useState<ATSScoreMap>({});

  const fetchJobs = useCallback(async () => {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    setJobs(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch("/api/jobs")
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) {
          setJobs(data);
          setLoading(false);
        }
      });

    const interval = setInterval(() => {
      void fetchJobs();
    }, 5000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [fetchJobs]);

  useEffect(() => {
    const scored = jobs.filter((job) => job.tailored_resume_path);
    if (scored.length === 0) return;

    let ignore = false;
    Promise.all(
      scored.map((job) =>
        fetch(`/api/ats-score/${job.id}`)
          .then((res) => res.json())
          .then((data) => ({ id: job.id, score: data.exists ? data.overall_score : null }))
          .catch(() => ({ id: job.id, score: null }))
      )
    ).then((results) => {
      if (ignore) return;
      const scoreMap: ATSScoreMap = {};
      for (const result of results) scoreMap[result.id] = result.score;
      setAtsScores(scoreMap);
    });

    return () => {
      ignore = true;
    };
  }, [jobs]);

  const handleGenerate = async (job: Job) => {
    setGenerating((g) => new Set(g).add(job.id));
    setJobs((prev) => prev.map((j) => j.id === job.id ? { ...j, status: "generating" } : j));
    try {
      const res = await fetch(`/api/tailor/${job.id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(`Generation failed: ${data.error || "Unknown error"}`);
        setJobs((prev) => prev.map((j) => j.id === job.id ? { ...j, status: "pending" } : j));
      } else {
        await fetchJobs();
      }
    } catch {
      setJobs((prev) => prev.map((j) => j.id === job.id ? { ...j, status: "pending" } : j));
    } finally {
      setGenerating((g) => { const s = new Set(g); s.delete(job.id); return s; });
    }
  };

  const handleStatusChange = async (job: Job, status: Status) => {
    await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await fetchJobs();
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    setDeleteConfirm(null);
    if (previewJob?.id === id) setPreviewJob(null);
    await fetchJobs();
  };

  const handlePreview = async (job: Job) => {
    setPreviewJob(job);
    setPreviewContent(null);
    setNotesContent(null);
    setPreviewTab("resume");
    setChatCount(getChatMessageCount(job.id));
    setPreviewLoading(true);
    try {
      const [resumeRes, notesRes] = await Promise.all([
        fetch(`/api/resume/tailored/${job.id}`),
        fetch(`/api/resume/notes/${job.id}`),
      ]);
      const [resumeData, notesData] = await Promise.all([resumeRes.json(), notesRes.json()]);
      setPreviewContent(resumeData.exists ? resumeData.content : null);
      setNotesContent(notesData.exists ? notesData.content : null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCopy = async () => {
    const text = previewTab === "resume" ? previewContent : notesContent;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filtered = filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Jobs</h1>
          <p className="text-gray-400 mt-1 text-sm">{jobs.length} applications tracked</p>
        </div>
        <Link
          href="/add"
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Job
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f.value ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {f.label}
            {f.value !== "all" && (
              <span className="ml-1.5 text-xs opacity-60">
                {jobs.filter((j) => j.status === f.value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table + preview */}
      <div className={`flex gap-6 ${previewJob ? "items-start" : ""}`}>
        <div className={`${previewJob ? "flex-1 min-w-0" : "w-full"}`}>
          {filtered.length === 0 ? (
            <div className="text-center py-16 bg-gray-900/50 border border-gray-800 rounded-xl">
              <svg className="w-12 h-12 mx-auto text-gray-700 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-gray-500 text-sm">
                {filter === "all" ? "No applications yet." : `No ${STATUS_CONFIG[filter as Status]?.label ?? filter} applications.`}
              </p>
              {filter === "all" && (
                <Link href="/add" className="mt-3 inline-block text-indigo-400 hover:text-indigo-300 text-sm font-medium">
                  Add your first job
                </Link>
              )}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Company / Role</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">ATS</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Added</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {filtered.map((job) => (
                    <tr
                      key={job.id}
                      className={`group hover:bg-gray-800/30 transition-colors cursor-pointer ${previewJob?.id === job.id ? "bg-gray-800/40" : ""}`}
                    >
                      <td className="px-4 py-3.5" onClick={() => previewJob?.id === job.id ? setPreviewJob(null) : handlePreview(job)}>
                        <div className="font-medium text-gray-100 group-hover:text-indigo-300 transition-colors">{job.company}</div>
                        <JobTitle title={job.title} jobLink={job.job_link} />
                      </td>
                      <td className="px-4 py-3.5"><StatusBadge status={job.status} /></td>
                      <td className="px-4 py-3.5"><ATSScoreBadge score={atsScores[job.id]} /></td>
                      <td className="px-4 py-3.5 text-gray-500 text-xs">{formatDate(job.created_at)}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          {(job.status === "pending" || job.status === "ready") && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleGenerate(job); }}
                              disabled={generating.has(job.id)}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600/80 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              {job.status === "ready" ? "Re-gen" : "Generate"}
                            </button>
                          )}
                          {(job.status === "ready" || job.tailored_resume_path) ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (previewJob?.id === job.id) setPreviewJob(null);
                                else void handlePreview(job);
                              }}
                              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                previewJob?.id === job.id ? "bg-gray-600 text-white" : "bg-gray-800 hover:bg-gray-700 text-gray-300"
                              }`}
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              Preview
                            </button>
                          ) : null}
                          <Link
                            href={`/jobs/${job.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors opacity-0 group-hover:opacity-100"
                          >
                            Details
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </Link>
                          <select
                            value={job.status}
                            onChange={(e) => { e.stopPropagation(); handleStatusChange(job, e.target.value as Status); }}
                            disabled={job.status === "generating"}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-gray-800 border border-gray-700 text-gray-400 text-xs rounded-lg px-2 py-1.5 outline-none hover:border-gray-600 transition-colors disabled:opacity-50"
                          >
                            {USER_SELECTABLE_STATUSES.map((status) => (
                              <option key={status} value={status}>{STATUS_CONFIG[status].label}</option>
                            ))}
                          </select>
                          {deleteConfirm === job.id ? (
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => handleDelete(job.id)} className="text-xs text-red-400 hover:text-red-300 font-medium px-1">Confirm</button>
                              <button onClick={() => setDeleteConfirm(null)} className="text-xs text-gray-500 hover:text-gray-300 px-1">Cancel</button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(job.id); }}
                              className="p-1.5 text-gray-600 hover:text-red-400 rounded-lg hover:bg-gray-800 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Preview panel */}
        {previewJob && (
          <div className="w-[480px] flex-shrink-0 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="min-w-0 flex items-center gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{previewJob.company}</p>
                  <div className="truncate"><JobTitle title={previewJob.title} jobLink={previewJob.job_link} /></div>
                </div>
                {atsScores[previewJob.id] != null && <ATSScoreBadge score={atsScores[previewJob.id]} size="md" />}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                {(previewTab === "resume" || previewTab === "notes") &&
                  (previewTab === "resume" ? previewContent : notesContent) && (
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors"
                  >
                    {copied ? (
                      <><svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied</>
                    ) : (
                      <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy MD</>
                    )}
                  </button>
                )}
                <Link
                  href={`/jobs/${previewJob.id}`}
                  className="flex items-center gap-1 px-2 py-1.5 text-gray-400 hover:text-indigo-300 hover:bg-gray-800 rounded-lg text-xs font-medium transition-colors"
                >
                  Details
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
                <a
                  href={`/resume/view/${previewJob.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-800 transition-colors"
                  title="Open resume in new tab"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
                <button onClick={() => setPreviewJob(null)} className="p-1 text-gray-500 hover:text-gray-300 rounded transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex border-b border-gray-800 overflow-x-auto">
              {(
                [
                  { id: "resume", label: "Resume", dot: !!previewContent },
                  { id: "notes", label: "Notes", dot: !!notesContent },
                  { id: "ats", label: "ATS Score", dot: atsScores[previewJob.id] != null },
                  { id: "activity", label: "Activity", dot: false },
                  { id: "chat", label: "Chat", count: chatCount },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setPreviewTab(tab.id)}
                  className={`px-4 py-2.5 text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    previewTab === tab.id ? "text-white border-b-2 border-indigo-500" : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {tab.label}
                  {"dot" in tab && tab.dot && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />}
                  {"count" in tab && tab.count > 0 && (
                    <span className="bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">{tab.count}</span>
                  )}
                </button>
              ))}
            </div>

            {previewTab === "chat" ? (
              <JobResumeChat
                jobId={previewJob.id}
                className="h-[560px]"
                onMessagesChange={setChatCount}
                onResumeUpdated={(updated) => { setPreviewContent(updated); setPreviewTab("resume"); }}
              />
            ) : previewTab === "ats" ? (
              <div className="p-5 h-[560px] overflow-y-auto">
                <ATSScorePanel jobId={previewJob.id} />
              </div>
            ) : previewTab === "activity" ? (
              <div className="p-5 h-[560px] overflow-y-auto">
                <ActivityTimeline jobId={previewJob.id} />
              </div>
            ) : (
              <div className="p-5 h-[560px] overflow-y-auto">
                {previewLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
                  </div>
                ) : previewTab === "resume" ? (
                  previewContent ? <MarkdownPreview content={previewContent} /> : (
                    <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                      <p className="text-gray-600 text-sm">No tailored resume yet.</p>
                      <button onClick={() => handleGenerate(previewJob)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors">
                        Generate Now
                      </button>
                    </div>
                  )
                ) : notesContent ? <MarkdownPreview content={notesContent} /> : (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                    <p className="text-gray-600 text-sm">No change notes yet.</p>
                    <p className="text-gray-700 text-xs">Generate the resume to see why each change was made.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
