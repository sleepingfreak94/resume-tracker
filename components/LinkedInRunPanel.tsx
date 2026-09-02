"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { LinkedInRun, LinkedInRunItem } from "@/lib/db";
import type { LinkedInRunRecovery, RunSummary } from "@/lib/linkedin-run";

interface RunState {
  run: LinkedInRun;
  items: LinkedInRunItem[];
  summary: RunSummary;
  searchUrl: string;
  recovery: LinkedInRunRecovery;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  tailoring: "Tailoring resumes…",
  done: "Done",
  stopped: "Stopped",
  failed: "Failed",
};

const ACTIVE_STATUSES = new Set(["queued", "running", "tailoring"]);

const RECOVERY_LABEL: Record<LinkedInRunRecovery["state"], string> = {
  launching: "Waiting for extension…",
  connected: "Running",
  waiting_user: "Waiting for you",
  interrupted: "Interrupted",
  complete: "Complete",
};

export default function LinkedInRunPanel() {
  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("");
  const [maxJobs, setMaxJobs] = useState(15);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<RunState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // On mount, check for an already-active run
  useEffect(() => {
    fetch("/api/linkedin-run/active")
      .then((r) => r.json())
      .then((data) => {
        if (data?.run) {
          setActive(data as RunState);
          startPolling(data.run.id);
        }
      })
      .catch(() => {});
  }, []);

  function startPolling(runId: number) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/linkedin-run/${runId}`);
        if (!res.ok) return;
        const data: RunState = await res.json();
        setActive(data);
        if (!ACTIVE_STATUSES.has(data.run.status)) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      } catch {
        // network blip — keep polling
      }
    }, 3000);
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function handleStart() {
    setError(null);
    if (!keywords.trim()) { setError("Keywords are required"); return; }
    setStarting(true);
    try {
      const res = await fetch("/api/linkedin-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords,
          location: location || undefined,
          max_jobs: maxJobs,
          auto_submit: false,
          app_port: Number(window.location.port || "3000"),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to start run"); return; }
      setActive({
        run: data.run,
        items: [],
        summary: { total: 0, processing: 0, applied: 0, needs_manual: 0, failed: 0, skipped: 0 },
        searchUrl: data.searchUrl,
        recovery: { state: "launching", canResume: false, reason: null },
      });
      startPolling(data.run.id);
      window.open(data.searchUrl, "_blank", "noopener");
    } catch (err) {
      setError(String(err));
    } finally {
      setStarting(false);
    }
  }

  async function handleStop() {
    if (!active) return;
    if (active.recovery.state === "interrupted" && !window.confirm(
      "Stop this LinkedIn run? Any open LinkedIn application will be left for you to verify manually."
    )) return;
    await fetch(`/api/linkedin-run/${active.run.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "stopped" }),
    });
    setActive((prev) => prev ? {
      ...prev,
      run: { ...prev.run, status: "stopped" },
      recovery: { state: "complete", canResume: false, reason: null },
    } : null);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  const isActive = active && ACTIVE_STATUSES.has(active.run.status);
  const needsManual = active?.items.filter((i) => i.outcome === "needs_manual") ?? [];
  const activeLabel = active
    ? active.recovery.state === "complete"
      ? STATUS_LABEL[active.run.status] ?? active.run.status
      : RECOVERY_LABEL[active.recovery.state]
    : "";

  return (
    <section className="dashboard-panel" aria-labelledby="linkedin-run-heading" style={{ borderColor: "rgba(99,202,183,0.15)", background: "rgba(99,202,183,0.03)" }}>
      <div className="panel-heading">
        <div>
          <p className="panel-kicker" style={{ color: "#63cab7" }}>Automation</p>
          <h2 id="linkedin-run-heading">LinkedIn auto-apply</h2>
        </div>
        {active && !isActive && (
          <button
            onClick={() => setActive(null)}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            New run
          </button>
        )}
      </div>

      {/* Run form — show when no active run */}
      {!active && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="li-keywords" className="text-xs text-gray-400">Search keywords</label>
              <input
                id="li-keywords"
                type="text"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStart()}
                placeholder="e.g. QA Automation Engineer"
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#63cab7]/40 focus:outline-none"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="li-location" className="text-xs text-gray-400">Location (optional)</label>
              <input
                id="li-location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStart()}
                placeholder="e.g. Canada, Remote"
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#63cab7]/40 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="li-maxjobs" className="text-xs text-gray-400">Job cap</label>
              <input
                id="li-maxjobs"
                type="number"
                min={1}
                max={100}
                value={maxJobs}
                onChange={(e) => setMaxJobs(Math.min(100, Math.max(1, Number(e.target.value))))}
                className="w-20 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white focus:border-[#63cab7]/40 focus:outline-none"
              />
            </div>
            <p className="pt-5 text-sm text-gray-400">Final submission is always manual.</p>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleStart}
            disabled={starting}
            className="self-start rounded-xl px-4 py-2.5 text-sm font-bold text-[#111318] transition-opacity disabled:opacity-50"
            style={{ background: "#63cab7" }}
          >
            {starting ? "Starting…" : "Start run ↗"}
          </button>

          <p className="text-xs text-gray-600">
            Opens a LinkedIn search tab. Each job must have a validated description and a verified tailored resume before Easy Apply opens. External-portal jobs are listed for manual application only after preparation succeeds.
          </p>
        </div>
      )}

      {/* Active run progress */}
      {active && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isActive && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#63cab7] opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#63cab7]" />
                </span>
              )}
              <span className="text-sm font-medium text-white">{activeLabel}</span>
            </div>
            {isActive && (
              <button onClick={handleStop} className="text-xs text-red-400 hover:text-red-300">Stop</button>
            )}
          </div>

          <p className="text-xs text-gray-400">
            <strong className="text-white">{`"${active.run.keywords}"`}</strong>
            {active.run.location ? ` · ${active.run.location}` : ""}
            {" · "}cap {active.run.max_jobs}
          </p>

          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-gray-400">
              App port <strong className="text-gray-200">{active.run.app_port}</strong>
            </span>
            <span className="rounded-full border border-[#63cab7]/20 bg-[#63cab7]/[0.06] px-2.5 py-1 text-[#63cab7]">
              Final submit <strong>MANUAL</strong>
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-gray-500">
              {active.run.heartbeat_at ? `Extension seen ${new Date(`${active.run.heartbeat_at.replace(" ", "T")}Z`).toLocaleTimeString()}` : "No extension heartbeat"}
            </span>
          </div>

          {active.recovery.state === "interrupted" && (
            <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-xs text-amber-200">
              <p>{active.recovery.reason}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {active.recovery.canResume && (
                  <button
                    type="button"
                    onClick={() => window.open(active.searchUrl, "_blank", "noopener")}
                    className="rounded-lg bg-amber-300 px-3 py-1.5 font-bold text-[#111318]"
                  >
                    Reopen LinkedIn search
                  </button>
                )}
                <button type="button" onClick={handleStop} className="rounded-lg border border-red-400/30 px-3 py-1.5 font-semibold text-red-300">
                  Stop interrupted run
                </button>
              </div>
            </div>
          )}

          {active.summary.total > 0 && (
            <div className="flex gap-4 text-xs text-gray-400">
              {active.summary.processing > 0 && <span><strong className="text-amber-300">{active.summary.processing}</strong> in progress</span>}
              <span><strong className="text-white">{active.summary.applied}</strong> applied</span>
              <span><strong className="text-[#63cab7]">{active.summary.needs_manual}</strong> needs manual</span>
              {active.summary.failed > 0 && <span><strong className="text-red-400">{active.summary.failed}</strong> failed</span>}
              <span className="text-gray-600">{active.summary.total} / {active.run.max_jobs}</span>
            </div>
          )}

          {active.run.note && (
            <p className="text-xs text-amber-400">{active.run.note}</p>
          )}

          {needsManual.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-[#63cab7]">Apply manually — resume is ready</p>
              <div className="flex flex-col gap-1">
                {needsManual.map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                    <div className="min-w-0">
                      <span className="block truncate text-xs font-medium text-gray-200">{item.company}</span>
                      <span className="block truncate text-[11px] text-gray-500">{item.title}</span>
                    </div>
                    {item.jobId && (
                      <Link
                        href={`/jobs/${item.jobId}`}
                        className="flex-shrink-0 rounded-lg border border-[#63cab7]/20 bg-[#63cab7]/[0.08] px-2.5 py-1 text-xs font-semibold text-[#63cab7]"
                      >
                        Apply →
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
