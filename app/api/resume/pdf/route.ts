import { NextRequest, NextResponse } from "next/server";
import { buildPdfBuffer } from "@/lib/md-to-pdf";
import { sanitizeDownloadFilename } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    if (content.length > 1_000_000) {
      return NextResponse.json({ error: "Resume must be under 1 MB" }, { status: 400 });
    }

    const buffer = await buildPdfBuffer(content);
    const base = sanitizeDownloadFilename(body.filename, "resume.pdf");
    const filename = base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
