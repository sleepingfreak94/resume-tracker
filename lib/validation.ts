import path from "path";

export const ALLOWED_CURSOR_MODELS = ["composer-2.5-fast", "composer-2.5", "claude-sonnet-5"] as const;

export function parsePositiveId(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "http://localhost");
    return parsed.origin === "http://localhost" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/";
  } catch {
    return "/";
  }
}

export function canonicalizeJobUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Job link must be a URL");
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Job link must use http or https");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|ref$|referrer$|source$|trk$)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

export interface ValidJobInput {
  company: string;
  title: string;
  description: string;
  job_link: string | null;
}

function cleanSingleLine(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new Error(`${label} is required`);
  if (cleaned.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return cleaned;
}

export function validateJobInput(value: unknown): ValidJobInput {
  if (!value || typeof value !== "object") throw new Error("Invalid job data");
  const input = value as Record<string, unknown>;
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description) throw new Error("Description is required");
  if (description.length > 100_000) throw new Error("Description is too large");
  return {
    company: cleanSingleLine(input.company, "Company", 120),
    title: cleanSingleLine(input.title, "Title", 160),
    description,
    job_link: canonicalizeJobUrl(input.job_link),
  };
}

export type JobArtifactKind = "resume" | "notes" | "cover-letter";

export function jobArtifactPath(jobId: unknown, kind: JobArtifactKind): string {
  const id = parsePositiveId(jobId);
  if (!id) throw new Error("Invalid job id");
  const suffix = kind === "resume" ? "" : `-${kind}`;
  return path.join(process.cwd(), "resumes", "tailored", `job-${id}${suffix}.md`);
}

export function sanitizeDownloadFilename(value: unknown, fallback = "resume"): string {
  const safe = String(value ?? fallback)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return safe || fallback;
}
