interface ATSScoreBadgeProps {
  score: number | null | undefined;
  size?: "sm" | "md";
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-400 border-emerald-700 bg-emerald-950/50";
  if (score >= 60) return "text-yellow-400 border-yellow-700 bg-yellow-950/50";
  return "text-red-400 border-red-800 bg-red-950/50";
}

export default function ATSScoreBadge({ score, size = "sm" }: ATSScoreBadgeProps) {
  if (score == null) return null;

  const colors = scoreColor(score);
  const isSmall = size === "sm";

  return (
    <span
      className={`inline-flex items-center border rounded font-mono font-semibold tabular-nums ${colors} ${
        isSmall ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1"
      }`}
      title={`ATS Score: ${score}/100`}
    >
      {score}%
    </span>
  );
}
