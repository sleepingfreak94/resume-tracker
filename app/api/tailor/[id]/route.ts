import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { claimJobGeneration, getJob, updateJobStatus, listRules, upsertATSScore, logActivity } from "@/lib/db";
import { tailorResume } from "@/lib/agent";
import { computeATSScore } from "@/lib/ats-scorer";
import { parsePositiveId } from "@/lib/validation";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = parsePositiveId(id);
  if (!jobId) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });

  try {
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    if (!claimJobGeneration(jobId)) {
      return NextResponse.json({ error: "Resume generation already in progress" }, { status: 409 });
    }

    const rules = listRules();

    // Run the agent (this is async — it will block until agent completes)
    const result = await tailorResume({
      jobId,
      company: job.company,
      title: job.title,
      description: job.description,
      jobLink: job.job_link,
      rules,
    });

    if (result.success && result.tailoredResumePath) {
      updateJobStatus(jobId, "ready", {
        tailored_resume_path: result.tailoredResumePath,
        agent_id: result.agentId,
      });
      logActivity(jobId, "resume_tailored", "Resume tailored by AI agent");

      // Compute ATS score immediately after tailoring
      try {
        const resume = fs.readFileSync(result.tailoredResumePath, "utf-8");
        const atsResult = computeATSScore(resume, job.description);
        upsertATSScore(jobId, {
          overall_score: atsResult.overall_score,
          keyword_score: atsResult.keyword_score,
          skills_score: atsResult.skills_score,
          experience_score: atsResult.experience_score,
          format_score: atsResult.format_score,
          matched_keywords: JSON.stringify(atsResult.matched_keywords),
          missing_keywords: JSON.stringify(atsResult.missing_keywords),
          computed_at: new Date().toISOString(),
        });
        logActivity(jobId, "score_computed", `ATS score: ${atsResult.overall_score}/100`);
      } catch {
        // Non-fatal — scoring failure shouldn't block tailoring
      }

      return NextResponse.json({ success: true, agentId: result.agentId });
    } else {
      updateJobStatus(jobId, "pending", { agent_id: result.agentId });
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }
  } catch (err) {
    updateJobStatus(jobId, "pending");
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
