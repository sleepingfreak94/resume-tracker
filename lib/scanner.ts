export interface Portal {
  name: string;
  ats: "greenhouse" | "ashby" | "lever";
  slug: string;
}

export interface ScannedJob {
  title: string;
  company: string;
  description: string;
  job_link: string;
  location: string; // free-text e.g. "San Francisco, CA" or "Remote"
}

// Detect ATS type and slug from a careers page URL.
// Returns null if the URL doesn't match any known pattern.
export function parsePortalUrl(raw: string): Pick<Portal, "ats" | "slug"> | null {
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  // slug is always the first path segment
  const slug = url.pathname.split("/").filter(Boolean)[0];
  if (!slug) return null;

  if (host === "jobs.ashbyhq.com" || host === "app.ashbyhq.com") {
    return { ats: "ashby", slug };
  }
  if (host === "job-boards.greenhouse.io" || host === "boards.greenhouse.io") {
    return { ats: "greenhouse", slug };
  }
  if (host === "jobs.lever.co") {
    return { ats: "lever", slug };
  }
  return null;
}

export async function scanGreenhouse(slug: string, company: string): Promise<ScannedJob[]> {
  const res = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) throw new Error(`Greenhouse ${slug}: HTTP ${res.status}`);
  const data = await res.json();
  // ponytail: description may be HTML — strip tags to keep it plain text for the tailoring prompt
  return (data.jobs ?? []).map((j: Record<string, unknown>) => ({
    title: String(j.title ?? ""),
    company,
    description: stripHtml(String((j.content as string) ?? "")),
    job_link: String(j.absolute_url ?? ""),
    location: String((j.location as Record<string, unknown>)?.name ?? ""),
  }));
}

export async function scanAshby(slug: string, company: string): Promise<ScannedJob[]> {
  const res = await fetch("https://api.ashbyhq.com/posting-public/job-posting/list", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ organizationHostedJobsPageName: slug }),
    signal: AbortSignal.timeout(15_000),
  });
  // ponytail: Ashby locked down their public API in 2025 — all orgs now return 401.
  // Keep the scanner function so manual "Add by URL" still stores the entry,
  // but surface a clear message instead of a raw HTTP status.
  if (res.status === 401) {
    throw new Error(`Ashby (${company}): API now requires authentication — remove this portal or check for a public feed`);
  }
  if (!res.ok) throw new Error(`Ashby ${slug} (${company}): HTTP ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((j: Record<string, unknown>) => ({
    title: String(j.title ?? ""),
    company,
    description: stripHtml(String((j.descriptionHtml as string) ?? (j.descriptionPlain as string) ?? "")),
    job_link: String(j.jobUrl ?? ""),
    location: String((j.locationName as string) ?? ""),
  }));
}

export async function scanLever(slug: string, company: string): Promise<ScannedJob[]> {
  const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Lever ${slug}: HTTP ${res.status}`);
  const data = await res.json();
  return (data ?? []).map((j: Record<string, unknown>) => {
    const lists = (j.lists as Array<{ content: string }> | undefined) ?? [];
    const description = stripHtml(lists.map((l) => l.content).join("\n"));
    const cats = (j.categories as Record<string, string> | undefined) ?? {};
    return {
      title: String(j.text ?? ""),
      company,
      description,
      job_link: String(j.hostedUrl ?? ""),
      location: cats.location ?? cats.country ?? "",
    };
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
