import { NextRequest, NextResponse } from "next/server";
import { expireStaleLinkedInRuns, getLinkedInRun, updateLinkedInRun, appendLinkedInRunItem, heartbeatLinkedInRun, type LinkedInRunStatus, type LinkedInRunItem } from "@/lib/db";
import { parsePositiveId } from "@/lib/validation";
import { buildLinkedInSearchUrl, deriveLinkedInRunRecovery, normalizeLinkedInRunItems, summarizeRun, validateLinkedInRunItem } from "@/lib/linkedin-run";

function responseFor(run: NonNullable<ReturnType<typeof getLinkedInRun>>) {
  const items = normalizeLinkedInRunItems(JSON.parse(run.items_json) as LinkedInRunItem[]);
  return {
    run,
    items,
    summary: summarizeRun(items),
    searchUrl: buildLinkedInSearchUrl({ keywords: run.keywords, location: run.location, appPort: run.app_port, runId: run.id }),
    recovery: deriveLinkedInRunRecovery(run, items),
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = parsePositiveId(id);
  if (!runId) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

  expireStaleLinkedInRuns();
  const run = getLinkedInRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  return NextResponse.json(responseFor(run));
}

const VALID_STATUSES: LinkedInRunStatus[] = ["queued", "running", "tailoring", "done", "stopped", "failed"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = parsePositiveId(id);
  if (!runId) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

  expireStaleLinkedInRuns();
  const run = getLinkedInRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  try {
    const body = await req.json() as Record<string, unknown>;

    if ((body.item || body.heartbeat === true) && !["queued", "running", "tailoring"].includes(run.status)) {
      return NextResponse.json({ error: "Run is no longer active" }, { status: 409 });
    }

    if (body.item) {
      appendLinkedInRunItem(runId, validateLinkedInRunItem(body.item));
    }
    if (body.heartbeat === true) heartbeatLinkedInRun(runId);

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
    return NextResponse.json(responseFor(updated));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
