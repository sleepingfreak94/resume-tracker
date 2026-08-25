import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLinkedInSearchUrl, canonicalLinkedInJobUrl, isMeaningfulJobDescription, normalizeLinkedInRunItems, summarizeRun, validateLinkedInJobInput, validateLinkedInRunItem } from "../lib/linkedin-run";
import type { LinkedInRunItem } from "../lib/db";

// buildLinkedInSearchUrl

test("buildLinkedInSearchUrl encodes keywords", () => {
  const url = buildLinkedInSearchUrl({ keywords: "QA Automation Engineer" });
  assert.ok(url.includes("keywords=QA+Automation+Engineer") || url.includes("keywords=QA%20Automation%20Engineer"), url);
  assert.ok(url.startsWith("https://www.linkedin.com/jobs/search/"));
  assert.ok(url.includes("f_TPR=r604800"));
});

test("buildLinkedInSearchUrl includes location when provided", () => {
  const url = buildLinkedInSearchUrl({ keywords: "SRE", location: "Toronto, ON" });
  assert.ok(url.includes("location="), url);
  assert.ok(url.includes("SRE"), url);
});

test("buildLinkedInSearchUrl omits location param when null", () => {
  const url = buildLinkedInSearchUrl({ keywords: "Dev", location: null });
  assert.ok(!url.includes("location="), url);
});

test("buildLinkedInSearchUrl throws on empty keywords", () => {
  assert.throws(() => buildLinkedInSearchUrl({ keywords: "   " }), /keywords is required/i);
});

// summarizeRun

function makeItem(
  outcome: LinkedInRunItem["outcome"],
  applyType: LinkedInRunItem["applyType"] = "easy_apply",
  jobId = 1,
): LinkedInRunItem {
  return { jobId, title: "SWE", company: "Acme", url: `https://example.com/${jobId}`, applyType, outcome, note: "" };
}

test("summarizeRun counts correctly", () => {
  const items: LinkedInRunItem[] = [
    makeItem("applied", "easy_apply", 1),
    makeItem("applied", "easy_apply", 2),
    makeItem("needs_manual", "external", 3),
    makeItem("failed", "easy_apply", 4),
    makeItem("skipped", "easy_apply", 5),
  ];
  const s = summarizeRun(items);
  assert.equal(s.total, 5);
  assert.equal(s.applied, 2);
  assert.equal(s.needs_manual, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.skipped, 1);
});

test("summarizeRun returns zeros for empty array", () => {
  const s = summarizeRun([]);
  assert.equal(s.total, 0);
  assert.equal(s.applied, 0);
});

test("normalizes historical import and final-outcome rows to one job", () => {
  const imported = { ...makeItem("skipped"), jobId: 42, note: "imported" };
  const final = { ...makeItem("applied"), jobId: 42, note: "Applied via Easy Apply" };
  const normalized = normalizeLinkedInRunItems([imported, final]);
  assert.deepEqual(normalized, [final]);
  assert.deepEqual(summarizeRun([imported, final]), {
    total: 1,
    applied: 1,
    needs_manual: 0,
    failed: 0,
    skipped: 0,
  });
});

test("validates canonical LinkedIn jobs and rejects title-only descriptions", () => {
  const description = "Build reliable test automation and collaborate with product and engineering teams across the delivery lifecycle.";
  assert.equal(canonicalLinkedInJobUrl("https://ca.linkedin.com/jobs/view/senior-qa-4450328308?trk=abc"), "https://www.linkedin.com/jobs/view/4450328308");
  assert.equal(isMeaningfulJobDescription(description, "Senior QA"), true);
  assert.throws(() => validateLinkedInJobInput({
    title: "Senior QA", company: "Acme", description: "Senior QA", job_link: "https://www.linkedin.com/jobs/view/4450328308",
  }), /100 meaningful characters/i);
  assert.equal(validateLinkedInJobInput({
    title: "Senior QA", company: "Acme", description, job_link: "https://www.linkedin.com/jobs/view/4450328308",
  }, "4450328308").job_link, "https://www.linkedin.com/jobs/view/4450328308");
});

test("validates extension run-item payloads instead of trusting casts", () => {
  const valid = { ...makeItem("failed", "easy_apply", 9), url: "https://www.linkedin.com/jobs/view/4450328308" };
  assert.equal(validateLinkedInRunItem(valid).outcome, "failed");
  assert.throws(() => validateLinkedInRunItem({ ...valid, outcome: "invented" }), /outcome/i);
  assert.throws(() => validateLinkedInRunItem({ ...valid, url: "https://evil.example/jobs/1" }), /required/i);
});
