import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applicationQuestionSimilarity,
  categorizeApplicationQuestion,
  normalizeApplicationQuestion,
  normalizeApplicationResumeFormat,
} from "../lib/application-memory";

describe("application answer memory", () => {
  it("normalizes common sponsorship wording to a reusable meaning", () => {
    assert.equal(
      normalizeApplicationQuestion("Do you require employment sponsorship?"),
      "need work sponsor"
    );
    assert.ok(
      applicationQuestionSimilarity(
        "Will you now or in the future require visa sponsorship?",
        "Do you require employment sponsorship?"
      ) >= 0.66
    );
  });

  it("matches work-authorization variants while separating unrelated questions", () => {
    assert.ok(
      applicationQuestionSimilarity(
        "Are you legally authorized to work in Canada?",
        "Are you authorized to work in Canada?"
      ) >= 0.7
    );
    assert.ok(
      applicationQuestionSimilarity(
        "Are you legally authorized to work?",
        "What is your expected salary?"
      ) < 0.3
    );
  });

  it("uses DOCX as the safe default resume format", () => {
    assert.equal(normalizeApplicationResumeFormat(undefined), "docx");
    assert.equal(normalizeApplicationResumeFormat("docx"), "docx");
    assert.equal(normalizeApplicationResumeFormat("pdf"), "pdf");
    assert.equal(normalizeApplicationResumeFormat("exe"), "docx");
  });

  it("organizes repeated questions into questionnaire categories", () => {
    assert.equal(categorizeApplicationQuestion("Will you require visa sponsorship?"), "work_authorization");
    assert.equal(categorizeApplicationQuestion("What are your salary expectations?"), "compensation");
    assert.equal(categorizeApplicationQuestion("Why are you interested in this role?"), "job_specific");
    assert.equal(categorizeApplicationQuestion("How many years of Playwright experience do you have?"), "experience");
  });
});
