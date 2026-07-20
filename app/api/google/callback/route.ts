import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/google-drive";
import { deleteSetting, getSetting } from "@/lib/db";
import { sanitizeReturnTo } from "@/lib/validation";

function consumeState(state: string | null): string | null {
  if (!state || !/^[0-9a-f-]{36}$/i.test(state)) return null;
  const key = `oauth_state:${state}`;
  const stored = getSetting(key);
  deleteSetting(key);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as { returnTo?: unknown; createdAt?: unknown };
    if (typeof value.createdAt !== "number" || Date.now() - value.createdAt > 10 * 60 * 1000) return null;
    return sanitizeReturnTo(value.returnTo);
  } catch {
    return null;
  }
}

function redirectWith(req: NextRequest, returnTo: string, key: string, value: string) {
  const destination = new URL(returnTo, req.nextUrl.origin);
  destination.searchParams.set(key, value);
  return NextResponse.redirect(destination);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const returnTo = consumeState(state);

  if (!returnTo) {
    return NextResponse.json({ error: "Invalid or expired OAuth state" }, { status: 400 });
  }

  if (error) {
    return redirectWith(req, returnTo, "driveError", "Authorization was cancelled");
  }

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  try {
    await exchangeCodeForTokens(code);
    return redirectWith(req, returnTo, "driveConnected", "1");
  } catch {
    return redirectWith(req, returnTo, "driveError", "Google Drive connection failed");
  }
}
