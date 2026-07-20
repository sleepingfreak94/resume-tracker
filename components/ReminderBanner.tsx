"use client";

import { useState } from "react";

interface StaleJob {
  job: {
    id: number;
    company: string;
    title: string;
    status: string;
  };
  daysSinceActivity: number;
  suggestedAction: string;
}

const STATUS_LABELS: Record<string, string> = {
  applied: "Applied",
  recruiter_call: "Recruiter Call",
  interview: "Interview",
};

export default function ReminderBanner({
  staleJobs,
  onSelectJob,
}: {
  staleJobs: StaleJob[];
  onSelectJob: (jobId: number) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (dismissed || staleJobs.length === 0) return null;

  const preview = expanded ? staleJobs : staleJobs.slice(0, 3);

  return (
    <div className="overflow-hidden rounded-2xl border border-amber-300/15 bg-amber-300/[0.045] shadow-[inset_0_1px_rgba(255,255,255,0.025)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <button
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex min-w-0 items-center gap-2.5 text-amber-200 hover:text-amber-100 transition-colors"
        >
          <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg border border-amber-300/15 bg-amber-300/[0.07]">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          </span>
          <span className="truncate text-xs font-semibold sm:text-sm">
            {staleJobs.length} job{staleJobs.length > 1 ? "s" : ""} need attention
          </span>
          <span className="hidden text-xs text-amber-500/80 sm:inline">No activity in 7+ days</span>
          <svg
            className={`w-3.5 h-3.5 flex-shrink-0 text-amber-500 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-300/[0.06] hover:text-amber-300 transition-colors"
          aria-label="Dismiss follow-up reminder"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Job rows */}
      {expanded && (
        <div className="divide-y divide-amber-300/10 border-t border-amber-300/10">
          {preview.map(({ job, daysSinceActivity, suggestedAction }) => (
            <div key={job.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-gray-200">{job.company}</span>
                  <span className="truncate text-xs text-gray-500">{job.title}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] font-medium text-amber-500">
                    {STATUS_LABELS[job.status] ?? job.status} · {daysSinceActivity}d ago
                  </span>
                  <span className="text-[10px] text-gray-500 truncate">{suggestedAction}</span>
                </div>
              </div>
              <button
                onClick={() => onSelectJob(job.id)}
                className="flex-shrink-0 rounded-lg border border-amber-300/15 bg-amber-300/[0.07] px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-300/[0.12]"
              >
                View
              </button>
            </div>
          ))}
          {!expanded && staleJobs.length > 3 && (
            <div className="px-4 py-2 text-xs text-amber-600">
              +{staleJobs.length - 3} more…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
