import { getDb, getSetting, setSetting } from "./db";
import { applicationQuestionPolicy, type ApplicationAnswer, type ApplicationQuestion, type ApplicationQuestionKind } from "./application-answers";

export type StoredAnswerValue = string | number | boolean;
export const APPLICATION_ANSWER_CATEGORIES = [
  "identity",
  "contact",
  "work_authorization",
  "availability",
  "compensation",
  "experience",
  "education",
  "preferences",
  "job_specific",
  "other",
] as const;
export type ApplicationAnswerCategory = (typeof APPLICATION_ANSWER_CATEGORIES)[number];

export interface StoredApplicationAnswer {
  id: number;
  canonical_question: string;
  normalized_question: string;
  answer: StoredAnswerValue;
  answer_type: ApplicationQuestionKind;
  source: string;
  confidence: "high" | "medium" | "low";
  scope: "global" | "job";
  job_id: number | null;
  is_confirmed: number;
  use_count: number;
  category: ApplicationAnswerCategory;
  correction_count: number;
  last_confirmed_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  aliases: { id: number; question_text: string; normalized_question: string }[];
}

export interface PendingApplicationQuestion {
  id: number;
  question_text: string;
  normalized_question: string;
  question_kind: ApplicationQuestionKind;
  options: string[];
  page_url: string | null;
  job_id: number | null;
  suggested_answer: StoredAnswerValue | null;
  status: "pending" | "resolved" | "dismissed";
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface ApplicationAutomationSettings {
  auto_continue: boolean;
  wait_seconds: number;
  final_review: boolean;
  pause_on_unknown: boolean;
  resume_format: "docx" | "pdf";
}

const DEFAULT_SETTINGS: ApplicationAutomationSettings = {
  auto_continue: false,
  wait_seconds: 5,
  final_review: true,
  pause_on_unknown: true,
  resume_format: "docx",
};

export function normalizeApplicationResumeFormat(value: unknown): ApplicationAutomationSettings["resume_format"] {
  return value === "pdf" ? "pdf" : "docx";
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "at", "be", "do", "does", "for", "have", "has", "i", "in", "is",
  "it", "now", "of", "on", "or", "our", "please", "that", "the", "this", "to", "we", "will", "with",
  "you", "your", "future", "currently",
]);

const TOKEN_ALIASES: Record<string, string> = {
  authorised: "authorized",
  authorization: "authorized",
  eligibility: "authorized",
  eligible: "authorized",
  employment: "work",
  requiring: "need",
  required: "need",
  require: "need",
  requires: "need",
  needing: "need",
  needs: "need",
  sponsorship: "sponsor",
  sponsored: "sponsor",
  sponsoring: "sponsor",
  yrs: "years",
  experience: "experience",
};

function parseStoredValue(value: string | null): StoredAnswerValue | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean" ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeApplicationQuestion(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .filter((token) => token && !STOP_WORDS.has(token))
    .join(" ");
}

