import { NextRequest, NextResponse } from "next/server";
import { getLinkedInRun, updateLinkedInRun, appendLinkedInRunItem, type LinkedInRunStatus, type LinkedInRunItem } from "@/lib/db";
import { parsePositiveId } from "@/lib/validation";
import { normalizeLinkedInRunItems, summarizeRun, validateLinkedInRunItem } from "@/lib/linkedin-run";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = parsePositiveId(id);
  if (!runId) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

  const run = getLinkedInRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const items = normalizeLinkedInRunItems(JSON.parse(run.items_json) as LinkedInRunItem[]);
  return NextResponse.json({ run, items, summary: summarizeRun(items) });
}

const VALID_STATUSES: LinkedInRunStatus[] = ["queued", "running", "tailoring", "done", "stopped", "failed"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = parsePositiveId(id);
  if (!runId) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

  const run = getLinkedInRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  try {
    const body = await req.json() as Record<string, unknown>;

    if (body.item) {
      appendLinkedInRunItem(runId, validateLinkedInRunItem(body.item));
    }

    const updates: Parameters<typeof updateLinkedInRun>[1] = {};
    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status as LinkedInRunStatus)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      updates.status = body.status as LinkedInRunStatus;
    }
    if (body.note !== undefined) {
      updates.note = String(body.note);
    }
    if (Object.keys(updates).length > 0) {
      updateLinkedInRun(runId, updates);
    }

    const updated = getLinkedInRun(runId)!;
    const items = normalizeLinkedInRunItems(JSON.parse(updated.items_json) as LinkedInRunItem[]);
    return NextResponse.json({ run: updated, items, summary: summarizeRun(items) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
