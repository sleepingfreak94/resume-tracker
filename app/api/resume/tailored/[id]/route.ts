import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getJob } from "@/lib/db";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = getJob(Number(id));
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const filePath = path.join(process.cwd(), "resumes", "tailored", `job-${id}.md`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ content: null, exists: false }, { headers: CORS });
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return NextResponse.json({ content, exists: true }, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}
