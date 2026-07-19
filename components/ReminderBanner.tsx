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
    <div className="bg-amber-950/40 border border-amber-800/50 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 text-amber-300 hover:text-amber-200 transition-colors"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-sm font-medium">
            {staleJobs.length} job{staleJobs.length > 1 ? "s" : ""} need attention
          </span>
          <span className="text-xs text-amber-500">— no activity in 7+ days</span>
          <svg
            className={`w-3.5 h-3.5 text-amber-500 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-600 hover:text-amber-400 transition-colors p-1"
          title="Dismiss"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Job rows */}
      {expanded && (
        <div className="border-t border-amber-800/30 divide-y divide-amber-800/20">
          {preview.map(({ job, daysSinceActivity, suggestedAction }) => (
            <div key={job.id} className="flex items-center justify-between px-4 py-2.5 gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-200 font-medium truncate">{job.company}</span>
                  <span className="text-xs text-gray-500 truncate">— {job.title}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-amber-500 font-medium">
                    {STATUS_LABELS[job.status] ?? job.status} · {daysSinceActivity}d ago
                  </span>
                  <span className="text-[10px] text-gray-500 truncate">{suggestedAction}</span>
                </div>
              </div>
              <button
                onClick={() => onSelectJob(job.id)}
                className="flex-shrink-0 px-2.5 py-1 bg-amber-900/60 hover:bg-amber-900 text-amber-300 rounded-lg text-xs font-medium border border-amber-700/50 transition-colors"
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
