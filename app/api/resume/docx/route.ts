import { NextRequest, NextResponse } from "next/server";
import { buildDocxBuffer } from "@/lib/md-to-docx";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  try {
    const { content, filename } = await req.json();
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const buffer = await buildDocxBuffer(content);
    const outFilename = filename ?? "resume.docx";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${outFilename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}
