import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseJobLine,
  splitResumeSegments,
  toDriveFilename,
} from "../lib/resume-format";

describe("resume formatting", () => {
  it("creates a filesystem-safe Drive filename", () => {
    assert.equal(toDriveFilename('  Acme: Labs / QA  '), "Acme Labs QA Resume.docx");
    assert.equal(toDriveFilename(' /:*?"<>| '), "resume.docx");
  });

  it("parses formatted role lines", () => {
    assert.deepEqual(parseJobLine("**Senior QA Engineer** | Jan 2022 – Present"), {
      title: "Senior QA Engineer",
      dateRange: "Jan 2022 – Present",
    });
    assert.equal(parseJobLine("Senior QA Engineer"), null);
  });

  it("splits experience entries from surrounding Markdown", () => {
    const segments = splitResumeSegments([
      "## Experience",
      "### Acme",
      "**QA Engineer** | 2022 – Present",
      "- Improved coverage",
    ].join("\n"));

    assert.deepEqual(segments, [
      { kind: "md", content: "## Experience" },
      { kind: "job", company: "Acme", title: "QA Engineer", dateRange: "2022 – Present" },
      { kind: "md", content: "- Improved coverage" },
    ]);
  });
});
