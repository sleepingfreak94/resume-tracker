import { NextRequest, NextResponse } from "next/server";
import { decodeReturnTo, exchangeCodeForTokens } from "@/lib/google-drive";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    const returnTo = decodeReturnTo(state);
    return NextResponse.redirect(
      new URL(`${returnTo}?driveError=${encodeURIComponent(error)}`, req.nextUrl.origin)
    );
  }

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  try {
    await exchangeCodeForTokens(code);
    const returnTo = decodeReturnTo(state);
    return NextResponse.redirect(new URL(`${returnTo}?driveConnected=1`, req.nextUrl.origin));
  } catch (err) {
    const returnTo = decodeReturnTo(state);
    return NextResponse.redirect(
      new URL(`${returnTo}?driveError=${encodeURIComponent(String(err))}`, req.nextUrl.origin)
    );
  }
}
