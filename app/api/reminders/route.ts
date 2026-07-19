import { NextResponse } from "next/server";
import { getStaleJobs } from "@/lib/activity-tracker";

export async function GET() {
  try {
    const stale = getStaleJobs();
    return NextResponse.json(stale);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