export function applicationQuestionSimilarity(left: string, right: string): number {
  const a = new Set(normalizeApplicationQuestion(left).split(" ").filter(Boolean));
  const b = new Set(normalizeApplicationQuestion(right).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  return (2 * overlap) / (a.size + b.size);
}

export function categorizeApplicationQuestion(label: string): ApplicationAnswerCategory {
  if (/\b(first|last|full|preferred|legal)\s+name\b|\bpronouns?\b/i.test(label)) return "identity";
  if (/\b(e-?mail|phone|mobile|address|city|province|state|postal|zip|location|linkedin|portfolio|website)\b/i.test(label)) return "contact";
  if (/\b(authori[sz](?:ed|ation)|work permit|permanent resident|citizen|visa|sponsor|immigration)\b/i.test(label)) return "work_authorization";
  if (/\b(start date|available|availability|notice period|relocat|travel|shift|schedule|remote|hybrid|on-?site)\b/i.test(label)) return "availability";
  if (/\b(salary|compensation|pay|hourly|wage|rate|currency)\b/i.test(label)) return "compensation";
  if (/\b(experience|years?|skill|proficien|technology|tool|worked|employment|current company|current title)\b/i.test(label)) return "experience";
  if (/\b(education|degree|school|college|university|graduat|gpa|certification)\b/i.test(label)) return "education";
  if (/\b(preference|willing|employment type|full.?time|part.?time|contract)\b/i.test(label)) return "preferences";
  if (isJobSpecificQuestion(label, "manual")) return "job_specific";
  return "other";
}

function rowToAnswer(row: Record<string, unknown>, aliases: StoredApplicationAnswer["aliases"]): StoredApplicationAnswer | null {
  const answer = parseStoredValue(String(row.answer_json ?? ""));
  if (answer === null) return null;
  return {
    id: Number(row.id),
    canonical_question: String(row.canonical_question),
    normalized_question: String(row.normalized_question),
    answer,
    answer_type: row.answer_type as ApplicationQuestionKind,
    source: String(row.source),
    confidence: row.confidence as StoredApplicationAnswer["confidence"],
    scope: row.scope as StoredApplicationAnswer["scope"],
    job_id: row.job_id === null ? null : Number(row.job_id),
    is_confirmed: Number(row.is_confirmed),
    use_count: Number(row.use_count),
    category: APPLICATION_ANSWER_CATEGORIES.includes(row.category as ApplicationAnswerCategory)
      ? row.category as ApplicationAnswerCategory
      : "other",
    correction_count: Number(row.correction_count ?? 0),
    last_confirmed_at: row.last_confirmed_at ? String(row.last_confirmed_at) : null,
    last_used_at: row.last_used_at ? String(row.last_used_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    aliases,
  };
}

export function listApplicationAnswers(): StoredApplicationAnswer[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM application_answers ORDER BY is_confirmed DESC, updated_at DESC").all() as Record<string, unknown>[];
  const aliases = db.prepare("SELECT id, answer_id, question_text, normalized_question FROM application_answer_aliases ORDER BY id").all() as Array<{
    id: number;
    answer_id: number;
    question_text: string;
    normalized_question: string;
  }>;
  const aliasesByAnswer = new Map<number, StoredApplicationAnswer["aliases"]>();
  for (const alias of aliases) {
    const list = aliasesByAnswer.get(alias.answer_id) ?? [];
    list.push({ id: alias.id, question_text: alias.question_text, normalized_question: alias.normalized_question });
    aliasesByAnswer.set(alias.answer_id, list);
  }
  return rows.map((row) => rowToAnswer(row, aliasesByAnswer.get(Number(row.id)) ?? [])).filter(Boolean) as StoredApplicationAnswer[];
}

export function listPendingApplicationQuestions(): PendingApplicationQuestion[] {
  const rows = getDb().prepare(
    "SELECT * FROM application_question_queue WHERE status = 'pending' ORDER BY last_seen_at DESC"
  ).all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: Number(row.id),
    question_text: String(row.question_text),
    normalized_question: String(row.normalized_question),
    question_kind: row.question_kind as ApplicationQuestionKind,
    options: JSON.parse(String(row.options_json || "[]")) as string[],
    page_url: row.page_url ? String(row.page_url) : null,
    job_id: row.job_id === null ? null : Number(row.job_id),
    suggested_answer: parseStoredValue(row.suggested_answer_json ? String(row.suggested_answer_json) : null),
    status: row.status as PendingApplicationQuestion["status"],
    occurrence_count: Number(row.occurrence_count),
    first_seen_at: String(row.first_seen_at),
    last_seen_at: String(row.last_seen_at),
  }));
}

function optionMatch(options: string[], value: StoredAnswerValue): StoredAnswerValue | null {
  if (options.length === 0) return value;
  const wanted = String(value).trim().toLowerCase();
  const exact = options.find((option) => option.trim().toLowerCase() === wanted);
  if (exact) return exact;
  if (/^(true|yes|1)$/.test(wanted)) return options.find((option) => /^(yes|true)\b/i.test(option.trim())) ?? null;
  if (/^(false|no|0)$/.test(wanted)) return options.find((option) => /^(no|false)\b/i.test(option.trim())) ?? null;
  return null;
}

function applicationAnswerMatch(
  question: ApplicationQuestion,
  jobId: number | null,
  answers: StoredApplicationAnswer[]
): { memory: StoredApplicationAnswer; value: StoredAnswerValue; score: number } | null {
  const normalized = normalizeApplicationQuestion(question.label);
  let best: { memory: StoredApplicationAnswer; score: number } | null = null;

  for (const memory of answers.filter((item) => item.scope === "global" || (item.scope === "job" && jobId !== null && item.job_id === jobId))) {
    const candidates = [memory.normalized_question, ...memory.aliases.map((alias) => alias.normalized_question)];
    const exact = candidates.includes(normalized);
    const score = exact ? 1 : Math.max(...candidates.map((candidate) => applicationQuestionSimilarity(normalized, candidate)));
    const threshold = memory.is_confirmed ? 0.78 : memory.confidence === "high" ? 0.9 : 1;
    const structuredKinds = new Set<ApplicationQuestionKind>(["number", "date", "radio", "select", "checkbox"]);
    const compatibleKind = memory.answer_type === question.kind ||
      (!structuredKinds.has(memory.answer_type) && !structuredKinds.has(question.kind));
    if (compatibleKind && score >= threshold && (!best || score > best.score ||
      (score === best.score && memory.scope === "job" && best.memory.scope !== "job") ||
      (score === best.score && memory.scope === best.memory.scope && memory.is_confirmed > best.memory.is_confirmed))) {
      best = { memory, score };
    }
  }

  if (!best) return null;
  const value = optionMatch(question.options, best.memory.answer);
  if (value === null) return null;
  return { memory: best.memory, value, score: best.score };
}

