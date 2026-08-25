import fs from "fs";
import { buildTailoringPrompt, buildCoverLetterPrompt, TailoringContext, CoverLetterContext } from "./prompts";
import { Rule } from "./db";
import { ensureTailoredDirectory } from "./job-artifacts";
import { jobArtifactPath } from "./validation";
import { generateAIText } from "./ai-provider";

function tagged(text: string, name: string): string | null {
  const match = text.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`, "i"));
  return match?.[1]?.trim() || null;
}

export interface TailorResumeOptions {
  jobId: number;
  company: string;
  title: string;
  description: string;
  jobLink: string | null;
  rules: Rule[];
  signal?: AbortSignal;
}

export interface TailorResumeResult {
  success: boolean;
  tailoredResumePath?: string;
  agentId?: string;
  error?: string;
}

export async function tailorResume(opts: TailorResumeOptions): Promise<TailorResumeResult> {
  const baseResumePath = `${process.cwd()}/resumes/base-resume.md`;
  if (!fs.existsSync(baseResumePath)) {
    return { success: false, error: "Base resume not found. Please upload your base resume first." };
  }

  ensureTailoredDirectory();
  const outputPath = jobArtifactPath(opts.jobId, "resume");
  const notesPath = jobArtifactPath(opts.jobId, "notes");

  const ctx: TailoringContext = {
    baseResume: fs.readFileSync(baseResumePath, "utf-8"),
    jobTitle: opts.title,
    company: opts.company,
    jobDescription: opts.description,
    jobLink: opts.jobLink,
    rules: opts.rules,
  };

  const prompt = buildTailoringPrompt(ctx);

  try {
    const result = await generateAIText({
      workload: "generation",
      prompt,
      maxOutputTokens: 24_000,
      signal: opts.signal,
    });
    const text = result.text;
    const resume = tagged(text, "TAILORED_RESUME");
    const notes = tagged(text, "TAILORING_NOTES");
    if (!resume || !notes) {
      return {
        success: false,
        agentId: result.runId,
        error: "AI response did not contain a valid resume and notes. Please try again.",
      };
    }
    fs.writeFileSync(outputPath, `${resume}\n`, "utf-8");
    fs.writeFileSync(notesPath, `${notes}\n`, "utf-8");

    return {
      success: true,
      tailoredResumePath: outputPath,
      agentId: result.runId,
    };
  } catch (err) {
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
  signal?: AbortSignal;
}

export interface GenerateCoverLetterResult {
  success: boolean;
  coverLetterPath?: string;
  agentId?: string;
  error?: string;
}

export async function generateCoverLetter(opts: GenerateCoverLetterOptions): Promise<GenerateCoverLetterResult> {
  const baseResumePath = `${process.cwd()}/resumes/base-resume.md`;
  if (!fs.existsSync(baseResumePath)) {
    return { success: false, error: "Base resume not found. Please upload your base resume first." };
  }

  ensureTailoredDirectory();
  const outputPath = jobArtifactPath(opts.jobId, "cover-letter");
  const tailoredResumePath = jobArtifactPath(opts.jobId, "resume");

  const ctx: CoverLetterContext = {
    baseResume: fs.readFileSync(fs.existsSync(tailoredResumePath) ? tailoredResumePath : baseResumePath, "utf-8"),
    jobTitle: opts.title,
    company: opts.company,
    jobDescription: opts.description,
    jobLink: opts.jobLink,
  };

  const prompt = buildCoverLetterPrompt(ctx);

  try {
    const result = await generateAIText({
      workload: "generation",
      prompt,
      maxOutputTokens: 8_000,
      signal: opts.signal,
    });
    const coverLetter = tagged(result.text, "COVER_LETTER");
    if (!coverLetter) {
      return {
        success: false,
        agentId: result.runId,
        error: "AI response did not contain a valid cover letter. Please try again.",
      };
    }
    fs.writeFileSync(outputPath, `${coverLetter}\n`, "utf-8");

    return {
      success: true,
      coverLetterPath: outputPath,
      agentId: result.runId,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
