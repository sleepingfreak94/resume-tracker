import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  canonicalizeJobUrl,
  jobArtifactPath,
  parsePositiveId,
  sanitizeDownloadFilename,
  sanitizeReturnTo,
  validateJobInput,
} from "../lib/validation";

describe("input validation", () => {
  it("accepts only positive safe integer IDs", () => {
    assert.equal(parsePositiveId("12"), 12);
    assert.equal(parsePositiveId("../../tmp/owned"), null);
    assert.equal(parsePositiveId(-1), null);
    assert.equal(parsePositiveId(1.5), null);
  });

  it("keeps job artifacts inside the tailored directory", () => {
    const file = jobArtifactPath("42", "resume");
    assert.equal(file, path.join(process.cwd(), "resumes", "tailored", "job-42.md"));
    assert.throws(() => jobArtifactPath("../../tmp/owned", "resume"));
  });

  it("allows only local relative OAuth return paths", () => {
    assert.equal(sanitizeReturnTo("/jobs/12?tab=ats"), "/jobs/12?tab=ats");
    assert.equal(sanitizeReturnTo("https://evil.example"), "/");
    assert.equal(sanitizeReturnTo("//evil.example/path"), "/");
  });

  it("normalizes job input and tracking URLs", () => {
    const job = validateJobInput({
      company: "  Example   Inc ",
      title: " Engineer ",
      description: " Description ",
      job_link: "https://example.com/job/1?utm_source=test&team=eng#apply",
    });
    assert.equal(job.company, "Example Inc");
    assert.equal(job.description, "Description");
    assert.equal(job.job_link, "https://example.com/job/1?team=eng");
    assert.throws(() => canonicalizeJobUrl("javascript:alert(1)"));
  });

  it("sanitizes response filenames", () => {
    assert.equal(sanitizeDownloadFilename("resume\"\r\nX-Test: yes.docx"), "resumeX-Test-yes.docx");
  });
});
