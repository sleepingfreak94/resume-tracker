import { getSetting, setSetting } from "./db";

export const AI_PROVIDERS = ["openai", "codex", "cursor"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

export const OPENAI_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;
export type OpenAIModel = (typeof OPENAI_MODELS)[number];

export const CODEX_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;
export type CodexModel = (typeof CODEX_MODELS)[number];
export type CodexAuthStatus = "subscription" | "signed_out" | "api_key" | "unavailable";

export const CURSOR_MODELS = ["composer-2.5-fast", "composer-2.5", "claude-sonnet-5"] as const;
export type CursorModel = (typeof CURSOR_MODELS)[number];

export type AIWorkload = "generation" | "chat" | "routine";

export interface AISettings {
  provider: AIProvider;
  generationModel: OpenAIModel;
  chatModel: OpenAIModel;
  routineModel: OpenAIModel;
  codexGenerationModel: CodexModel;
  codexChatModel: CodexModel;
  codexRoutineModel: CodexModel;
  reasoningEffort: "high";
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: "openai",
  generationModel: "gpt-5.6-sol",
  chatModel: "gpt-5.6-terra",
  routineModel: "gpt-5.6-luna",
  codexGenerationModel: "gpt-5.6-sol",
  codexChatModel: "gpt-5.6-terra",
  codexRoutineModel: "gpt-5.6-luna",
  reasoningEffort: "high",
};

const SETTING_KEYS = {
  provider: "ai_provider",
  generationModel: "ai_openai_generation_model",
  chatModel: "ai_openai_chat_model",
  routineModel: "ai_openai_routine_model",
  codexGenerationModel: "ai_codex_generation_model",
  codexChatModel: "ai_codex_chat_model",
  codexRoutineModel: "ai_codex_routine_model",
} as const;

export function isAIProvider(value: unknown): value is AIProvider {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}

export function aiProviderName(provider: AIProvider): "OpenAI" | "Codex" | "Cursor" {
  if (provider === "openai") return "OpenAI";
  if (provider === "codex") return "Codex";
  return "Cursor";
}

export function isOpenAIModel(value: unknown): value is OpenAIModel {
  return typeof value === "string" && (OPENAI_MODELS as readonly string[]).includes(value);
}

export function isCursorModel(value: unknown): value is CursorModel {
  return typeof value === "string" && (CURSOR_MODELS as readonly string[]).includes(value);
}

export function isCodexModel(value: unknown): value is CodexModel {
  return typeof value === "string" && (CODEX_MODELS as readonly string[]).includes(value);
}

export function normalizeAISettings(input: Partial<Record<keyof AISettings, unknown>>): AISettings {
  return {
    provider: isAIProvider(input.provider) ? input.provider : DEFAULT_AI_SETTINGS.provider,
    generationModel: isOpenAIModel(input.generationModel) ? input.generationModel : DEFAULT_AI_SETTINGS.generationModel,
    chatModel: isOpenAIModel(input.chatModel) ? input.chatModel : DEFAULT_AI_SETTINGS.chatModel,
    routineModel: isOpenAIModel(input.routineModel) ? input.routineModel : DEFAULT_AI_SETTINGS.routineModel,
    codexGenerationModel: isCodexModel(input.codexGenerationModel) ? input.codexGenerationModel : DEFAULT_AI_SETTINGS.codexGenerationModel,
    codexChatModel: isCodexModel(input.codexChatModel) ? input.codexChatModel : DEFAULT_AI_SETTINGS.codexChatModel,
    codexRoutineModel: isCodexModel(input.codexRoutineModel) ? input.codexRoutineModel : DEFAULT_AI_SETTINGS.codexRoutineModel,
    reasoningEffort: "high",
  };
}

export function getAISettings(): AISettings {
  return normalizeAISettings({
    provider: getSetting(SETTING_KEYS.provider),
    generationModel: getSetting(SETTING_KEYS.generationModel),
    chatModel: getSetting(SETTING_KEYS.chatModel),
    routineModel: getSetting(SETTING_KEYS.routineModel),
    codexGenerationModel: getSetting(SETTING_KEYS.codexGenerationModel),
    codexChatModel: getSetting(SETTING_KEYS.codexChatModel),
    codexRoutineModel: getSetting(SETTING_KEYS.codexRoutineModel),
  });
}

export function updateAISettings(input: Partial<Omit<AISettings, "reasoningEffort">>): AISettings {
  if (input.provider !== undefined) {
    if (!isAIProvider(input.provider)) throw new Error("Provider must be OpenAI, Codex, or Cursor");
    setSetting(SETTING_KEYS.provider, input.provider);
  }
  for (const key of ["codexGenerationModel", "codexChatModel", "codexRoutineModel"] as const) {
    const value = input[key];
    if (value !== undefined) {
      if (!isCodexModel(value)) throw new Error(`Invalid Codex model for ${key}`);
      setSetting(SETTING_KEYS[key], value);
    }
  }
  for (const key of ["generationModel", "chatModel", "routineModel"] as const) {
    const value = input[key];
    if (value !== undefined) {
      if (!isOpenAIModel(value)) throw new Error(`Invalid OpenAI model for ${key}`);
      setSetting(SETTING_KEYS[key], value);
    }
  }
  return getAISettings();
}

export function codexModelForWorkload(settings: AISettings, workload: AIWorkload): CodexModel {
  if (workload === "generation") return settings.codexGenerationModel;
  if (workload === "chat") return settings.codexChatModel;
  return settings.codexRoutineModel;
}

export function openAIModelForWorkload(settings: AISettings, workload: AIWorkload): OpenAIModel {
  if (workload === "generation") return settings.generationModel;
  if (workload === "chat") return settings.chatModel;
  return settings.routineModel;
}

export function cursorModelForWorkload(workload: AIWorkload): CursorModel {
  void workload;
  return "composer-2.5";
}

export function getAIKeyStatus() {
  return {
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    cursorConfigured: Boolean(process.env.CURSOR_API_KEY?.trim()),
  };
}
