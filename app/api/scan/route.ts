import { NextResponse } from "next/server";
import { getDb, listPortals } from "@/lib/db";
import { scanGreenhouse, scanAshby, scanLever, type Portal, type ScannedJob } from "@/lib/scanner";
import { canonicalizeJobUrl } from "@/lib/validation";

export async function POST() {
  try {
    const portals = listPortals();

    // Fetch all existing job links for deduplication in one query
    const existing = new Set<string>(
      (getDb().prepare("SELECT job_link FROM jobs WHERE job_link IS NOT NULL").all() as { job_link: string }[]).map(
        (r) => {
          try { return canonicalizeJobUrl(r.job_link) ?? r.job_link; } catch { return r.job_link; }
        }
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
        let link: string | null = null;
        try { link = canonicalizeJobUrl(job.job_link); } catch { /* invalid scanner result */ }
        if (!link || existing.has(link)) {
          skipped++;
        } else {
          existing.add(link);
          jobs.push({ ...job, job_link: link });
        }
      }
    });

    return NextResponse.json({ jobs, skipped, errors });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
