import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { AIProviderError, __claudeProviderTestUtils } from "../lib/ai-provider";

function isClaudeError(error: unknown): boolean {
  return error instanceof AIProviderError && error.provider === "claude";
}

describe("Claude provider isolation", () => {
  it("constructs a headless, tool-less, non-persistent JSON command", () => {
    const schema = { type: "object", properties: { text: { type: "string" } }, required: ["text"] };
    const schemaJson = JSON.stringify(schema);
    const args = __claudeProviderTestUtils.claudeExecArgs("claude-haiku-5-5", schemaJson);
    assert.equal(args[0], "-p");
    for (const flag of [
      "--output-format", "--json-schema", "--model", "--effort", "--max-turns", "--tools",
      "--strict-mcp-config", "--mcp-config", "--setting-sources", "--disable-slash-commands",
      "--no-session-persistence", "--permission-prompts", "--safe-mode",
    ]) {
      assert.ok(args.includes(flag), `missing ${flag}`);
    }
    const valueOf = (flag: string) => args[args.indexOf(flag) + 1];
    assert.equal(valueOf("--output-format"), "json");
    assert.equal(valueOf("--model"), "claude-haiku-5-5");
    assert.equal(valueOf("--effort"), "high");
    assert.equal(valueOf("--max-turns"), "2");
    assert.equal(valueOf("--tools"), "");
    assert.equal(valueOf("--setting-sources"), "");
    assert.equal(valueOf("--permission-prompts"), "none");
    assert.deepEqual(JSON.parse(valueOf("--mcp-config")), { mcpServers: {} });
    assert.deepEqual(JSON.parse(valueOf("--json-schema")), schema);
    assert.ok(!args.includes("--dangerously-skip-permissions"));
    assert.ok(!args.some((arg) => arg.includes("Tailor my resume")));
  });

  it("removes API keys and application secrets from the child environment", () => {
    const env = __claudeProviderTestUtils.sanitizeClaudeEnvironment({
      NODE_ENV: "test",
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      CLAUDE_CONFIG_DIR: "/tmp/claude",
      ANTHROPIC_API_KEY: "secret",
      ANTHROPIC_AUTH_TOKEN: "secret",
      ANTHROPIC_BASE_URL: "https://example.invalid",
      CLAUDE_CODE_USE_BEDROCK: "1",
      AWS_SECRET_ACCESS_KEY: "secret",
      OPENAI_API_KEY: "secret",
      CURSOR_API_KEY: "secret",
      DATABASE_URL: "secret",
      APP_SECRET: "secret",
      RESUME_TRACKER_CLAUDE_CLI: "/x",
    } as NodeJS.ProcessEnv);
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.HOME, "/tmp/home");
    assert.equal(env.CLAUDE_CONFIG_DIR, "/tmp/claude");
    for (const key of [
      "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK",
      "AWS_SECRET_ACCESS_KEY", "OPENAI_API_KEY", "CURSOR_API_KEY", "DATABASE_URL", "APP_SECRET",
      "RESUME_TRACKER_CLAUDE_CLI",
    ]) {
      assert.equal(env[key], undefined, `${key} leaked`);
    }
    assert.equal(env.DISABLE_TELEMETRY, "1");
    assert.equal(env.DISABLE_ERROR_REPORTING, "1");
    assert.equal(env.DISABLE_AUTOUPDATER, "1");
    assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
  });

  it("resolves the Claude CLI path", () => {
    const resolve = __claudeProviderTestUtils.claudeCliCommand;
    assert.equal(resolve({ NODE_ENV: "test" } as NodeJS.ProcessEnv), "claude");
    assert.equal(resolve({ NODE_ENV: "test", RESUME_TRACKER_CLAUDE_CLI: "   " } as NodeJS.ProcessEnv), "claude");
    assert.equal(resolve({ NODE_ENV: "test", RESUME_TRACKER_CLAUDE_CLI: "/x" } as NodeJS.ProcessEnv), "/x");
    assert.throws(
      () => resolve({ NODE_ENV: "test", RESUME_TRACKER_CLAUDE_CLI: "bin/claude" } as NodeJS.ProcessEnv),
      /absolute/i,
    );
  });

  it("parses the single JSON result and rejects failures", () => {
    const parse = __claudeProviderTestUtils.parseClaudeResult;
    const wrapped = parse(JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: JSON.stringify({ text: "hello" }),
      session_id: "session-1",
    }), { wrappedText: true });
    assert.deepEqual(wrapped, { text: "hello", runId: "session-1" });

    const structured = parse(JSON.stringify({
      subtype: "success",
      is_error: false,
      result: JSON.stringify({ title: "Engineer", score: 5 }),
      session_id: "session-2",
    }), { wrappedText: false });
    assert.deepEqual(JSON.parse(structured.text), { title: "Engineer", score: 5 });
    assert.equal(structured.runId, "session-2");

    const failures = [
      JSON.stringify({ subtype: "success", is_error: true, result: "Credit balance is too low" }),
      JSON.stringify({ subtype: "error_max_turns", is_error: false, result: "partial" }),
      JSON.stringify({ subtype: "success", is_error: false, result: "" }),
      "not json",
    ];
    for (const stdout of failures) {
      assert.throws(() => parse(stdout, { wrappedText: false }), isClaudeError);
      assert.throws(() => parse(stdout, { wrappedText: true }), isClaudeError);
    }
  });

  it("accepts only Claude subscription authentication", () => {
    const classify = __claudeProviderTestUtils.classifyClaudeAuthOutput;
    const subscription = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" });
    assert.equal(classify(subscription, 0), "subscription");
    assert.equal(classify(JSON.stringify({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" }), 0), "api_key");
    assert.equal(classify(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "bedrock" }), 0), "api_key");
    assert.equal(classify(JSON.stringify({ loggedIn: false }), 1), "signed_out");
    assert.equal(classify("unexpected output", 0), "unavailable");
    assert.equal(classify(subscription, 1), "unavailable");
  });

  it("keeps Claude CLI and SDK usage inside the central provider module", () => {
    const root = process.cwd();
    const violations: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (/\.[cm]?[jt]sx?$/.test(entry.name) && full !== path.join(root, "lib", "ai-provider.ts")) {
          const source = fs.readFileSync(full, "utf8");
          if (
            /from\s+["']@anthropic-ai\//.test(source)
            || /require\(\s*["']@anthropic-ai\//.test(source)
            || /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(\s*["'`]claude/.test(source)
            || source.includes("RESUME_TRACKER_CLAUDE_CLI")
          ) {
            violations.push(path.relative(root, full));
          }
        }
      }
    };
    for (const candidate of ["app", "components", "lib"]) {
      const directory = path.join(root, candidate);
      if (fs.existsSync(directory)) visit(directory);
    }
    assert.deepEqual(violations, []);
  });
});
