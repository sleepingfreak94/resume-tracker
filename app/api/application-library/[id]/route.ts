import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_QUESTION_KINDS, type ApplicationQuestionKind } from "@/lib/application-answers";
import { deleteApplicationAnswer, updateApplicationAnswer, type StoredAnswerValue } from "@/lib/application-memory";
import { parsePositiveId } from "@/lib/validation";

function parseAnswer(value: unknown): StoredAnswerValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new Error("Invalid answer");
  if (typeof value === "string" && !value.trim()) throw new Error("Answer is required");
  return typeof value === "string" ? value.trim().slice(0, 2_000) : value;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const answerId = parsePositiveId(id);
    if (!answerId) return NextResponse.json({ error: "Invalid answer id" }, { status: 400 });
    const body = (await req.json()) as Record<string, unknown>;
    const answerType = body.answerType === undefined ? undefined : body.answerType as ApplicationQuestionKind;
    if (answerType && !APPLICATION_QUESTION_KINDS.includes(answerType)) throw new Error("Invalid answer type");
    const aliases = Array.isArray(body.aliases)
      ? body.aliases.filter((item): item is string => typeof item === "string").slice(0, 50)
      : undefined;
    const answer = updateApplicationAnswer(answerId, {
      canonicalQuestion: typeof body.canonicalQuestion === "string" ? body.canonicalQuestion : undefined,
      answer: parseAnswer(body.answer),
      answerType,
      aliases,
      confirmed: body.confirmed === undefined ? undefined : Boolean(body.confirmed),
    });
    return NextResponse.json(answer);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const answerId = parsePositiveId(id);
  if (!answerId) return NextResponse.json({ error: "Invalid answer id" }, { status: 400 });
  if (!deleteApplicationAnswer(answerId)) return NextResponse.json({ error: "Answer not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
