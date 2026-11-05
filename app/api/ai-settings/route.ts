import { NextRequest, NextResponse } from "next/server";
import {
  getAIKeyStatus,
  getAISettings,
  isClaudeModel,
  isCodexModel,
  isAIProvider,
  isOpenAIModel,
  updateAISettings,
} from "@/lib/ai-settings";
import { getClaudeAuthStatus, getCodexAuthStatus } from "@/lib/ai-provider";

export const dynamic = "force-dynamic";

async function authStatuses() {
  const [codexAuthStatus, claudeAuthStatus] = await Promise.all([getCodexAuthStatus(), getClaudeAuthStatus()]);
  return { codexAuthStatus, claudeAuthStatus };
}

export async function GET() {
  try {
    return NextResponse.json({ ...getAISettings(), ...getAIKeyStatus(), ...(await authStatuses()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const input: Parameters<typeof updateAISettings>[0] = {};
    if ("provider" in body) {
      if (!isAIProvider(body.provider)) throw new Error("Provider must be Claude, OpenAI, Codex, or Cursor");
      if (body.provider === "claude" && await getClaudeAuthStatus() !== "subscription") {
        throw new Error("Sign in to Claude Code with your Claude subscription (claude auth login) before selecting the Claude provider");
      }
      if (body.provider === "codex" && await getCodexAuthStatus() !== "subscription") {
        throw new Error("Sign in to Codex with ChatGPT before selecting the Codex provider");
      }
      input.provider = body.provider;
    }
    for (const key of ["generationModel", "chatModel", "routineModel"] as const) {
      if (key in body) {
        if (!isOpenAIModel(body[key])) throw new Error(`Invalid OpenAI model for ${key}`);
        input[key] = body[key];
      }
    }
    for (const key of ["codexGenerationModel", "codexChatModel", "codexRoutineModel"] as const) {
      if (key in body) {
        if (!isCodexModel(body[key])) throw new Error(`Invalid Codex model for ${key}`);
        input[key] = body[key];
      }
    }
    for (const key of ["claudeGenerationModel", "claudeChatModel", "claudeRoutineModel"] as const) {
      if (key in body) {
        if (!isClaudeModel(body[key])) throw new Error(`Invalid Claude model for ${key}`);
        input[key] = body[key];
      }
    }
    const updated = updateAISettings(input);
    return NextResponse.json({ ...updated, ...getAIKeyStatus(), ...(await authStatuses()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
