"use client";

import { useEffect, useState, useTransition } from "react";

interface Profile {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  linkedin_url: string;
  portfolio_url: string;
  location: string;
  current_company: string;
  current_title: string;
  work_authorization: string;
  requires_sponsorship: number;
  has_work_permit: number;
  has_pr: number;
  years_experience: string;
  education_level: string;
}

const EMPTY: Profile = {
  first_name: "", last_name: "", email: "", phone: "",
  linkedin_url: "", portfolio_url: "", location: "",
  current_company: "", current_title: "",
  work_authorization: "", requires_sponsorship: 0,
  has_work_permit: 0, has_pr: 0,
  years_experience: "", education_level: "",
};

const WORK_AUTH_OPTIONS = [
  "US Citizen", "Green Card", "PR (Permanent Resident)", "Open Work Permit",
  "H-1B", "OPT/CPT", "TN Visa", "L-1 Visa", "O-1 Visa", "EAD", "Other",
];

const EDUCATION_OPTIONS = [
  "High School / GED", "Associate's Degree", "Bachelor's Degree",
  "Master's Degree", "MBA", "PhD / Doctorate", "Professional Degree (JD/MD)", "Other",
];

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        setProfile({
          first_name: data.first_name ?? "",
          last_name: data.last_name ?? "",
          email: data.email ?? "",
          phone: data.phone ?? "",
          linkedin_url: data.linkedin_url ?? "",
          portfolio_url: data.portfolio_url ?? "",
          location: data.location ?? "",
          current_company: data.current_company ?? "",
          current_title: data.current_title ?? "",
          work_authorization: data.work_authorization ?? "",
          requires_sponsorship: data.requires_sponsorship ?? 0,
          has_work_permit: data.has_work_permit ?? 0,
          has_pr: data.has_pr ?? 0,
          years_experience: data.years_experience != null ? String(data.years_experience) : "",
          education_level: data.education_level ?? "",
        });
      })
      .catch(() => setError("Failed to load profile"));
  }, []);

  function set(field: keyof Profile, value: string | number) {
    setProfile((p) => ({ ...p, [field]: value }));
    setSaved(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...profile,
            requires_sponsorship: profile.requires_sponsorship ? 1 : 0,
            has_work_permit: profile.has_work_permit ? 1 : 0,
            has_pr: profile.has_pr ? 1 : 0,
            years_experience: profile.years_experience ? parseInt(profile.years_experience) : null,
          }),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || `HTTP ${res.status}`);
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500 placeholder-gray-500";
  const selectCls = inputCls + " cursor-pointer";
  const labelCls = "block text-xs font-medium text-gray-400 mb-1";

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-100">My Profile</h1>
          <a href="/api/backup" download className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800">Download backup</a>
        </div>
        <p className="text-sm text-gray-400 mt-1">
          This data is used by the browser extension to auto-fill job application forms.
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-indigo-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-200">Extension Auto-Fill</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Once saved, open the extension on any job application page and click{" "}
              <span className="text-indigo-400 font-medium">Fill This Page</span> to auto-fill detected fields.
              The extension fetches this profile from <code className="text-xs bg-gray-800 px-1 rounded">localhost/api/profile</code>.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Personal Info */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wide">Personal Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="first-name" className={labelCls}>First Name</label>
              <input id="first-name" autoComplete="given-name" className={inputCls} value={profile.first_name} onChange={(e) => set("first_name", e.target.value)} placeholder="Jane" />
            </div>
            <div>
              <label htmlFor="last-name" className={labelCls}>Last Name</label>
              <input id="last-name" autoComplete="family-name" className={inputCls} value={profile.last_name} onChange={(e) => set("last_name", e.target.value)} placeholder="Doe" />
            </div>
            <div>
              <label htmlFor="email" className={labelCls}>Email</label>
              <input id="email" autoComplete="email" className={inputCls} type="email" value={profile.email} onChange={(e) => set("email", e.target.value)} placeholder="jane@example.com" />
            </div>
            <div>
              <label htmlFor="phone" className={labelCls}>Phone</label>
              <input id="phone" autoComplete="tel" className={inputCls} type="tel" value={profile.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+1 (555) 000-0000" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="location" className={labelCls}>Location (City, State)</label>
              <input id="location" autoComplete="address-level2" className={inputCls} value={profile.location} onChange={(e) => set("location", e.target.value)} placeholder="San Francisco, CA" />
            </div>
          </div>
        </div>

        {/* Professional Info */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wide">Professional Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="current-company" className={labelCls}>Current Company</label>
              <input id="current-company" autoComplete="organization" className={inputCls} value={profile.current_company} onChange={(e) => set("current_company", e.target.value)} placeholder="Acme Corp" />
            </div>
            <div>
              <label htmlFor="current-title" className={labelCls}>Current Title</label>
              <input id="current-title" autoComplete="organization-title" className={inputCls} value={profile.current_title} onChange={(e) => set("current_title", e.target.value)} placeholder="Senior Engineer" />
            </div>
            <div>
              <label htmlFor="years-experience" className={labelCls}>Years of Experience</label>
              <input id="years-experience" className={inputCls} type="number" min="0" max="60" value={profile.years_experience} onChange={(e) => set("years_experience", e.target.value)} placeholder="5" />
            </div>
            <div>
              <label htmlFor="education-level" className={labelCls}>Education Level</label>
              <select id="education-level" className={selectCls} value={profile.education_level} onChange={(e) => set("education_level", e.target.value)}>
                <option value="">Select…</option>
                {EDUCATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Online Presence */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wide">Online Presence</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="linkedin-url" className={labelCls}>LinkedIn URL</label>
              <input id="linkedin-url" autoComplete="url" className={inputCls} type="url" value={profile.linkedin_url} onChange={(e) => set("linkedin_url", e.target.value)} placeholder="https://linkedin.com/in/janedoe" />
            </div>
            <div>
              <label htmlFor="portfolio-url" className={labelCls}>Portfolio / Website</label>
              <input id="portfolio-url" className={inputCls} type="url" value={profile.portfolio_url} onChange={(e) => set("portfolio_url", e.target.value)} placeholder="https://janedoe.dev" />
            </div>
          </div>
        </div>

        {/* Work Authorization */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wide">Work Authorization</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="work-authorization" className={labelCls}>Authorization Type</label>
              <select id="work-authorization" className={selectCls} value={profile.work_authorization} onChange={(e) => set("work_authorization", e.target.value)}>
                <option value="">Select…</option>
                {WORK_AUTH_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3 pt-5">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={profile.requires_sponsorship === 1}
                  onChange={(e) => set("requires_sponsorship", e.target.checked ? 1 : 0)}
                />
                <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-indigo-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:w-4 after:h-4 after:transition-all peer-checked:after:translate-x-5" />
                <span className="ml-2 text-sm text-gray-300">Requires sponsorship</span>
              </label>
            </div>
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={profile.has_work_permit === 1}
                  onChange={(e) => set("has_work_permit", e.target.checked ? 1 : 0)}
                />
                <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-indigo-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:w-4 after:h-4 after:transition-all peer-checked:after:translate-x-5" />
                <span className="ml-2 text-sm text-gray-300">Has work permit</span>
              </label>
            </div>
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={profile.has_pr === 1}
                  onChange={(e) => set("has_pr", e.target.checked ? 1 : 0)}
                />
                <div className="w-10 h-5 bg-gray-700 rounded-full peer peer-checked:bg-indigo-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:w-4 after:h-4 after:transition-all peer-checked:after:translate-x-5" />
                <span className="ml-2 text-sm text-gray-300">Permanent Resident (PR)</span>
              </label>
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" className="bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {saved && (
          <div role="status" className="bg-green-950 border border-green-800 rounded-lg px-4 py-3 text-sm text-green-300">
            Profile saved — the extension will use this data on your next fill.
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm rounded-lg transition-colors"
        >
          {isPending ? "Saving…" : "Save Profile"}
        </button>
      </form>
    </div>
  );
}
