"use client";

interface StatsData {
  total: number;
  pipeline: number;
  offers: number;
  closed: number;
  applied: number;
  avgATSScore: number | null;
  responseRate: number | null;
  interviewRate: number | null;
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-1">
      <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-2xl font-bold font-mono tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-600">{sub}</p>}
    </div>
  );
}

export default function DashboardStats({ stats }: { stats: StatsData }) {
  const { total, pipeline, offers, closed, applied, avgATSScore, responseRate, interviewRate } = stats;

  const atsColor =
    avgATSScore == null ? "text-gray-500"
    : avgATSScore >= 80 ? "text-emerald-400"
    : avgATSScore >= 60 ? "text-yellow-400"
    : "text-red-400";

  return (
    <div className="grid grid-cols-4 gap-4">
      <StatCard
        label="Total"
        value={total}
        sub={`${pipeline} active · ${closed} closed`}
        color="text-white"
      />
      <StatCard
        label="In Pipeline"
        value={pipeline}
        sub={offers > 0 ? `${offers} offer${offers > 1 ? "s" : ""}` : "No offers yet"}
        color="text-purple-400"
      />
      <StatCard
        label="Avg ATS Score"
        value={avgATSScore != null ? `${avgATSScore}%` : "—"}
        sub={avgATSScore != null ? (avgATSScore >= 80 ? "Strong match" : avgATSScore >= 60 ? "Moderate match" : "Needs improvement") : "Generate resumes to see scores"}
        color={atsColor}
      />
      <StatCard
        label="Response Rate"
        value={responseRate != null ? `${responseRate}%` : "—"}
        sub={
          applied > 0
            ? `${applied} applied · ${interviewRate != null ? interviewRate + "% interview" : ""}`
            : "No applications yet"
        }
        color={responseRate != null && responseRate >= 30 ? "text-emerald-400" : "text-gray-300"}
      />
    </div>
  );
}
