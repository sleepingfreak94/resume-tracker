"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddJobPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    company: "",
    title: "",
    description: "",
    job_link: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI paste parsing state
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseSuccess, setParseSuccess] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      router.push("/");
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  };

  const handleParseWithAI = async () => {
    if (!pasteText.trim()) return;
    setParsing(true);
    setParseError(null);
    setParseSuccess(false);
    try {
      const res = await fetch("/api/parse-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setForm((f) => ({
        company: data.company || f.company,
        title: data.title || f.title,
        description: data.description || f.description,
        job_link: f.job_link,
      }));
      setParseSuccess(true);
      setPasteText("");
    } catch (err) {
      setParseError(String(err));
    } finally {
      setParsing(false);
    }
  };

  const charCount = form.description.length;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Add Job Application</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Fill in the job details. Once saved, you can generate a tailored resume from the dashboard.
        </p>
      </div>

      {/* AI Parse Section */}
      <div className="rounded-xl border border-indigo-900/60 bg-indigo-950/30 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="bg-indigo-600 text-indigo-100 text-xs font-bold px-2 py-0.5 rounded">AI</span>
          <span className="text-sm font-medium text-indigo-200">Paste &amp; Parse</span>
          <span className="text-xs text-gray-500 ml-1">— paste raw job text and AI fills the form automatically</span>
        </div>
        <label htmlFor="raw-job-text" className="sr-only">Raw job posting text</label>
        <textarea
          id="raw-job-text"
          value={pasteText}
          onChange={(e) => { setPasteText(e.target.value); setParseSuccess(false); setParseError(null); }}
          rows={5}
          placeholder="Paste the full job posting text here (from LinkedIn, Indeed, or any job board)…"
          className="w-full bg-gray-900/70 border border-indigo-900/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500 transition-colors resize-none leading-relaxed"
        />
        {parseError && (
          <p role="alert" className="text-xs text-red-400">{parseError}</p>
        )}
        {parseSuccess && (
          <p role="status" className="text-xs text-green-400">Fields filled from AI extraction. Review and adjust as needed.</p>
        )}
        <button
          type="button"
          onClick={handleParseWithAI}
          disabled={parsing || !pasteText.trim()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          {parsing ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Parsing…
            </>
          ) : (
            "Parse with AI"
          )}
        </button>
      </div>

      {error && (
        <div role="alert" className="px-4 py-3 rounded-lg text-sm bg-red-900/50 border border-red-800 text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="company" className="block text-sm font-medium text-gray-300 mb-1.5">
              Company <span className="text-red-400">*</span>
            </label>
            <input
              id="company"
              value={form.company}
              onChange={set("company")}
              required
              placeholder="e.g. Stripe"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label htmlFor="job-title" className="block text-sm font-medium text-gray-300 mb-1.5">
              Job Title <span className="text-red-400">*</span>
            </label>
            <input
              id="job-title"
              value={form.title}
              onChange={set("title")}
              required
              placeholder="e.g. Senior Software Engineer"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        <div>
          <label htmlFor="job-link" className="block text-sm font-medium text-gray-300 mb-1.5">
            Job Link
          </label>
          <input
            id="job-link"
            value={form.job_link}
            onChange={set("job_link")}
            type="url"
            placeholder="https://jobs.company.com/..."
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="job-description" className="block text-sm font-medium text-gray-300">
              Job Description <span className="text-red-400">*</span>
            </label>
            <span className="text-xs text-gray-600">{charCount} chars</span>
          </div>
          <textarea
            id="job-description"
            value={form.description}
            onChange={set("description")}
            required
            rows={14}
            placeholder="Paste the full job description here. The more detail, the better the tailored resume will be..."
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-indigo-500 transition-colors resize-none leading-relaxed font-mono"
          />
          <p className="mt-1.5 text-xs text-gray-600">
            Tip: Include the full job description with requirements, responsibilities, and qualifications for the best results.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {submitting ? "Saving..." : "Save Application"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="px-6 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
