# Decisions

One line per decision: `date — area — decision — why`.
Written as the build goes. Read this before changing anything that looks odd.

---

2026-10-30 — process — Work autonomously; do not stop to ask Emir — The master
build prompt (Part B1) says so explicitly, overriding the "ASK ME FIRST" rule
in `CLAUDE.md`. Every judgement call that rule would have surfaced is recorded
here instead.

2026-10-30 — data model — **Do not create a `leads` table.** The spec's `leads`
columns are added to the existing `opportunities` (the enquiry) and `contacts`
(the person) — The CRM already splits a lead that way, and the whole of
ingestion, dedupe, the inbox, workflows and every report is built on it. A
second table holding the same person would be two sources of truth, and the
one thing the business cannot afford is a duplicated or lost lead.

2026-10-30 — data model — `lead_activities` → the existing `activities` table;
`user_sessions` → the existing `sessions` table (extended); `routing_settings`
→ the existing `app_settings` rows — Same reason: one source of truth. The new
spec columns are added to these.

2026-10-30 — deployment — **Commit freely, push only on a completed step** —
A push to `claude/new-session-krd7bx` deploys to `crm.homes.me` within a
minute, with no staging and seven agents working in it. A commit costs
nothing; a push is a release.

2026-10-30 — safety — Backup runs on the server from `npm start`, immediately
before migrations, not from the build machine — The database listens on
localhost, so nothing outside the box can reach it. A backup taken anywhere
else would be a backup of nothing.

2026-10-30 — safety — A failed backup warns loudly but does **not** stop the
server — Seven agents losing the CRM because `mysqldump` is missing is worse
than one start without a fresh dump. The real guarantee is that migrations
cannot be destructive, which is now enforced by a test
(`server/src/db/migrations.safety.test.ts`) that fails CI on `DROP`,
`RENAME`, `TRUNCATE`, `MODIFY`, an unqualified `DELETE`, or a `NOT NULL`
column added without a default.

2026-10-30 — design — Keep the existing accent teal `--primary:#00AFC8` rather
than the spec's `#0E7C86` — Part C2 says "if the CRM already has an accent
colour, keep it". It is also the colour in the design Emir approved, and
changing it would repaint every screen the team already knows.

2026-10-30 — design — Build the missing Part C3 components into the existing
`web/src/design/` system, matching its naming — There is already a working
design system ported from the approved file. A second component library beside
it would mean two buttons that look slightly different.
