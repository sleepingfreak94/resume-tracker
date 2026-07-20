import { NextRequest, NextResponse } from "next/server";
import { getJob, getJobActivities, logActivity } from "@/lib/db";
import { parsePositiveId } from "@/lib/validation";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const jobId = parsePositiveId(id);
    if (!jobId) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const activities = getJobActivities(jobId);
    return NextResponse.json(activities);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const jobId = parsePositiveId(id);
    if (!jobId) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { description } = await req.json();
    if (typeof description !== "string" || !description.trim() || description.length > 5_000) return NextResponse.json({ error: "description must be 1–5000 characters" }, { status: 400 });
    logActivity(jobId, "manual_note", description.trim());
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
