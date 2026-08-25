import { execFileSync } from "node:child_process";
import fs from "node:fs";

const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

const forbiddenTrackedPaths = [
  { name: "environment file", test: (file) => /(^|\/)\.env(?:\.|$)/.test(file) && file !== ".env.example" },
  { name: "local agent data", test: (file) => /^(?:\.agents|\.claude|\.claude-flow|\.codex|\.swarm)(?:\/|$)/.test(file) },
  { name: "local MCP configuration", test: (file) => file === ".mcp.json" },
  { name: "agent vector database", test: (file) => file === "ruvector.db" },
  { name: "Google OAuth tokens", test: (file) => file === "data/google-tokens.json" },
  { name: "local database", test: (file) => /^data\/.*\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal|journal))?$/.test(file) },
  { name: "personal or generated resume", test: (file) => file === "resumes/base-resume.md" || file.startsWith("resumes/tailored/") },
  { name: "generated output", test: (file) => file.startsWith("output/") },
  { name: "private key or OAuth credential file", test: (file) => /(^|\/)(?:client_secret|credentials).*\.json$/i.test(file) || /\.(?:pem|key|p12|pfx)$/i.test(file) },
];

const secretRules = [
  ["OpenAI-style API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ["GitHub token", /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})\b/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ["Google OAuth token", /\b(?:ya29\.[0-9A-Za-z_-]{20,}|1\/\/[0-9A-Za-z_-]{20,})\b/g],
  ["Slack token", /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g],
  ["Stripe live secret", /\bsk_live_[0-9A-Za-z]{20,}\b/g],
  ["npm token", /\bnpm_[A-Za-z0-9]{30,}\b/g],
  ["private key", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g],
];

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", ...options });
}

function trackedFiles() {
  return git(["ls-files", "-z"]).split("\0").filter(Boolean);
}

function lineNumber(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function scanText(text, location, findings) {
  for (const [ruleName, pattern] of secretRules) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      findings.push(`${location}:${lineNumber(text, match.index ?? 0)} (${ruleName})`);
    }
  }
}

function scanCurrentTree(files, findings) {
  for (const file of files) {
    for (const rule of forbiddenTrackedPaths) {
      if (rule.test(file)) findings.push(`${file} (${rule.name})`);
    }

    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_TEXT_FILE_BYTES) continue;

    const content = fs.readFileSync(file);
    if (content.includes(0)) continue;
    scanText(content.toString("utf8"), file, findings);
  }
}

function scanHistory(findings) {
  const revisions = git(["rev-list", "--all"]).trim().split(/\s+/).filter(Boolean);
  const combinedPattern = [
    "sk-(proj-)?[A-Za-z0-9_-]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "gh[pousr]_[A-Za-z0-9]{30,}",
    "AKIA[0-9A-Z]{16}",
    "AIza[0-9A-Za-z_-]{30,}",
    "ya29\\.[0-9A-Za-z_-]{20,}",
    "1//[0-9A-Za-z_-]{20,}",
    "xox[baprs]-[0-9A-Za-z-]{20,}",
    "sk_live_[0-9A-Za-z]{20,}",
    "npm_[A-Za-z0-9]{30,}",
    "BEGIN ([A-Z ]+ )?PRIVATE KEY",
  ].join("|");

  const seen = new Set();
  for (const revision of revisions) {
    let output = "";
    try {
      output = git(["grep", "-nI", "-E", combinedPattern, revision, "--", "."]);
    } catch (error) {
      if (error?.status === 1) continue;
      throw error;
    }
    for (const line of output.split("\n").filter(Boolean)) {
      const match = line.match(/^[^:]+:(.*?):(\d+):/);
      const location = match ? `${revision.slice(0, 12)}:${match[1]}:${match[2]}` : revision.slice(0, 12);
      if (!seen.has(location)) {
        seen.add(location);
        findings.push(`${location} (recognized credential pattern in Git history)`);
      }
    }
  }
}

const files = trackedFiles();
const findings = [];
scanCurrentTree(files, findings);
if (process.argv.includes("--history")) scanHistory(findings);

if (findings.length > 0) {
  console.error("Repository security check failed. Potential secrets are redacted; review these locations:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Repository security check passed (${files.length} tracked files${process.argv.includes("--history") ? ", full history" : ""}).`);
