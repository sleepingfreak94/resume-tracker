import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJobStatus, updateJobDetails, deleteJob, logActivity } from "@/lib/db";
import { USER_SELECTABLE_STATUSES, STATUS_CONFIG } from "@/lib/job-status";
import { parsePositiveId, validateJobInput } from "@/lib/validation";
import { removeJobArtifacts } from "@/lib/job-artifacts";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const jobId = parsePositiveId(id);
    if (!jobId) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(job);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const jobId = parsePositiveId(id);
    if (!jobId) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    const body = await req.json();
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (body.status !== undefined) {
      const status = body.status;
      if (!USER_SELECTABLE_STATUSES.includes(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      updateJobStatus(jobId, status);
      if (job.status !== status) {
      const oldLabel = STATUS_CONFIG[job.status as keyof typeof STATUS_CONFIG]?.label ?? job.status;
      const newLabel = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.label ?? status;
      logActivity(jobId, "status_change",
        `Status changed: ${oldLabel} → ${newLabel}`,
        { old_value: job.status, new_value: status }
      );
      }
    }

    if (["company", "title", "description", "job_link"].some((key) => key in body)) {
      const details = validateJobInput({
        company: body.company ?? job.company,
        title: body.title ?? job.title,
        description: body.description ?? job.description,
        job_link: body.job_link === undefined ? job.job_link : body.job_link,
      });
      updateJobDetails(jobId, details);
    }
    return NextResponse.json(getJob(jobId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to update job";
    return NextResponse.json({ error: message }, { status: /UNIQUE/.test(message) ? 409 : 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const jobId = parsePositiveId(id);
    if (!jobId) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    deleteJob(jobId);
    removeJobArtifacts(jobId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
