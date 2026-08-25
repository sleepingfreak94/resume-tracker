import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";

function readMarkdownFiles(directory: string): Record<string, string> {
  if (!fs.existsSync(directory)) return {};
  const files: Record<string, string> = {};
  for (const name of fs.readdirSync(directory)) {
    if (name.endsWith(".md")) files[name] = fs.readFileSync(path.join(directory, name), "utf-8");
  }
  return files;
}

export async function GET() {
  const db = getDb();
  const resumesDirectory = path.join(process.cwd(), "resumes");
  const backup = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    jobs: db.prepare("SELECT * FROM jobs ORDER BY id").all(),
    activities: db.prepare("SELECT * FROM job_activities ORDER BY id").all(),
    atsScores: db.prepare("SELECT * FROM ats_scores ORDER BY id").all(),
    rules: db.prepare("SELECT * FROM rules ORDER BY id").all(),
    profile: db.prepare("SELECT * FROM profile ORDER BY id").all(),
    portals: db.prepare("SELECT * FROM portals ORDER BY id").all(),
    applicationAnswers: db.prepare("SELECT * FROM application_answers ORDER BY id").all(),
    applicationAnswerAliases: db.prepare("SELECT * FROM application_answer_aliases ORDER BY id").all(),
    applicationQuestionQueue: db.prepare("SELECT * FROM application_question_queue ORDER BY id").all(),
    applicationAutomationSettings: db.prepare("SELECT key, value FROM settings WHERE key LIKE 'autofill_%' ORDER BY key").all(),
    aiSettings: db.prepare("SELECT key, value FROM settings WHERE key LIKE 'ai_%' ORDER BY key").all(),
    resumes: {
      base: readMarkdownFiles(resumesDirectory),
      tailored: readMarkdownFiles(path.join(resumesDirectory, "tailored")),
    },
  };
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="resume-tracker-backup-${date}.json"`,
    },
  });
}
