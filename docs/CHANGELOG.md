# Changelog

All notable changes to the Emir CRM, newest first. One entry per build phase.

## Phase 1 — Foundation (auth, roles, schema, audit)

**Added**
- npm workspaces monorepo: `server` (Express + TypeScript + MySQL 8) and `web` (React + Vite + Tailwind PWA).
- Schema migrations `0001`–`0003` covering 30 tables: users, sessions, audit log, contacts,
  contact identities, pipelines and stages, opportunities, inbound events, conversations,
  messages, WhatsApp templates, activities, tasks, tags, consents, suppressions, projects,
  form field map, workflows, workflow runs, jobs, push tokens, conversion events,
  brochure views, AI field suggestions, assignment state and the unassigned queue.
- Forward-only migration runner tracked in `schema_migrations`, plus an idempotent seed
  (pipeline and stages, day-one WhatsApp templates, workflows, tags, form field map, owner account).
- Email + password login only: server-side sessions in MySQL, httpOnly / SameSite=Lax cookie,
  7-day or 12-hour lifetime, argon2 hashing with a bcrypt(12) fallback, 8-character minimum,
  forced change of temporary passwords, 5-failure account lockout for 15 minutes and per-IP
  rate limiting.
- Role matrix for `owner`, `admin`, `manager`, `agent` and `automation`, enforced server-side
  by permission and by data scope (own / team / all).
- `audit_log` writer with before/after field diffing. Every login, failed login, lockout and
  password change is recorded.
- Configuration through zod-validated environment variables; all external API versions pinned
  in a single `API_VERSIONS` constant; AES-256-GCM helpers for encrypting tokens at rest;
  a JSON logger that redacts secrets and masks phone numbers and email addresses.

**Verified**
- Migrations apply cleanly from empty to seeded on a live MySQL-compatible server.
- Login, session cookie, `/api/auth/me`, account lockout after 5 failures and the audit trail
  exercised end to end over HTTP.
- 64 unit tests green; no TypeScript errors.
