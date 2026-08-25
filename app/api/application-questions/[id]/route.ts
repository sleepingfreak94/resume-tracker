import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_QUESTION_KINDS, type ApplicationQuestionKind } from "@/lib/application-answers";
import {
  dismissApplicationQuestion,
  resolveApplicationQuestion,
  type StoredAnswerValue,
} from "@/lib/application-memory";
import { parsePositiveId } from "@/lib/validation";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const questionId = parsePositiveId(id);
    if (!questionId) return NextResponse.json({ error: "Invalid question id" }, { status: 400 });
    const body = (await req.json()) as Record<string, unknown>;
    if (body.action === "dismiss") {
      if (!dismissApplicationQuestion(questionId)) throw new Error("Pending question not found");
      return NextResponse.json({ success: true });
    }
    if (body.action !== "resolve") throw new Error("Invalid question action");
    if (typeof body.answer !== "string" && typeof body.answer !== "number" && typeof body.answer !== "boolean") {
      throw new Error("Answer is required");
    }
    const answer = typeof body.answer === "string" ? body.answer.trim() : body.answer;
    if (answer === "") throw new Error("Answer is required");
    const answerType = body.answerType as ApplicationQuestionKind;
    if (!APPLICATION_QUESTION_KINDS.includes(answerType)) throw new Error("Invalid answer type");
    const memory = resolveApplicationQuestion(questionId, {
      canonicalQuestion: typeof body.canonicalQuestion === "string" ? body.canonicalQuestion : undefined,
      answer: answer as StoredAnswerValue,
      answerType,
    });
    return NextResponse.json(memory);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
