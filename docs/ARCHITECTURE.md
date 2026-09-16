# Architecture

## The shape of the system

```
  Meta Lead Ads ─┐
  Click-to-WA   ─┤
  Website form  ─┼─► /webhooks/* ─► inbound_events ─► normalize ─► identity ─► ingest
  Google Ads    ─┤    (verify sig)   (raw, unique)     (Lead DTO)  (row locks)   │
  Inbound WA    ─┤                                                               │
  CSV / manual  ─┘                                                               ▼
                                                                          jobs table
                                                                               │
                              ┌────────────────────────────────────────────────┤
                              ▼                                                ▼
                        worker process                                   web app (PWA)
                   (poll → claim → run)                          board · inbox · 360 · reports
                              │
        ┌─────────────┬───────┴────────┬──────────────┬───────────────┐
        ▼             ▼                ▼              ▼               ▼
   Workflow A     Workflow B      Workflow C      scoring / AI    Meta CAPI +
   instant        follow-up       inbound         extraction      Google offline
   capture        ladder          routing         summary         conversions
        │             │                │
        └─────────────┴────────────────┴────► guarded send ─► WhatsApp / SMTP / FCM
                                                 (DNC, consent, quiet hours,
                                                  3-per-24h, agent pause, 24h window)
```

## Processes

| Process | Command | Responsibility |
|---|---|---|
| API | `npm start` | HTTP: webhooks, the JSON API, SSE, and the built SPA |
| Worker | `npm run worker` | Polls the `jobs` table, runs workflows, schedules recurring work |

They share a database and nothing else, so either can be restarted alone and
several workers can run side by side. The API also runs instant actions in
process immediately after a webhook responds, which is what keeps speed-to-lead
under 30 seconds without waiting for a poll.

## Why each significant decision was made

### Webhooks answer before they work
Every webhook verifies its signature, writes the raw payload to
`inbound_events`, returns 200, and only then processes — the work is attached to
the response's `finish` event. Meta retries anything slower than a few seconds,
and a retry storm is how duplicate leads are born. The raw payload is stored
first so that a crash one millisecond later still leaves the lead recoverable.

### Idempotency is layered, not assumed
Four independent guards, because any one of them can be bypassed by a race:

1. `inbound_events` is unique on `(source, external_id)` — a replayed webhook
   never reaches the pipeline.
2. `contacts` is unique on `phone_e164` and on `wa_id` — the database, not the
   application, decides who is a duplicate.
3. `jobs.dedupe_key` is unique — a follow-up is scheduled once.
4. `workflow_runs.singleton_key` is unique — Workflow A runs once per
   opportunity and Workflow C once per inbound message, so a retried job cannot
   send a lead a second welcome.

### READ COMMITTED, not MySQL's default
Under REPEATABLE READ a transaction keeps the snapshot from its first read. A
webhook that lost the race to create a contact therefore could not see the
winner's opportunity, and opened a second one for the same inquiry. Gap locking
also deadlocked concurrent inserts against the same unique key. Nothing here
depends on repeating a read inside a transaction: correctness comes from unique
keys and `SELECT … FOR UPDATE`.

### Locks are always taken in the same order
Contact first, then conversation. Inserting a message takes a shared foreign-key
lock on both parent rows, and the updates that follow need them exclusively —
so without a consistent order, twenty concurrent webhooks for one number
deadlock on the upgrade.

### One door for outbound messages
Nothing calls a provider directly. `messaging/send.ts` is the only path out, so
the guards — DNC, consent, quiet hours, the 3-per-24h cap, the 24-hour agent
pause, and WhatsApp's template rule — cannot be forgotten by a new caller.

### Verified data or nothing
`projects.verified_at` gates every price, payment plan and handover date that
can reach a lead. Editing any of those figures clears the verification. When a
lead asks for a price and there is no verified row, the bot hands the
conversation to a human rather than guessing — implemented in
`workflows/workflow-c.ts` and enforced again in `services/projects.ts`.

### The design is ported, not interpreted

The approved design is a working HTML file, so its CSS is copied across
character for character rather than reimplemented in a utility framework. That
makes "does this match the design?" a question anyone can answer by diffing, and
it keeps the cascade — several blocks deliberately re-style earlier rules — from
being lost in translation. `docs/DESIGN.md` lists the four places the port
deliberately differs and why.

### Rules live in pure functions
Identity merging, stage-move permissions, the automation guards, assignment,
intent matching and scoring are all pure and unit-tested. The database-backed
layer around them is thin. This is why the rules can be reasoned about at all.

## Directory map

```
server/src/
  config/        env validation (zod), business constants, pinned API versions
  lib/           phone (E.164), email, crypto, Asia/Dubai time, logging, redaction
  auth/          passwords, sessions, lockout, the role matrix, data scoping
  audit/         the audit_log writer and field diffing
  db/            pool, migration runner, seed, demo data
  pipeline/      stage and sub-status definitions, move rules
  ingestion/     Lead DTO, parsers, field mapping, identity resolution, sources/
  messaging/     send guard, WhatsApp adapters, email SMTP/IMAP, templates
  workflows/     guards, assignment, intent, workflows A/B/C, run tracking
  jobs/          queue, worker loop, cron, handlers
  scoring/       lead score
  ai/            provider-agnostic AI (Gemini, OpenAI, or off)
  attribution/   Meta CAPI, Google offline conversions
  http/          Express app, middleware, routes
  realtime/      SSE hub
  testing/       integration-test harness

web/src/
  lib/           API client, auth context, realtime, i18n, formatting
  styles/        the design system's CSS, ported from the approved design
  design/        shell, icons, charts, theme — see docs/DESIGN.md
  components/    shell, inline SVG icons, shared UI
  pages/         login, board, inbox, contact 360, contacts, projects,
                 templates, reports, team
```

## Data model in one paragraph

A `contact` is a person, unique on phone and `wa_id`. An `opportunity` is one
inquiry in the pipeline, carrying the real estate fields and first-touch
attribution. A `conversation` is the single thread per contact; `messages` mix
WhatsApp, email, SMS, notes and system events inside it. `activities` are the
human-readable trail, `audit_log` the tamper-evident one. Everything automated
runs through `jobs` and is recorded in `workflow_runs`.

## What is deliberately not here

- **No message queue.** A MySQL table with `FOR UPDATE SKIP LOCKED` is enough at
  this volume and removes an entire component from the deployment.
- **No WebSockets.** SSE survives shared-hosting proxies, and the client falls
  back to 4-second polling on its own.
- **No ORM-generated schema.** Migrations are hand-written SQL so the indexes
  and unique keys — which carry the correctness guarantees — are explicit.
