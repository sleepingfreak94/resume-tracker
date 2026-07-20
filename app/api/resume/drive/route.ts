import { NextRequest, NextResponse } from "next/server";
import { buildDocxBuffer } from "@/lib/md-to-docx";
import {
  clearTokens,
  isGoogleConfigured,
  isGoogleConnected,
  isInvalidGrantError,
  uploadDocx,
} from "@/lib/google-drive";
import { getSetting, setSetting } from "@/lib/db";
import { sanitizeDownloadFilename } from "@/lib/validation";

function driveSettingKey(key: string) {
  return `drive_url:${key}`;
}

function needsAuthResponse() {
  return NextResponse.json({ error: "Not connected to Google Drive", needsAuth: true }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key || !/^[a-zA-Z0-9:_-]{1,100}$/.test(key)) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  return NextResponse.json({ url: getSetting(driveSettingKey(key)) });
}

export async function POST(req: NextRequest) {
  try {
    if (!isGoogleConfigured()) {
      return NextResponse.json(
        { error: "Google OAuth not configured", needsSetup: true },
        { status: 503 }
      );
    }

    if (!isGoogleConnected()) {
      return needsAuthResponse();
    }

    const { content, filename, storageKey } = await req.json();
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const buffer = await buildDocxBuffer(content);
    const base = sanitizeDownloadFilename(filename, "resume.docx");
    const outFilename = base.toLowerCase().endsWith(".docx") ? base : `${base}.docx`;
    const { fileId, url } = await uploadDocx(buffer, outFilename);

    if (typeof storageKey === "string" && /^[a-zA-Z0-9:_-]{1,100}$/.test(storageKey)) {
      setSetting(driveSettingKey(storageKey), url);
    }

    return NextResponse.json({ success: true, fileId, url });
  } catch (err) {
    if (String(err).includes("NOT_CONNECTED") || isInvalidGrantError(err)) {
      // Stale refresh token still looks "connected" until upload; clear so UI prompts re-auth.
      if (isInvalidGrantError(err)) clearTokens();
      return needsAuthResponse();
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
