import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { __codexProviderTestUtils } from "../lib/ai-provider";

describe("Codex provider isolation", () => {
  it("constructs an ephemeral, read-only, non-interactive JSONL command", () => {
    const args = __codexProviderTestUtils.codexExecArgs("gpt-5.6-luna", "/tmp/schema.json", "/tmp/final.json", "/tmp/work");
    assert.deepEqual(args.slice(0, 3), ["--ask-for-approval", "never", "exec"]);
    for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "--json", "--output-schema", "--output-last-message"]) {
      assert.ok(args.includes(flag), `missing ${flag}`);
    }
    assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
    assert.equal(args[args.indexOf("--model") + 1], "gpt-5.6-luna");
    assert.ok(args.includes("web_search=\"disabled\""));
    assert.equal(args.at(-1), "-");
  });

  it("removes API keys and application secrets from the child environment", () => {
    const env = __codexProviderTestUtils.sanitizeCodexEnvironment({
      NODE_ENV: "test",
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      CODEX_HOME: "/tmp/codex",
      OPENAI_API_KEY: "secret",
      CURSOR_API_KEY: "secret",
      DATABASE_URL: "secret",
      APP_SECRET: "secret",
    });
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.CODEX_HOME, "/tmp/codex");
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.CURSOR_API_KEY, undefined);
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.APP_SECRET, undefined);
  });

  it("parses JSONL lifecycle errors and thread IDs", () => {
    const parsed = __codexProviderTestUtils.parseCodexEvents([
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n"));
    assert.deepEqual(parsed, { runId: "thread-1", error: null });
    assert.throws(() => __codexProviderTestUtils.parseCodexEvents("not-json"), /malformed JSONL/i);
  });

  it("accepts only ChatGPT subscription authentication", () => {
    const classify = __codexProviderTestUtils.classifyCodexAuthOutput;
    assert.equal(classify("Logged in using ChatGPT", 0), "subscription");
    assert.equal(classify("Logged in using API key", 0), "api_key");
    assert.equal(classify("Not logged in", 1), "signed_out");
    assert.equal(classify("unexpected output", 0), "unavailable");
    assert.equal(classify("Logged in using ChatGPT", 1), "unavailable");
  });

  it("keeps provider SDK and CLI imports inside the central provider module", () => {
    const root = process.cwd();
    const candidates = ["app", "components", "lib"];
    const violations: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (/\.[cm]?[jt]sx?$/.test(entry.name) && full !== path.join(root, "lib", "ai-provider.ts")) {
          const source = fs.readFileSync(full, "utf8");
          if (/from\s+["'](?:openai|@cursor\/sdk|@openai\/codex)|require\(["'](?:openai|@cursor\/sdk|@openai\/codex)/.test(source)) {
            violations.push(path.relative(root, full));
          }
        }
      }
    };
    candidates.forEach((candidate) => visit(path.join(root, candidate)));
    assert.deepEqual(violations, []);
  });
});
