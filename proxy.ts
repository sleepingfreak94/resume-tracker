import { NextRequest, NextResponse } from "next/server";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function allowedExtensionOrigin(origin: string): boolean {
  if (!origin.startsWith("chrome-extension://")) return false;
  const requiredId = process.env.RESUME_TRACKER_EXTENSION_ID?.trim();
  return !requiredId || origin === `chrome-extension://${requiredId}`;
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  let hostname = "";
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    hostname = "";
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    return NextResponse.json({ error: "Resume Tracker only accepts local connections" }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  let sameOrigin = false;
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      sameOrigin = parsedOrigin.protocol === "http:" && parsedOrigin.host === host;
    } catch {
      sameOrigin = false;
    }
  }
  if (origin && !sameOrigin && !allowedExtensionOrigin(origin)) {
    return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }

  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    if (origin && allowedExtensionOrigin(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      response.headers.set("Access-Control-Allow-Headers", "Content-Type");
      response.headers.set("Vary", "Origin");
    }
    return response;
  }

  const response = NextResponse.next();
  if (origin && allowedExtensionOrigin(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: "/api/:path*" };
