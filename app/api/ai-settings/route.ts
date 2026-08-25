import { NextRequest, NextResponse } from "next/server";
import {
  getAIKeyStatus,
  getAISettings,
  isCodexModel,
  isAIProvider,
  isOpenAIModel,
  updateAISettings,
} from "@/lib/ai-settings";
import { getCodexAuthStatus } from "@/lib/ai-provider";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ...getAISettings(), ...getAIKeyStatus(), codexAuthStatus: await getCodexAuthStatus() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const input: Parameters<typeof updateAISettings>[0] = {};
    if ("provider" in body) {
      if (!isAIProvider(body.provider)) throw new Error("Provider must be OpenAI, Codex, or Cursor");
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
    return NextResponse.json({ ...updateAISettings(input), ...getAIKeyStatus(), codexAuthStatus: await getCodexAuthStatus() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
