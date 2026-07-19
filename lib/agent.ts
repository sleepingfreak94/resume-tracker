import { Agent, CursorAgentError } from "@cursor/sdk";
import path from "path";
import fs from "fs";
import { buildTailoringPrompt, buildCoverLetterPrompt, TailoringContext, CoverLetterContext } from "./prompts";
import { Rule } from "./db";

export interface TailorResumeOptions {
  jobId: number;
  company: string;
  title: string;
  description: string;
  jobLink: string | null;
  rules: Rule[];
}

export interface TailorResumeResult {
  success: boolean;
  tailoredResumePath?: string;
  agentId?: string;
  error?: string;
}

export async function tailorResume(opts: TailorResumeOptions): Promise<TailorResumeResult> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    return { success: false, error: "CURSOR_API_KEY is not set in environment variables." };
  }

  const baseResumePath = path.join(process.cwd(), "resumes", "base-resume.md");
  if (!fs.existsSync(baseResumePath)) {
    return { success: false, error: "Base resume not found. Please upload your base resume first." };
  }

  const tailoredDir = path.join(process.cwd(), "resumes", "tailored");
  if (!fs.existsSync(tailoredDir)) {
    fs.mkdirSync(tailoredDir, { recursive: true });
  }

  const outputPath = path.join(tailoredDir, `job-${opts.jobId}.md`);
  const notesPath = path.join(tailoredDir, `job-${opts.jobId}-notes.md`);

  const ctx: TailoringContext = {
    baseResumePath,
    outputPath,
    notesPath,
    jobTitle: opts.title,
    company: opts.company,
    jobDescription: opts.description,
    jobLink: opts.jobLink,
    rules: opts.rules,
  };

  const prompt = buildTailoringPrompt(ctx);

  try {
    const result = await Agent.prompt(prompt, {
      apiKey,
      model: { id: "composer-2.5" },
      local: { cwd: process.cwd() },
    });

    if (result.status === "error") {
      return {
        success: false,
        agentId: result.id,
        error: `Agent run failed (run id: ${result.id}). Check the Cursor dashboard for details.`,
      };
    }

    // Verify the file was written
    if (!fs.existsSync(outputPath)) {
      return {
        success: false,
        agentId: result.id,
        error: "Agent completed but the tailored resume file was not created.",
      };
    }

    return {
      success: true,
      tailoredResumePath: outputPath,
      agentId: result.id,
    };
  } catch (err) {
    if (err instanceof CursorAgentError) {
      return {
        success: false,
        error: `Agent startup failed: ${err.message}${err.isRetryable ? " (retryable)" : ""}`,
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface GenerateCoverLetterOptions {
  jobId: number;
  company: string;
  title: string;
  description: string;
  jobLink: string | null;
}

export interface GenerateCoverLetterResult {
  success: boolean;
  coverLetterPath?: string;
  agentId?: string;
  error?: string;
}

export async function generateCoverLetter(opts: GenerateCoverLetterOptions): Promise<GenerateCoverLetterResult> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    return { success: false, error: "CURSOR_API_KEY is not set in environment variables." };
  }

  const baseResumePath = path.join(process.cwd(), "resumes", "base-resume.md");
  if (!fs.existsSync(baseResumePath)) {
    return { success: false, error: "Base resume not found. Please upload your base resume first." };
  }

  const tailoredDir = path.join(process.cwd(), "resumes", "tailored");
  if (!fs.existsSync(tailoredDir)) {
    fs.mkdirSync(tailoredDir, { recursive: true });
  }

  const outputPath = path.join(tailoredDir, `job-${opts.jobId}-cover-letter.md`);

  const ctx: CoverLetterContext = {
    baseResumePath,
    outputPath,
    jobTitle: opts.title,
    company: opts.company,
    jobDescription: opts.description,
    jobLink: opts.jobLink,
  };

  const prompt = buildCoverLetterPrompt(ctx);

  try {
    const result = await Agent.prompt(prompt, {
      apiKey,
      model: { id: "composer-2.5" },
      local: { cwd: process.cwd() },
    });

    if (result.status === "error") {
      return {
        success: false,
        agentId: result.id,
        error: `Agent run failed (run id: ${result.id}). Check the Cursor dashboard for details.`,
      };
    }

    if (!fs.existsSync(outputPath)) {
      return {
        success: false,
        agentId: result.id,
        error: "Agent completed but the cover letter file was not created.",
      };
    }

    return {
      success: true,
      coverLetterPath: outputPath,
      agentId: result.id,
    };
  } catch (err) {
    if (err instanceof CursorAgentError) {
      return {
        success: false,
        error: `Agent startup failed: ${err.message}${err.isRetryable ? " (retryable)" : ""}`,
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
