import { Rule } from "./db";

export interface TailoringContext {
  baseResumePath: string;
  outputPath: string;
  notesPath: string;
  jobTitle: string;
  company: string;
  jobDescription: string;
  jobLink: string | null;
  rules: Rule[];
}

export function buildTailoringPrompt(ctx: TailoringContext): string {
  const activeRules = ctx.rules.filter((r) => r.is_active);
  const rulesText = activeRules
    .sort((a, b) => a.priority - b.priority)
    .map((r, i) => `${i + 1}. ${r.rule_text}`)
    .join("\n");

  return `You are an expert resume writer. Your task is to create a tailored resume for a specific job application, then write a detailed notes file explaining every change you made.

## Critical Constraints

**NEVER assume or fabricate.** If applying a tailoring rule would require inventing information not present in the base resume (a skill, a metric, a technology, a responsibility), do NOT add it. Instead, note it in the notes file under a "Could not apply" section and explain what was missing.

Examples of what NOT to do:
- Do not add "Led a team of 10 engineers" if the base resume does not mention team leadership
- Do not add a skill (e.g. "Kubernetes") just because the job requires it if it does not appear in the base resume
- Do not change job titles, company names, dates, or education credentials

Only rearrange, rephrase, emphasize, and cut from what is already there.

---

## Step 1 — Read the base resume

Read the file at: \`${ctx.baseResumePath}\`

---

## Step 2 — Write the tailored resume

Apply the tailoring rules below to produce the tailored resume.
Write it to: \`${ctx.outputPath}\`

### Job Details

- **Company:** ${ctx.company}
- **Position:** ${ctx.jobTitle}
${ctx.jobLink ? `- **Job Link:** ${ctx.jobLink}` : ""}

### Job Description

${ctx.jobDescription}

### Tailoring Rules

${rulesText}

### Resume Output Requirements

- Markdown format only
- Standard sections: Summary, Experience, Skills, Education, Projects (if applicable)
- No commentary or meta-text in the resume file itself — only resume content

### ATS Formatting (always apply)

These structural requirements help the resume parse correctly through ATS systems.
Apply them regardless of the base resume's original formatting.

1. **Section Headers** — Use standard names only: Summary, Experience, Skills, Education, Projects
   - Do NOT use creative alternatives like "What I Bring", "My Journey", "Expertise"
2. **Bullet Points** — Write achievements as bullet points, not prose paragraphs
   - Keep each bullet to 1-2 lines maximum
3. **No Complex Formatting** — No tables, columns, or special characters
4. **Skills Section** — List skills as comma-separated items or simple bullet points
   - If skills are scattered through experience bullets, consolidate them into the Skills section too

---

## Step 3 — Write the change notes file

After writing the resume, write a second file to: \`${ctx.notesPath}\`

This file is a structured explanation of every decision made. Use this exact format:

\`\`\`
# Tailoring Notes — ${ctx.jobTitle} at ${ctx.company}

## Changes Made

For each change, one entry:

### [Section name] — [short description of change]
- **What changed:** [exact before → after, or "added" / "removed"]
- **Why:** [which rule number drove this, and how it maps to the job description]
- **Job description signal:** [quote or paraphrase the JD line that motivated this]

## Could Not Apply

List any rule or tailoring intent that could NOT be applied because the base resume lacked the necessary information:

- Rule N: [rule text] — could not apply because [specific gap in base resume]

## Keywords Matched

List the keywords/skills from the job description that are present in the tailored resume.

## Keywords Missing

List keywords/skills from the job description that are NOT in the base resume and were therefore not added.
\`\`\`

Write both files, then stop.`;
}

export interface CoverLetterContext {
  baseResumePath: string;
  outputPath: string;
  jobTitle: string;
  company: string;
  jobDescription: string;
  jobLink: string | null;
}

export function buildCoverLetterPrompt(ctx: CoverLetterContext): string {
  return `You are an expert cover letter writer. Your task is to write a compelling, personalized cover letter for a specific job application.

## Critical Constraints

**NEVER fabricate or assume.** Only use information present in the base resume. Do not invent achievements, skills, or experiences that are not there.

---

## Step 1 — Read the base resume

Read the file at: \`${ctx.baseResumePath}\`

---

## Step 2 — Write the cover letter

Write a professional, tailored cover letter to: \`${ctx.outputPath}\`

### Job Details

- **Company:** ${ctx.company}
- **Position:** ${ctx.jobTitle}
${ctx.jobLink ? `- **Job Link:** ${ctx.jobLink}` : ""}

### Job Description

${ctx.jobDescription}

### Cover Letter Requirements

- **Format:** Markdown
- **Length:** 3–4 paragraphs (no longer than one page)
- **Tone:** Professional, confident, and specific — not generic
- **Structure:**
  1. **Opening paragraph** — State the role you're applying for and a strong hook: one specific reason why this company/role excites you (pull from the job description and the candidate's background)
  2. **Middle paragraph(s)** — 2–3 concrete examples from the resume that directly address the job's key requirements. Use specific achievements and numbers where they exist in the resume.
  3. **Closing paragraph** — Reiterate enthusiasm, mention availability for an interview, and a polite sign-off
- **Personalization:** Reference the company by name and specific details from the job description
- **No boilerplate:** Avoid generic phrases like "I am writing to express my interest" or "I would be a great fit"
- Do NOT include placeholder text like [Your Name] or [Date] — use only what is in the resume

Write the cover letter file, then stop.`;
}
