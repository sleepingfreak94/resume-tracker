import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const RESUME_PATH = path.join(process.cwd(), "resumes", "base-resume.md");

export async function GET() {
  try {
    if (!fs.existsSync(RESUME_PATH)) {
      return NextResponse.json({ content: null, exists: false });
    }
    const content = fs.readFileSync(RESUME_PATH, "utf-8");
    return NextResponse.json({ content, exists: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    let content: string;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      content = await file.text();
    } else {
      const body = await req.json();
      content = body.content;
      if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    if (typeof content !== "string" || content.length > 1_000_000) {
      return NextResponse.json({ error: "Resume must be text under 1 MB" }, { status: 400 });
    }
    const dir = path.dirname(RESUME_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RESUME_PATH, content, "utf-8");

    return NextResponse.json({ success: true, path: RESUME_PATH });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