export function findApplicationAnswer(question: ApplicationQuestion, jobId: number | null = null): { memory: StoredApplicationAnswer; value: StoredAnswerValue } | null {
  const best = applicationAnswerMatch(question, jobId, listApplicationAnswers());
  if (!best) return null;
  getDb().prepare(
    "UPDATE application_answers SET use_count = use_count + 1, last_used_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(best.memory.id);
  addApplicationAnswerAlias(best.memory.id, question.label);
  return { memory: best.memory, value: best.value };
}

export function addApplicationAnswerAlias(answerId: number, questionText: string) {
  const normalized = normalizeApplicationQuestion(questionText);
  if (!normalized) return;
  getDb().prepare(
    "INSERT OR IGNORE INTO application_answer_aliases (answer_id, question_text, normalized_question) VALUES (?, ?, ?)"
  ).run(answerId, questionText.trim(), normalized);
}

export function createApplicationAnswer(input: {
  canonicalQuestion: string;
  answer: StoredAnswerValue;
  answerType: ApplicationQuestionKind;
  aliases?: string[];
  source?: string;
  confidence?: "high" | "medium" | "low";
  scope?: "global" | "job";
  jobId?: number | null;
  confirmed?: boolean;
  category?: ApplicationAnswerCategory;
}): StoredApplicationAnswer {
  const canonicalQuestion = input.canonicalQuestion.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!canonicalQuestion) throw new Error("Canonical question is required");
  if (typeof input.answer === "string" && !input.answer.trim()) throw new Error("Answer is required");
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO application_answers
      (canonical_question, normalized_question, answer_json, answer_type, source, confidence, scope, job_id, is_confirmed, category, last_confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    canonicalQuestion,
    normalizeApplicationQuestion(canonicalQuestion),
    JSON.stringify(input.answer),
    input.answerType,
    input.source ?? "user",
    input.confidence ?? "high",
    input.scope ?? "global",
    input.jobId ?? null,
    input.confirmed ? 1 : 0,
    input.category ?? categorizeApplicationQuestion(canonicalQuestion),
    input.confirmed ? new Date().toISOString() : null
  );
  const id = Number(result.lastInsertRowid);
  addApplicationAnswerAlias(id, canonicalQuestion);
  for (const alias of input.aliases ?? []) addApplicationAnswerAlias(id, alias);
  return listApplicationAnswers().find((answer) => answer.id === id)!;
}

