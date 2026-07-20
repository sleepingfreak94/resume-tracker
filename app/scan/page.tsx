"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Portal, ScannedJob } from "@/lib/scanner";

const ATS_COLORS: Record<Portal["ats"], string> = {
  greenhouse: "bg-green-900/40 text-green-400 border-green-800/50",
  ashby: "bg-blue-900/40 text-blue-400 border-blue-800/50",
  lever: "bg-purple-900/40 text-purple-400 border-purple-800/50",
};

const DEFAULT_KEYWORDS = "QA Test SDET Quality Automation";

// Suggested companies not in the default portals.json, with known-good careers URLs
const SUGGESTED_COMPANIES = [
  { name: "Atlassian",     url: "https://jobs.lever.co/atlassian" },
  { name: "Datadog",       url: "https://jobs.lever.co/datadog" },
  { name: "Sentry",        url: "https://jobs.lever.co/sentry" },
  { name: "PagerDuty",     url: "https://jobs.lever.co/pagerduty" },
  { name: "HashiCorp",     url: "https://jobs.lever.co/hashicorp" },
  { name: "MongoDB",       url: "https://job-boards.greenhouse.io/mongodb" },
  { name: "Snowflake",     url: "https://job-boards.greenhouse.io/snowflake" },
  { name: "Grafana Labs",  url: "https://job-boards.greenhouse.io/grafanalabs" },
  { name: "Postman",       url: "https://job-boards.greenhouse.io/postman" },
  { name: "Sauce Labs",    url: "https://jobs.lever.co/saucelabs" },
  { name: "LaunchDarkly",  url: "https://jobs.lever.co/launchdarkly" },
  { name: "Checkly",       url: "https://jobs.ashbyhq.com/checkly" },
  { name: "Percy",         url: "https://job-boards.greenhouse.io/percy" },
  { name: "Tricentis",     url: "https://job-boards.greenhouse.io/tricentis" },
  { name: "Applitools",    url: "https://jobs.lever.co/applitools" },
  { name: "Smartbear",     url: "https://job-boards.greenhouse.io/smartbear" },
  { name: "Testlio",       url: "https://jobs.lever.co/testlio" },
  { name: "Rainforest QA", url: "https://jobs.lever.co/rainforestqa" },
  { name: "Qualys",        url: "https://job-boards.greenhouse.io/qualys" },
];

