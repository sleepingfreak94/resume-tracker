import { NextRequest, NextResponse } from "next/server";
import { parsePortalUrl } from "@/lib/scanner";
import { createPortal, deletePortal, listPortals, type Portal } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json(listPortals());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { url, name } = (await req.json()) as { url?: string; name?: string };

    if (!url || !name?.trim()) {
      return NextResponse.json({ error: "url and name are required" }, { status: 400 });
    }

    const detected = parsePortalUrl(url);
    if (!detected) {
      return NextResponse.json(
        { error: "Unrecognised ATS URL. Supported: jobs.ashbyhq.com, job-boards.greenhouse.io, jobs.lever.co" },
        { status: 422 }
      );
    }

    const entry = createPortal({ name: name.trim().slice(0, 120), ...detected });

    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    const message = String(err);
    return NextResponse.json(
      { error: /UNIQUE/.test(message) ? "This company is already in your portal list" : "Unable to add portal" },
      { status: /UNIQUE/.test(message) ? 409 : 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { ats, slug } = (await req.json()) as { ats?: string; slug?: string };
    if (!ats || !slug) {
      return NextResponse.json({ error: "ats and slug are required" }, { status: 400 });
    }
    if (!["greenhouse", "ashby", "lever"].includes(ats)) {
      return NextResponse.json({ error: "Invalid ATS" }, { status: 400 });
    }
    const deleted = deletePortal(ats as Portal["ats"], slug);
    return NextResponse.json({ ok: deleted });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
