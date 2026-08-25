import { NextResponse } from "next/server";
import { getActiveLinkedInRun } from "@/lib/db";
import { buildLinkedInSearchUrl } from "@/lib/linkedin-run";

export async function GET() {
  const run = getActiveLinkedInRun();
  if (!run) return NextResponse.json(null);
  const searchUrl = buildLinkedInSearchUrl({ keywords: run.keywords, location: run.location });
  return NextResponse.json({ run, searchUrl });
}
