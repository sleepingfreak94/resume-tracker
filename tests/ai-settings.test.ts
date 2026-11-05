import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLAUDE_MODELS,
  CURSOR_MODELS,
  CODEX_MODELS,
  DEFAULT_AI_SETTINGS,
  OPENAI_MODELS,
  claudeModelForWorkload,
  cursorModelForWorkload,
  codexModelForWorkload,
  isAIProvider,
  isClaudeModel,
  isCursorModel,
  isCodexModel,
  isOpenAIModel,
  normalizeAISettings,
  openAIModelForWorkload,
} from "../lib/ai-settings";

describe("AI settings", () => {
  it("defaults to Claude with balanced routing for every provider", () => {
    const settings = normalizeAISettings({});
    assert.deepEqual(settings, DEFAULT_AI_SETTINGS);
    assert.equal(DEFAULT_AI_SETTINGS.provider, "claude");
    assert.equal(settings.provider, "claude");
    assert.equal(claudeModelForWorkload(settings, "generation"), "claude-opus-5-5");
    assert.equal(claudeModelForWorkload(settings, "chat"), "claude-sonnet-5-5");
    assert.equal(claudeModelForWorkload(settings, "routine"), "claude-haiku-5-5");
    assert.equal(openAIModelForWorkload(settings, "generation"), "gpt-5.6-sol");
    assert.equal(openAIModelForWorkload(settings, "chat"), "gpt-5.6-terra");
    assert.equal(openAIModelForWorkload(settings, "routine"), "gpt-5.6-luna");
    assert.equal(settings.reasoningEffort, "high");
    assert.equal(codexModelForWorkload(settings, "generation"), "gpt-5.6-sol");
    assert.equal(codexModelForWorkload(settings, "chat"), "gpt-5.6-terra");
    assert.equal(codexModelForWorkload(settings, "routine"), "gpt-5.6-luna");
  });

  it("accepts only supported providers and models", () => {
    assert.equal(isAIProvider("claude"), true);
    assert.equal(isAIProvider("openai"), true);
    assert.equal(isAIProvider("cursor"), true);
    assert.equal(isAIProvider("codex"), true);
    assert.equal(isAIProvider("automatic"), false);
    for (const model of OPENAI_MODELS) assert.equal(isOpenAIModel(model), true);
    for (const model of CURSOR_MODELS) assert.equal(isCursorModel(model), true);
    for (const model of CODEX_MODELS) assert.equal(isCodexModel(model), true);
    for (const model of CLAUDE_MODELS) assert.equal(isClaudeModel(model), true);
    assert.equal(isOpenAIModel("composer-2.5"), false);
    assert.equal(isCursorModel("gpt-5.6-sol"), false);
    assert.equal(isClaudeModel("gpt-5.6-sol"), false);
    assert.equal(isClaudeModel("claude-sonnet-5"), false);
    assert.equal(isCodexModel("claude-opus-5-5"), false);
  });

  it("falls back safely when stored values are stale", () => {
    assert.deepEqual(normalizeAISettings({
      provider: "unknown",
      generationModel: "retired-model",
      chatModel: "gpt-5.6-sol",
      routineModel: null,
    }), {
      ...DEFAULT_AI_SETTINGS,
      chatModel: "gpt-5.6-sol",
    });
  });

  it("falls back safely when stored Claude values are stale", () => {
    assert.deepEqual(normalizeAISettings({
      claudeGenerationModel: "retired",
      claudeChatModel: "claude-opus-5-5",
    }), {
      ...DEFAULT_AI_SETTINGS,
      claudeChatModel: "claude-opus-5-5",
    });
  });

  it("keeps Cursor compatibility on its existing balanced model", () => {
    assert.equal(cursorModelForWorkload("generation"), "composer-2.5");
    assert.equal(cursorModelForWorkload("chat"), "composer-2.5");
    assert.equal(cursorModelForWorkload("routine"), "composer-2.5");
  });
});
