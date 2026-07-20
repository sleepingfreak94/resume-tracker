import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { ScannedJob } from "@/lib/scanner";
import { validateJobInput } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const { jobs } = (await req.json()) as { jobs: ScannedJob[] };
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return NextResponse.json({ error: "jobs array is required" }, { status: 400 });
    }

    const validated = jobs.map(validateJobInput);
    const insert = getDb().transaction(() => {
      let imported = 0;
      let skipped = 0;
      const statement = getDb().prepare(
        "INSERT OR IGNORE INTO jobs (company, title, description, job_link) VALUES (?, ?, ?, ?)"
      );
      for (const job of validated) {
        const result = statement.run(job.company, job.title, job.description, job.job_link);
        if (result.changes === 1) imported++;
        else skipped++;
      }
      return { imported, skipped };
    });

    return NextResponse.json(insert());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Import failed" }, { status: 400 });
  }
}
