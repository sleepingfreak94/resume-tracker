# Security Policy

## Supported version

Security fixes are applied to the current `main` branch. This project is a trusted, single-user, local application and is not designed to be exposed as a hosted service.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/sleepingfreak94/resume-tracker/security/advisories/new). Do not open a public issue containing an exploit, API key, OAuth token, resume, profile, application answer, database, or other personal data.

Include the affected version, reproduction steps, impact, and a suggested remediation when available. Never include live credentials; replace them with clearly fake placeholders.

## Deployment boundary

Development and production commands bind to `127.0.0.1`, and API requests are restricted to loopback hosts and permitted origins. Do not expose the server through a public tunnel, reverse proxy, container port, or cloud deployment without first adding authentication, authorization, CSRF protection appropriate to the deployment, encrypted secret storage, and a production data-storage design.

The Chrome extension can be restricted to its exact extension origin by setting `RESUME_TRACKER_EXTENSION_ID`. Provider credentials stay in the local server environment and must never be placed in extension files or committed to Git.

## Local secrets and personal data

Keep `.env.local`, Google OAuth tokens, SQLite databases, resumes, tailored documents, backups, agent memory, and generated files local. Run `npm run security:repo` before every public push. If a real secret is ever committed, revoke or rotate it immediately before removing it from Git history.

## Known upstream dependency constraint

Cursor is an optional AI provider. As of this release, the latest Cursor SDK depends on ConnectRPC 1.x, which resolves to an Undici 5.x release reported by `npm audit` for upstream HTTP/WebSocket denial-of-service and request-handling advisories. No compatible upstream fix is currently available through the Cursor SDK dependency graph.

The application remains loopback-only, Cursor is not the default provider, and users who do not accept this residual risk should select Codex or OpenAI and avoid configuring Cursor credentials. This exception does not cover any other critical or fixable high-severity dependency finding.
