import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl, isGoogleConfigured } from "@/lib/google-drive";

export async function GET(req: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local." },
      { status: 503 }
    );
  }

  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/";
  const url = getAuthUrl(returnTo);
  return NextResponse.redirect(url);
}
