import { NextRequest, NextResponse } from "next/server";
import { getDb, getLinkedInRun, invalidateJobGeneration, logActivity } from "@/lib/db";
import { parsePositiveId } from "@/lib/validation";
import { isMeaningfulJobDescription, validateLinkedInJobInput } from "@/lib/linkedin-run";
import { removeJobArtifacts } from "@/lib/job-artifacts";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = parsePositiveId(id);
  if (!runId) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

  const run = getLinkedInRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!["queued", "running", "tailoring"].includes(run.status)) {
    return NextResponse.json({ error: "Run is not active" }, { status: 409 });
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const expectedJobId = typeof body.linkedInJobId === "string" ? body.linkedInJobId : undefined;
    const validated = validateLinkedInJobInput(body, expectedJobId);

    const db = getDb();

    // Upsert: the unique index on job_link means INSERT OR IGNORE dedupes cleanly.
    const insertResult = db.prepare(
      "INSERT OR IGNORE INTO jobs (company, title, description, job_link) VALUES (?, ?, ?, ?)"
    ).run(validated.company, validated.title, validated.description, validated.job_link);

    let jobId: number;
    if (insertResult.changes === 1) {
      jobId = insertResult.lastInsertRowid as number;
    } else {
      // Already exists — find by job_link
      const existing = db.prepare("SELECT id, title, description FROM jobs WHERE job_link = ?").get(validated.job_link) as { id: number; title: string; description: string } | undefined;
      if (!existing) return NextResponse.json({ error: "Job deduplication failed" }, { status: 500 });
      jobId = existing.id;
      if (!isMeaningfulJobDescription(existing.description, existing.title)) {
        removeJobArtifacts(jobId);
        invalidateJobGeneration(jobId);
        db.prepare(
          "UPDATE jobs SET company = ?, title = ?, description = ?, job_link = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(validated.company, validated.title, validated.description, validated.job_link, jobId);
        logActivity(jobId, "status_change", "Repaired incomplete LinkedIn job description and invalidated stale generated documents");
      }
    }

    const savedJob = db.prepare("SELECT status, tailored_resume_path FROM jobs WHERE id = ?").get(jobId) as { status: string; tailored_resume_path: string | null };
    return NextResponse.json({ jobId, created: insertResult.changes === 1, jobStatus: savedJob.status, tailoredResumePath: savedJob.tailored_resume_path }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
