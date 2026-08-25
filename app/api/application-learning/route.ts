import { NextRequest, NextResponse } from "next/server";
import { MAX_APPLICATION_QUESTIONS, validateApplicationQuestions } from "@/lib/application-answers";
import { learnManualApplicationAnswers, type StoredAnswerValue } from "@/lib/application-memory";
import { parsePositiveId } from "@/lib/validation";

function parseValue(value: unknown): StoredAnswerValue {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error("Each learned answer must be text, a number, or yes/no");
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (!cleaned) throw new Error("Learned answers cannot be empty");
    if (cleaned.length > 2_000) throw new Error("A learned answer is too long");
    return cleaned;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("A learned number is invalid");
  return value;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const jobId = body.jobId === null || body.jobId === undefined ? null : parsePositiveId(body.jobId);
    if (body.jobId !== null && body.jobId !== undefined && !jobId) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
    }
    if (!Array.isArray(body.answers) || body.answers.length === 0) {
      throw new Error("answers must be a non-empty array");
    }
    if (body.answers.length > MAX_APPLICATION_QUESTIONS) {
      throw new Error(`A maximum of ${MAX_APPLICATION_QUESTIONS} answers can be learned at once`);
    }

    const rawAnswers = body.answers.map((answer) => {
      if (!answer || typeof answer !== "object") throw new Error("A learned answer is invalid");
      return answer as Record<string, unknown>;
    });
    const questions = validateApplicationQuestions(rawAnswers.map((answer) => ({
      id: answer.id,
      label: answer.label,
      kind: answer.kind,
      required: answer.required,
      options: answer.options,
    })));
    const observations = questions.map((question, index) => ({
      question,
      value: parseValue(rawAnswers[index].value),
    }));

    return NextResponse.json(learnManualApplicationAnswers(observations, jobId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
