import { getDb } from "./db";
import type { Job, JobActivity } from "./db";

export const ACTIVE_STATUSES = new Set(["applied", "recruiter_call", "interview"]);
const STALE_THRESHOLD_DAYS = 7;

export interface StaleJob {
  job: Job;
  daysSinceActivity: number;
  lastActivity: JobActivity | null;
  suggestedAction: string;
}

function getSuggestedAction(status: string, days: number): string {
  if (status === "applied") {
    return days >= 14
      ? "No response after 2 weeks — consider marking as ghosted or sending a final follow-up"
      : "Send a follow-up email to the recruiter";
  }
  if (status === "recruiter_call") {
    return "Follow up on next steps from the recruiter call";
  }
  if (status === "interview") {
    return "Follow up on interview feedback or next round timeline";
  }
  return "Update the status or add a note";
}

export function getStaleJobs(thresholdDays = STALE_THRESHOLD_DAYS): StaleJob[] {
  const db = getDb();

  const jobs = db.prepare(`
    SELECT * FROM jobs
    WHERE status IN ('applied', 'recruiter_call', 'interview')
    AND (
      last_activity_at IS NULL
      OR (julianday('now') - julianday(last_activity_at)) >= ?
    )
    ORDER BY last_activity_at ASC NULLS FIRST
  `).all(thresholdDays) as Job[];

  return jobs.map((job) => {
    const lastActivity = db.prepare(
      "SELECT * FROM job_activities WHERE job_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(job.id) as JobActivity | null;

    const ref = job.last_activity_at ?? job.created_at;
    const daysSinceActivity = Math.floor((Date.now() - new Date(ref).getTime()) / 86_400_000);

    return {
      job,
      daysSinceActivity,
      lastActivity,
      suggestedAction: getSuggestedAction(job.status, daysSinceActivity),
    };
  });
}
