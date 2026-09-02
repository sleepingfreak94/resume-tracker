import type { LinkedInRun, LinkedInRunItem } from "./db";

// 1-week freshness filter keeps results recent and reduces crawl volume.
const FRESHNESS_SECONDS = 7 * 24 * 60 * 60; // 604800

export interface LinkedInRunInput {
  keywords: string;
  location?: string;
  max_jobs?: number;
  auto_submit?: boolean;
  app_port?: number;
}

export const LINKEDIN_APP_PORT_HASH_KEY = "resume-tracker-port";
export const LINKEDIN_RUN_ID_HASH_KEY = "resume-tracker-run";
const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "tailoring"]);
export const LINKEDIN_HEARTBEAT_FRESH_MS = 30_000;
export const LINKEDIN_LAUNCH_GRACE_MS = 20_000;
const AMBIGUOUS_RUN_NOTE = /waiting for your|easy apply modal opened|submitt(?:ing|ed)|final review/i;

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
  if (!["processing", "applied", "needs_manual", "failed", "skipped"].includes(String(input.outcome))) throw new Error("Invalid run item outcome");
  const phase = input.phase == null ? undefined : String(input.phase);
  const validPhases: NonNullable<LinkedInRunItem["phase"]>[] = ["imported", "prepared", "modal_open", "awaiting_user", "submission_started"];
  if (phase !== undefined && !validPhases.includes(phase as NonNullable<LinkedInRunItem["phase"]>)) throw new Error("Invalid run item phase");
  if (input.outcome === "processing" && phase === undefined) throw new Error("Processing run items require a phase");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 2_000) : "";
  return {
    jobId,
    title,
    company,
    url,
    applyType: input.applyType,
    outcome: input.outcome as LinkedInRunItem["outcome"],
    ...(phase ? { phase: phase as NonNullable<LinkedInRunItem["phase"]> } : {}),
    note,
  };
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

  const appPort = input.app_port !== undefined ? Number(input.app_port) : 3000;
  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65_535) throw new Error("app_port must be an integer between 1 and 65535");

  return { keywords, location, max_jobs: maxJobs, auto_submit: false, app_port: appPort };
}

export function buildLinkedInSearchUrl({ keywords, location, appPort = 3000, runId }: {
  keywords: string;
  location?: string | null;
  appPort?: number;
  runId?: number;
}): string {
  if (!keywords.trim()) throw new Error("keywords is required");
  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65_535) throw new Error("Invalid Resume Tracker app port");
  if (runId !== undefined && (!Number.isInteger(runId) || runId <= 0)) throw new Error("Invalid LinkedIn run ID");
  const params = new URLSearchParams({ keywords: keywords.trim() });
  if (location?.trim()) params.set("location", location.trim());
  params.set("f_TPR", `r${FRESHNESS_SECONDS}`);
  const url = new URL(`https://www.linkedin.com/jobs/search/?${params.toString()}`);
  const handoff = new URLSearchParams({ [LINKEDIN_APP_PORT_HASH_KEY]: String(appPort) });
  if (runId !== undefined) handoff.set(LINKEDIN_RUN_ID_HASH_KEY, String(runId));
  url.hash = handoff.toString();
  return url.toString();
}

export function linkedInAppPortFromUrl(value: unknown): number | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return null;
    const port = Number(new URLSearchParams(parsed.hash.replace(/^#/, "")).get(LINKEDIN_APP_PORT_HASH_KEY));
    return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
  } catch {
    return null;
  }
}

export function linkedInRunIdFromUrl(value: unknown): number | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return null;
    const runId = Number(new URLSearchParams(parsed.hash.replace(/^#/, "")).get(LINKEDIN_RUN_ID_HASH_KEY));
    return Number.isInteger(runId) && runId > 0 ? runId : null;
  } catch {
    return null;
  }
}

export interface RunSummary {
  total: number;
  processing: number;
  applied: number;
  needs_manual: number;
  failed: number;
  skipped: number;
}

export function normalizeLinkedInRunItems(items: LinkedInRunItem[]): LinkedInRunItem[] {
  const normalized: LinkedInRunItem[] = [];
  for (const item of items) {
    const index = normalized.findIndex((existing) =>
      (item.jobId != null && existing.jobId === item.jobId) ||
      Boolean(item.url && existing.url === item.url)
    );
    if (index >= 0) normalized[index] = item;
    else normalized.push(item);
  }
  return normalized;
}

export function summarizeRun(items: LinkedInRunItem[]): RunSummary {
  return normalizeLinkedInRunItems(items).reduce(
    (acc, item) => {
      acc.total++;
      acc[item.outcome]++;
      return acc;
    },
    { total: 0, processing: 0, applied: 0, needs_manual: 0, failed: 0, skipped: 0 } as RunSummary
  );
}

export interface LinkedInRunRecovery {
  state: "launching" | "connected" | "waiting_user" | "interrupted" | "complete";
  canResume: boolean;
  reason: string | null;
}

function sqliteDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function shouldExpireLinkedInRun(run: LinkedInRun, nowMs = Date.now()): boolean {
  if (!ACTIVE_RUN_STATUSES.has(run.status)) return false;
  const createdMs = sqliteDateMs(run.created_at);
  if (createdMs === null) return false;
  const heartbeatMs = sqliteDateMs(run.heartbeat_at);
  if (heartbeatMs !== null) return nowMs - heartbeatMs > LINKEDIN_HEARTBEAT_FRESH_MS;
  return nowMs - createdMs > LINKEDIN_LAUNCH_GRACE_MS;
}

export function deriveLinkedInRunRecovery(
  run: LinkedInRun,
  items: LinkedInRunItem[],
  nowMs = Date.now(),
): LinkedInRunRecovery {
  if (!ACTIVE_RUN_STATUSES.has(run.status)) return { state: "complete", canResume: false, reason: null };

  const normalizedItems = normalizeLinkedInRunItems(items);
  const processingItem = normalizedItems.find((item) => item.outcome === "processing");
  const heartbeatMs = sqliteDateMs(run.heartbeat_at);
  const heartbeatFresh = heartbeatMs !== null && nowMs - heartbeatMs <= LINKEDIN_HEARTBEAT_FRESH_MS;
  const createdMs = sqliteDateMs(run.created_at) ?? nowMs;

  if (processingItem?.phase === "awaiting_user" && heartbeatFresh) {
    return { state: "waiting_user", canResume: false, reason: processingItem.note || run.note };
  }
  if (heartbeatFresh) return { state: "connected", canResume: false, reason: null };
  if (run.status === "queued" && nowMs - createdMs <= LINKEDIN_LAUNCH_GRACE_MS) {
    return { state: "launching", canResume: false, reason: null };
  }

  const ambiguous = Boolean(processingItem || AMBIGUOUS_RUN_NOTE.test(run.note || ""));
  return {
    state: "interrupted",
    canResume: !ambiguous,
    reason: ambiguous
      ? "The previous browser session stopped during an application. Verify it manually before starting another run."
      : "The LinkedIn tab or extension is no longer connected. Reopen the saved search to continue between jobs.",
  };
}
