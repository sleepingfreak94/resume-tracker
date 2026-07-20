import { NextRequest, NextResponse } from "next/server";
import { listRules, createRule } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json(listRules());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { rule_text, priority } = await req.json();
    if (typeof rule_text !== "string" || !rule_text.trim() || rule_text.length > 2_000) return NextResponse.json({ error: "rule_text must be 1–2000 characters" }, { status: 400 });
    const safePriority = Number.isInteger(priority) ? priority : 99;
    const rule = createRule(rule_text.trim(), safePriority);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
