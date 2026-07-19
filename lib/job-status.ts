export const JOB_STATUSES = [
  "pending",
  "generating",
  "ready",
  "applied",
  "recruiter_call",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "ghosted",
  "position_filled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/** Statuses users can pick in the dropdown (excludes system-only "generating"). */
export const USER_SELECTABLE_STATUSES: JobStatus[] = [
  "pending",
  "ready",
  "applied",
  "recruiter_call",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "ghosted",
  "position_filled",
];

export const STATUS_CONFIG: Record<JobStatus, { label: string; classes: string }> = {
  pending: { label: "Pending", classes: "bg-gray-700 text-gray-300" },
  generating: { label: "Generating...", classes: "bg-yellow-900 text-yellow-300 animate-pulse" },
  ready: { label: "Ready", classes: "bg-green-900 text-green-300" },
  applied: { label: "Applied", classes: "bg-blue-900 text-blue-300" },
  recruiter_call: { label: "Recruiter Call", classes: "bg-purple-900 text-purple-300" },
  interview: { label: "Interview", classes: "bg-indigo-900 text-indigo-300" },
  offer: { label: "Offer", classes: "bg-emerald-900 text-emerald-300" },
  rejected: { label: "Rejected", classes: "bg-red-900 text-red-300" },
  withdrawn: { label: "Withdrawn", classes: "bg-orange-900 text-orange-300" },
  ghosted: { label: "No Response", classes: "bg-gray-800 text-gray-500" },
  position_filled: { label: "Position Filled", classes: "bg-rose-900 text-rose-300" },
};

export const PIPELINE_STATUSES: JobStatus[] = ["applied", "recruiter_call", "interview"];
export const CLOSED_STATUSES: JobStatus[] = ["rejected", "withdrawn", "ghosted", "position_filled"];

export const STATUS_CHECK_SQL = JOB_STATUSES.map((s) => `'${s}'`).join(",");
