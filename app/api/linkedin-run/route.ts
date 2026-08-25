import { NextRequest, NextResponse } from "next/server";
import { createLinkedInRun, getActiveLinkedInRun, listLinkedInRuns } from "@/lib/db";
import { validateLinkedInRunInput, buildLinkedInSearchUrl } from "@/lib/linkedin-run";
import { assertSelectedProviderReady } from "@/lib/ai-provider";

export async function GET() {
  return NextResponse.json(listLinkedInRuns());
}

export async function POST(req: NextRequest) {
  try {
    const input = validateLinkedInRunInput(await req.json());
    const existing = getActiveLinkedInRun();
    if (existing) return NextResponse.json({ error: `LinkedIn run ${existing.id} is already active` }, { status: 409 });
    await assertSelectedProviderReady({ requireBaseResume: true, signal: req.signal });
    const run = createLinkedInRun({
      keywords: input.keywords,
      location: input.location,
      max_jobs: input.max_jobs,
      auto_submit: input.auto_submit ? 1 : 0,
    });
    const searchUrl = buildLinkedInSearchUrl({ keywords: run.keywords, location: run.location });
    return NextResponse.json({ run, searchUrl }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
