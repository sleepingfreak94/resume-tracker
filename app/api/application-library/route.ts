import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_QUESTION_KINDS, type ApplicationQuestionKind } from "@/lib/application-answers";
import {
  createApplicationAnswer,
  getApplicationAutomationSettings,
  listApplicationAnswers,
  listPendingApplicationQuestions,
  type StoredAnswerValue,
} from "@/lib/application-memory";

function answerValue(value: unknown): StoredAnswerValue {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error("Answer must be text, a number, or yes/no");
  }
  if (typeof value === "string") {
    const cleaned = value.trim();
    if (!cleaned) throw new Error("Answer is required");
    if (cleaned.length > 2_000) throw new Error("Answer is too long");
    return cleaned;
  }
  return value;
}

function answerKind(value: unknown): ApplicationQuestionKind {
  if (!APPLICATION_QUESTION_KINDS.includes(value as ApplicationQuestionKind)) throw new Error("Invalid answer type");
  return value as ApplicationQuestionKind;
}

export async function GET() {
  try {
    return NextResponse.json({
      answers: listApplicationAnswers(),
      pending: listPendingApplicationQuestions(),
      settings: getApplicationAutomationSettings(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const canonicalQuestion = typeof body.canonicalQuestion === "string" ? body.canonicalQuestion : "";
    const aliases = Array.isArray(body.aliases)
      ? body.aliases.filter((item): item is string => typeof item === "string").slice(0, 50)
      : [];
    const answer = createApplicationAnswer({
      canonicalQuestion,
      answer: answerValue(body.answer),
      answerType: answerKind(body.answerType),
      aliases,
      source: "user",
      confidence: "high",
      scope: "global",
      confirmed: true,
    });
    return NextResponse.json(answer, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
