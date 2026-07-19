"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import ReminderBanner from "@/components/ReminderBanner";
import ATSScoreBadge from "@/components/ATSScoreBadge";
import StatusBadge from "@/components/StatusBadge";
import { PIPELINE_STATUSES, CLOSED_STATUSES, type JobStatus } from "@/lib/job-status";

interface Job {
  id: number;
  company: string;
  title: string;
  status: JobStatus;
  tailored_resume_path: string | null;
  last_activity_at: string | null;
  created_at: string;
}

interface ATSScoreMap {
  [jobId: number]: number | null;
}

interface StaleJob {
  job: Job;
  daysSinceActivity: number;
  suggestedAction: string;
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function formatRelDate(iso: string) {
  const d = daysSince(iso);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

// Pipeline stages in order with display labels
const PIPELINE_STAGES: { status: JobStatus; label: string; color: string; bg: string }[] = [
  { status: "applied", label: "Applied", color: "text-blue-400", bg: "bg-blue-900/40 border-blue-800/50" },
  { status: "recruiter_call", label: "Recruiter Call", color: "text-purple-400", bg: "bg-purple-900/40 border-purple-800/50" },
  { status: "interview", label: "Interview", color: "text-indigo-400", bg: "bg-indigo-900/40 border-indigo-800/50" },
  { status: "offer", label: "Offer", color: "text-emerald-400", bg: "bg-emerald-900/40 border-emerald-800/50" },
];

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [atsScores, setAtsScores] = useState<ATSScoreMap>({});
  const [staleJobs, setStaleJobs] = useState<StaleJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    Promise.all([
      fetch("/api/jobs").then((res) => res.json()),
      fetch("/api/reminders").then((res) => res.json()),
    ]).then(async ([jobsData, remindersData]) => {
      if (ignore) return;
      setJobs(jobsData);
      setStaleJobs(Array.isArray(remindersData) ? remindersData : []);
      setLoading(false);

      const scored = (jobsData as Job[]).filter((job) => job.tailored_resume_path);
      if (scored.length === 0) return;
      const results = await Promise.all(
        scored.map((job) =>
          fetch(`/api/ats-score/${job.id}`)
            .then((res) => res.json())
            .then((data) => ({ id: job.id, score: data.exists ? data.overall_score : null }))
            .catch(() => ({ id: job.id, score: null }))
        )
      );
      if (ignore) return;
      const scoreMap: ATSScoreMap = {};
      for (const result of results) scoreMap[result.id] = result.score;
      setAtsScores(scoreMap);
    });

    return () => {
      ignore = true;
    };
  }, []);

  // Stats
  const total = jobs.length;
  const pipeline = jobs.filter((j) => PIPELINE_STATUSES.includes(j.status)).length;
  const offers = jobs.filter((j) => j.status === "offer").length;
  const closed = jobs.filter((j) => CLOSED_STATUSES.includes(j.status)).length;
  const applied = jobs.filter((j) => !["pending", "generating", "ready"].includes(j.status) && !CLOSED_STATUSES.includes(j.status)).length;
  const responded = jobs.filter((j) => ["recruiter_call", "interview", "offer"].includes(j.status)).length;
  const interviews = jobs.filter((j) => ["interview", "offer"].includes(j.status)).length;
  const responseRate = applied > 0 ? Math.round((responded / applied) * 100) : null;
  const interviewRate = applied > 0 ? Math.round((interviews / applied) * 100) : null;
  const scoredVals = Object.values(atsScores).filter((s) => s != null) as number[];
  const avgATS = scoredVals.length > 0 ? Math.round(scoredVals.reduce((a, b) => a + b, 0) / scoredVals.length) : null;

  // Recent jobs (last 5)
  const recentJobs = [...jobs]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

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
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-1 text-sm">Your job search at a glance.</p>
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

      {/* Reminder banner */}
      <ReminderBanner
        staleJobs={staleJobs}
        onSelectJob={(jobId) => { window.location.href = `/jobs/${jobId}`; }}
      />

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total Jobs",
            value: total,
            sub: `${pipeline} active · ${closed} closed`,
            color: "text-white",
            iconBg: "bg-gray-800 text-gray-400",
            icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
          },
          {
            label: "In Pipeline",
            value: pipeline,
            sub: offers > 0 ? `${offers} offer${offers > 1 ? "s" : ""}` : "No offers yet",
            color: "text-purple-400",
            iconBg: "bg-purple-950/60 text-purple-400",
            icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />,
          },
          {
            label: "Avg ATS Score",
            value: avgATS != null ? `${avgATS}%` : "—",
            sub: avgATS != null ? (avgATS >= 80 ? "Strong match" : avgATS >= 60 ? "Moderate match" : "Needs improvement") : "Generate resumes to score",
            color: avgATS == null ? "text-gray-500" : avgATS >= 80 ? "text-emerald-400" : avgATS >= 60 ? "text-yellow-400" : "text-red-400",
            iconBg: "bg-indigo-950/60 text-indigo-400",
            icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
          },
          {
            label: "Response Rate",
            value: responseRate != null ? `${responseRate}%` : "—",
            sub: applied > 0 ? `${applied} applied${interviewRate != null ? ` · ${interviewRate}% interview` : ""}` : "No applications yet",
            color: responseRate != null && responseRate >= 30 ? "text-emerald-400" : "text-gray-300",
            iconBg: "bg-emerald-950/60 text-emerald-400",
            icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />,
          },
        ].map((s) => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-3 hover:border-gray-700 transition-colors">
            <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${s.iconBg}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">{s.icon}</svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{s.label}</p>
              <p className={`text-2xl font-bold font-mono tabular-nums mt-0.5 ${s.color}`}>{s.value}</p>
              {s.sub && <p className="text-[10px] text-gray-600 mt-0.5 leading-snug">{s.sub}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Main two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Pipeline funnel — takes 2/3 */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Application Pipeline</h2>
            <Link href="/jobs" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              View all jobs →
            </Link>
          </div>

          {total === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <svg className="w-10 h-10 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-gray-500 text-sm">No jobs yet</p>
              <Link href="/add" className="text-indigo-400 hover:text-indigo-300 text-sm font-medium">Add your first job →</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {PIPELINE_STAGES.map((stage) => {
                const count = jobs.filter((j) => j.status === stage.status).length;
                const pct = applied > 0 ? Math.round((count / Math.max(applied, 1)) * 100) : 0;
                return (
                  <Link
                    key={stage.status}
                    href={`/jobs?status=${stage.status}`}
                    className={`flex items-center gap-4 p-3 rounded-lg border ${stage.bg} hover:opacity-80 transition-opacity`}
                  >
                    <div className="w-24 flex-shrink-0">
                      <p className={`text-xs font-medium ${stage.color}`}>{stage.label}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            stage.status === "offer" ? "bg-emerald-500" :
                            stage.status === "interview" ? "bg-indigo-500" :
                            stage.status === "recruiter_call" ? "bg-purple-500" : "bg-blue-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right w-16">
                      <span className={`text-lg font-bold font-mono ${stage.color}`}>{count}</span>
                      <span className="text-xs text-gray-600 ml-1">jobs</span>
                    </div>
                  </Link>
                );
              })}

              {/* Pre-application stats */}
              <div className="pt-2 border-t border-gray-800 mt-3 grid grid-cols-3 gap-3">
                {[
                  { label: "Pending", count: jobs.filter(j => j.status === "pending").length, color: "text-gray-400" },
                  { label: "Ready", count: jobs.filter(j => j.status === "ready").length, color: "text-green-400" },
                  { label: "Closed", count: closed, color: "text-gray-500" },
                ].map((s) => (
                  <div key={s.label} className="text-center">
                    <p className={`text-xl font-bold font-mono ${s.color}`}>{s.count}</p>
                    <p className="text-[10px] text-gray-600 uppercase tracking-wide mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Recent activity — 1/3 */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Recent Jobs</h2>
            <Link href="/jobs" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              All →
            </Link>
          </div>

          {recentJobs.length === 0 ? (
            <p className="text-gray-600 text-xs text-center py-8">No jobs added yet</p>
          ) : (
            <div className="space-y-3">
              {recentJobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-gray-800/60 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-200 truncate group-hover:text-indigo-300 transition-colors">
                        {job.company}
                      </p>
                      {atsScores[job.id] != null && (
                        <ATSScoreBadge score={atsScores[job.id]} size="sm" />
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{job.title}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <StatusBadge status={job.status} />
                      <span className="text-[10px] text-gray-600">{formatRelDate(job.created_at)}</span>
                    </div>
                  </div>
                  <svg className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 flex-shrink-0 mt-1 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ATS score distribution */}
      {scoredVals.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">ATS Score Distribution</h2>
          <div className="flex items-end gap-2 h-20">
            {[
              { label: "0–39", range: [0, 39], color: "bg-red-600" },
              { label: "40–59", range: [40, 59], color: "bg-orange-500" },
              { label: "60–74", range: [60, 74], color: "bg-yellow-500" },
              { label: "75–89", range: [75, 89], color: "bg-emerald-500" },
              { label: "90–100", range: [90, 100], color: "bg-emerald-400" },
            ].map((bucket) => {
              const count = scoredVals.filter((s) => s >= bucket.range[0] && s <= bucket.range[1]).length;
              const pct = scoredVals.length > 0 ? (count / scoredVals.length) : 0;
              return (
                <div key={bucket.label} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-gray-500 font-mono">{count > 0 ? count : ""}</span>
                  <div className="w-full flex items-end" style={{ height: "52px" }}>
                    <div
                      className={`w-full rounded-t transition-all duration-700 ${bucket.color} ${count === 0 ? "opacity-20" : ""}`}
                      style={{ height: `${Math.max(pct * 52, count > 0 ? 4 : 2)}px` }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-600">{bucket.label}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-600 mt-2">{scoredVals.length} resume{scoredVals.length > 1 ? "s" : ""} scored · avg {avgATS}%</p>
        </div>
      )}
    </div>
  );
}
