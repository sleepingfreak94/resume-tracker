import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { parsePortalUrl, type Portal } from "@/lib/scanner";

const PORTALS_PATH = path.join(process.cwd(), "portals.json");

function read(): Portal[] {
  return JSON.parse(fs.readFileSync(PORTALS_PATH, "utf-8")) as Portal[];
}

export async function GET() {
  try {
    return NextResponse.json(read());
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

    const portals = read();

    // Avoid exact duplicates
    if (portals.some((p) => p.ats === detected.ats && p.slug === detected.slug)) {
      return NextResponse.json({ error: "This company is already in your portal list" }, { status: 409 });
    }

    const entry: Portal = { name: name.trim(), ...detected };
    portals.push(entry);
    fs.writeFileSync(PORTALS_PATH, JSON.stringify(portals, null, 2));

    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { ats, slug } = (await req.json()) as { ats?: string; slug?: string };
    if (!ats || !slug) {
      return NextResponse.json({ error: "ats and slug are required" }, { status: 400 });
    }
    const portals = read().filter((p) => !(p.ats === ats && p.slug === slug));
    fs.writeFileSync(PORTALS_PATH, JSON.stringify(portals, null, 2));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
