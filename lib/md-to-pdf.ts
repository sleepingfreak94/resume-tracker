import { PDFDocument, PDFPage, PDFFont, PDFString, StandardFonts, rgb } from "pdf-lib";
import { parseJobLine } from "./resume-format";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 42;
const MARGIN_TOP = 38;
const MARGIN_BOTTOM = 38;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const ACCENT = rgb(31 / 255, 56 / 255, 100 / 255);
const TEXT = rgb(42 / 255, 46 / 255, 54 / 255);
const MUTED = rgb(84 / 255, 91 / 255, 103 / 255);
const LINK = rgb(17 / 255, 85 / 255, 170 / 255);

function safeLinkTarget(value: string): string | null {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return trimmed;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return `mailto:${trimmed}`;
  return null;
}

function plainText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/[^\x09\x20-\x7e\xa0-\xff]/g, "")
    .trim();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = plainText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const character of word) {
      if (font.widthOfTextAtSize(chunk + character, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildPdfBuffer(markdown: string): Promise<Buffer> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const italic = await document.embedFont(StandardFonts.HelveticaOblique);
  let page: PDFPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN_TOP;

  function newPage() {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN_TOP;
  }

  function ensureSpace(height: number) {
    if (y - height < MARGIN_BOTTOM) newPage();
  }

  function addLinkAnnotation(targetPage: PDFPage, target: string, x: number, baseline: number, width: number, height: number) {
    const safeTarget = safeLinkTarget(target);
    if (!safeTarget) return;
    const annotation = document.context.register(document.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, baseline - 1, x + width, baseline + height],
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFString.of(safeTarget),
      },
    }));
    targetPage.node.addAnnot(annotation);
  }

  function drawContactLine(source: string) {
    const parts = source.split("|").map((part) => part.trim()).filter(Boolean);
    const segments: { text: string; target?: string }[] = [];
    parts.forEach((part, index) => {
      if (index > 0) segments.push({ text: "  |  " });
      const markdownLink = /^\[([^\]]+)]\(([^)]+)\)$/.exec(part);
      if (markdownLink) {
        segments.push({ text: plainText(markdownLink[1]), target: markdownLink[2] });
      } else {
        const text = plainText(part);
        segments.push({ text, target: safeLinkTarget(text) ?? undefined });
      }
    });

    let size = 8.8;
    let totalWidth = segments.reduce((sum, segment) => sum + regular.widthOfTextAtSize(segment.text, size), 0);
    if (totalWidth > CONTENT_WIDTH) {
      size = Math.max(7.4, size * CONTENT_WIDTH / totalWidth);
      totalWidth = segments.reduce((sum, segment) => sum + regular.widthOfTextAtSize(segment.text, size), 0);
    }

    if (totalWidth > CONTENT_WIDTH) {
      for (const part of parts) {
        const markdownLink = /^\[([^\]]+)]\(([^)]+)\)$/.exec(part);
        const text = plainText(markdownLink?.[1] ?? part);
        const target = markdownLink?.[2] ?? safeLinkTarget(text);
        const width = regular.widthOfTextAtSize(text, size);
        ensureSpace(size + 5);
        const x = MARGIN_X + Math.max(0, (CONTENT_WIDTH - width) / 2);
        const baseline = y - size;
        page.drawText(text, { x, y: baseline, size, font: regular, color: target ? LINK : MUTED });
        if (target) {
          page.drawLine({ start: { x, y: baseline - 1 }, end: { x: x + width, y: baseline - 1 }, thickness: 0.45, color: LINK });
          addLinkAnnotation(page, target, x, baseline, width, size + 2);
        }
        y -= size + 5;
      }
      y -= 3;
      return;
    }

    ensureSpace(size + 10);
    let x = MARGIN_X + (CONTENT_WIDTH - totalWidth) / 2;
    const baseline = y - size;
    for (const segment of segments) {
      const width = regular.widthOfTextAtSize(segment.text, size);
      page.drawText(segment.text, { x, y: baseline, size, font: regular, color: segment.target ? LINK : MUTED });
      if (segment.target) {
        page.drawLine({ start: { x, y: baseline - 1 }, end: { x: x + width, y: baseline - 1 }, thickness: 0.45, color: LINK });
        addLinkAnnotation(page, segment.target, x, baseline, width, size + 2);
      }
      x += width;
    }
    y -= size + 7;
  }

  function drawWrapped(text: string, options: {
    font?: PDFFont;
    size?: number;
    color?: ReturnType<typeof rgb>;
    x?: number;
    width?: number;
    lineHeight?: number;
    align?: "left" | "center";
    after?: number;
  } = {}) {
    const font = options.font ?? regular;
    const size = options.size ?? 10;
    const color = options.color ?? TEXT;
    const x = options.x ?? MARGIN_X;
    const width = options.width ?? CONTENT_WIDTH;
    const lineHeight = options.lineHeight ?? size * 1.28;
    const lines = wrapText(text, font, size, width);
    ensureSpace(lines.length * lineHeight + (options.after ?? 0));
    for (const line of lines) {
      const lineWidth = font.widthOfTextAtSize(line, size);
      page.drawText(line, {
        x: options.align === "center" ? x + Math.max(0, (width - lineWidth) / 2) : x,
        y: y - size,
        size,
        font,
        color,
      });
      y -= lineHeight;
    }
    y -= options.after ?? 0;
  }

  const lines = markdown.split(/\r?\n/);
  let i = 0;
  let seenName = false;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || /^(---|\*\*\*|___)$/.test(line)) {
      i += 1;
      continue;
    }

    if (line.startsWith("# ")) {
      ensureSpace(50);
      drawWrapped(line.slice(2), { font: bold, size: 19, color: ACCENT, align: "center", lineHeight: 22, after: 2 });
      const next = lines[i + 1]?.trim() ?? "";
      if (/^\*\*(.+)\*\*$/.test(next)) {
        drawWrapped(next, { size: 10.5, align: "center", color: TEXT, after: 4 });
        i += 1;
      }
      seenName = true;
      i += 1;
      continue;
    }

    if (seenName && !line.startsWith("#") && (line.includes("|") || /\[.+\]\(.+\)/.test(line))) {
      drawContactLine(line);
      page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_WIDTH - MARGIN_X, y }, thickness: 0.7, color: ACCENT });
      y -= 8;
      seenName = false;
      i += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      ensureSpace(28);
      y -= 6;
      drawWrapped(line.slice(3).toUpperCase(), { font: bold, size: 10.5, color: ACCENT, lineHeight: 13, after: 2 });
      page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_WIDTH - MARGIN_X, y }, thickness: 0.65, color: ACCENT });
      y -= 6;
      i += 1;
      continue;
    }

    if (line.startsWith("### ")) {
      ensureSpace(36);
      y -= 3;
      const company = plainText(line.slice(4));
      const next = lines[i + 1]?.trim() ?? "";
      const job = parseJobLine(next);
      if (job) {
        const companySize = 10.5;
        const date = plainText(job.dateRange);
        page.drawText(company, { x: MARGIN_X, y: y - companySize, size: companySize, font: bold, color: ACCENT });
        const dateWidth = italic.widthOfTextAtSize(date, 9.5);
        page.drawText(date, { x: PAGE_WIDTH - MARGIN_X - dateWidth, y: y - 10, size: 9.5, font: italic, color: MUTED });
        y -= 15;
        drawWrapped(job.title, { font: bold, size: 10, lineHeight: 12, after: 2 });
        i += 1;
      } else {
        drawWrapped(company, { font: bold, size: 10.5, color: ACCENT, lineHeight: 13, after: 2 });
      }
      i += 1;
      continue;
    }

    if (line.startsWith("- ")) {
      const body = line.slice(2);
      const bulletX = MARGIN_X + 2;
      const textX = MARGIN_X + 13;
      const width = CONTENT_WIDTH - 13;
      const wrapped = wrapText(body, regular, 9.3, width);
      const lineHeight = 12;
      ensureSpace(Math.max(1, wrapped.length) * lineHeight + 2);
      page.drawText("-", { x: bulletX, y: y - 9.3, size: 9.3, font: bold, color: ACCENT });
      for (const text of wrapped) {
        page.drawText(text, { x: textX, y: y - 9.3, size: 9.3, font: regular, color: TEXT });
        y -= lineHeight;
      }
      y -= 2;
      i += 1;
      continue;
    }

    if (/^\*[^*].*\*$/.test(line)) {
      drawWrapped(line, { font: italic, size: 9.3, color: MUTED, lineHeight: 12, after: 3 });
      i += 1;
      continue;
    }

    const label = /^\*\*(.+?):\*\*\s*(.*)$/.exec(line);
    if (label) {
      drawWrapped(`${label[1]}: ${label[2]}`, { size: 9.3, lineHeight: 12, after: 3 });
      i += 1;
      continue;
    }

    drawWrapped(line, { size: 9.3, lineHeight: 12.2, after: 3 });
    i += 1;
  }

  document.setTitle("Resume");
  document.setCreator("Resume Tracker");
  document.setProducer("Resume Tracker");
  const bytes = await document.save();
  return Buffer.from(bytes);
}
