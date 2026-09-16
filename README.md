# Emir CRM

A unified lead management system for a Dubai and Abu Dhabi off-plan real estate
brokerage. It ingests leads from Meta Lead Ads, click-to-WhatsApp ads, website
forms, Google Ads lead forms, inbound WhatsApp and CSV, merges each person into
a single contact, assigns an agent instantly, replies on WhatsApp within
30 seconds, runs follow-ups automatically, shows every message in one shared
inbox, and reports lead quality back to Meta and Google.

The four priorities, in order: **never lose or duplicate a lead**,
**speed-to-lead under 30 seconds**, **WhatsApp-first**, **a clean UI**.

## Requirements

- Node.js 20.11+ (22 recommended)
- MySQL 8 — MariaDB 10.6+ also works

## Getting started

```bash
npm install
cp .env.example .env
openssl rand -hex 32          # put this in ENCRYPTION_KEY

npm run migrate               # apply schema migrations
npm run seed                  # pipeline, templates, tags and the owner account
npm run build                 # compile the server, build the web bundle

npm start                     # API + web app on $PORT (default 3000)
npm run worker                # background worker, in a second process
```

`npm run seed` prints the owner's temporary password once; it must be changed at
first sign-in. Set `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` to choose them.

To see the system working with realistic data:

```bash
npm run demo                  # drives the real pipeline, not fixture inserts
```

For development with hot reload, run `npm run dev` and `npm run dev:web` in two
terminals; Vite proxies the API so the session cookie still works.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `npm run dev:web` | API / web with hot reload |
| `npm run build` | Compile the server and build the web bundle |
| `npm start` | Run the compiled server (also serves the web app) |
| `npm run worker` | Background job worker |
| `npm run migrate` | Apply pending migrations |
| `npm run seed` | Seed reference data (idempotent) |
| `npm run demo` | Load a realistic demo dataset (never in production) |
| `npm test` | Unit and integration tests, both workspaces |
| `npm run typecheck` | TypeScript, no emit |
| `npm run e2e` | Browser smoke test (needs a running server and `npx playwright install chromium`) |

The design system has a gallery page: run `npm run dev:web` and open
`/design-system.html` to see the shell, every chart and every icon on one page,
in either theme. It is served in development only and is not in the production
build.

The database-backed test suites skip themselves when no server is reachable, so
`npm test` is green on a machine without MySQL. Point them at one with
`TEST_DB_HOST`, `TEST_DB_USER` and `TEST_DB_PASSWORD`.

## Documentation

| Document | What is in it |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the pieces fit, and why each significant decision was made |
| [`docs/WEBHOOKS.md`](docs/WEBHOOKS.md) | Every inbound endpoint with real sample payloads |
| [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) | The guards, workflows A/B/C, and ad-platform feedback |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Hosting requirements, integration setup, what needs owner action |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The design system: where it lives, how to port a screen, the theme |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | What shipped in each phase, and the bugs found along the way |
| [`CLAUDE.md`](CLAUDE.md) | The product specification this is built against |

## How it is put together

```
server/   Express + TypeScript API, background worker, MySQL migrations
web/      React + Vite PWA, served from the same origin as the API
design/   The approved design file — the visual source of truth
fixtures/ Real webhook payloads, replayed by the test suite
docs/     Architecture, webhooks, workflows, deployment, changelog
```

Two processes share a database and nothing else: the **API** (webhooks, JSON
API, SSE, and the built SPA) and the **worker** (workflows, follow-ups,
recurring jobs). Either can be restarted alone, and several workers can run side
by side.

## The guarantees, and where they live

| Guarantee | Enforced by |
|---|---|
| A replayed webhook changes nothing | `inbound_events` unique on `(source, external_id)` |
| One person is one contact | `contacts` unique on `phone_e164` and `wa_id`, resolved under row locks |
| A follow-up is scheduled once | `jobs.dedupe_key` unique |
| A lead gets one welcome, however often a job retries | `workflow_runs.singleton_key` unique |
| No automated message to a DNC or unconsented contact | `workflows/guards.ts`, the single send path |
| No message between 22:00 and 08:00 Asia/Dubai | the same guards, with Workflow A's instant reply exempt |
| Nothing outside WhatsApp's 24-hour window without a template | the same guards |
| No invented price, payment plan or handover date | `projects.verified_at`, checked before every quote |
| Every data change is attributable | `audit_log`, with actor, role, before and after |

The rules themselves — identity merging, stage permissions, the guards,
assignment, intent matching, scoring — are pure functions with unit tests. The
database layer around them is thin on purpose.

## Testing

374 tests. The ones worth knowing about:

- **Duplicate storm.** The same lead twenty times in parallel produces exactly
  one contact, one opportunity and one Workflow A job. Also twenty leads across
  five different phone formats, and twenty concurrent inbound WhatsApp webhooks.
- **Replay.** Every fixture in `/fixtures` is parsed, normalized and ingested,
  then replayed to prove it changes nothing.
- **Workflow idempotency.** Ten concurrent retries of Workflow A send one
  welcome; five retries of one inbound message produce one reply and one task.
- **Guards.** Every rule, its precedence, and both deliberate exceptions.
- **Theme.** The appearance and reduce-glass settings survive a reload, a forced
  light theme holds on a dark device, and the app still renders when
  `localStorage` throws, which is what private-mode Safari does.
- **Browser.** Sixteen steps through real Chromium at desktop and phone
  viewports, covering every screen, the 24-hour window indicator, the dark
  theme and the Arabic RTL switch (`npm run e2e`). This is the only
  suite that catches bugs which appear solely once a browser renders the page —
  it is how the CDN icon font, the empty-looking inbox default and the silently
  reset language toggle were all found.

## Security notes

- Email and password only. No public sign-up, no OTP, no third-party login.
- Sessions live server-side in MySQL; the cookie carries a random token and the
  table stores only its SHA-256.
- Passwords are argon2id, with a bcrypt(12) fallback where the native module
  cannot build. Five failures lock an account for 15 minutes; IPs are
  rate-limited separately.
- Secrets come from the environment only. Tokens are encrypted at rest with
  AES-256-GCM. Logs redact secrets and mask phone numbers and email addresses.
- Every user-supplied value reaches SQL through a placeholder; the few dynamic
  column lists are validated against an identifier pattern at runtime.
- Only an owner or admin can export or bulk-delete, and both are audited.
