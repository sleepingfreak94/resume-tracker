import { NextRequest, NextResponse } from "next/server";
import { buildDocxBuffer } from "@/lib/md-to-docx";
import { sanitizeDownloadFilename } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const { content, filename } = await req.json();
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const buffer = await buildDocxBuffer(content);
    const base = sanitizeDownloadFilename(filename, "resume.docx");
    const outFilename = base.toLowerCase().endsWith(".docx") ? base : `${base}.docx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${outFilename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
