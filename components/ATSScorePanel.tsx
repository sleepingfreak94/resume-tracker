"use client";

import { useState, useEffect } from "react";

interface ATSScoreData {
  exists: boolean;
  overall_score: number | null;
  keyword_score: number | null;
  skills_score: number | null;
  experience_score: number | null;
  format_score: number | null;
  matched_keywords: string | null;
  missing_keywords: string | null;
  ai_analysis: string | null;
  computed_at: string | null;
  ai_analyzed_at: string | null;
}

interface AIAnalysis {
  summary: string;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  detailedScores?: {
    technicalSkills: number;
    softSkills: number;
    experienceDepth: number;
    formatting: number;
  };
}

function ScoreBar({ label, score }: { label: string; score: number | null }) {
  if (score == null) return null;
  const color = score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono font-medium">{score}%</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function KeywordTags({ items, variant }: { items: string[]; variant: "matched" | "missing" }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 10);
  const classes =
    variant === "matched"
      ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/50"
      : "bg-red-950/60 text-red-400 border border-red-800/50";

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((kw) => (
          <span key={kw} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${classes}`}>
            {kw}
          </span>
        ))}
      </div>
      {items.length > 10 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          {expanded ? "Show less" : `+${items.length - 10} more`}
        </button>
      )}
    </div>
  );
}

export default function ATSScorePanel({ jobId, onScoreChange }: { jobId: number; onScoreChange?: (score: number | null) => void }) {
  const [data, setData] = useState<ATSScoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [runningAI, setRunningAI] = useState(false);

  const fetchScore = async () => {
    const res = await fetch(`/api/ats-score/${jobId}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
    onScoreChange?.(json?.exists ? json.overall_score : null);
  };

  useEffect(() => {
    let ignore = false;
    fetch(`/api/ats-score/${jobId}`)
      .then((res) => res.json())
      .then((json) => {
        if (ignore) return;
        setData(json);
        setLoading(false);
        onScoreChange?.(json?.exists ? json.overall_score : null);
      });

    return () => {
      ignore = true;
    };
  }, [jobId, onScoreChange]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    await fetch(`/api/ats-score/${jobId}`, { method: "POST" });
    await fetchScore();
    setRecalculating(false);
  };

  const handleRunAIAnalysis = async () => {
    setRunningAI(true);
    await fetch(`/api/ats-score/${jobId}?ai_only=true`, { method: "POST" });
    await fetchScore();
    setRunningAI(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const matched: string[] = data?.matched_keywords ? JSON.parse(data.matched_keywords) : [];
  const missing: string[] = data?.missing_keywords ? JSON.parse(data.missing_keywords) : [];
  const aiAnalysis: AIAnalysis | null = data?.ai_analysis ? JSON.parse(data.ai_analysis) : null;

  if (!data?.exists || data.overall_score == null) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3 text-center px-4">
        <svg className="w-8 h-8 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p className="text-gray-500 text-sm">No ATS score yet</p>
        <button
          onClick={handleRecalculate}
          disabled={recalculating}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
        >
          {recalculating ? "Calculating..." : "Calculate Score"}
        </button>
      </div>
    );
  }

  const overallColor =
    data.overall_score >= 80 ? "text-emerald-400" : data.overall_score >= 60 ? "text-yellow-400" : "text-red-400";

  return (
    <div className="space-y-4 text-sm">
      {/* Overall score */}
      <div className="flex items-center justify-between">
        <div>
          <span className={`text-3xl font-bold font-mono ${overallColor}`}>{data.overall_score}</span>
          <span className="text-gray-500 text-lg font-mono">/100</span>
          <p className="text-xs text-gray-500 mt-0.5">ATS Score</p>
        </div>
        <button
          onClick={handleRecalculate}
          disabled={recalculating}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg text-xs font-medium transition-colors"
        >
          <svg className={`w-3 h-3 ${recalculating ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {recalculating ? "..." : "Recalculate"}
        </button>
      </div>

      {/* Sub-score bars */}
      <div className="space-y-2.5">
        <ScoreBar label="Keyword Match" score={data.keyword_score} />
        <ScoreBar label="Skills Alignment" score={data.skills_score} />
        <ScoreBar label="Experience Depth" score={data.experience_score} />
        <ScoreBar label="Formatting" score={data.format_score} />
      </div>

      {/* AI Analysis section */}
      <div className="pt-2 border-t border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">AI Analysis</p>
          {aiAnalysis ? (
            <button
              onClick={handleRunAIAnalysis}
              disabled={runningAI}
              className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-400 rounded text-[10px] font-medium transition-colors"
            >
              <svg className={`w-2.5 h-2.5 ${runningAI ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {runningAI ? "Running..." : "Refresh"}
            </button>
          ) : (
            <button
              onClick={handleRunAIAnalysis}
              disabled={runningAI}
              className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded text-[10px] font-medium transition-colors"
            >
              {runningAI ? (
                <>
                  <svg className="w-2.5 h-2.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Analyzing...
                </>
              ) : "Run AI Analysis"}
            </button>
          )}
        </div>

        {aiAnalysis?.detailedScores && (
          <div className="space-y-2.5">
            <ScoreBar label="Technical Skills" score={aiAnalysis.detailedScores.technicalSkills} />
            <ScoreBar label="Soft Skills" score={aiAnalysis.detailedScores.softSkills} />
            <ScoreBar label="Experience Depth" score={aiAnalysis.detailedScores.experienceDepth} />
            <ScoreBar label="Formatting" score={aiAnalysis.detailedScores.formatting} />
          </div>
        )}

        {!aiAnalysis && !runningAI && (
          <p className="text-xs text-gray-600">Run AI analysis for deeper insights: strengths, gaps, and suggestions.</p>
        )}

        {runningAI && (
          <p className="text-xs text-gray-500 animate-pulse">AI is analyzing your resume against the job description...</p>
        )}
      </div>

      {/* AI summary */}
      {aiAnalysis?.summary && (
        <div className="pt-2 border-t border-gray-800">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Summary</p>
          <p className="text-xs text-gray-300 leading-relaxed">{aiAnalysis.summary}</p>
        </div>
      )}

      {/* Strengths */}
      {aiAnalysis?.strengths && aiAnalysis.strengths.length > 0 && (
        <div className="pt-2 border-t border-gray-800">
          <p className="text-xs font-medium text-emerald-400 uppercase tracking-wide mb-1.5">Strengths</p>
          <ul className="space-y-1">
            {aiAnalysis.strengths.map((s, i) => (
              <li key={i} className="text-xs text-gray-300 flex gap-1.5">
                <span className="text-emerald-600 flex-shrink-0">+</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Gaps */}
      {aiAnalysis?.gaps && aiAnalysis.gaps.length > 0 && (
        <div className="pt-2 border-t border-gray-800">
          <p className="text-xs font-medium text-red-400 uppercase tracking-wide mb-1.5">Gaps</p>
          <ul className="space-y-1">
            {aiAnalysis.gaps.map((g, i) => (
              <li key={i} className="text-xs text-gray-300 flex gap-1.5">
                <span className="text-red-600 flex-shrink-0">−</span>
                {g}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions */}
      {aiAnalysis?.suggestions && aiAnalysis.suggestions.length > 0 && (
        <div className="pt-2 border-t border-gray-800">
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-wide mb-1.5">Suggestions</p>
          <ul className="space-y-1">
            {aiAnalysis.suggestions.map((s, i) => (
              <li key={i} className="text-xs text-gray-300 flex gap-1.5">
                <span className="text-indigo-500 flex-shrink-0">→</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Keyword sections */}
      {matched.length > 0 && (
        <div className="pt-2 border-t border-gray-800">
          <p className="text-xs font-medium text-emerald-400 uppercase tracking-wide mb-1.5">
            Matched Keywords ({matched.length})
          </p>
          <KeywordTags items={matched} variant="matched" />
        </div>
      )}

      {missing.length > 0 && (
        <div className="pt-2 border-t border-gray-800">
          <p className="text-xs font-medium text-red-400 uppercase tracking-wide mb-1.5">
            Missing Keywords ({missing.length})
          </p>
          <KeywordTags items={missing} variant="missing" />
        </div>
      )}

      {data.computed_at && (
        <p className="text-[10px] text-gray-600 pt-1">
          Scored {new Date(data.computed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          {data.ai_analyzed_at && ` · AI analyzed ${new Date(data.ai_analyzed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
        </p>
      )}
    </div>
  );
}
