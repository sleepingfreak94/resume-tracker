export const JOB_LINE_RE = /^\*\*(.+?)\*\*\s*\|\s*(.+)$/;

export type JobEntry = { company: string; title: string; dateRange: string };

export function parseJobLine(line: string): { title: string; dateRange: string } | null {
  const m = JOB_LINE_RE.exec(line.trim());
  return m ? { title: m[1].trim(), dateRange: m[2].trim() } : null;
}

export function toDriveFilename(company: string): string {
  const clean = company.replace(/[/\\:*?"<>|]/g, "").trim().replace(/\s+/g, " ");
  return clean ? `${clean} Resume.docx` : "resume.docx";
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
