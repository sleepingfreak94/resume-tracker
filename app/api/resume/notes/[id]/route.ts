import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const filePath = path.join(process.cwd(), "resumes", "tailored", `job-${id}-notes.md`);
    if (!fs.existsSync(filePath)) return NextResponse.json({ content: null, exists: false });
    return NextResponse.json({ content: fs.readFileSync(filePath, "utf-8"), exists: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
