import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLinkedInSearchUrl, canonicalLinkedInJobUrl, deriveLinkedInRunRecovery, isMeaningfulJobDescription, linkedInAppPortFromUrl, linkedInRunIdFromUrl, normalizeLinkedInRunItems, shouldExpireLinkedInRun, summarizeRun, validateLinkedInJobInput, validateLinkedInRunInput, validateLinkedInRunItem } from "../lib/linkedin-run";
import type { LinkedInRun, LinkedInRunItem } from "../lib/db";

// buildLinkedInSearchUrl

test("buildLinkedInSearchUrl encodes keywords", () => {
  const url = buildLinkedInSearchUrl({ keywords: "QA Automation Engineer" });
  assert.ok(url.includes("keywords=QA+Automation+Engineer") || url.includes("keywords=QA%20Automation%20Engineer"), url);
  assert.ok(url.startsWith("https://www.linkedin.com/jobs/search/"));
  assert.ok(url.includes("f_TPR=r604800"));
});

test("buildLinkedInSearchUrl includes location when provided", () => {
  const url = buildLinkedInSearchUrl({ keywords: "SRE", location: "Toronto, ON", appPort: 3002, runId: 42 });
  assert.ok(url.includes("location="), url);
  assert.ok(url.includes("SRE"), url);
  assert.equal(linkedInAppPortFromUrl(url), 3002);
  assert.equal(linkedInRunIdFromUrl(url), 42);
});

test("buildLinkedInSearchUrl omits location param when null", () => {
  const url = buildLinkedInSearchUrl({ keywords: "Dev", location: null });
  assert.ok(!url.includes("location="), url);
});

test("buildLinkedInSearchUrl throws on empty keywords", () => {
  assert.throws(() => buildLinkedInSearchUrl({ keywords: "   " }), /keywords is required/i);
});

test("validates custom app ports and rejects unsafe values", () => {
  assert.equal(validateLinkedInRunInput({ keywords: "QA", app_port: 3002 }).app_port, 3002);
  assert.equal(validateLinkedInRunInput({ keywords: "QA", auto_submit: true }).auto_submit, false);
  assert.throws(() => validateLinkedInRunInput({ keywords: "QA", app_port: 70_000 }), /app_port/i);
  assert.equal(linkedInAppPortFromUrl("https://example.com/#resume-tracker-port=3002"), null);
  assert.equal(linkedInRunIdFromUrl("https://example.com/#resume-tracker-run=42"), null);
  assert.throws(() => buildLinkedInSearchUrl({ keywords: "QA", runId: 0 }), /run ID/i);
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
    processing: 0,
    applied: 1,
    needs_manual: 0,
    failed: 0,
    skipped: 0,
  });
});

test("normalizes an imported checkpoint to its later database job id by URL", () => {
  const url = "https://www.linkedin.com/jobs/view/4450328308";
  const imported: LinkedInRunItem = {
    jobId: null, title: "SWE", company: "Acme", url, applyType: "easy_apply",
    outcome: "processing", phase: "imported", note: "imported",
  };
  const prepared: LinkedInRunItem = { ...imported, jobId: 42, phase: "prepared", note: "prepared" };
  assert.deepEqual(normalizeLinkedInRunItems([imported, prepared]), [prepared]);
  assert.equal(summarizeRun([imported, prepared]).processing, 1);
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
  assert.throws(() => validateLinkedInRunItem({ ...valid, outcome: "processing" }), /phase/i);
  assert.equal(validateLinkedInRunItem({ ...valid, outcome: "processing", phase: "submission_started" }).phase, "submission_started");
});

function makeRun(overrides: Partial<LinkedInRun> = {}): LinkedInRun {
  return {
    id: 9,
    keywords: "QA",
    location: null,
    max_jobs: 15,
    auto_submit: 1,
    app_port: 3002,
    heartbeat_at: null,
    status: "running",
    items_json: "[]",
    note: null,
    created_at: "2026-08-25 05:00:00",
    updated_at: "2026-08-25 05:00:00",
    ...overrides,
  };
}

test("marks legacy safety waits as interrupted and unsafe to resume", () => {
  const recovery = deriveLinkedInRunRecovery(
    makeRun({ note: "Waiting for your safety confirmation — click Resume automation in LinkedIn when complete." }),
    [],
    Date.parse("2026-08-25T06:00:00Z"),
  );
  assert.equal(recovery.state, "interrupted");
  assert.equal(recovery.canResume, false);
});

test("allows a disconnected run to reopen only when no application is in flight", () => {
  const now = Date.parse("2026-08-25T06:00:00Z");
  const safe = deriveLinkedInRunRecovery(makeRun(), [makeItem("applied")], now);
  assert.equal(safe.canResume, true);

  const processing = { ...makeItem("processing"), phase: "modal_open" as const };
  const unsafe = deriveLinkedInRunRecovery(makeRun(), [processing], now);
  assert.equal(unsafe.canResume, false);
});

test("reports a live user-confirmation pause from a fresh heartbeat", () => {
  const now = Date.parse("2026-08-25T06:00:00Z");
  const processing = { ...makeItem("processing"), phase: "awaiting_user" as const, note: "Review required" };
  const recovery = deriveLinkedInRunRecovery(makeRun({ heartbeat_at: "2026-08-25 05:59:50" }), [processing], now);
  assert.equal(recovery.state, "waiting_user");
  assert.equal(recovery.canResume, false);
});

test("expires runs that never connect or lose their extension heartbeat", () => {
  const now = Date.parse("2026-08-25T06:00:00Z");
  assert.equal(shouldExpireLinkedInRun(makeRun({ status: "queued", created_at: "2026-08-25 05:59:39" }), now), true);
  assert.equal(shouldExpireLinkedInRun(makeRun({ heartbeat_at: "2026-08-25 05:59:29" }), now), true);
  assert.equal(shouldExpireLinkedInRun(makeRun({ heartbeat_at: "2026-08-25 05:59:31" }), now), false);
});
