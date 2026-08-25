import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applicationQuestionPolicy,
  buildApplicationAnswersPrompt,
  parseApplicationAnswers,
  validateApplicationQuestions,
} from "../lib/application-answers";
import type { Job, Profile } from "../lib/db";

const profile: Profile = {
  id: 1,
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@example.com",
  phone: null,
  linkedin_url: null,
  portfolio_url: null,
  location: "Toronto, ON",
  current_company: "Example Inc",
  current_title: "QA Engineer",
  work_authorization: "Open Work Permit",
  requires_sponsorship: 0,
  has_work_permit: 1,
  has_pr: 0,
  years_experience: 5,
  education_level: "Bachelor's Degree",
  updated_at: "2026-01-01",
};

const job: Job = {
  id: 7,
  company: "Acme",
  title: "Senior QA Engineer",
  description: "Test web applications with Playwright.",
  job_link: "https://example.com/job/7",
  status: "pending",
  tailored_resume_path: null,
  agent_id: null,
  last_activity_at: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

describe("application answers", () => {
  it("validates question descriptors and rejects duplicate IDs", () => {
    const questions = validateApplicationQuestions([
      { id: "q-1", label: "Why do you want this role?", kind: "textarea", required: true, options: [] },
    ]);
    assert.equal(questions[0].kind, "textarea");
    assert.throws(() => validateApplicationQuestions([
      { id: "q1", label: "One", kind: "text" },
      { id: "q1", label: "Two", kind: "text" },
    ]));
  });

  it("builds an evidence-bound prompt with explicit safety rules", () => {
    const questions = validateApplicationQuestions([
      { id: "q1", label: "Why Acme?", kind: "textarea", options: [] },
    ]);
    const prompt = buildApplicationAnswersPrompt({ questions, profile, job, resume: "Playwright experience", pageUrl: null });
    assert.match(prompt, /Never invent personal facts/);
    assert.match(prompt, /Prefer not to say/);
    assert.match(prompt, /Senior QA Engineer/);
  });

  it("keeps exact options and nulls unsupported answers", () => {
    const questions = validateApplicationQuestions([
      { id: "auth", label: "Authorized?", kind: "radio", options: ["Yes", "No"] },
      { id: "consent", label: "I certify", kind: "checkbox", options: [] },
      { id: "gender", label: "Gender", kind: "radio", options: ["Woman", "Man", "Prefer not to say"] },
    ]);
    const answers = parseApplicationAnswers(
      JSON.stringify({ answers: [
        { id: "auth", value: "yes", confidence: "high", source: "profile" },
        { id: "consent", value: true, confidence: "high", source: "generated" },
        { id: "gender", value: "Woman", confidence: "high", source: "generated" },
      ] }),
      questions
    );
    assert.equal(answers[0].value, "Yes");
    assert.equal(answers[1].value, null);
    assert.equal(answers[2].value, "Prefer not to say");
    assert.equal(answers[2].source, "decline");
  });

  it("never learns or autofills legal confirmations and identity secrets", () => {
    assert.equal(applicationQuestionPolicy("Type your electronic signature"), "manual");
    assert.equal(applicationQuestionPolicy("Enter your Social Security Number"), "manual");
    assert.equal(applicationQuestionPolicy("Passport number"), "manual");
    assert.equal(applicationQuestionPolicy("Do you hold an AWS certification?"), "answerable");
    assert.equal(applicationQuestionPolicy("What salary do you expect?"), "answerable");
  });
});
