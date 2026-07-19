export interface AIATSAnalysis {
  summary: string;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  detailedScores: {
    technicalSkills: number;
    softSkills: number;
    experienceDepth: number;
    formatting: number;
  };
}

export function buildATSAnalysisPrompt(resume: string, jobDescription: string, company: string, title: string): string {
  return `You are an expert ATS (Applicant Tracking System) analyst and recruiter. Analyze how well this resume matches the job description.

## Job Details
Company: ${company}
Role: ${title}

## Job Description
${jobDescription}

## Resume Content
${resume}

## Your Task
Analyze the resume against the job description and return a JSON object (no markdown, no code fences, just raw JSON) with this exact structure:

{
  "summary": "2-3 sentence overall assessment of how well the resume fits this role",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "gaps": ["gap 1", "gap 2", "gap 3"],
  "suggestions": ["actionable suggestion 1", "actionable suggestion 2", "actionable suggestion 3"],
  "detailedScores": {
    "technicalSkills": 0-100,
    "softSkills": 0-100,
    "experienceDepth": 0-100,
    "formatting": 0-100
  }
}

Guidelines:
- technicalSkills: How well do listed technologies/tools/skills match the job requirements?
- softSkills: How well are communication, leadership, collaboration, etc. represented vs. required?
- experienceDepth: Does the experience level, years, and domain match what's asked for?
- formatting: Is the resume ATS-friendly (clear sections, bullet points, no complex tables/graphics)?
- Be specific — name actual keywords, skills, or sections from both documents
- Keep each array to 3-5 items, be concise
- Return ONLY the JSON object, nothing else`;
}
