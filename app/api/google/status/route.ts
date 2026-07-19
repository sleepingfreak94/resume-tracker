import { NextResponse } from "next/server";
import { isGoogleConfigured, isGoogleConnected } from "@/lib/google-drive";

export async function GET() {
  return NextResponse.json({
    configured: isGoogleConfigured(),
    connected: isGoogleConnected(),
  });
}