export default function ScanPage() {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [portalsLoading, setPortalsLoading] = useState(true);

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [scannedJobs, setScannedJobs] = useState<ScannedJob[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [scanErrors, setScanErrors] = useState<string[]>([]);

  // Filter + selection
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [country, setCountry] = useState("Canada India");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Import state
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  // Add company form
  const [addUrl, setAddUrl] = useState("");
  const [addName, setAddName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  // Delete state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Error panel
  const [errorsExpanded, setErrorsExpanded] = useState(false);

  // Add company tabs
  const [addTab, setAddTab] = useState<"browse" | "manual">("browse");
  const [quickAdding, setQuickAdding] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/portals")
      .then((r) => r.json())
      .then((d) => { setPortals(Array.isArray(d) ? d : []); setPortalsLoading(false); })
      .catch(() => setPortalsLoading(false));
  }, []);

  // Client-side keyword + country filter
  const filteredJobs = useMemo(() => {
    if (!scannedJobs) return [];
    const kws = keywords
      .split(/[\s,]+/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
      const countryKws = country
      .split(/[\s,]+/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    return scannedJobs.filter((j) => {
      const titleMatch = kws.length === 0 || kws.some((kw) => j.title.toLowerCase().includes(kw));
      const locationMatch = countryKws.length === 0 || countryKws.some((kw) => j.location.toLowerCase().includes(kw));
      return titleMatch && locationMatch;
    });
  }, [scannedJobs, keywords, country]);

  async function handleScan() {
    setScanning(true);
    setScannedJobs(null);
    setScanErrors([]);
    setSelected(new Set());
    setImportedCount(null);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setScannedJobs(data.jobs ?? []);
      setSkipped(data.skipped ?? 0);
      setScanErrors(data.errors ?? []);
      // Auto-select all jobs matching current filters
      const kws = keywords.split(/[\s,]+/).map((k) => k.trim().toLowerCase()).filter(Boolean);
      const countryKws = country.split(/[\s,]+/).map((k) => k.trim().toLowerCase()).filter(Boolean);
      const autoSelected = new Set<string>(
        (data.jobs ?? [])
          .filter((j: ScannedJob) => {
            const titleMatch = kws.length === 0 || kws.some((kw) => j.title.toLowerCase().includes(kw));
            const locMatch = countryKws.length === 0 || countryKws.some((kw) => j.location.toLowerCase().includes(kw));
            return titleMatch && locMatch;
          })
          .map((j: ScannedJob) => j.job_link)
      );
      setSelected(autoSelected);
    } catch (err) {
      setScanErrors([String(err)]);
    } finally {
      setScanning(false);
    }
  }

  function toggleJob(link: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(link)) next.delete(link);
      else next.add(link);
      return next;
    });
  }

  function toggleAll() {
    if (filteredJobs.every((j) => selected.has(j.job_link))) {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredJobs.forEach((j) => next.delete(j.job_link));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredJobs.forEach((j) => next.add(j.job_link));
        return next;
      });
    }
  }

  async function handleImport() {
    const toImport = (scannedJobs ?? []).filter((j) => selected.has(j.job_link));
    if (toImport.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch("/api/scan/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: toImport }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setImportedCount(data.imported);
      setScannedJobs((prev) => (prev ?? []).filter((j) => !selected.has(j.job_link)));
      setSelected(new Set());
    } catch (err) {
      setScanErrors((prev) => [...prev, String(err)]);
    } finally {
      setImporting(false);
    }
  }

  async function handleAddPortal(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddLoading(true);
    try {
      const res = await fetch("/api/portals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: addUrl, name: addName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setPortals((prev) => [...prev, data]);
      setAddUrl("");
      setAddName("");
    } catch (err) {
      setAddError(String(err));
    } finally {
      setAddLoading(false);
    }
  }

  async function handleQuickAdd(suggestion: { name: string; url: string }) {
    setQuickAdding(suggestion.url);
    try {
      const res = await fetch("/api/portals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: suggestion.url, name: suggestion.name }),
      });
      const data = await res.json();
      if (res.ok) setPortals((prev) => [...prev, data]);
    } finally {
      setQuickAdding(null);
    }
  }

  async function handleDeletePortal(portal: Portal) {
    const key = `${portal.ats}:${portal.slug}`;
    try {
      await fetch("/api/portals", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ats: portal.ats, slug: portal.slug }),
      });
      setPortals((prev) => prev.filter((p) => !(p.ats === portal.ats && p.slug === portal.slug)));
    } finally {
      setDeleteConfirm(null);
    }
    void key;
  }

  const selectedInView = filteredJobs.filter((j) => selected.has(j.job_link)).length;
  const allFilteredSelected = filteredJobs.length > 0 && filteredJobs.every((j) => selected.has(j.job_link));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Portal Scanner</h1>
          <p className="text-gray-400 mt-1 text-sm">
            Scan {portals.length} company job boards and import matching roles in one click.
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning || portals.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors flex-shrink-0"
        >
          {scanning ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Scanning {portals.length} companies…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              Scan All
            </>
          )}
        </button>
      </div>

      {/* Filters — keyword + country, always visible */}
      <div className="flex gap-3">
        {/* Keyword filter */}
        <div className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex-1">
          <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          <input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="Title keywords — e.g. QA Test SDET"
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none"
          />
          {keywords && (
            <button onClick={() => setKeywords("")} className="text-xs text-gray-500 hover:text-gray-300 flex-shrink-0">
              Clear
            </button>
          )}
        </div>

        {/* Country filter */}
        <div className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 w-56">
          <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Country or city"
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none"
          />
          {country && (
            <button onClick={() => setCountry("")} className="text-xs text-gray-500 hover:text-gray-300 flex-shrink-0">
              Clear
            </button>
          )}
        </div>

        {/* Match count */}
        {scannedJobs !== null && (
          <div className="flex items-center px-3 bg-gray-900 border border-gray-800 rounded-xl">
            <span className="text-xs text-gray-600 whitespace-nowrap">
              <span className="text-white font-medium">{filteredJobs.length}</span> / {scannedJobs.length}
            </span>
          </div>
        )}
      </div>

      {/* Import success banner */}
      {importedCount != null && (
        <div className="flex items-center justify-between px-4 py-3 bg-emerald-900/40 border border-emerald-800/50 rounded-xl text-sm text-emerald-300">
          <span>{importedCount} job{importedCount !== 1 ? "s" : ""} imported successfully.</span>
          <Link href="/jobs" className="text-emerald-400 hover:text-emerald-300 font-medium">View Jobs →</Link>
        </div>
      )}

      {/* Scan errors — collapsible so they don't dominate the UI */}
      {scanErrors.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <button
            onClick={() => setErrorsExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-400 font-medium">
                {scanErrors.length} portal{scanErrors.length !== 1 ? "s" : ""} could not be scanned
              </span>
              <span className="text-xs text-gray-600">(wrong slug or API change)</span>
            </div>
            <svg
              className={`w-3.5 h-3.5 text-gray-600 transition-transform ${errorsExpanded ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {errorsExpanded && (
            <div className="px-4 pb-3 space-y-1 border-t border-gray-800">
              {scanErrors.map((e, i) => (
                <p key={i} className="text-xs text-gray-500 pt-1">{e}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: company list + add form */}
        <div className="space-y-4">
          {/* Company grid */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3">
              Configured Companies
              <span className="ml-2 text-xs text-gray-500 font-normal">{portals.length} portals</span>
            </h2>
            {portalsLoading ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full" />
              </div>
            ) : portals.length === 0 ? (
              <p className="text-sm text-gray-600 text-center py-4">No portals configured yet.</p>
            ) : (
              <ul className="space-y-1">
                {portals.map((p) => {
                  const key = `${p.ats}:${p.slug}`;
                  return (
                    <li key={key} className="flex items-center justify-between group px-2 py-1.5 rounded-lg hover:bg-gray-800/50 transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${ATS_COLORS[p.ats]}`}>
                          {p.ats.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="text-sm text-gray-200 truncate">{p.name}</span>
                      </div>
                      {deleteConfirm === key ? (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => handleDeletePortal(p)} className="text-xs text-red-400 hover:text-red-300 font-medium px-1">Remove</button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-xs text-gray-500 hover:text-gray-300 px-1">Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(key)}
                          className="p-1 text-gray-700 hover:text-red-400 rounded transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Add company — tabbed */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-gray-800">
              {(["browse", "manual"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setAddTab(t)}
                  className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                    addTab === t ? "text-white border-b-2 border-indigo-500" : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {t === "browse" ? "Browse Companies" : "Add by URL"}
                </button>
              ))}
            </div>

            {addTab === "browse" ? (
              <div className="p-3">
                <p className="text-[10px] text-gray-600 mb-2 px-1">QA-friendly companies — click + to add to your scanner</p>
                <ul className="space-y-0.5 max-h-72 overflow-y-auto">
                  {SUGGESTED_COMPANIES.map((s) => {
                    const alreadyAdded = portals.some(
                      (p) => p.name.toLowerCase() === s.name.toLowerCase()
                    );
                    return (
                      <li key={s.url} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-800/50 transition-colors group">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-200 truncate">{s.name}</p>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] text-gray-600 hover:text-indigo-400 truncate block transition-colors"
                          >
                            {s.url.replace("https://", "")}
                          </a>
                        </div>
                        {alreadyAdded ? (
                          <span className="text-[10px] text-gray-600 flex-shrink-0 px-1">Added</span>
                        ) : (
                          <button
                            onClick={() => handleQuickAdd(s)}
                            disabled={quickAdding === s.url}
                            className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-gray-600 hover:text-indigo-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
                            title={`Add ${s.name}`}
                          >
                            {quickAdding === s.url ? (
                              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                            )}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <p className="text-xs text-gray-500">Paste a careers page URL — ATS type is detected automatically.</p>
                <form onSubmit={handleAddPortal} className="space-y-2">
                  <input
                    value={addName}
                    onChange={(e) => { setAddName(e.target.value); setAddError(null); }}
                    placeholder="Company name"
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-indigo-500 transition-colors"
                  />
                  <input
                    value={addUrl}
                    onChange={(e) => { setAddUrl(e.target.value); setAddError(null); }}
                    placeholder="https://jobs.ashbyhq.com/company"
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-indigo-500 transition-colors"
                  />
                  {addError && <p className="text-xs text-red-400">{addError}</p>}
                  <button
                    type="submit"
                    disabled={addLoading}
                    className="w-full py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-gray-200 rounded-lg text-sm font-medium transition-colors"
                  >
                    {addLoading ? "Adding…" : "Add Company"}
                  </button>
                </form>
                <p className="text-[10px] text-gray-600 leading-relaxed">
                  Supported: jobs.ashbyhq.com · job-boards.greenhouse.io · jobs.lever.co
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right: results */}
        <div className="lg:col-span-2 space-y-4">
          {scannedJobs === null && !scanning && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl flex flex-col items-center justify-center py-20 text-center gap-3">
              <svg className="w-10 h-10 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <p className="text-gray-500 text-sm">Click &ldquo;Scan All&rdquo; to discover new roles.</p>
            </div>
          )}

          {scanning && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl flex flex-col items-center justify-center py-20 text-center gap-3">
              <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
              <p className="text-gray-400 text-sm">Scanning {portals.length} companies…</p>
            </div>
          )}

          {scannedJobs !== null && !scanning && (
            <>
              {/* Stats bar */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-300">
                  <span className="font-semibold text-white">{filteredJobs.length}</span> new roles
                  {(keywords.trim() || country.trim()) && " matching filters"}
                </span>
                {skipped > 0 && (
                  <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-500 rounded-full">
                    {skipped} already tracked
                  </span>
                )}
                {scannedJobs.length !== filteredJobs.length && (
                  <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-500 rounded-full">
                    {scannedJobs.length - filteredJobs.length} hidden by filters
                  </span>
                )}
              </div>

              {/* Import bar */}
              {filteredJobs.length > 0 && (
                <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAll}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-500 cursor-pointer"
                    />
                    <span className="text-sm text-gray-300">
                      {allFilteredSelected ? "Deselect all" : "Select all"} ({filteredJobs.length})
                    </span>
                  </label>
                  <button
                    onClick={handleImport}
                    disabled={selectedInView === 0 || importing}
                    className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {importing ? (
                      <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>Importing…</>
                    ) : (
                      `Import ${selectedInView} selected`
                    )}
                  </button>
                </div>
              )}

              {/* Job cards */}
              {filteredJobs.length === 0 ? (
                <div className="bg-gray-900 border border-gray-800 rounded-xl flex flex-col items-center justify-center py-12 text-center gap-2">
                  <p className="text-gray-500 text-sm">
                    {scannedJobs.length === 0
                      ? "No new jobs found. All roles are already in your tracker."
                      : `No roles match "${keywords}". Try different keywords or clear the filter.`}
                  </p>
                  {scannedJobs.length > 0 && keywords && (
                    <button onClick={() => setKeywords("")} className="text-indigo-400 hover:text-indigo-300 text-sm font-medium">
                      Show all {scannedJobs.length} roles
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredJobs.map((job) => (
                    <div
                      key={job.job_link}
                      onClick={() => toggleJob(job.job_link)}
                      className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                        selected.has(job.job_link)
                          ? "bg-indigo-950/30 border-indigo-800/60"
                          : "bg-gray-900 border-gray-800 hover:border-gray-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(job.job_link)}
                        onChange={() => toggleJob(job.job_link)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-500 cursor-pointer flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-white">{job.title}</p>
                          <span className="text-xs text-gray-500">{job.company}</span>
                          {job.location && (
                            <span className="flex items-center gap-1 text-xs text-gray-600">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              {job.location}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{job.description.slice(0, 160)}</p>
                      </div>
                      {job.job_link && (
                        <a
                          href={job.job_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 text-gray-600 hover:text-indigo-400 rounded-lg hover:bg-gray-800 transition-colors flex-shrink-0"
                          title="Open job posting"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
