# Emir CRM

A unified lead management system for a Dubai and Abu Dhabi off-plan real estate brokerage.
It ingests leads from Meta Lead Ads, click-to-WhatsApp ads, website forms, Google Ads lead
forms, inbound WhatsApp and CSV, merges each person into a single contact, assigns an agent
instantly, replies on WhatsApp within 30 seconds and reports lead quality back to the ad
platforms.

> Build status: Phase 1 (foundation) complete. See `docs/CHANGELOG.md`.

## Requirements

- Node.js 20.11+ (22 recommended)
- MySQL 8 (MariaDB 10.11+ also works)

## Getting started

```bash
npm install
cp .env.example .env          # then fill in DB credentials and ENCRYPTION_KEY
openssl rand -hex 32          # value for ENCRYPTION_KEY

npm run migrate               # apply schema migrations
npm run seed                  # pipeline, templates, tags and the owner account
npm run dev                   # API on http://localhost:3000
npm run dev:web               # UI on http://localhost:5173
```

`npm run seed` prints the owner's temporary password once. It must be changed on first login.
Set `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` to choose them yourself.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API with hot reload |
| `npm run dev:web` | Web UI with hot reload |
| `npm run build` | Compile the server and build the web bundle |
| `npm start` | Run the compiled server |
| `npm run worker` | Background job worker (jobs table poller) |
| `npm run migrate` | Apply pending migrations |
| `npm run seed` | Seed reference data (idempotent) |
| `npm test` | Unit and integration tests |
| `npm run typecheck` | TypeScript, no emit |

## Documentation

- `docs/ARCHITECTURE.md` — how the pieces fit together
- `docs/WEBHOOKS.md` — every inbound endpoint with sample payloads
- `docs/WORKFLOWS.md` — workflows A, B and C, and the automation guards
- `docs/CHANGELOG.md` — what shipped in each phase
- `CLAUDE.md` — the product specification this system is built against

## Repository layout

```
server/
  migrations/         versioned SQL, applied in order and recorded in schema_migrations
  src/
    config/           environment validation, business constants, pinned API versions
    lib/              phone, email, crypto, time (Asia/Dubai), logging and redaction
    auth/             passwords, sessions, lockout, roles and data scoping
    audit/            the audit_log writer
    db/               connection pool, migration runner, seed
    pipeline/         stage, sub-status and lost-reason definitions
    messaging/        WhatsApp, email and the template library and validator
    http/             Express app, middleware and routes
web/                  React + Tailwind PWA
fixtures/             sample webhook payloads used by the replay tests
```

## Security notes

- Secrets live in environment variables only. Tokens are encrypted at rest with AES-256-GCM.
- Logs redact secrets and mask phone numbers and email addresses.
- Every data-changing action writes to `audit_log` with actor, role, before and after.
- Only the owner or admin can export or bulk-delete, and both are logged.