export function updateApplicationAnswer(id: number, input: {
  canonicalQuestion?: string;
  answer?: StoredAnswerValue;
  answerType?: ApplicationQuestionKind;
  aliases?: string[];
  confirmed?: boolean;
  category?: ApplicationAnswerCategory;
}) {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM application_answers WHERE id = ?").get(id);
  if (!existing) throw new Error("Answer not found");
  const sets: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];
  if (input.canonicalQuestion !== undefined) {
    const canonical = input.canonicalQuestion.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!canonical) throw new Error("Canonical question is required");
    sets.push("canonical_question = ?", "normalized_question = ?");
    values.push(canonical, normalizeApplicationQuestion(canonical));
  }
  if (input.answer !== undefined) {
    if (typeof input.answer === "string" && !input.answer.trim()) throw new Error("Answer is required");
    sets.push("answer_json = ?");
    values.push(JSON.stringify(input.answer));
  }
  if (input.answerType !== undefined) { sets.push("answer_type = ?"); values.push(input.answerType); }
  if (input.confirmed !== undefined) {
    sets.push("is_confirmed = ?", "last_confirmed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE last_confirmed_at END");
    values.push(input.confirmed ? 1 : 0, input.confirmed ? 1 : 0);
  }
  if (input.category !== undefined) { sets.push("category = ?"); values.push(input.category); }
  values.push(id);
  db.prepare(`UPDATE application_answers SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  for (const alias of input.aliases ?? []) addApplicationAnswerAlias(id, alias);
  return listApplicationAnswers().find((answer) => answer.id === id)!;
}

export function deleteApplicationAnswer(id: number) {
  return getDb().prepare("DELETE FROM application_answers WHERE id = ?").run(id).changes === 1;
}

function isJobSpecificQuestion(label: string, source: string) {
  return source === "generated" || source === "job" || /\b(why|interested|motivation|tell\s+us|describe|cover\s+letter|this\s+role|our\s+company)\b/i.test(label);
}

export function rememberApplicationAnswer(question: ApplicationQuestion, answer: ApplicationAnswer, jobId: number | null) {
  if (answer.value === null) return null;
  const existing = findApplicationAnswer(question, jobId);
  if (existing) return existing.memory;
  const scope = isJobSpecificQuestion(question.label, answer.source) ? "job" : "global";
  return createApplicationAnswer({
    canonicalQuestion: answer.canonicalQuestion || question.label,
    answer: answer.value,
    answerType: question.kind,
    aliases: [question.label],
    source: answer.source,
    confidence: answer.confidence,
    scope,
    jobId: scope === "job" ? jobId : null,
    confirmed: answer.source === "profile" || answer.source === "decline",
    category: categorizeApplicationQuestion(question.label),
  });
}

export interface ManualApplicationObservation {
  question: ApplicationQuestion;
  value: StoredAnswerValue;
}

export interface ApplicationLearningResult {
  saved: number;
  updated: number;
  corrected: number;
  skipped: number;
}

function answersEqual(left: StoredAnswerValue, right: StoredAnswerValue) {
  if (typeof left === "string" || typeof right === "string") {
    return String(left).replace(/\s+/g, " ").trim().toLocaleLowerCase() === String(right).replace(/\s+/g, " ").trim().toLocaleLowerCase();
  }
  return left === right;
}

export function learnManualApplicationAnswers(
  observations: ManualApplicationObservation[],
  jobId: number | null
): ApplicationLearningResult {
  const result: ApplicationLearningResult = { saved: 0, updated: 0, corrected: 0, skipped: 0 };
  const db = getDb();

  const learn = db.transaction(() => {
    for (const observation of observations) {
      const { question, value } = observation;
      if (applicationQuestionPolicy(question.label) !== "answerable" ||
        (typeof value === "string" && !value.trim())) {
        result.skipped++;
        continue;
      }

      const category = categorizeApplicationQuestion(question.label);
      const scope: StoredApplicationAnswer["scope"] = isJobSpecificQuestion(question.label, "manual") ? "job" : "global";
      if (scope === "job" && jobId === null) {
        result.skipped++;
        continue;
      }

      const candidates = listApplicationAnswers().filter((answer) =>
        answer.scope === scope && (scope === "global" || answer.job_id === jobId)
      );
      const normalized = normalizeApplicationQuestion(question.label);
      let existing: StoredApplicationAnswer | null = null;
      let bestScore = 0;
      for (const candidate of candidates) {
        const forms = [candidate.normalized_question, ...candidate.aliases.map((alias) => alias.normalized_question)];
        const score = forms.includes(normalized) ? 1 : Math.max(...forms.map((form) => applicationQuestionSimilarity(normalized, form)));
        if (score >= 0.88 && score > bestScore) {
          existing = candidate;
          bestScore = score;
        }
      }

      let answerId: number;
      if (existing) {
        const corrected = !answersEqual(existing.answer, value);
        db.prepare(
          `UPDATE application_answers SET answer_json = ?, answer_type = ?, source = 'manual', confidence = 'high',
           category = ?, is_confirmed = 1, correction_count = correction_count + ?,
           last_confirmed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        ).run(JSON.stringify(value), question.kind, category, corrected ? 1 : 0, existing.id);
        addApplicationAnswerAlias(existing.id, question.label);
        answerId = existing.id;
        result.updated++;
        if (corrected) result.corrected++;
      } else {
        const created = createApplicationAnswer({
          canonicalQuestion: question.label,
          answer: value,
          answerType: question.kind,
          aliases: [question.label],
          source: "manual",
          confidence: "high",
          scope,
          jobId: scope === "job" ? jobId : null,
          confirmed: true,
          category,
        });
        answerId = created.id;
        result.saved++;
      }

      db.prepare(
        `UPDATE application_question_queue SET status = 'resolved', resolved_answer_id = ?, last_seen_at = datetime('now')
         WHERE normalized_question = ? AND status = 'pending'`
      ).run(answerId, normalized);
    }
  });
  learn();
  return result;
}

