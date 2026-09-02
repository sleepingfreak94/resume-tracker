import { NextResponse } from "next/server";
import { getActiveLinkedInRun, type LinkedInRunItem } from "@/lib/db";
import { buildLinkedInSearchUrl, deriveLinkedInRunRecovery, normalizeLinkedInRunItems, summarizeRun } from "@/lib/linkedin-run";

export async function GET() {
  const run = getActiveLinkedInRun();
  if (!run) return NextResponse.json(null);
  const items = normalizeLinkedInRunItems(JSON.parse(run.items_json) as LinkedInRunItem[]);
  const searchUrl = buildLinkedInSearchUrl({ keywords: run.keywords, location: run.location, appPort: run.app_port, runId: run.id });
  return NextResponse.json({ run, items, summary: summarizeRun(items), searchUrl, recovery: deriveLinkedInRunRecovery(run, items) });
}
