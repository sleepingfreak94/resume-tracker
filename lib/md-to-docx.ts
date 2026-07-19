import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  LevelFormat,
  Tab,
  TabStopType,
  convertInchesToTwip,
} from "docx";
import { parseJobLine } from "./resume-format";

const FONT = "Merriweather";

const PAGE_WIDTH = 12240;
const PAGE_MARGIN_LEFT = 720;
const PAGE_MARGIN_RIGHT = 720;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN_LEFT - PAGE_MARGIN_RIGHT;

const ACCENT = "1F3864";
const DARKGRAY = "333333";
const MIDGRAY = "555555";

const bottomBorder = {
  bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 4 },
};

type RunStyle = {
  bold?: boolean;
  italics?: boolean;
  size?: number;
  color?: string;
  underline?: object;
};

function txt(text: string, style: RunStyle = {}): TextRun {
  return new TextRun({ text, font: FONT, size: 20, color: DARKGRAY, ...style });
}

function sectionHeading(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    border: bottomBorder,
    children: [txt(text.toUpperCase(), { bold: true, color: ACCENT, size: 22 })],
  });
}

function jobHeader(title: string, company: string, dateRange: string): Paragraph[] {
  const tabStops = [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }];
  return [
    new Paragraph({
      spacing: { before: 180, after: 20 },
      tabStops,
      children: [
        txt(company, { bold: true, size: 21, color: ACCENT }),
        new TextRun({
          font: FONT,
          italics: true,
          size: 20,
          color: MIDGRAY,
          children: [new Tab(), dateRange],
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 20 },
      children: [txt(title, { bold: true, size: 21, color: DARKGRAY })],
    }),
  ];
}

function subline(text: string) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [txt(text, { italics: true, size: 19, color: MIDGRAY })],
  });
}

function bullet(runs: (TextRun | ExternalHyperlink)[]) {
  return new Paragraph({
    numbering: { reference: "bullet-list", level: 0 },
    spacing: { after: 60 },
    children: runs,
  });
}

function techLine(label: string, text: string) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [
      txt(`${label}: `, { bold: true, size: 19, color: ACCENT }),
      txt(text, { size: 19, color: MIDGRAY }),
    ],
  });
}

function skillCategory(title: string, text: string) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [
      txt(`${title}: `, { bold: true, size: 20, color: ACCENT }),
      txt(text, { size: 20, color: DARKGRAY }),
    ],
  });
}

function nameHeader(name: string, title: string) {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [txt(name.toUpperCase(), { bold: true, size: 40, color: ACCENT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [txt(title, { size: 22, color: DARKGRAY })],
    }),
  ];
}

function contactLine(parts: (string | { text: string; link: string })[]) {
  const children: (TextRun | ExternalHyperlink)[] = [];
  parts.forEach((p, i) => {
    if (i > 0) children.push(txt("  |  ", { size: 19, color: MIDGRAY }));
    if (typeof p === "string") {
      children.push(txt(p, { size: 19, color: MIDGRAY }));
    } else {
      children.push(
        new ExternalHyperlink({
          link: p.link,
          children: [txt(p.text, { size: 19, color: "1155CC", underline: {} })],
        })
      );
    }
  });
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    border: bottomBorder,
    children,
  });
}

type InlineChild = TextRun | ExternalHyperlink;

