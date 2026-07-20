import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { jobArtifactPath, parsePositiveId } from "@/lib/validation";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const jobId = parsePositiveId(id);
    if (!jobId) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    const filePath = jobArtifactPath(jobId, "cover-letter");
    if (!fs.existsSync(filePath)) return NextResponse.json({ content: null, exists: false });
    return NextResponse.json({ content: fs.readFileSync(filePath, "utf-8"), exists: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