export function queueApplicationQuestion(input: {
  question: ApplicationQuestion;
  jobId: number | null;
  pageUrl: string | null;
  suggestedAnswer?: StoredAnswerValue | null;
}) {
  const normalized = normalizeApplicationQuestion(input.question.label);
  if (!normalized) return;
  const db = getDb();
  const existing = db.prepare(
    "SELECT id FROM application_question_queue WHERE normalized_question = ? AND status = 'pending'"
  ).get(normalized) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE application_question_queue SET occurrence_count = occurrence_count + 1,
       last_seen_at = datetime('now'), page_url = ?, job_id = ?, options_json = ?,
       suggested_answer_json = COALESCE(?, suggested_answer_json) WHERE id = ?`
    ).run(
      input.pageUrl,
      input.jobId,
      JSON.stringify(input.question.options),
      input.suggestedAnswer === undefined || input.suggestedAnswer === null ? null : JSON.stringify(input.suggestedAnswer),
      existing.id
    );
    return existing.id;
  }
  const result = db.prepare(
    `INSERT INTO application_question_queue
      (question_text, normalized_question, question_kind, options_json, page_url, job_id, suggested_answer_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.question.label,
    normalized,
    input.question.kind,
    JSON.stringify(input.question.options),
    input.pageUrl,
    input.jobId,
    input.suggestedAnswer === undefined || input.suggestedAnswer === null ? null : JSON.stringify(input.suggestedAnswer)
  );
  return Number(result.lastInsertRowid);
}

export function resolveApplicationQuestion(id: number, input: {
  canonicalQuestion?: string;
  answer: StoredAnswerValue;
  answerType: ApplicationQuestionKind;
}) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM application_question_queue WHERE id = ? AND status = 'pending'").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Pending question not found");
  const memory = createApplicationAnswer({
    canonicalQuestion: input.canonicalQuestion || String(row.question_text),
    answer: input.answer,
    answerType: input.answerType,
    aliases: [String(row.question_text)],
    source: "user",
    confidence: "high",
    scope: "global",
    confirmed: true,
    category: categorizeApplicationQuestion(String(row.question_text)),
  });
  db.prepare("UPDATE application_question_queue SET status = 'resolved', resolved_answer_id = ?, last_seen_at = datetime('now') WHERE id = ?")
    .run(memory.id, id);
  return memory;
}

export function dismissApplicationQuestion(id: number) {
  return getDb().prepare(
    "UPDATE application_question_queue SET status = 'dismissed', last_seen_at = datetime('now') WHERE id = ? AND status = 'pending'"
  ).run(id).changes === 1;
}

export function getApplicationAutomationSettings(): ApplicationAutomationSettings {
  const storedWait = getSetting("autofill_wait_seconds");
  const rawWait = storedWait === null ? Number.NaN : Number(storedWait);
  return {
    auto_continue: getSetting("autofill_auto_continue") === "1" || DEFAULT_SETTINGS.auto_continue,
    wait_seconds: Number.isInteger(rawWait) && rawWait >= 0 && rawWait <= 60 ? rawWait : DEFAULT_SETTINGS.wait_seconds,
    final_review: getSetting("autofill_final_review") === null ? DEFAULT_SETTINGS.final_review : getSetting("autofill_final_review") === "1",
    pause_on_unknown: getSetting("autofill_pause_on_unknown") === null ? DEFAULT_SETTINGS.pause_on_unknown : getSetting("autofill_pause_on_unknown") === "1",
    resume_format: normalizeApplicationResumeFormat(getSetting("autofill_resume_format")),
  };
}

export function updateApplicationAutomationSettings(input: Partial<ApplicationAutomationSettings>) {
  if (input.auto_continue !== undefined) setSetting("autofill_auto_continue", input.auto_continue ? "1" : "0");
  if (input.final_review !== undefined) setSetting("autofill_final_review", input.final_review ? "1" : "0");
  if (input.pause_on_unknown !== undefined) setSetting("autofill_pause_on_unknown", input.pause_on_unknown ? "1" : "0");
  if (input.resume_format !== undefined) {
    if (input.resume_format !== "docx" && input.resume_format !== "pdf") throw new Error("Resume format must be DOCX or PDF");
    setSetting("autofill_resume_format", input.resume_format);
  }
  if (input.wait_seconds !== undefined) {
    if (!Number.isInteger(input.wait_seconds) || input.wait_seconds < 0 || input.wait_seconds > 60) {
      throw new Error("Wait time must be between 0 and 60 seconds");
    }
    setSetting("autofill_wait_seconds", String(input.wait_seconds));
  }
  return getApplicationAutomationSettings();
}
