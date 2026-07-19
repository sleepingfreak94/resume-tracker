"use client";

import { useState, useEffect } from "react";

interface Activity {
  id: number;
  job_id: number;
  activity_type: string;
  description: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

const ACTIVITY_ICONS: Record<string, string> = {
  status_change: "🔄",
  resume_tailored: "✨",
  resume_edited: "✏️",
  score_computed: "📊",
  manual_note: "📝",
  follow_up_sent: "📧",
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ActivityTimeline({ jobId }: { jobId: number }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchActivities = async () => {
    const res = await fetch(`/api/jobs/${jobId}/activity`);
    const data = await res.json();
    setActivities(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => {
    let ignore = false;
    fetch(`/api/jobs/${jobId}/activity`)
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) {
          setActivities(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [jobId]);

  const handleAddNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    await fetch(`/api/jobs/${jobId}/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: note }),
    });
    setNote("");
    await fetchActivities();
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-20">
        <div className="animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      {/* Add note */}
      <div className="flex gap-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
          placeholder="Add a note..."
          className="flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 placeholder:text-gray-600 transition-colors"
        />
        <button
          onClick={handleAddNote}
          disabled={saving || !note.trim()}
          className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg text-xs font-medium border border-gray-700 transition-colors"
        >
          Add
        </button>
      </div>

      {/* Timeline */}
      {activities.length === 0 ? (
        <p className="text-xs text-gray-600 text-center py-4">No activity recorded yet</p>
      ) : (
        <div className="space-y-0">
          {activities.map((activity, i) => (
            <div key={activity.id} className="flex gap-3 relative">
              {/* Connector line */}
              {i < activities.length - 1 && (
                <div className="absolute left-[11px] top-6 bottom-0 w-px bg-gray-800" />
              )}
              <div className="flex-shrink-0 w-5.5 h-5.5 flex items-center justify-center text-sm mt-0.5 z-10">
                {ACTIVITY_ICONS[activity.activity_type] ?? "•"}
              </div>
              <div className="flex-1 pb-3 min-w-0">
                <p className="text-xs text-gray-300 leading-snug">{activity.description}</p>
                <p className="text-[10px] text-gray-600 mt-0.5">{formatRelative(activity.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
