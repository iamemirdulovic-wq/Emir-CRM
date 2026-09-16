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

## Phase 2 — Ingestion and deduplication

**Added**
- Canonical Lead DTO that every source normalizes into: person, real estate, attribution,
  consent, notes and any unmapped answers.
- Source adapters for Meta Lead Ads (webhook + `/{leadgen_id}` fetch + `/{form_id}/leads`
  backfill), WhatsApp Cloud API (`messages[]`, `statuses[]`, `referral`), website forms,
  Google Ads lead forms and CSV / manual entry.
- Value parsers that turn free-text form answers into CRM enums: budget bands
  ("AED 1M – 2M", "800k-1.2m", "up to 3M", "5M+"), purpose, payment method, timeline and
  emirate, in English and Arabic, plus script-based language detection.
- `form_field_map`-driven field mapping, so a new custom question on a lead form is a
  configuration change rather than a deploy. Unmapped answers are preserved on the lead.
- Identity resolution in a transaction with row locks: match on phone → wa_id → email,
  fill only empty fields, never overwrite agent-edited data, keep the first-touch source,
  and keep a returning lead with their existing agent.
- Re-inquiry rule: a second inquiry within 30 days on the same project adds an activity to
  the open card instead of opening a duplicate opportunity.
- Immutable `inbound_events` log, unique on (source, external_id), so a replayed webhook
  never reaches the pipeline twice.
- Webhook endpoints for Meta Lead Ads, WhatsApp, website and Google, each verifying its
  signature (`X-Hub-Signature-256`, HMAC or reCAPTCHA, `google_key`), storing the raw
  payload, answering within 2 seconds and processing after the response is flushed.
- Inbound WhatsApp handling: message storage, the 24-hour window, delivery ticks that only
  move forward, and an email fallback scheduled when Meta's marketing limits reject a send.

**Changed**
- Transactions now run at READ COMMITTED. Under REPEATABLE READ a webhook that lost the race
  to create a contact kept a snapshot from before the winner committed, and opened a second
  opportunity for the same inquiry; gap locking also deadlocked concurrent inserts against
  the same unique key.
- An email-only match whose phone number disagrees no longer merges. It creates a separate
  contact linked by `possible_duplicate_of` and tagged `ops:possible_duplicate`, because
  merging silently discarded the new lead's phone number.
- Inbound message handling takes its row locks up front, contact before conversation, to
  avoid the shared-to-exclusive lock upgrade that deadlocked concurrent webhooks.

**Verified**
- Duplicate-storm test: 20 identical leads in parallel produce exactly 1 contact, 1
  opportunity and 1 Workflow A job; run five times with no flakiness. The same holds for
  20 parallel leads written in five different phone formats, and for 20 concurrent inbound
  WhatsApp webhooks (1 contact, 20 messages). Two different people arriving together stay
  two contacts.
- Replay tests over every fixture in `/fixtures`, including redelivery of the same payload.
- 159 tests green; the 31 database-backed tests skip cleanly when no server is reachable.
