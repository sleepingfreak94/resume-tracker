import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { JobStatus, STATUS_CHECK_SQL } from "./job-status";

const DB_PATH = path.join(process.cwd(), "data", "resume-tracker.db");

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      job_link TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN (${STATUS_CHECK_SQL})),
      tailored_resume_path TEXT,
      agent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_text TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS ats_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
      overall_score INTEGER,
      keyword_score INTEGER,
      skills_score INTEGER,
      experience_score INTEGER,
      format_score INTEGER,
      ai_analysis TEXT,
      matched_keywords TEXT,
      missing_keywords TEXT,
      computed_at TEXT,
      ai_analyzed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS job_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL,
      description TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      linkedin_url TEXT,
      portfolio_url TEXT,
      location TEXT,
      current_company TEXT,
      current_title TEXT,
      work_authorization TEXT,
      requires_sponsorship INTEGER DEFAULT 0,
      has_work_permit INTEGER DEFAULT 0,
      has_pr INTEGER DEFAULT 0,
      years_experience INTEGER,
      education_level TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS portals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ats TEXT NOT NULL CHECK(ats IN ('greenhouse', 'ashby', 'lever')),
      slug TEXT NOT NULL,
      UNIQUE(ats, slug)
    );
  `);

  migrateJobStatuses(db);
  migrateAddLastActivity(db);
  migrateAddProfileWorkAuth(db);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS jobs_job_link_unique ON jobs(job_link) WHERE job_link IS NOT NULL");
  seedPortals(db);

  // Seed default rules if none exist
  const count = (db.prepare("SELECT COUNT(*) as c FROM rules").get() as { c: number }).c;
  if (count === 0) {
    const insert = db.prepare("INSERT INTO rules (rule_text, priority, is_active) VALUES (?, ?, 1)");
    const defaults = [
      ["Tailor the summary/objective to directly address the job description and company", 1],
      ["Emphasize skills and technologies that match the job requirements", 2],
      ["Quantify achievements with numbers and percentages wherever possible", 3],
      ["Use strong action verbs at the start of each bullet point", 4],
      ["Keep Experience jobs in reverse-chronological order (latest role first, oldest last). Never reorder employers by relevance — Meazure Learning, then Infobyte Tech Solutions, then Becton Dickinson (BD), then Softprodigy. You may reorder bullets within a job, but not the jobs themselves.", 5],
      ["Keep the resume concise — aim for one page unless experience warrants two", 6],
      ["Reorder bullet points and Skills/Summary emphasis to prioritize the most relevant experience — do NOT reorder employers; job order stays reverse-chronological", 7],
      ["Mirror keywords from the job description to pass ATS screening", 8],
      ["Expand acronyms where they already appear in the resume (e.g., write 'AWS (Amazon Web Services)') to maximize keyword matching — do NOT add acronyms not in the base resume", 9],
      ["Front-load bullet points with the most relevant keywords from the job description — only rearrange existing content, do not invent new content", 10],
    ];
    for (const [text, priority] of defaults) {
      insert.run(text, priority);
    }
  }
}

function seedPortals(db: Database.Database) {
  const seeded = db.prepare("SELECT value FROM settings WHERE key = 'portals_seeded_v1'").get() as { value: string } | undefined;
  if (seeded?.value === "1") return;
  const count = (db.prepare("SELECT COUNT(*) AS count FROM portals").get() as { count: number }).count;
  if (count > 0) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('portals_seeded_v1', '1')").run();
    return;
  }
  const defaultsPath = path.join(process.cwd(), "portals.json");
  if (!fs.existsSync(defaultsPath)) return;
  try {
    const portals = JSON.parse(fs.readFileSync(defaultsPath, "utf-8")) as Portal[];
    const insert = db.prepare("INSERT OR IGNORE INTO portals (name, ats, slug) VALUES (?, ?, ?)");
    for (const portal of portals) insert.run(portal.name, portal.ats, portal.slug);
  } catch {
    // The app can still start with an empty portal list if the optional seed is invalid.
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('portals_seeded_v1', '1')").run();
}

const JOBS_STATUS_SCHEMA_KEY = "jobs_status_v3";

function migrateJobStatuses(db: Database.Database) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(JOBS_STATUS_SCHEMA_KEY) as
    | { value: string }
    | undefined;
  if (row?.value === "1") return;

  db.exec(`
    PRAGMA foreign_keys=OFF;
    BEGIN TRANSACTION;
    CREATE TABLE jobs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      job_link TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN (${STATUS_CHECK_SQL})),
      tailored_resume_path TEXT,
      agent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO jobs_new SELECT * FROM jobs;
    DROP TABLE jobs;
    ALTER TABLE jobs_new RENAME TO jobs;
    COMMIT;
    PRAGMA foreign_keys=ON;
  `);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(JOBS_STATUS_SCHEMA_KEY, "1");
}

function migrateAddLastActivity(db: Database.Database) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("last_activity_migration_v1") as { value: string } | undefined;
  if (row?.value === "1") return;
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN last_activity_at TEXT`);
    db.exec(`UPDATE jobs SET last_activity_at = updated_at`);
  } catch {
    // Column may already exist if DB was created fresh with updated schema
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("last_activity_migration_v1", "1");
}

