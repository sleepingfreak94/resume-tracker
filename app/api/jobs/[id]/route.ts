import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJobStatus, deleteJob, logActivity } from "@/lib/db";
import { JOB_STATUSES, STATUS_CONFIG } from "@/lib/job-status";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = getJob(Number(id));
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });
    return NextResponse.json(job, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const jobId = Number(id);
    const body = await req.json();
    const { status } = body;
    const allowed = [...JOB_STATUSES];
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400, headers: CORS });
    }
    const job = getJob(jobId);
    updateJobStatus(jobId, status);
    if (job && job.status !== status) {
      const oldLabel = STATUS_CONFIG[job.status as keyof typeof STATUS_CONFIG]?.label ?? job.status;
      const newLabel = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.label ?? status;
      logActivity(jobId, "status_change",
        `Status changed: ${oldLabel} → ${newLabel}`,
        { old_value: job.status, new_value: status }
      );
    }
    return NextResponse.json(getJob(jobId), { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = getJob(Number(id));
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404, headers: CORS });
    deleteJob(Number(id));
    return NextResponse.json({ success: true }, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}
