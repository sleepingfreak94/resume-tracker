import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { buildDocxBuffer } from "../lib/md-to-docx";
import { isGoogleConfigured, isGoogleConnected, uploadDocx } from "../lib/google-drive";
import { getJob, getProfile } from "../lib/db";
import { toDriveFilename, toResumeFilename } from "../lib/resume-format";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();

function usage() {
  console.log(`Usage: npm run open-doc -- <job-id|base|path/to/file.md> [--drive-only]

Examples:
  npm run open-doc -- 3              # job-3.md → local Word + Google Drive
  npm run open-doc -- base           # base-resume.md
  npm run open-doc -- 3 --drive-only # upload and open in Drive only`);
}

function resolveMdPath(arg: string): { mdPath: string; jobId?: number } {
  if (arg === "base") {
    return { mdPath: path.join("resumes", "base-resume.md") };
  }

  if (/^\d+$/.test(arg)) {
    return {
      mdPath: path.join("resumes", "tailored", `job-${arg}.md`),
      jobId: Number(arg),
    };
  }

  return { mdPath: path.resolve(arg) };
}

function resolveFilename(target: string, jobId?: number): string {
  const profile = getProfile();
  if (target === "base") return toResumeFilename(profile);
  if (jobId) {
    const job = getJob(jobId);
    if (job) return toDriveFilename(profile, job.company);
  }
  const base = path.basename(target, path.extname(target));
  return `${base}.docx`;
}

function openLocal(filePath: string) {
  execSync(`open "${filePath}"`, { stdio: "inherit" });
}

function openUrl(url: string) {
  execSync(`open "${url}"`, { stdio: "inherit" });
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const target = args.find((a) => !a.startsWith("--"));
  const driveOnly = args.includes("--drive-only");

  if (!target) {
    usage();
    process.exit(1);
  }

  const { mdPath, jobId } = resolveMdPath(target);
  if (!fs.existsSync(mdPath)) {
    console.error(`Resume not found: ${mdPath}`);
    process.exit(1);
  }

  const filename = resolveFilename(target, jobId);
  const md = fs.readFileSync(mdPath, "utf-8");
  const buffer = await buildDocxBuffer(md);

  const outDir = path.join("output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length} bytes)`);

  if (!driveOnly) {
    openLocal(path.resolve(outPath));
    console.log("Opened locally.");
  }

  if (!isGoogleConfigured()) {
    console.warn("Google Drive not configured — skipping Drive upload.");
    return;
  }

  if (!isGoogleConnected()) {
    console.warn(
      "Not connected to Google Drive. Sign in via the app first (Save to Google Drive button), then retry."
    );
    return;
  }

  const { url } = await uploadDocx(buffer, filename);
  console.log(`Uploaded to Google Drive: ${url}`);
  openUrl(url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
