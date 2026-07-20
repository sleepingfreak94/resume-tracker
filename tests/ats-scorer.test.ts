import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeATSScore } from "../lib/ats-scorer";

describe("ATS scorer", () => {
  it("returns bounded component and overall scores", () => {
    const result = computeATSScore(
      "# Candidate\n## Summary\nQA engineer\n## Experience\n- Automated API tests with TypeScript and Playwright\n## Skills\nTypeScript, API testing\n## Education\nDegree",
      "Seeking a QA engineer with TypeScript, API testing, and Playwright experience",
    );

    for (const score of [
      result.overall_score,
      result.keyword_score,
      result.skills_score,
      result.experience_score,
      result.format_score,
    ]) {
      assert.ok(score >= 0 && score <= 100);
    }
    assert.ok(result.matched_keywords.includes("typescript"));
  });

  it("gives full keyword coverage when the job description has no keywords", () => {
    const result = computeATSScore("## Experience", "the and or");
    assert.equal(result.keyword_score, 100);
    assert.deepEqual(result.missing_keywords, []);
  });

  it("counts three or more experience bullets", () => {
    const result = computeATSScore(
      "## Experience\n- Built APIs\n- Added tests\n- Improved monitoring",
      "Software engineer",
    );
    assert.equal(result.experience_score, 85);
  });

  it("matches whole keywords instead of substrings", () => {
    const result = computeATSScore("JavaScript developer", "Java developer");
    assert.ok(result.missing_keywords.includes("java"));
    assert.ok(!result.matched_keywords.includes("java"));
  });
});
