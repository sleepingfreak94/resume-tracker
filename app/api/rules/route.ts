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
    if (!rule_text) return NextResponse.json({ error: "rule_text is required" }, { status: 400 });
    const rule = createRule(rule_text, priority ?? 99);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
