import { after, NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Agent } from "@cursor/sdk";
import { getJob, getATSScore, upsertATSScore } from "@/lib/db";
import { computeATSScore } from "@/lib/ats-scorer";
import { buildATSAnalysisPrompt, type AIATSAnalysis } from "@/lib/ats-prompts";
import { logActivity } from "@/lib/db";
import { jobArtifactPath, parsePositiveId } from "@/lib/validation";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const jobId = parsePositiveId(id);
    if (!jobId) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    const score = getATSScore(jobId);
    if (!score) return NextResponse.json({ exists: false });
    return NextResponse.json({ exists: true, ...score });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const jobId = parsePositiveId(id);
    if (!jobId) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    const aiOnly = req.nextUrl.searchParams.get("ai_only") === "true";

    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Read tailored resume (fall back to base if not tailored yet)
    const tailoredPath = jobArtifactPath(jobId, "resume");
    const basePath = path.join(process.cwd(), "resumes", "base-resume.md");
    const resumePath = fs.existsSync(tailoredPath) ? tailoredPath : basePath;

    if (!fs.existsSync(resumePath)) {
      return NextResponse.json({ error: "No resume found to score" }, { status: 400 });
    }

    const resume = fs.readFileSync(resumePath, "utf-8");

    if (aiOnly) {
      // Run only AI analysis — skip heuristic recalculation
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) return NextResponse.json({ error: "CURSOR_API_KEY not configured" }, { status: 500 });
      await runAIAnalysis(jobId, resume, job.description, job.company, job.title, apiKey);
      return NextResponse.json({ success: true });
    }

    const result = computeATSScore(resume, job.description);

    upsertATSScore(jobId, {
      overall_score: result.overall_score,
      keyword_score: result.keyword_score,
      skills_score: result.skills_score,
      experience_score: result.experience_score,
      format_score: result.format_score,
      matched_keywords: JSON.stringify(result.matched_keywords),
      missing_keywords: JSON.stringify(result.missing_keywords),
      computed_at: new Date().toISOString(),
    });

    logActivity(jobId, "score_computed", `ATS score computed: ${result.overall_score}/100`);

    // Fire off AI analysis asynchronously — don't block the response
    const apiKey = process.env.CURSOR_API_KEY;
    if (apiKey) {
      after(async () => {
        await runAIAnalysis(jobId, resume, job.description, job.company, job.title, apiKey).catch(() => undefined);
      });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function runAIAnalysis(
  jobId: number,
  resume: string,
  jobDescription: string,
  company: string,
  title: string,
  apiKey: string
) {
  try {
    const prompt = buildATSAnalysisPrompt(resume, jobDescription, company, title);
    const result = await Agent.prompt(prompt, {
      apiKey,
      model: { id: "composer-2.5" },
    });

    if (result.status !== "finished") return;

    const text = (result.result ?? "").slice(0, 100_000);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const analysis = JSON.parse(jsonMatch[0]) as AIATSAnalysis;
    if (
      typeof analysis.summary !== "string" ||
      !Array.isArray(analysis.strengths) ||
      !Array.isArray(analysis.gaps) ||
      !Array.isArray(analysis.suggestions) ||
      !analysis.detailedScores
    ) return;
    upsertATSScore(jobId, {
      ai_analysis: JSON.stringify(analysis),
      ai_analyzed_at: new Date().toISOString(),
    });
  } catch (err) {
    throw err;
  }
}
