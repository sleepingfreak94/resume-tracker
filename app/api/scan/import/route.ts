import { NextRequest, NextResponse } from "next/server";
import { getDb, createJob } from "@/lib/db";
import type { ScannedJob } from "@/lib/scanner";

export async function POST(req: NextRequest) {
  try {
    const { jobs } = (await req.json()) as { jobs: ScannedJob[] };
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return NextResponse.json({ error: "jobs array is required" }, { status: 400 });
    }

    // ponytail: wrap in a transaction so partial failures don't leave orphaned rows
    const insert = getDb().transaction(() => {
      let imported = 0;
      for (const job of jobs) {
        if (!job.title || !job.company || !job.description) continue;
        createJob({
          company: job.company,
          title: job.title,
          description: job.description,
          job_link: job.job_link || null,
        });
        imported++;
      }
      return imported;
    });

    const imported = insert();
    return NextResponse.json({ imported });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
