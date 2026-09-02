export const JOB_LINE_RE = /^\*\*(.+?)\*\*\s*\|\s*(.+)$/;

export type JobEntry = { company: string; title: string; dateRange: string };

export type ResumeFilenameProfile = {
  first_name?: string | null;
  last_name?: string | null;
};

export function parseJobLine(line: string): { title: string; dateRange: string } | null {
  const m = JOB_LINE_RE.exec(line.trim());
  return m ? { title: m[1].trim(), dateRange: m[2].trim() } : null;
}

function compactFilenamePart(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 100);
}

export function toResumeFilename(profile: ResumeFilenameProfile | null | undefined, format = "docx"): string {
  const name = `${compactFilenamePart(profile?.first_name)}${compactFilenamePart(profile?.last_name)}`;
  const extension = format === "pdf" ? "pdf" : "docx";
  return `${name ? `${name}-Resume` : "Resume"}.${extension}`;
}

export function toDriveFilename(profile: ResumeFilenameProfile | null | undefined, company?: string | null): string {
  const base = toResumeFilename(profile).replace(/\.docx$/i, "");
  const companySuffix = compactFilenamePart(company);
  return `${base}${companySuffix ? `-${companySuffix}` : ""}.docx`;
}

export type ResumeSegment =
  | { kind: "job"; company: string; title: string; dateRange: string }
  | { kind: "md"; content: string };

// ponytail: line scan — same ### + **title** | date pattern as md-to-docx
export function splitResumeSegments(md: string): ResumeSegment[] {
  const lines = md.split("\n");
  const segments: ResumeSegment[] = [];
  let buf: string[] = [];

  const flush = () => {
    if (buf.length) {
      segments.push({ kind: "md", content: buf.join("\n") });
      buf = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("### ")) {
      const company = trimmed.slice(4).trim();
      const next = i + 1 < lines.length ? lines[i + 1].trim() : "";
      const job = parseJobLine(next);
      if (job) {
        flush();
        segments.push({ kind: "job", company, title: job.title, dateRange: job.dateRange });
        i++;
        continue;
      }
    }
    buf.push(lines[i]);
  }
  flush();
  return segments;
}
