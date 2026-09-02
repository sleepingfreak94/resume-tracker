import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { JobStatus, STATUS_CHECK_SQL } from "./job-status";
import { shouldExpireLinkedInRun } from "./linkedin-run";

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

    CREATE TABLE IF NOT EXISTS application_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_question TEXT NOT NULL,
      normalized_question TEXT NOT NULL,
      answer_json TEXT NOT NULL,
      answer_type TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      confidence TEXT NOT NULL DEFAULT 'high',
      scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global', 'job')),
      job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      is_confirmed INTEGER NOT NULL DEFAULT 0,
      use_count INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'other',
      correction_count INTEGER NOT NULL DEFAULT 0,
      last_confirmed_at TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS application_answer_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      answer_id INTEGER NOT NULL REFERENCES application_answers(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      normalized_question TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(answer_id, normalized_question)
    );

    CREATE TABLE IF NOT EXISTS application_question_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_text TEXT NOT NULL,
      normalized_question TEXT NOT NULL,
      question_kind TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      page_url TEXT,
      job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      suggested_answer_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'resolved', 'dismissed')),
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_answer_id INTEGER REFERENCES application_answers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS linkedin_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keywords TEXT NOT NULL,
      location TEXT,
      max_jobs INTEGER NOT NULL DEFAULT 15,
      auto_submit INTEGER NOT NULL DEFAULT 0,
      app_port INTEGER NOT NULL DEFAULT 3000,
      heartbeat_at TEXT,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued','running','tailoring','done','stopped','failed')),
      -- ponytail: items stored as JSON blob; not queryable per-item. Fine for a single-user run log.
      -- upgrade path: extract to a linkedin_run_items table if reporting is needed.
      items_json TEXT NOT NULL DEFAULT '[]',
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  migrateJobStatuses(db);
  migrateAddLastActivity(db);
  migrateAddProfileWorkAuth(db);
  migrateApplicationAnswerIntelligence(db);
  migrateLinkedInRunConnectivity(db);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS jobs_job_link_unique ON jobs(job_link) WHERE job_link IS NOT NULL");
  db.exec("CREATE INDEX IF NOT EXISTS application_answers_normalized_idx ON application_answers(normalized_question, scope)");
  db.exec("CREATE INDEX IF NOT EXISTS application_aliases_normalized_idx ON application_answer_aliases(normalized_question)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS application_queue_pending_unique ON application_question_queue(normalized_question) WHERE status = 'pending'");
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

function migrateApplicationAnswerIntelligence(db: Database.Database) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("application_answer_intelligence_v1") as { value: string } | undefined;
  if (row?.value === "1") return;
  for (const column of [
    "category TEXT NOT NULL DEFAULT 'other'",
    "correction_count INTEGER NOT NULL DEFAULT 0",
    "last_confirmed_at TEXT",
  ]) {
    try {
      db.exec(`ALTER TABLE application_answers ADD COLUMN ${column}`);
    } catch {
      // Column may already exist when the database was created from the current schema.
    }
  }
  db.prepare("UPDATE application_answers SET last_confirmed_at = updated_at WHERE is_confirmed = 1 AND last_confirmed_at IS NULL").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("application_answer_intelligence_v1", "1");
}