function migrateAddProfileWorkAuth(db: Database.Database) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("profile_work_auth_v1") as { value: string } | undefined;
  if (row?.value === "1") return;
  for (const col of ["has_work_permit INTEGER DEFAULT 0", "has_pr INTEGER DEFAULT 0"]) {
    try {
      db.exec(`ALTER TABLE profile ADD COLUMN ${col}`);
    } catch {
      // Column may already exist if DB was created fresh with updated schema
    }
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("profile_work_auth_v1", "1");
}

// --- Job helpers ---

export interface Job {
  id: number;
  company: string;
  title: string;
  description: string;
  job_link: string | null;
  status: JobStatus;
  tailored_resume_path: string | null;
  agent_id: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export function listJobs(): Job[] {
  return getDb().prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as Job[];
}

export function getJob(id: number): Job | undefined {
  return getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
}

export function createJob(data: Omit<Job, "id" | "status" | "tailored_resume_path" | "agent_id" | "last_activity_at" | "created_at" | "updated_at">): Job {
  const db = getDb();
  const result = db
    .prepare("INSERT INTO jobs (company, title, description, job_link) VALUES (?, ?, ?, ?)")
    .run(data.company, data.title, data.description, data.job_link ?? null);
  return getJob(result.lastInsertRowid as number)!;
}

export function updateJobStatus(
  id: number,
  status: Job["status"],
  extra: { tailored_resume_path?: string; agent_id?: string } = {}
) {
  const db = getDb();
  db.prepare(
    `UPDATE jobs SET status = ?, tailored_resume_path = COALESCE(?, tailored_resume_path),
     agent_id = COALESCE(?, agent_id), updated_at = datetime('now') WHERE id = ?`
  ).run(status, extra.tailored_resume_path ?? null, extra.agent_id ?? null, id);
}

export function claimJobGeneration(id: number): boolean {
  const result = getDb().prepare(
    "UPDATE jobs SET status = 'generating', updated_at = datetime('now') WHERE id = ? AND status != 'generating'"
  ).run(id);
  return result.changes === 1;
}

export function updateJobDetails(id: number, data: Pick<Job, "company" | "title" | "description" | "job_link">) {
  getDb().prepare(
    `UPDATE jobs SET company = ?, title = ?, description = ?, job_link = ?,
     updated_at = datetime('now') WHERE id = ?`
  ).run(data.company, data.title, data.description, data.job_link, id);
  return getJob(id);
}

export function deleteJob(id: number) {
  getDb().prepare("DELETE FROM jobs WHERE id = ?").run(id);
}

// --- Rule helpers ---

export interface Rule {
  id: number;
  rule_text: string;
  priority: number;
  is_active: number;
  created_at: string;
}

export function listRules(): Rule[] {
  return getDb().prepare("SELECT * FROM rules ORDER BY priority ASC").all() as Rule[];
}

export function createRule(rule_text: string, priority: number): Rule {
  const db = getDb();
  const result = db.prepare("INSERT INTO rules (rule_text, priority) VALUES (?, ?)").run(rule_text, priority);
  return db.prepare("SELECT * FROM rules WHERE id = ?").get(result.lastInsertRowid) as Rule;
}

export function updateRule(id: number, data: Partial<Pick<Rule, "rule_text" | "priority" | "is_active">>) {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.rule_text !== undefined) { sets.push("rule_text = ?"); vals.push(data.rule_text); }
  if (data.priority !== undefined) { sets.push("priority = ?"); vals.push(data.priority); }
  if (data.is_active !== undefined) { sets.push("is_active = ?"); vals.push(data.is_active); }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE rules SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function deleteRule(id: number) {
  getDb().prepare("DELETE FROM rules WHERE id = ?").run(id);
}

// --- Settings helpers ---

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function deleteSetting(key: string) {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

// --- Portal helpers ---

export interface Portal {
  id?: number;
  name: string;
  ats: "greenhouse" | "ashby" | "lever";
  slug: string;
}

export function listPortals(): Portal[] {
  return getDb().prepare("SELECT id, name, ats, slug FROM portals ORDER BY name").all() as Portal[];
}

export function createPortal(data: Omit<Portal, "id">): Portal {
  const result = getDb().prepare("INSERT INTO portals (name, ats, slug) VALUES (?, ?, ?)").run(
    data.name,
    data.ats,
    data.slug
  );
  return getDb().prepare("SELECT id, name, ats, slug FROM portals WHERE id = ?").get(result.lastInsertRowid) as Portal;
}

export function deletePortal(ats: Portal["ats"], slug: string): boolean {
  return getDb().prepare("DELETE FROM portals WHERE ats = ? AND slug = ?").run(ats, slug).changes === 1;
}

// --- ATS Score helpers ---

export interface ATSScore {
  id: number;
  job_id: number;
  overall_score: number | null;
  keyword_score: number | null;
  skills_score: number | null;
  experience_score: number | null;
  format_score: number | null;
  ai_analysis: string | null;
  matched_keywords: string | null;
  missing_keywords: string | null;
  computed_at: string | null;
  ai_analyzed_at: string | null;
}

export function getATSScore(jobId: number): ATSScore | undefined {
  return getDb().prepare("SELECT * FROM ats_scores WHERE job_id = ?").get(jobId) as ATSScore | undefined;
}

export function upsertATSScore(jobId: number, data: Partial<Omit<ATSScore, "id" | "job_id">>) {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM ats_scores WHERE job_id = ?").get(jobId);
  if (existing) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
    if (sets.length) {
      vals.push(jobId);
      db.prepare(`UPDATE ats_scores SET ${sets.join(", ")} WHERE job_id = ?`).run(...vals);
    }
  } else {
    const cols = ["job_id", ...Object.keys(data)];
    const placeholders = cols.map(() => "?").join(", ");
    db.prepare(`INSERT INTO ats_scores (${cols.join(", ")}) VALUES (${placeholders})`).run(jobId, ...Object.values(data));
  }
}

export function listATSScores(): ATSScore[] {
  return getDb().prepare("SELECT * FROM ats_scores").all() as ATSScore[];
}

// --- Activity helpers ---

export type ActivityType = "status_change" | "resume_tailored" | "resume_edited" | "score_computed" | "manual_note" | "follow_up_sent" | "cover_letter_generated";

export interface JobActivity {
  id: number;
  job_id: number;
  activity_type: ActivityType;
  description: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export function logActivity(jobId: number, type: ActivityType, description: string, opts: { old_value?: string; new_value?: string } = {}) {
  const db = getDb();
  db.prepare(
    "INSERT INTO job_activities (job_id, activity_type, description, old_value, new_value) VALUES (?, ?, ?, ?, ?)"
  ).run(jobId, type, description, opts.old_value ?? null, opts.new_value ?? null);
  db.prepare("UPDATE jobs SET last_activity_at = datetime('now') WHERE id = ?").run(jobId);
}

export function getJobActivities(jobId: number): JobActivity[] {
  return getDb()
    .prepare("SELECT * FROM job_activities WHERE job_id = ? ORDER BY created_at DESC")
    .all(jobId) as JobActivity[];
}

// --- Profile helpers ---

export interface Profile {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  location: string | null;
  current_company: string | null;
  current_title: string | null;
  work_authorization: string | null;
  requires_sponsorship: number;
  has_work_permit: number;
  has_pr: number;
  years_experience: number | null;
  education_level: string | null;
  updated_at: string;
}

export function getProfile(): Profile {
  const db = getDb();
  let row = db.prepare("SELECT * FROM profile WHERE id = 1").get() as Profile | undefined;
  if (!row) {
    db.prepare("INSERT INTO profile (id) VALUES (1)").run();
    row = db.prepare("SELECT * FROM profile WHERE id = 1").get() as Profile;
  }
  return row;
}

export function upsertProfile(data: Partial<Omit<Profile, "id" | "updated_at">>) {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM profile WHERE id = 1").get();
  if (!existing) {
    db.prepare("INSERT INTO profile (id) VALUES (1)").run();
  }
  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(data)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(1);
  db.prepare(`UPDATE profile SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getProfile();
}
