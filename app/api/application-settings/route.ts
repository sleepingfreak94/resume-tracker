import { NextRequest, NextResponse } from "next/server";
import {
  getApplicationAutomationSettings,
  updateApplicationAutomationSettings,
} from "@/lib/application-memory";

export async function GET() {
  try {
    return NextResponse.json(getApplicationAutomationSettings());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const input: Parameters<typeof updateApplicationAutomationSettings>[0] = {};
    for (const key of ["auto_continue", "final_review", "pause_on_unknown"] as const) {
      if (key in body) {
        if (typeof body[key] !== "boolean") throw new Error(`${key} must be true or false`);
        input[key] = body[key];
      }
    }
    if ("wait_seconds" in body) {
      if (!Number.isInteger(body.wait_seconds)) throw new Error("wait_seconds must be a whole number");
      input.wait_seconds = Number(body.wait_seconds);
    }
    if ("resume_format" in body) {
      if (body.resume_format !== "docx" && body.resume_format !== "pdf") throw new Error("resume_format must be docx or pdf");
      input.resume_format = body.resume_format;
    }
    return NextResponse.json(updateApplicationAutomationSettings(input));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
