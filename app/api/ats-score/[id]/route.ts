import { after, NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getJob, getATSScore, upsertATSScore } from "@/lib/db";
import { computeATSScore } from "@/lib/ats-scorer";
import { buildATSAnalysisPrompt, type AIATSAnalysis } from "@/lib/ats-prompts";
import { logActivity } from "@/lib/db";
import { jobArtifactPath, parsePositiveId } from "@/lib/validation";
import { generateAIText } from "@/lib/ai-provider";
import { getAIKeyStatus, getAISettings } from "@/lib/ai-settings";

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
      await runAIAnalysis(jobId, resume, job.description, job.company, job.title);
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
    const settings = getAISettings();
    const keyStatus = getAIKeyStatus();
    const selectedProviderConfigured = settings.provider === "codex" || (settings.provider === "openai" ? keyStatus.openaiConfigured : keyStatus.cursorConfigured);
    if (selectedProviderConfigured) {
      after(async () => {
        await runAIAnalysis(jobId, resume, job.description, job.company, job.title).catch(() => undefined);
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
  title: string
) {
  try {
    const prompt = buildATSAnalysisPrompt(resume, jobDescription, company, title);
    const result = await generateAIText({
      workload: "routine",
      prompt,
      maxOutputTokens: 6_000,
      jsonSchema: {
        name: "ats_analysis",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            strengths: { type: "array", items: { type: "string" } },
            gaps: { type: "array", items: { type: "string" } },
            suggestions: { type: "array", items: { type: "string" } },
            detailedScores: {
              type: "object",
              additionalProperties: false,
              properties: {
                technicalSkills: { type: "number", minimum: 0, maximum: 100 },
                softSkills: { type: "number", minimum: 0, maximum: 100 },
                experienceDepth: { type: "number", minimum: 0, maximum: 100 },
                formatting: { type: "number", minimum: 0, maximum: 100 },
              },
              required: ["technicalSkills", "softSkills", "experienceDepth", "formatting"],
            },
          },
          required: ["summary", "strengths", "gaps", "suggestions", "detailedScores"],
        },
      },
    });
    const text = result.text.slice(0, 100_000);
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
