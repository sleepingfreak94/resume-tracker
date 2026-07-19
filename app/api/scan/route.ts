import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getDb } from "@/lib/db";
import { scanGreenhouse, scanAshby, scanLever, type Portal, type ScannedJob } from "@/lib/scanner";

function loadPortals(): Portal[] {
  const p = path.join(process.cwd(), "portals.json");
  return JSON.parse(fs.readFileSync(p, "utf-8")) as Portal[];
}

export async function POST() {
  try {
    const portals = loadPortals();

    // Fetch all existing job links for deduplication in one query
    const existing = new Set<string>(
      (getDb().prepare("SELECT job_link FROM jobs WHERE job_link IS NOT NULL").all() as { job_link: string }[]).map(
        (r) => r.job_link
      )
    );

    const scanners: Record<Portal["ats"], (slug: string, company: string) => Promise<ScannedJob[]>> = {
      greenhouse: scanGreenhouse,
      ashby: scanAshby,
      lever: scanLever,
    };

    const results = await Promise.allSettled(
      portals.map((p) => scanners[p.ats](p.slug, p.name))
    );

    const jobs: ScannedJob[] = [];
    const errors: string[] = [];
    let skipped = 0;

    results.forEach((r, i) => {
      if (r.status === "rejected") {
        errors.push(`${portals[i].name}: ${String(r.reason)}`);
        return;
      }
      for (const job of r.value) {
        if (!job.job_link || existing.has(job.job_link)) {
          skipped++;
        } else {
          jobs.push(job);
        }
      }
    });

    return NextResponse.json({ jobs, skipped, errors });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
