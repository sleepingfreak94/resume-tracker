import { NextRequest, NextResponse } from "next/server";
import { getProfile, upsertProfile } from "@/lib/db";

// ponytail: permissive CORS — localhost-only, extension needs this
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  try {
    return NextResponse.json(getProfile(), { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
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
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }
    const profile = upsertProfile(data);
    return NextResponse.json(profile, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}
