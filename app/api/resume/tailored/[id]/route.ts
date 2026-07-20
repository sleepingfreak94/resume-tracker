import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { getJob } from "@/lib/db";
import { jobArtifactPath, parsePositiveId } from "@/lib/validation";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const jobId = parsePositiveId(id);
    if (!jobId) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const filePath = jobArtifactPath(jobId, "resume");
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ content: null, exists: false });
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return NextResponse.json({ content, exists: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