function parseInline(text: string, baseSize = 20, baseColor = DARKGRAY): InlineChild[] {
  const result: InlineChild[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[(.+?)\]\((.+?)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      result.push(txt(text.slice(last, match.index), { size: baseSize, color: baseColor }));
    }
    if (match[1] !== undefined) {
      result.push(txt(match[1], { bold: true, size: baseSize, color: baseColor }));
    } else if (match[2] !== undefined) {
      result.push(txt(match[2], { italics: true, size: baseSize, color: MIDGRAY }));
    } else if (match[3] !== undefined) {
      result.push(
        new ExternalHyperlink({
          link: match[4],
          children: [txt(match[3], { size: baseSize, color: "1155CC", underline: {} })],
        })
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    result.push(txt(text.slice(last), { size: baseSize, color: baseColor }));
  }
  return result.length > 0 ? result : [txt(text, { size: baseSize, color: baseColor })];
}

// ponytail: line-by-line MD parser — handles resume format only, not full CommonMark
function mdToDocx(md: string): Paragraph[] {
  const lines = md.split("\n");
  const paragraphs: Paragraph[] = [];

  let i = 0;
  let pendingH1: string | null = null;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      i++;
      continue;
    }

    if (trimmed.startsWith("# ")) {
      pendingH1 = trimmed.slice(2).trim();
      i++;
      let subtitle = "";
      if (i < lines.length && /^\*\*(.+)\*\*$/.test(lines[i].trim())) {
        subtitle = lines[i].trim().replace(/^\*\*|\*\*$/g, "");
        i++;
      }
      paragraphs.push(...nameHeader(pendingH1, subtitle));
      continue;
    }

    if (
      pendingH1 &&
      !trimmed.startsWith("#") &&
      (trimmed.includes("|") || /\[.+\]\(.+\)/.test(trimmed)) &&
      trimmed !== ""
    ) {
      const rawParts = trimmed.split("|").map((p) => p.trim()).filter(Boolean);
      const parts: (string | { text: string; link: string })[] = rawParts.map((part) => {
        const linkMatch = /^\[(.+?)\]\((.+?)\)$/.exec(part);
        if (linkMatch) return { text: linkMatch[1], link: linkMatch[2] };
        return part;
      });
      paragraphs.push(contactLine(parts));
      pendingH1 = null;
      i++;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      paragraphs.push(sectionHeading(trimmed.slice(3).trim()));
      i++;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      const company = trimmed.slice(4).trim();
      i++;
      const next = i < lines.length ? lines[i].trim() : "";
      const jobLine = parseJobLine(next);
      if (jobLine) {
        paragraphs.push(...jobHeader(jobLine.title, company, jobLine.dateRange));
        i++;
      } else {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 180, after: 20 },
            children: [txt(company, { bold: true, size: 21, color: ACCENT })],
          })
        );
      }
      continue;
    }

    if (/^\*[^*].*[^*]\*$/.test(trimmed) || /^\*\w+\*$/.test(trimmed)) {
      paragraphs.push(subline(trimmed.replace(/^\*|\*$/g, "")));
      i++;
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const text = trimmed.slice(2);
      const italicCatMatch = /^\*(.+?):\*\s*(.*)$/.exec(text);
      if (italicCatMatch) {
        paragraphs.push(
          bullet([
            txt(`${italicCatMatch[1]}: `, { italics: true, size: 20, color: ACCENT }),
            txt(italicCatMatch[2], { size: 20, color: DARKGRAY }),
          ])
        );
      } else {
        paragraphs.push(bullet(parseInline(text) as (TextRun | ExternalHyperlink)[]));
      }
      i++;
      continue;
    }

    if (/^\*\*(.+?)\*\*[:\s]/.test(trimmed)) {
      const colonLabelMatch = /^\*\*(.+?):\*\*\s*(.*)$/.exec(trimmed);
      if (colonLabelMatch) {
        const label = colonLabelMatch[1].trim();
        const value = colonLabelMatch[2].trim();
        if (value) {
          paragraphs.push(techLine(label, value));
        } else {
          paragraphs.push(
            new Paragraph({
              spacing: { before: 60, after: 40 },
              children: [txt(`${label}:`, { bold: true, size: 19, color: ACCENT })],
            })
          );
        }
        i++;
        continue;
      }

      const boldOnlyMatch = /^\*\*(.+?)\*\*\s*$/.exec(trimmed);
      if (boldOnlyMatch) {
        const title = boldOnlyMatch[1].trim();
        i++;
        const nextLine = i < lines.length ? lines[i].trim() : "";
        if (nextLine && !nextLine.startsWith("#") && !nextLine.startsWith("-")) {
          paragraphs.push(skillCategory(title, nextLine));
          i++;
        } else {
          paragraphs.push(
            new Paragraph({
              spacing: { after: 80 },
              children: [txt(title, { bold: true, size: 20, color: ACCENT })],
            })
          );
        }
        continue;
      }
    }

    if (trimmed === "") {
      i++;
      continue;
    }

    paragraphs.push(
      new Paragraph({
        spacing: { after: 80 },
        children: parseInline(trimmed),
      })
    );
    i++;
  }

  return paragraphs;
}

export async function buildDocxBuffer(md: string): Promise<Buffer> {
  const children = mdToDocx(md);
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "bullet-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: convertInchesToTwip(0.28),
                    hanging: convertInchesToTwip(0.18),
                  },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: 15840 },
            margin: {
              top: 640,
              bottom: 640,
              left: PAGE_MARGIN_LEFT,
              right: PAGE_MARGIN_RIGHT,
            },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
