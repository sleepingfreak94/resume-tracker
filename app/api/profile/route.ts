import { NextRequest, NextResponse } from "next/server";
import { getProfile, upsertProfile } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json(getProfile());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    // Only allow known profile fields
    const allowed = [
      "first_name", "last_name", "email", "phone", "linkedin_url",
      "portfolio_url", "location", "current_company", "current_title",
      "work_authorization", "requires_sponsorship", "has_work_permit", "has_pr",
      "years_experience", "education_level",
    ];
    const data: Record<string, unknown> = {};
    const toggles = new Set(["requires_sponsorship", "has_work_permit", "has_pr"]);
    for (const key of allowed) {
      if (!(key in body)) continue;
      const value = body[key];
      if (toggles.has(key)) {
        if (![0, 1, false, true].includes(value as never)) return NextResponse.json({ error: `${key} must be a boolean` }, { status: 400 });
        data[key] = value ? 1 : 0;
        continue;
      }
      if (key === "years_experience") {
        if (value !== null && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 60)) return NextResponse.json({ error: "years_experience must be between 0 and 60" }, { status: 400 });
        data[key] = value;
        continue;
      }
      if (value !== null && typeof value !== "string") return NextResponse.json({ error: `${key} must be text` }, { status: 400 });
      if (typeof value === "string" && value.length > 500) {
        return NextResponse.json({ error: `${key} is too long` }, { status: 400 });
      }
      data[key] = typeof value === "string" ? value.trim() : value;
    }
    const profile = upsertProfile(data);
    return NextResponse.json(profile);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
