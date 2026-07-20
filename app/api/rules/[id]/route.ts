import { NextRequest, NextResponse } from "next/server";
import { updateRule, deleteRule } from "@/lib/db";
import { parsePositiveId } from "@/lib/validation";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ruleId = parsePositiveId(id);
    if (!ruleId) return NextResponse.json({ error: "Invalid rule id" }, { status: 400 });
    const body = await req.json();
    const data: { rule_text?: string; priority?: number; is_active?: number } = {};
    if (body.rule_text !== undefined) {
      if (typeof body.rule_text !== "string" || !body.rule_text.trim() || body.rule_text.length > 2_000) return NextResponse.json({ error: "Invalid rule text" }, { status: 400 });
      data.rule_text = body.rule_text.trim();
    }
    if (body.priority !== undefined && Number.isInteger(body.priority)) data.priority = body.priority;
    if (body.is_active !== undefined && [0, 1].includes(body.is_active)) data.is_active = body.is_active;
    updateRule(ruleId, data);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ruleId = parsePositiveId(id);
    if (!ruleId) return NextResponse.json({ error: "Invalid rule id" }, { status: 400 });
    deleteRule(ruleId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
