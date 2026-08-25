"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReminderBanner from "@/components/ReminderBanner";
import LinkedInRunPanel from "@/components/LinkedInRunPanel";
import ATSScoreBadge from "@/components/ATSScoreBadge";
import StatusBadge from "@/components/StatusBadge";
import { CLOSED_STATUSES, PIPELINE_STATUSES, type JobStatus } from "@/lib/job-status";

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

const PIPELINE_STAGES: {
  status: JobStatus;
  label: string;
  description: string;
  accent: string;
}[] = [
  { status: "applied", label: "Applied", description: "Waiting for a response", accent: "pipeline-blue" },
  { status: "recruiter_call", label: "Recruiter call", description: "First conversation", accent: "pipeline-violet" },
  { status: "interview", label: "Interview", description: "Active interview loop", accent: "pipeline-cyan" },
  { status: "offer", label: "Offer", description: "At the finish line", accent: "pipeline-green" },
];

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function formatRelDate(iso: string) {
  const days = daysSince(iso);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function companyInitial(company: string) {
  return company.trim().charAt(0).toUpperCase() || "J";
}

export default function DashboardPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [atsScores, setAtsScores] = useState<ATSScoreMap>({});
  const [staleJobs, setStaleJobs] = useState<StaleJob[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    Promise.all([
      fetch("/api/jobs").then((res) => res.json()),
      fetch("/api/reminders").then((res) => res.json()),
      fetch("/api/application-library").then((res) => res.json()).catch(() => ({ pending: [] })),
    ]).then(async ([jobsData, remindersData, libraryData]) => {
      if (ignore) return;
      setJobs(jobsData);
      setStaleJobs(Array.isArray(remindersData) ? remindersData : []);
      setPendingQuestions(Array.isArray(libraryData.pending) ? libraryData.pending.length : 0);
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

  const total = jobs.length;
  const pipeline = jobs.filter((job) => PIPELINE_STATUSES.includes(job.status)).length;
  const offers = jobs.filter((job) => job.status === "offer").length;
  const closed = jobs.filter((job) => CLOSED_STATUSES.includes(job.status)).length;
  const applied = jobs.filter((job) => !["pending", "generating", "ready", "withdrawn"].includes(job.status)).length;
  const responded = jobs.filter((job) => ["recruiter_call", "interview", "offer"].includes(job.status)).length;
  const interviews = jobs.filter((job) => ["interview", "offer"].includes(job.status)).length;
  const responseRate = applied > 0 ? Math.round((responded / applied) * 100) : null;
  const interviewRate = applied > 0 ? Math.round((interviews / applied) * 100) : null;
  const scoredValues = Object.values(atsScores).filter((score) => score != null) as number[];
  const avgATS = scoredValues.length
    ? Math.round(scoredValues.reduce((sum, score) => sum + score, 0) / scoredValues.length)
    : null;

  const recentJobs = [...jobs]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const metricCards = [
    {
      index: "01",
      label: "Total jobs",
      value: total,
      detail: `${pipeline} active · ${closed} closed`,
      tone: "metric-neutral",
    },
    {
      index: "02",
      label: "In pipeline",
      value: pipeline,
      detail: offers ? `${offers} offer${offers === 1 ? "" : "s"} in progress` : "Build toward your first offer",
      tone: "metric-violet",
    },
    {
      index: "03",
      label: "Average ATS",
      value: avgATS == null ? "—" : `${avgATS}%`,
      detail: avgATS == null ? "Generate resumes to start scoring" : avgATS >= 80 ? "Strong resume alignment" : avgATS >= 60 ? "Solid, with room to sharpen" : "Prioritize resume tailoring",
      tone: "metric-cyan",
    },
    {
      index: "04",
      label: "Response rate",
      value: responseRate == null ? "—" : `${responseRate}%`,
      detail: applied ? `${applied} applied · ${interviewRate ?? 0}% interview rate` : "Apply to start measuring",
      tone: "metric-green",
    },
  ];

  if (loading) {
    return (
      <div className="dashboard-loading" role="status" aria-label="Loading dashboard">
        <span className="dashboard-loading-mark" />
        <p>Preparing your workspace</p>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <section className="dashboard-hero" aria-labelledby="dashboard-heading">
        <div className="dashboard-hero-copy">
          <p className="dashboard-eyebrow"><span /> Application command center</p>
          <h1 id="dashboard-heading">
            Move every opportunity <em>forward.</em>
          </h1>
          <p className="dashboard-intro">
            A focused view of your applications, resume strength, and the conversations that need your attention.
          </p>
          <div className="dashboard-actions">
            <Link href="/add" className="primary-action">
              Add a new job <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/jobs" className="secondary-action">Review all jobs</Link>
            <Link href="/answers" className="secondary-action">Application answers</Link>
          </div>
        </div>

        <aside className="focus-card" aria-label="Current focus">
          <div className="focus-card-heading">
            <span>Current focus</span>
            <span className="live-indicator"><i /> Live</span>
          </div>
          <div className="focus-number">{staleJobs.length || pipeline}</div>
          <p className="focus-title">
            {staleJobs.length
              ? `follow-up${staleJobs.length === 1 ? "" : "s"} need attention`
              : pipeline
                ? `active application${pipeline === 1 ? "" : "s"} in motion`
                : "opportunities ready to be added"}
          </p>
          <div className="focus-meta">
            <span><strong>{responded}</strong> responses</span>
            <span><strong>{interviews}</strong> interviews</span>
            <span><strong>{offers}</strong> offers</span>
          </div>
        </aside>
      </section>

      <ReminderBanner
        staleJobs={staleJobs}
        onSelectJob={(jobId) => router.push(`/jobs/${jobId}`)}
      />

      <LinkedInRunPanel />

      {pendingQuestions > 0 && (
        <section className="dashboard-panel flex flex-col gap-4 border-amber-300/15 bg-amber-300/[0.035] sm:flex-row sm:items-center sm:justify-between" aria-label="Application questions awaiting review">
          <div>
            <p className="panel-kicker text-amber-300">Autofill needs your input</p>
            <h2 className="mt-1 text-lg font-semibold text-white">{pendingQuestions} application question{pendingQuestions === 1 ? "" : "s"} waiting for an answer</h2>
            <p className="mt-1 text-sm text-gray-500">Answer each one once and equivalent wording will be filled automatically next time.</p>
          </div>
          <Link href="/answers" className="shrink-0 rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-bold text-[#111318]">Review questions</Link>
        </section>
      )}

      <section className="metrics-grid" aria-label="Application performance">
        {metricCards.map((metric) => (
          <article key={metric.label} className={`metric-card ${metric.tone}`}>
            <div className="metric-card-topline">
              <span>{metric.label}</span>
              <span>{metric.index}</span>
            </div>
            <strong>{metric.value}</strong>
            <p>{metric.detail}</p>
          </article>
        ))}
      </section>

      <div className="dashboard-content-grid">
        <section className="dashboard-panel pipeline-panel" aria-labelledby="pipeline-heading">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Progress</p>
              <h2 id="pipeline-heading">Application pipeline</h2>
            </div>
            <Link href="/jobs">View all <span aria-hidden="true">→</span></Link>
          </div>

          {total === 0 ? (
            <div className="dashboard-empty-state">
              <span>01</span>
              <h3>Start your pipeline</h3>
              <p>Add a role and the dashboard will map its progress from application to offer.</p>
              <Link href="/add">Add your first job</Link>
            </div>
          ) : (
            <div className="pipeline-list">
              {PIPELINE_STAGES.map((stage) => {
                const count = jobs.filter((job) => job.status === stage.status).length;
                const percentage = applied ? Math.round((count / applied) * 100) : 0;
                return (
                  <Link
                    key={stage.status}
                    href={`/jobs?status=${stage.status}`}
                    className={`pipeline-row ${stage.accent}`}
                  >
                    <span className="pipeline-dot" aria-hidden="true" />
                    <span className="pipeline-name">
                      <strong>{stage.label}</strong>
                      <small>{stage.description}</small>
                    </span>
                    <span
                      className="pipeline-track"
                      role="progressbar"
                      aria-label={`${stage.label}: ${count} jobs`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percentage}
                    >
                      <span style={{ width: `${percentage}%` }} />
                    </span>
                    <span className="pipeline-count"><strong>{count}</strong> jobs</span>
                    <span className="pipeline-arrow" aria-hidden="true">↗</span>
                  </Link>
                );
              })}

              <div className="pipeline-summary" aria-label="Other application statuses">
                {[
                  { label: "Pending", count: jobs.filter((job) => job.status === "pending").length },
                  { label: "Resume ready", count: jobs.filter((job) => job.status === "ready").length },
                  { label: "Closed", count: closed },
                ].map((item) => (
                  <div key={item.label}>
                    <strong>{item.count}</strong>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="dashboard-panel recent-panel" aria-labelledby="recent-heading">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Latest</p>
              <h2 id="recent-heading">Recent jobs</h2>
            </div>
            <Link href="/jobs">All jobs <span aria-hidden="true">→</span></Link>
          </div>

          {recentJobs.length === 0 ? (
            <div className="compact-empty-state">
              <p>Your recently added roles will appear here.</p>
            </div>
          ) : (
            <div className="recent-job-list">
              {recentJobs.map((job) => (
                <Link key={job.id} href={`/jobs/${job.id}`} className="recent-job-row">
                  <span className="company-avatar" aria-hidden="true">{companyInitial(job.company)}</span>
                  <span className="recent-job-copy">
                    <span className="recent-job-company">
                      <strong>{job.company}</strong>
                      {atsScores[job.id] != null && <ATSScoreBadge score={atsScores[job.id]} size="sm" />}
                    </span>
                    <span className="recent-job-title">{job.title}</span>
                    <span className="recent-job-meta">
                      <StatusBadge status={job.status} />
                      <time dateTime={job.created_at}>{formatRelDate(job.created_at)}</time>
                    </span>
                  </span>
                  <span className="recent-job-arrow" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {scoredValues.length > 0 && (
        <section className="dashboard-panel score-panel" aria-labelledby="score-heading">
          <div className="panel-heading score-heading">
            <div>
              <p className="panel-kicker">Resume intelligence</p>
              <h2 id="score-heading">ATS score distribution</h2>
            </div>
            <p><strong>{scoredValues.length}</strong> resumes scored · average <strong>{avgATS}%</strong></p>
          </div>
          <div className="score-chart">
            {[
              { label: "0–39", range: [0, 39], tone: "score-red" },
              { label: "40–59", range: [40, 59], tone: "score-orange" },
              { label: "60–74", range: [60, 74], tone: "score-yellow" },
              { label: "75–89", range: [75, 89], tone: "score-cyan" },
              { label: "90–100", range: [90, 100], tone: "score-green" },
            ].map((bucket) => {
              const count = scoredValues.filter((score) => score >= bucket.range[0] && score <= bucket.range[1]).length;
              const percentage = count / scoredValues.length;
              return (
                <div key={bucket.label} className="score-column">
                  <span className="score-count">{count || ""}</span>
                  <span className="score-bar-track">
                    <span
                      className={bucket.tone}
                      style={{ height: `${Math.max(percentage * 112, count ? 8 : 3)}px` }}
                    />
                  </span>
                  <span className="score-label">{bucket.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
