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

2026-10-30 — web — No phone-number library in the browser. The country list,
grouping and length check are hand-written — The server already runs every
number through libphonenumber before storing it, and a browser can never be
the authority on whether a number is real. Adding ~145KB to a bundle an agent
loads on mobile data, to duplicate a check that is made again server-side, is
not worth it. The browser's job is to make the number readable and catch the
obvious slip; the server rules.

2026-10-30 — web — Sounds are synthesised with the Web Audio API, not shipped
as mp3 files — Nothing to download on a phone in a lift, no licence to get
wrong, and the tone is tuned by changing a number rather than finding another
recording.

2026-10-30 — web — Set `<html lang>` to `en-AE` (and `ar-AE`), and echo every
chosen callback time back in the CRM's own format — Browsers format their own
date controls from the *browser's* language, which we do not control. An agent
whose phone is set to US English sees month-first, and 10/11 means two
different days to two people in the same office. The echo under the field
removes the ambiguity whatever the browser does.

2026-10-30 — web — The PWA keeps the name "homes.me" under the icon but
"Emigeo Homes CRM" in the install dialog — The spec asks for the company name;
the approved design and the logo on screen say homes.me. This gives the
company name where it identifies the app and the brand where people look at it.

2026-10-30 — docs — Corrected `AUDIT.md`: the app uses `BrowserRouter` with
ordinary paths. Only the **preview** build uses `HashRouter` — My first reading
of it was wrong, and it would have misled every later step that reads
`location.pathname`.
