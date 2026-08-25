import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURSOR_MODELS,
  CODEX_MODELS,
  DEFAULT_AI_SETTINGS,
  OPENAI_MODELS,
  cursorModelForWorkload,
  codexModelForWorkload,
  isAIProvider,
  isCursorModel,
  isCodexModel,
  isOpenAIModel,
  normalizeAISettings,
  openAIModelForWorkload,
} from "../lib/ai-settings";

describe("AI settings", () => {
  it("uses balanced OpenAI routing by default", () => {
    const settings = normalizeAISettings({});
    assert.deepEqual(settings, DEFAULT_AI_SETTINGS);
    assert.equal(openAIModelForWorkload(settings, "generation"), "gpt-5.6-sol");
    assert.equal(openAIModelForWorkload(settings, "chat"), "gpt-5.6-terra");
    assert.equal(openAIModelForWorkload(settings, "routine"), "gpt-5.6-luna");
    assert.equal(settings.reasoningEffort, "high");
    assert.equal(codexModelForWorkload(settings, "generation"), "gpt-5.6-sol");
    assert.equal(codexModelForWorkload(settings, "chat"), "gpt-5.6-terra");
    assert.equal(codexModelForWorkload(settings, "routine"), "gpt-5.6-luna");
  });

  it("accepts only supported providers and models", () => {
    assert.equal(isAIProvider("openai"), true);
    assert.equal(isAIProvider("cursor"), true);
    assert.equal(isAIProvider("codex"), true);
    assert.equal(isAIProvider("automatic"), false);
    for (const model of OPENAI_MODELS) assert.equal(isOpenAIModel(model), true);
    for (const model of CURSOR_MODELS) assert.equal(isCursorModel(model), true);
    for (const model of CODEX_MODELS) assert.equal(isCodexModel(model), true);
    assert.equal(isOpenAIModel("composer-2.5"), false);
    assert.equal(isCursorModel("gpt-5.6-sol"), false);
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

  it("keeps Cursor compatibility on its existing balanced model", () => {
    assert.equal(cursorModelForWorkload("generation"), "composer-2.5");
    assert.equal(cursorModelForWorkload("chat"), "composer-2.5");
    assert.equal(cursorModelForWorkload("routine"), "composer-2.5");
  });
});
