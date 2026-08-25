import type { LinkedInRunItem } from "./db";

// 1-week freshness filter keeps results recent and reduces crawl volume.
const FRESHNESS_SECONDS = 7 * 24 * 60 * 60; // 604800

export interface LinkedInRunInput {
  keywords: string;
  location?: string;
  max_jobs?: number;
  auto_submit?: boolean;
}

export const MIN_LINKEDIN_DESCRIPTION_LENGTH = 100;

export interface ValidLinkedInJobInput {
  title: string;
  company: string;
  description: string;
  job_link: string;
}

export function canonicalLinkedInJobUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^https?:\/\/(?:[a-z]+\.)?linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/i);
  return match ? `https://www.linkedin.com/jobs/view/${match[1]}` : null;
}

function compact(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function isMeaningfulJobDescription(description: unknown, title?: unknown): description is string {
  if (typeof description !== "string") return false;
  const cleaned = description.trim();
  if (cleaned.length < MIN_LINKEDIN_DESCRIPTION_LENGTH || cleaned.length > 100_000) return false;
  return !title || cleaned.toLocaleLowerCase() !== String(title).trim().toLocaleLowerCase();
}

export function validateLinkedInJobInput(value: unknown, expectedLinkedInJobId?: string): ValidLinkedInJobInput {
  if (!value || typeof value !== "object") throw new Error("Invalid LinkedIn job data");
  const input = value as Record<string, unknown>;
  const title = compact(input.title, 160);
  const company = compact(input.company, 120);
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const jobLink = canonicalLinkedInJobUrl(input.job_link ?? input.url);
  if (!title) throw new Error("LinkedIn job title is required");
  if (!company) throw new Error("LinkedIn company is required");
  if (!jobLink) throw new Error("A canonical LinkedIn job URL is required");
  if (!isMeaningfulJobDescription(description, title)) throw new Error("LinkedIn job description must contain at least 100 meaningful characters");
  if (expectedLinkedInJobId && !jobLink.endsWith(`/${expectedLinkedInJobId}`)) throw new Error("LinkedIn job details do not match the selected job");
  return { title, company, description, job_link: jobLink };
}

export function validateLinkedInRunItem(value: unknown): LinkedInRunItem {
  if (!value || typeof value !== "object") throw new Error("Invalid LinkedIn run item");
  const input = value as Record<string, unknown>;
  const jobId = input.jobId == null ? null : Number(input.jobId);
  if (jobId !== null && (!Number.isSafeInteger(jobId) || jobId <= 0)) throw new Error("Invalid run item job id");
  const title = compact(input.title, 160);
  const company = compact(input.company, 120);
  const url = canonicalLinkedInJobUrl(input.url) ?? "";
  if (!title || !company || !url) throw new Error("Run item title, company, and LinkedIn URL are required");
  if (input.applyType !== "easy_apply" && input.applyType !== "external") throw new Error("Invalid run item apply type");
  if (!["applied", "needs_manual", "failed", "skipped"].includes(String(input.outcome))) throw new Error("Invalid run item outcome");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 2_000) : "";
  return { jobId, title, company, url, applyType: input.applyType, outcome: input.outcome as LinkedInRunItem["outcome"], note };
}

export function validateLinkedInRunInput(value: unknown): Required<Omit<LinkedInRunInput, "location">> & { location: string | null } {
  if (!value || typeof value !== "object") throw new Error("Invalid run data");
  const input = value as Record<string, unknown>;

  const keywords = typeof input.keywords === "string" ? input.keywords.trim() : "";
  if (!keywords) throw new Error("keywords is required");
  if (keywords.length > 200) throw new Error("keywords must be 200 characters or fewer");

  const rawLocation = input.location;
  const location = rawLocation != null && rawLocation !== "" ? String(rawLocation).trim().slice(0, 200) : null;

  const maxJobs = input.max_jobs !== undefined ? Number(input.max_jobs) : 15;
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 100) throw new Error("max_jobs must be an integer between 1 and 100");

  const autoSubmit = Boolean(input.auto_submit);

  return { keywords, location, max_jobs: maxJobs, auto_submit: autoSubmit };
}

export function buildLinkedInSearchUrl({ keywords, location }: { keywords: string; location?: string | null }): string {
  if (!keywords.trim()) throw new Error("keywords is required");
  const params = new URLSearchParams({ keywords: keywords.trim() });
  if (location?.trim()) params.set("location", location.trim());
  params.set("f_TPR", `r${FRESHNESS_SECONDS}`);
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

export interface RunSummary {
  total: number;
  applied: number;
  needs_manual: number;
  failed: number;
  skipped: number;
}

export function normalizeLinkedInRunItems(items: LinkedInRunItem[]): LinkedInRunItem[] {
  const normalized = new Map<string, LinkedInRunItem>();
  items.forEach((item, index) => {
    const key = item.jobId != null
      ? `job:${item.jobId}`
      : item.url
        ? `url:${item.url}`
        : `row:${index}`;
    normalized.set(key, item);
  });
  return Array.from(normalized.values());
}

export function summarizeRun(items: LinkedInRunItem[]): RunSummary {
  return normalizeLinkedInRunItems(items).reduce(
    (acc, item) => {
      acc.total++;
      acc[item.outcome]++;
      return acc;
    },
    { total: 0, applied: 0, needs_manual: 0, failed: 0, skipped: 0 } as RunSummary
  );
}
