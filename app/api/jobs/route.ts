import { NextRequest, NextResponse } from "next/server";
import { listJobs, createJob } from "@/lib/db";

// ponytail: permissive CORS — this API is localhost-only, extension needs it
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  try {
    return NextResponse.json(listJobs(), { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { company, title, description, job_link } = await req.json();

    if (!company || !title || !description) {
      return NextResponse.json(
        { error: "company, title, and description are required" },
        { status: 400, headers: CORS }
      );
    }

    const job = createJob({ company, title, description, job_link: job_link || null });
    return NextResponse.json(job, { status: 201, headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}
