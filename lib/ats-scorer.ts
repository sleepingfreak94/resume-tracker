export interface ATSScoreResult {
  overall_score: number;
  keyword_score: number;
  skills_score: number;
  experience_score: number;
  format_score: number;
  matched_keywords: string[];
  missing_keywords: string[];
}

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by","from","as","is","was","are","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","shall","can","need","must","that","this","these","those","it","its","we","us","our","you","your","they","their","them","i","my","me","he","she","his","her","him","what","which","who","when","where","why","how","all","each","every","both","few","more","most","other","some","such","no","not","only","same","so","than","too","very","just","also","about","up","out","if","then","because","while","although","though",
  // LinkedIn page-chrome noise
  "reposted","ago","applicants","applicant","clicked","metropolitan","hiring","hired","people","easy","apply",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s+#.]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
}

function extractPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  const phrases: string[] = [];

  // Common tech/skill patterns: 2-3 word phrases
  const words = lower
    .replace(/[^a-z0-9\s+#.]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (bigram.length > 3) phrases.push(bigram);
  }

  return phrases;
}

function getKeywordSet(text: string): Set<string> {
  const tokens = tokenize(text);
  const phrases = extractPhrases(text);
  return new Set([...tokens, ...phrases]);
}

function scoreKeywords(resume: string, jd: string): { score: number; matched: string[]; missing: string[] } {
  const jdKeywords = getKeywordSet(jd);
  const resumeKeywords = getKeywordSet(resume);

  const matched: string[] = [];
  const missing: string[] = [];

  for (const kw of jdKeywords) {
    if (resumeKeywords.has(kw)) {
      matched.push(kw);
    } else {
      missing.push(kw);
    }
  }

  const score = jdKeywords.size === 0 ? 100 : Math.round((matched.length / jdKeywords.size) * 100);
  return { score: Math.min(score, 100), matched, missing };
}

// Detect skill-like tokens: technologies, tools, certifications
const SKILL_PATTERNS = [
  /\b(python|javascript|typescript|java|golang|go|rust|c\+\+|c#|ruby|php|swift|kotlin|scala|r\b)/i,
  /\b(react|vue|angular|next\.?js|node\.?js|express|django|flask|fastapi|spring|rails)\b/i,
  /\b(aws|gcp|azure|docker|kubernetes|k8s|terraform|ansible|jenkins|ci\/cd)\b/i,
  /\b(sql|mysql|postgres|postgresql|mongodb|redis|elasticsearch|dynamodb|cassandra)\b/i,
  /\b(machine learning|deep learning|nlp|llm|data science|ai|ml)\b/i,
  /\b(agile|scrum|kanban|jira|git|github|gitlab)\b/i,
  /\b(restful|rest api|graphql|grpc|microservices|api)\b/i,
  /\b(leadership|management|mentoring|cross.functional|stakeholder)\b/i,
];

function extractSkillKeywords(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of SKILL_PATTERNS) {
    const matches = text.match(new RegExp(pattern.source, "gi")) || [];
    for (const m of matches) found.add(m.toLowerCase().trim());
  }
  return [...found];
}

function scoreSkills(resume: string, jd: string): number {
  const jdSkills = extractSkillKeywords(jd);
  if (jdSkills.length === 0) return 80; // No specific skills required
  const resumeKeywords = getKeywordSet(resume);
  const matched = jdSkills.filter((skill) => resumeKeywords.has(skill));
  return Math.round((matched.length / jdSkills.length) * 100);
}

function scoreExperience(resume: string, jd: string): number {
  // Check if years-of-experience requirements are present in resume
  const yearsMatch = jd.match(/(\d+)\+?\s*years?/gi) || [];
  const resumeLower = resume.toLowerCase();

  // Check experience section presence
  const hasExperienceSection = /experience|work history/i.test(resume);
  const hasBulletPoints = (resume.match(/^[\s]*[-•*]/gm) || []).length > 2;
  const hasQuantifiedAchievements = /\d+%|\$\d+|\d+x\b|\d+k\b/i.test(resume);

  let score = 60;
  if (hasExperienceSection) score += 15;
  if (hasBulletPoints) score += 10;
  if (hasQuantifiedAchievements) score += 15;

  // Penalize if experience section mentions fewer years than required
  if (yearsMatch.length > 0) {
    const requiredYears = Math.max(...yearsMatch.map((m) => parseInt(m)));
    const resumeYears = (resumeLower.match(/\d+\+?\s*years?/gi) || []).map((m) => parseInt(m));
    if (resumeYears.length > 0 && Math.max(...resumeYears) < requiredYears) {
      score -= 15;
    }
  }

  return Math.min(Math.max(score, 0), 100);
}

function scoreFormat(resume: string): number {
  let score = 50;

  // Presence of key sections
  if (/^#{1,3}\s*(experience|work)/im.test(resume)) score += 10;
  if (/^#{1,3}\s*(education|degree)/im.test(resume)) score += 8;
  if (/^#{1,3}\s*(skills|technical skills)/im.test(resume)) score += 10;
  if (/^#{1,3}\s*(summary|objective|profile)/im.test(resume)) score += 7;

  // No overly long paragraphs (ATS prefers bullet points)
  const longParagraphs = (resume.match(/^[^#\n-•*].{200,}/gm) || []).length;
  if (longParagraphs === 0) score += 10;
  else if (longParagraphs <= 2) score += 5;

  // Has contact info indicators
  if (/@|linkedin|github/i.test(resume)) score += 5;

  return Math.min(score, 100);
}

export function computeATSScore(resume: string, jobDescription: string): ATSScoreResult {
  const { score: keyword_score, matched: matched_keywords, missing: missing_keywords } = scoreKeywords(resume, jobDescription);
  const skills_score = scoreSkills(resume, jobDescription);
  const experience_score = scoreExperience(resume, jobDescription);
  const format_score = scoreFormat(resume);

  // Weighted average: keywords 40%, skills 30%, experience 20%, format 10%
  const overall_score = Math.round(
    keyword_score * 0.4 + skills_score * 0.3 + experience_score * 0.2 + format_score * 0.1
  );

  // Limit matched/missing to most relevant (top 20 each to avoid noise)
  const topMissing = missing_keywords
    .filter((k) => k.length > 2)
    .slice(0, 20);
  const topMatched = matched_keywords
    .filter((k) => k.length > 2)
    .slice(0, 20);

  return {
    overall_score,
    keyword_score,
    skills_score,
    experience_score,
    format_score,
    matched_keywords: topMatched,
    missing_keywords: topMissing,
  };
}
