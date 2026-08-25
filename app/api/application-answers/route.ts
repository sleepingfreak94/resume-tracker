import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  applicationQuestionPolicy,
  buildApplicationAnswersPrompt,
  type ApplicationAnswer,
  parseApplicationAnswers,
  validateApplicationQuestions,
} from "@/lib/application-answers";
import {
  findApplicationAnswer,
  queueApplicationQuestion,
  rememberApplicationAnswer,
} from "@/lib/application-memory";
import { getJob, getProfile } from "@/lib/db";
import { jobArtifactPath, parsePositiveId } from "@/lib/validation";
import { AIProviderError, generateAIText } from "@/lib/ai-provider";
import { aiProviderName } from "@/lib/ai-settings";

function readResume(jobId: number | null): string | null {
  if (jobId) {
    const tailoredPath = jobArtifactPath(jobId, "resume");
    if (fs.existsSync(tailoredPath)) return fs.readFileSync(tailoredPath, "utf-8");
  }
  const basePath = path.join(process.cwd(), "resumes", "base-resume.md");
  return fs.existsSync(basePath) ? fs.readFileSync(basePath, "utf-8") : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const questions = validateApplicationQuestions(body.questions);
    const jobId = body.jobId === null || body.jobId === undefined ? null : parsePositiveId(body.jobId);
    if (body.jobId !== null && body.jobId !== undefined && !jobId) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    }

    const pageUrl = typeof body.pageUrl === "string" ? body.pageUrl.trim() : null;
    if (pageUrl && pageUrl.length > 2_000) {
      return NextResponse.json({ error: "Page URL is too long" }, { status: 400 });
    }

    const job = jobId ? getJob(jobId) : undefined;
    const remembered = new Map<string, ApplicationAnswer>();
    const questionsForAi: typeof questions = [];
    for (const question of questions) {
      const match = applicationQuestionPolicy(question.label) === "answerable" ? findApplicationAnswer(question, jobId) : null;
      if (match) {
        remembered.set(question.id, {
          id: question.id,
          value: match.value,
          confidence: match.memory.confidence,
          source: "memory",
          canonicalQuestion: match.memory.canonical_question,
        });
      } else {
        questionsForAi.push(question);
      }
    }

    let aiAnswers: ApplicationAnswer[] = [];
    let agentId: string | null = null;
    if (questionsForAi.length > 0) {
      const prompt = buildApplicationAnswersPrompt({
        questions: questionsForAi,
        profile: getProfile(),
        job,
        resume: readResume(jobId),
        pageUrl,
      });

      const result = await generateAIText({
        workload: "routine",
        prompt,
        maxOutputTokens: 12_000,
        jsonSchema: {
          name: "application_answers",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              answers: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string", enum: questionsForAi.map((question) => question.id) },
                    value: { type: ["string", "number", "boolean", "null"] },
                    confidence: { type: "string", enum: ["high", "medium", "low"] },
                    source: { type: "string", enum: ["profile", "resume", "job", "generated", "decline", "unanswered"] },
                    canonicalQuestion: { type: ["string", "null"] },
                  },
                  required: ["id", "value", "confidence", "source", "canonicalQuestion"],
                },
              },
            },
            required: ["answers"],
          },
        },
        signal: req.signal,
      });
      agentId = result.runId;
      aiAnswers = parseApplicationAnswers(result.text.trim(), questionsForAi);
    }

    const aiMap = new Map(aiAnswers.map((answer) => [answer.id, answer]));
    const answers = questions.map((question) => remembered.get(question.id) ?? aiMap.get(question.id) ?? {
      id: question.id,
      value: null,
      confidence: "low" as const,
      source: "unanswered" as const,
      canonicalQuestion: null,
    });

    for (const question of questions) {
      const answer = answers.find((candidate) => candidate.id === question.id)!;
      if (answer.value !== null && answer.source !== "memory" && answer.confidence !== "high") {
        queueApplicationQuestion({ question, jobId, pageUrl, suggestedAnswer: answer.value });
        answer.value = null;
        answer.source = "unanswered";
      } else if (answer.value !== null) {
        if (answer.source !== "memory") rememberApplicationAnswer(question, answer, jobId);
      } else if (applicationQuestionPolicy(question.label) === "answerable") {
        queueApplicationQuestion({ question, jobId, pageUrl });
      }
    }

    return NextResponse.json({
      answers,
      answered: answers.filter((answer) => answer.value !== null).length,
      unanswered: answers.filter((answer) => answer.value === null).length,
      remembered: answers.filter((answer) => answer.source === "memory").length,
      agentId,
    });
  } catch (err) {
    if (err instanceof AIProviderError) {
      return NextResponse.json({ error: `${aiProviderName(err.provider)} service error: ${err.message}` }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : String(err);
    const status = /question|invalid|too long|maximum/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
