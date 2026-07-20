import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl, isGoogleConfigured } from "@/lib/google-drive";
import { setSetting } from "@/lib/db";
import { sanitizeReturnTo } from "@/lib/validation";

export async function GET(req: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local." },
      { status: 503 }
    );
  }

  const returnTo = sanitizeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const state = crypto.randomUUID();
  setSetting(`oauth_state:${state}`, JSON.stringify({ returnTo, createdAt: Date.now() }));
  const url = getAuthUrl(state);
  return NextResponse.redirect(url);
}