function migrateLinkedInRunConnectivity(db: Database.Database) {
  const migrationKey = "linkedin_run_connectivity_v1";
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(migrationKey) as { value: string } | undefined;
  if (row?.value === "1") return;
  for (const column of [
    "app_port INTEGER NOT NULL DEFAULT 3000",
    "heartbeat_at TEXT",
  ]) {
    try {
      db.exec(`ALTER TABLE linkedin_runs ADD COLUMN ${column}`);
    } catch {
      // Column may already exist when the database was created from the current schema.
    }
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(migrationKey, "1");
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

export function invalidateJobGeneration(id: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET status = 'pending', tailored_resume_path = NULL, agent_id = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(id);
  db.prepare("DELETE FROM ats_scores WHERE job_id = ?").run(id);
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

// --- LinkedIn run helpers ---

export type LinkedInRunStatus = "queued" | "running" | "tailoring" | "done" | "stopped" | "failed";

export interface LinkedInRunItem {
  jobId: number | null;
  title: string;
  company: string;
  url: string;
  applyType: "easy_apply" | "external";
  outcome: "processing" | "applied" | "needs_manual" | "failed" | "skipped";
  phase?: "imported" | "prepared" | "modal_open" | "awaiting_user" | "submission_started";
  note: string;
}

export interface LinkedInRun {
  id: number;
  keywords: string;
  location: string | null;
  max_jobs: number;
  auto_submit: number;
  app_port: number;
  heartbeat_at: string | null;
  status: LinkedInRunStatus;
  items_json: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function createLinkedInRun(data: Pick<LinkedInRun, "keywords" | "location" | "max_jobs" | "auto_submit" | "app_port">): LinkedInRun {
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO linkedin_runs (keywords, location, max_jobs, auto_submit, app_port) VALUES (?, ?, ?, ?, ?)"
  ).run(data.keywords, data.location ?? null, data.max_jobs, data.auto_submit, data.app_port);
  return db.prepare("SELECT * FROM linkedin_runs WHERE id = ?").get(result.lastInsertRowid) as LinkedInRun;
}

export function getLinkedInRun(id: number): LinkedInRun | undefined {
  return getDb().prepare("SELECT * FROM linkedin_runs WHERE id = ?").get(id) as LinkedInRun | undefined;
}

export function getActiveLinkedInRun(): LinkedInRun | undefined {
  expireStaleLinkedInRuns();
  return getDb()
    .prepare("SELECT * FROM linkedin_runs WHERE status IN ('queued','running','tailoring') ORDER BY created_at DESC LIMIT 1")
    .get() as LinkedInRun | undefined;
}

export function expireStaleLinkedInRuns(nowMs = Date.now()): number {
  const db = getDb();
  const runs = db.prepare("SELECT * FROM linkedin_runs WHERE status IN ('queued','running','tailoring')").all() as LinkedInRun[];
  const update = db.prepare("UPDATE linkedin_runs SET status = 'failed', note = ?, items_json = ?, updated_at = datetime('now') WHERE id = ?");
  let expired = 0;

  for (const run of runs) {
    if (!shouldExpireLinkedInRun(run, nowMs)) continue;
    const items = JSON.parse(run.items_json) as LinkedInRunItem[];
    const finalizedItems = items.map((item) => {
      if (item.outcome !== "processing") return item;
      const completedItem: LinkedInRunItem = {
        ...item,
        outcome: "failed" as const,
        note: "Extension connection timed out before this job was completed. Review it manually before retrying.",
      };
      delete completedItem.phase;
      return completedItem;
    });
    update.run(
      "Extension connection timed out. This run was stopped to prevent a stale browser session from blocking new searches.",
      JSON.stringify(finalizedItems),
      run.id,
    );
    expired++;
  }

  return expired;
}

export function listLinkedInRuns(limit = 20): LinkedInRun[] {
  return getDb().prepare("SELECT * FROM linkedin_runs ORDER BY created_at DESC LIMIT ?").all(limit) as LinkedInRun[];
}

export function updateLinkedInRun(id: number, data: Partial<Pick<LinkedInRun, "status" | "note">>) {
  const db = getDb();
  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];
  if (data.status !== undefined) { sets.push("status = ?"); vals.push(data.status); }
  if (data.note !== undefined) { sets.push("note = ?"); vals.push(data.note); }
  vals.push(id);
  db.prepare(`UPDATE linkedin_runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function heartbeatLinkedInRun(id: number): void {
  getDb().prepare("UPDATE linkedin_runs SET heartbeat_at = datetime('now') WHERE id = ?").run(id);
}

export function appendLinkedInRunItem(id: number, item: LinkedInRunItem): void {
  const db = getDb();
  const run = db.prepare("SELECT items_json FROM linkedin_runs WHERE id = ?").get(id) as { items_json: string } | undefined;
  if (!run) throw new Error(`LinkedIn run ${id} not found`);
  const items: LinkedInRunItem[] = JSON.parse(run.items_json);
  const existingIndex = items.findIndex((existing) =>
    (item.jobId != null && existing.jobId === item.jobId) ||
    Boolean(item.url && existing.url === item.url)
  );
  if (existingIndex >= 0) items[existingIndex] = item;
  else items.push(item);
  db.prepare("UPDATE linkedin_runs SET items_json = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(items), id);
}
