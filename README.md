# Resume Tracker

A local-first job application tracker built with Next.js 16, React 19, SQLite, and the Cursor Agent SDK. It tracks applications, tailors resumes, scores ATS alignment, generates cover letters, exports DOCX files, and includes a Chrome extension for importing and filling job applications.

## Features

- Dashboard with pipeline metrics, response rates, ATS distribution, and reminders
- Job tracking with status history, notes, and activity timelines
- AI-assisted job-post parsing, resume tailoring, cover letters, and resume chat
- ATS keyword, skills, experience, and formatting scores
- Markdown resume editing, DOCX export, and optional Google Drive upload
- Greenhouse, Lever, and Ashby portal scanning and importing
- Chrome extension for LinkedIn import and application form autofill
- Local SQLite storage in `data/resume-tracker.db`

## Requirements

- Node.js 20.9 or newer
- npm
- A Cursor API key for AI generation features
- Optional Google OAuth credentials for Drive uploads

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Set `CURSOR_API_KEY` in `.env.local` to enable resume tailoring, cover-letter generation, AI ATS analysis, and resume chat. For Google Drive uploads, also configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`.

## Commands

```bash
npm run dev        # Start the development server
npm run lint       # Run ESLint
npm run typecheck  # Run TypeScript without emitting files
npm test           # Run unit tests
npm run build      # Create a production build
npm run check      # Run lint, typecheck, tests, and build
npm run start      # Serve the production build
```

## Chrome extension

1. Start the app on port 3000.
2. Open `chrome://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select the `extension` directory.
4. Open the extension popup from a supported job page.

The extension can import job details, match tracked jobs, download tailored resumes, and autofill supported application forms. Its localhost port can be changed in the popup.

## Local and generated data

The following files contain local credentials or generated output and are ignored by Git:

- `.env.local`
- `data/google-tokens.json`
- `output/`
- `.next/`

The SQLite database and personal/generated Markdown files under `resumes/` are local data and are also ignored by Git. Back them up before deleting or replacing them.
