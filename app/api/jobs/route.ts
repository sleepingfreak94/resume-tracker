import { NextRequest, NextResponse } from "next/server";
import { listJobs, createJob } from "@/lib/db";
import { validateJobInput } from "@/lib/validation";

export async function GET() {
  try {
    return NextResponse.json(listJobs());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const input = validateJobInput(await req.json());
    const job = createJob(input);
    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to create job";
    const status = /UNIQUE constraint failed/.test(message) ? 409 : 400;
    return NextResponse.json({ error: status === 409 ? "This job link is already tracked" : message }, { status });
  }
}
