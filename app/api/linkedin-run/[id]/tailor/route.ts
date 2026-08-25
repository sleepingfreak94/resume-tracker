import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import {
  getLinkedInRun, getJob, claimJobGeneration, updateJobStatus,
  listRules, upsertATSScore, logActivity, updateLinkedInRun, type LinkedInRunItem,
} from "@/lib/db";
import { tailorResume } from "@/lib/agent";
import { computeATSScore } from "@/lib/ats-scorer";
import { parsePositiveId } from "@/lib/validation";
import { isMeaningfulJobDescription } from "@/lib/linkedin-run";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = parsePositiveId(id);
  if (!runId) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

  const run = getLinkedInRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  // Accept an optional list of jobIds to tailor from the request body.
  // If not provided, tailor all jobs referenced by this run that are still pending.
  let jobIds: number[] = [];
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (Array.isArray(body.jobIds)) {
      jobIds = (body.jobIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    }
  } catch {
    // body parsing failure — proceed without explicit list
  }

  if (jobIds.length === 0) {
    // Derive from run items
    const items: LinkedInRunItem[] = JSON.parse(run.items_json);
    jobIds = [...new Set(items.map((i) => i.jobId).filter((id): id is number => id != null))];
  }

  updateLinkedInRun(runId, { status: "tailoring" });

  const rules = listRules();
  const results: { jobId: number; success: boolean; status?: string; tailoredArtifactExists?: boolean; error?: string }[] = [];

  for (const jobId of jobIds) {
    // Check if run was stopped mid-queue
    const currentRun = getLinkedInRun(runId);
    if (currentRun?.status === "stopped") break;

    const job = getJob(jobId);
    if (!job) { results.push({ jobId, success: false, error: "Not found" }); continue; }
    if (!isMeaningfulJobDescription(job.description, job.title)) {
      results.push({ jobId, success: false, status: job.status, tailoredArtifactExists: false, error: "Job description is incomplete" });
      continue;
    }
    if (!claimJobGeneration(jobId)) { results.push({ jobId, success: false, error: "Already generating" }); continue; }

    try {
      const result = await tailorResume({
        jobId,
        company: job.company,
        title: job.title,
        description: job.description,
        jobLink: job.job_link,
        rules,
        signal: req.signal,
      });

      if (result.success && result.tailoredResumePath) {
        updateJobStatus(jobId, "ready", { tailored_resume_path: result.tailoredResumePath, agent_id: result.agentId });
        logActivity(jobId, "resume_tailored", "Resume tailored for LinkedIn run");
        try {
          const resume = fs.readFileSync(result.tailoredResumePath, "utf-8");
          const ats = computeATSScore(resume, job.description);
          upsertATSScore(jobId, {
            overall_score: ats.overall_score,
            keyword_score: ats.keyword_score,
            skills_score: ats.skills_score,
            experience_score: ats.experience_score,
            format_score: ats.format_score,
            matched_keywords: JSON.stringify(ats.matched_keywords),
            missing_keywords: JSON.stringify(ats.missing_keywords),
            computed_at: new Date().toISOString(),
          });
          logActivity(jobId, "score_computed", `ATS score: ${ats.overall_score}/100`);
        } catch {
          // Non-fatal
        }
        const preparedJob = getJob(jobId);
        const artifactExists = Boolean(preparedJob?.tailored_resume_path && fs.existsSync(preparedJob.tailored_resume_path));
        results.push({ jobId, success: artifactExists && preparedJob?.status === "ready", status: preparedJob?.status, tailoredArtifactExists: artifactExists });
      } else {
        updateJobStatus(jobId, "pending", { agent_id: result.agentId });
        results.push({ jobId, success: false, status: "pending", tailoredArtifactExists: false, error: result.error });
      }
    } catch (err) {
      updateJobStatus(jobId, "pending");
      results.push({ jobId, success: false, status: "pending", tailoredArtifactExists: false, error: String(err) });
    }
  }

  // Only move to 'running' if it wasn't stopped; the extension will finish the run
  const afterRun = getLinkedInRun(runId);
  if (afterRun?.status === "tailoring") {
    updateLinkedInRun(runId, { status: "running" });
  }

  return NextResponse.json({ results });
}
