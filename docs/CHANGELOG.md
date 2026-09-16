# Changelog

All notable changes to the Emir CRM, newest first. One entry per build phase.

## Phase 10 — Design system

**Added**
- The approved design at `design/emir-crm-design.html` ported into the app as four
  stylesheets — `tokens.css`, `base.css`, `components.css`, `animations.css` — carrying
  the CSS across verbatim, cascade order included, so the result matches the design
  rather than resembling it. `docs/DESIGN.md` explains the layout and the four places
  it deliberately differs.
- Lucide icons bundled through npm instead of the design's CDN, keyed by the design's
  own kebab-case names so porting a screen is a substitution. 109 icons, tree-shaken.
  A blocked icon host has broken this app's icons once already.
- `AppShell`: glass sidebar, sticky top bar, mobile bottom bar. Nav items are real
  links, styled identically to the design's buttons.
- Chart primitives ported from the design's own drawing code — `Spark`, `AreaChart`,
  `Donut`, `Gauge`, `Funnel`, `Heat` and `CountUp` — taking real data where the design
  generated demo series.
- Theme system: light / dark / follow-the-system, plus the "Reduce glass effect"
  setting the specification asks for. Both are applied before first paint by an inline
  script, so a stored choice never flashes the default.
- An RTL block that mirrors the fixed shell for Arabic; the design is LTR only.
- A development-only design-system gallery at `/design-system.html`, excluded from the
  production build, rendering the shell, every chart and every icon on one page.
- Tests in the `web` workspace (vitest + jsdom), and `npm test` now runs both workspaces.

**Not in this phase**
- The CRM | Books switcher, at the owner's instruction. The sidebar reserves its
  footprint; the design's switcher CSS and the whole Books stylesheet are parked in
  `books.css`, imported by nothing.
- The CRM screens themselves. They still render on the previous stylesheet until
  Phase 11 moves them over; the two are not loaded at the same time.

**Verified**
- 352 tests green (328 server, 24 new in web); no TypeScript errors.
- Rendered in Chromium at 1440px and 390px, in light, forced dark, system dark,
  reduced glass and reduced motion, and in RTL: no console errors, no failed requests,
  no horizontal scroll, and icons draw as glyphs rather than as text.
- The production build is unchanged in size and does not contain the gallery.

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

## Phase 8 — Web app (PWA), demo data and exactly-once workflows

**Added**
- React + Vite + Tailwind PWA served from the same origin as the API, so the session
  cookie stays httpOnly and SameSite=Lax with no CORS surface: login, forced
  temporary-password change, Kanban board, unified inbox, Contact 360, contacts,
  projects, templates, reports and team management.
- Responsive Material-style layout: a navigation rail on desktop, a bottom bar on
  mobile, safe-area padding for installed iOS, and an installable manifest with a
  service worker that caches the shell but never CRM data.
- RTL-ready Arabic throughout, including a language switch that persists to the user record.
- `npm run demo` loads a realistic dataset by driving the real pipeline — ingestion,
  assignment, workflows — rather than inserting rows, so a demo shows what the system
  actually does.

**Fixed**
- Workflow A and Workflow C are now exactly-once, enforced by a unique index rather
  than a read-then-write check. A retried job was sending a lead a second welcome
  message, and re-running inbound routing replied twice and created a duplicate
  call-back task. Ten concurrent retries now produce exactly one welcome, and five
  concurrent retries of one inbound message produce one reply and one task.
- Icons are inline SVG instead of a CDN icon font. With the font host unreachable —
  offline, a restricted network, or a blocked region — every icon rendered as raw
  ligature text ("view_kanban", "logout"), which is exactly the condition a field
  agent's phone hits.
- The inbox thread endpoint never joined `contacts`, so the thread header showed
  "Unknown" with no phone number.
- The inbox defaulted every role to the "Mine" filter, so an owner or manager — who
  rarely owns conversations — opened an empty inbox that looked broken. Managers now
  start on "All".
- The language toggle wrote only to local storage, and the next session refresh
  reset it from the server, so switching to Arabic appeared to do nothing.
- The desktop and mobile navigations shared the accessible name "Main".

**Verified**
- 317 tests green.
- 13 browser steps driven through real Chromium at desktop and phone viewports: the
  login gate, wrong-password rejection, the forced password change, all seven board
  columns, the inbox thread, Contact 360, projects, reports, team, the mobile bottom
  navigation, and the Arabic RTL switch persisting across a reload.

## Phase 9 — Documentation, hardening and CI

**Added**
- `docs/ARCHITECTURE.md`, `docs/WEBHOOKS.md`, `docs/WORKFLOWS.md` and
  `docs/DEPLOYMENT.md`. The deployment guide answers the hosting question the
  specification asks: what the plan must support, what degrades if it does not, and
  which steps need the owner rather than code (Meta app review, WhatsApp template
  approval, SPF/DKIM/DMARC, a Google Ads developer token).
- Rate limiting on the unauthenticated surface — login, webhooks and brochure links —
  as a cheap layer in front of the existing per-account lockout and per-IP budget.
- A runtime identifier guard on the few dynamic column lists. Every user-supplied
  value already goes through a placeholder and every interpolated column name already
  comes from a fixed allowlist, but nothing enforced that; now a later edit that feeds
  request keys into a patch object fails loudly instead of opening a hole.
- GitHub Actions CI: typecheck, the full suite against a real MySQL 8 service
  container, and the production build.

- `e2e/ui.mjs` (`npm run e2e`), the browser smoke test, kept in the repository so the
  team can rerun it. It is idempotent: the owner's temporary password only works once,
  so the sign-in step falls back to the replaced password and skips the gate rather
  than failing on a second run.

**Verified**
- 328 tests green, and green again with no database reachable (59 skip cleanly).
- Clean install from an empty server: 4 migrations, 31 tables, seed, build, run.
- The compiled production build serves the API and the SPA from one origin.
- 13 browser steps pass, twice in a row against the same environment.
