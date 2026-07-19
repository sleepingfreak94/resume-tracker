import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const filePath = path.join(process.cwd(), "resumes", "tailored", `job-${id}-cover-letter.md`);
    if (!fs.existsSync(filePath)) return NextResponse.json({ content: null, exists: false }, { headers: CORS });
    return NextResponse.json({ content: fs.readFileSync(filePath, "utf-8"), exists: true }, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}
