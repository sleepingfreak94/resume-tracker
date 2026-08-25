# Resume Tracker

[![CI](https://github.com/sleepingfreak94/resume-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/sleepingfreak94/resume-tracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A local-first job application tracker built with Next.js 16, React 19, SQLite, the OpenAI Responses API, ChatGPT-subscription Codex CLI, and optional Cursor Agent SDK compatibility. It tracks applications, tailors resumes, scores ATS alignment, generates cover letters, exports DOCX/PDF files, and includes a Chrome extension for importing and safely filling job applications.

## Features

- Dashboard with pipeline metrics, response rates, ATS distribution, and reminders
- Job tracking with status history, notes, and activity timelines
- AI-assisted job-post parsing, resume tailoring, cover letters, and resume chat
- ATS keyword, skills, experience, and formatting scores
- Markdown resume editing, DOCX export, and optional Google Drive upload
- Greenhouse, Lever, and Ashby portal scanning and importing
- Chrome extension for LinkedIn import, profile/resume autofill, and evidence-bound AI answers for application questions
- Self-learning application answer library with equivalent-question aliases and a dashboard review queue
- Configurable multi-step automation with a cancelable countdown, automatic Next/Continue, and optional final submission
- Configurable application resume format with DOCX as the default and PDF as an alternative
- Local SQLite storage in `data/resume-tracker.db`
- Search, sorting, pagination, responsive mobile views, and JSON backups
- Global AI provider and workload-model settings, with per-chat model overrides

## Requirements

- Node.js 20.9 or newer
- npm
- A ChatGPT subscription signed into Codex, an OpenAI API key, or a Cursor API key for AI features
- Optional Google OAuth credentials for Drive uploads

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Use **Settings** to choose the provider. For ChatGPT-subscription Codex, run `npm run codex:login`, complete the browser sign-in, then refresh the status card. Codex routes Sol/high to resumes and cover letters, Terra/high to document chat, and Luna/high to parsing, ATS analysis, and application answers. OpenAI uses the corresponding workload controls with `OPENAI_API_KEY`; Cursor uses `CURSOR_API_KEY`. The app never falls back between providers.

API keys remain server-only and are never returned by the Settings API or included in backups. Resume-chat transcripts stay in browser local storage and are replayed with each request; OpenAI response storage is disabled. For Google Drive uploads, also configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`.

## Commands

```bash
npm run dev        # Start the development server
npm run lint       # Run ESLint
npm run typecheck  # Run TypeScript without emitting files
npm test           # Run unit tests
npm run build      # Create a production build
npm run security:repo # Scan tracked files and history for secrets
npm run check      # Run lint, typecheck, tests, and build
npm run start      # Serve the production build
npm run codex:login  # Sign Codex into ChatGPT
npm run codex:status # Show the active Codex authentication method
```

## LinkedIn auto-apply runs

The dashboard exposes a **LinkedIn auto-apply** panel. Enter a search keyword (e.g. "QA Automation Engineer"), an optional location, a job cap (default 15), and whether to auto-submit Easy Apply applications. Click **Start run** — this saves the run to the database and opens the matching LinkedIn job search in a new tab. The Chrome extension detects the active run and starts crawling automatically.

For each result card the run:
1. Extracts the job details using structured data, focused DOM, and guest APIs; if those are incomplete, the selected routine provider parses focused text.
2. Imports the job into the tracker (de-duplicated by URL).
3. Tailors the resume using the AI provider selected in Settings (sequential, typically 30–90 s per job).
4. **Easy Apply jobs**: opens the modal only after the tailored artifact is verified, requires successful resume conversion/upload when an upload control exists, generates a cover letter only for a required cover-letter field, answers evidence-backed questions, and either submits automatically or pauses for review depending on the **Auto-submit** toggle.
5. **External-portal jobs** (plain "Apply" button): prepares a tailored resume and flags the job as "Apply manually" only after preparation succeeds.

A progress panel appears in the LinkedIn tab showing current status and a **Stop** button. Once the run completes (or is stopped), the dashboard shows a summary of applied, flagged, and failed jobs.

**Known limits**

- The Chrome window and the LinkedIn search tab must remain open for the run's duration. If the machine sleeps or the tab is closed, the run pauses; re-opening the same search URL (visible in the dashboard) resumes it automatically because the active run is stored in SQLite.
- LinkedIn periodically changes its markup. Job extraction uses selector-learning fallbacks and a guest-API path to stay resilient, but the Easy Apply modal driver may need updating after major LinkedIn UI redesigns. Failures are logged to the run note rather than silently misfiring.
- The resume tailor queue runs in-process. A server restart mid-run leaves jobs in the `tailoring` status; re-triggering the run from the dashboard will resume where it left off (already-tailored jobs are skipped).
- Human-like 3–8 second gaps are added between jobs. Running the cap at the default 15 jobs takes roughly 20–30 minutes including tailoring.

## Chrome extension

1. Start the app on port 3000.
2. Open `chrome://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select the `extension` directory.
4. Open the extension popup from a supported job page.

The extension can import job details, match tracked jobs, download tailored resumes, autofill supported application forms, and use the selected server-side AI provider to answer open application questions from the saved profile, resume, tracked job, and confirmed answer library. Differently worded questions are grouped by normalized meaning and aliases; unanswered questions appear under **Answers** in the dashboard.

The **Answers** page also controls multi-step automation: enable automatic Next/Continue, choose whether auto-apply attaches DOCX (the default) or PDF, set a 0–60 second delay, pause on unknown questions, and turn final review on or off. Every countdown has a visible pause button. Final review defaults to on. Certification, consent, signature, background-check, validation, and CAPTCHA gates always pause for personal confirmation. The extension never receives either provider API key; AI requests remain in the localhost server. Its localhost port can be changed in the popup.

For stricter extension access, copy the extension ID from `chrome://extensions` into `RESUME_TRACKER_EXTENSION_ID` in `.env.local`. Without it, any installed Chrome extension may call the local API; regular websites and non-loopback hosts are still rejected.

## Security and backups

The development and production commands bind to `127.0.0.1`. API requests reject non-loopback hosts and cross-origin web pages. AI generation receives resume/job text as untrusted data. Codex runs ephemerally in a fresh temporary directory with user config/rules ignored, read-only command sandboxing, approvals disabled, web search disabled, bounded output, and a sanitized environment; the server alone validates and writes generated files to known paths.

Download a portable JSON backup from **My Profile → Download backup**. It includes jobs, activities, ATS scores, rules, portals, profile fields, non-secret AI preferences, and Markdown resumes. It deliberately excludes API keys, OAuth state, and Google tokens.

This remains a single-user, local-first application—not a hosted multi-user service. Do not expose it through a public tunnel or reverse proxy without adding full authentication, authorization, encrypted secret storage, and a production database migration strategy.

Before committing or publishing changes, run `npm run security:repo`. The command scans tracked files and Git history for sensitive filenames and recognizable credential formats without printing credential values. Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/sleepingfreak94/resume-tracker/security/advisories/new); see [SECURITY.md](SECURITY.md) for the disclosure policy and the documented Cursor SDK dependency constraint.

## Local and generated data

The following files contain local credentials or generated output and are ignored by Git:

- `.env.local`
- `data/google-tokens.json`
- Local agent configuration and memory under `.codex/`, `.claude/`, `.claude-flow/`, `.agents/`, and `.swarm/`
- `.mcp.json` and `ruvector.db`
- `output/`
- `.next/`

The SQLite database and personal/generated Markdown files under `resumes/` are local data and are also ignored by Git. Use the built-in JSON backup before deleting or replacing them.

## Contributing

Create a branch, keep credentials and personal application data out of commits, and run `npm run check` before opening a pull request. Contributions should preserve the loopback-only server boundary and the user-confirmation gates around submissions, sensitive questions, signatures, consent, background checks, and CAPTCHAs.

Released under the [MIT License](LICENSE).
