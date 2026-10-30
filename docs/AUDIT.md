# Codebase audit — Step 0

Written 30 Oct 2026, before any code was changed for the master build.
This is the map the rest of the build works from. If something here turns out
to be wrong, correct it here first, then carry on.

---

## 1. The stack

| Layer | What it is | Notes |
|---|---|---|
| Repo | npm workspaces monorepo: `server/`, `web/` | one `package-lock.json` at the root |
| Server | Node 20 + TypeScript (ESM) + Express 4 | `server/src`, compiled to `server/dist` |
| Database | **MySQL 8 / MariaDB** via `mysql2` | hand-written SQL; no ORM |
| Migrations | hand-written `.sql` in `server/migrations/`, tracked in `schema_migrations` | applied by `scripts/start.mjs` on every boot |
| Validation | **Zod** on every endpoint | |
| Web | React 18 + Vite 6, React Router | `web/src`, built to `web/dist` |
| Styling | plain CSS with custom properties in `web/src/styles/` | no Tailwind; do not add one |
| Icons | `lucide-react`, wrapped by `web/src/design/Icon.tsx` | only names in `ICON_NAMES` exist |
| Tests | **Vitest** both sides; Playwright for the browser smoke test (`e2e/ui.mjs`) | |
| CI | `.github/workflows/ci.yml` (typecheck, tests against a real MySQL service, build) | |

**Do not change any of the above.** The spec's Part C names tokens and
components that mostly already exist here under different names; map onto them
rather than introducing a second system.

### Running it

| Command | What it does |
|---|---|
| `npm run build` | builds both workspaces |
| `npm start` | backup → migrate → seed reference data → serve API + SPA from one origin |
| `npm test` | server suite then web suite |
| `npm run typecheck` | both workspaces |
| `npm run e2e` | Playwright smoke test against a running instance |
| `npm run polish` | every screen at two sizes in both themes, checked for overflow, clipped text, broken images and tap targets too small for a thumb (needs the preview server, started from inside `web/`) |
| `VITE_PREVIEW=1 npx vite --port 5182` (in `web/`) | the SPA against `src/preview/mock-api.ts`, no database needed |

The preview server is how every screenshot in this build gets taken: there is
no MySQL in the build environment, so 268 integration tests skip and the real
API cannot be run locally.

---

## 2. How it is deployed — read this before pushing

**Hostinger Cloud Professional, and a push to `claude/new-session-krd7bx`
deploys to `crm.homes.me` automatically.** There is no staging. Seven agents
are using the result within about a minute of a push.

Consequences that shape every step of this build:

- **A commit is free; a push is a deployment.** Work in local commits, push
  only when a step is complete, typechecked, tested and screenshotted.
- `npm start` runs migrations on boot and **refuses to start** if they fail,
  so a bad migration is an outage, not a warning.
- Migrations therefore have a test guarding them —
  `server/src/db/migrations.safety.test.ts` — which fails CI on `DROP`,
  `RENAME`, `TRUNCATE`, `MODIFY`, an unqualified `DELETE`, or a `NOT NULL`
  column added without a default.
- A dump is taken on the server immediately before migrations
  (`scripts/backup-db.mjs`, wired into `scripts/start.mjs`). It writes to
  `../crm-backups` outside the checkout, gzipped, keeping 14.

---

## 3. The data model as it stands (69 tables)

### The important thing about `leads`

**There is no `leads` table, and this build must not create one.** The CRM
splits what the spec calls a lead into two:

- **`contacts`** — the *person*. Unique on `phone_e164` and `wa_id`, indexed on
  `email`. Holds the sticky owner, DNC state, messaging windows, first-touch
  attribution and `locked_fields` (which protects agent-edited values from
  being overwritten by automation).
- **`opportunities`** — the *enquiry*. Stage, status, the real-estate fields
  (project, emirate, budget, purpose, timeline, Golden Visa), full campaign
  attribution, and the speed-to-lead timestamps.

A person who enquires twice has one `contacts` row and (depending on the
30-day re-inquiry rule) one or two `opportunities`. Creating a parallel
`leads` table would give the CRM two sources of truth for the same person and
break ingestion, dedupe, the inbox, workflows and every report. **The spec's
`leads` columns map onto these two tables** — the mapping is in
`DECISIONS.md` and must be followed.

### Mapping the spec's tables onto what exists

| Spec asks for | Already exists as | Gap to close |
|---|---|---|
| `leads` | `contacts` + `opportunities` | add the new routing/next-step/score columns to `opportunities` |
| `lead_activities` | **`activities`** (`contact_id`, `opportunity_id`, `user_id`, `type`, `title`, `body`, `meta` JSON) | append-only already; add the new `type` values |
| `lead_notes` | nothing — `contacts.notes` is a single text blob | **build it** |
| `lead_assignments` | **`lead_assignments`** (built last week) | add `ended_at`, `outcome`, `response_seconds` |
| `notifications` | nothing persisted; push is fire-and-forget | **build it** |
| `push_subscriptions` | **`push_tokens`** (FCM) | spec wants Web Push/VAPID — decide one |
| `routing_settings` | **`app_settings`** name/value rows + `server/src/routing/settings.ts` | extend, don't add a table |
| `user_sessions` | **`sessions`** (has `ip`, `user_agent`, `last_seen_at`) | add city/country/device/active_seconds/flagged |
| `audit_log` | **`audit_log`** — exact match | nothing |
| `agent_profiles` | nothing | **build it** |
| `wall_*`, `kudos`, `xp_events`, `badges`, `user_badges`, `weekly_winners` | nothing | **build it** |
| `import_batches` | **`imports`** + `import_rows` + `import_mappings` | add `tag`, `undo_until` |
| `email_templates` / `email_messages` / `email_campaigns` | `wa_templates`, `messages`, `campaigns` (WhatsApp/call campaigns, not email) | **build the email side** |
| `teams` | **`teams`** + `team_members` | nothing |
| `feature_flags` | env vars + `app_settings` | use env, per existing style |

### Tables that already exist and must not be disturbed

`contacts`, `opportunities`, `activities`, `conversations`, `messages`,
`inbound_events`, `jobs`, `workflows`, `workflow_runs`, `pipelines`,
`pipeline_stages`, `tags`, `contact_tags`, `consents`, `suppressions`,
`users`, `sessions`, `audit_log`, `tasks`, `task_attachments`, `teams`,
`team_members`, `assignment_rules`, `assignment_state`, `unassigned_queue`,
`lead_pool_claims`, `lists`, `list_members`, `campaigns`, `campaign_members`,
`imports`, `import_rows`, `import_mappings`, `projects`, `units`,
`unit_price_versions`, `payment_plans`, `payment_plan_rows`, `project_media`,
`project_floorplans`, `project_amenities`, `project_documents`,
`project_locations`, `project_commissions`, `project_imports`, `developers`,
`developer_contacts`, `offers`, `offer_units`, `offer_views`, `offer_events`,
`offer_folders`, `ai_*`, `app_settings`, `app_secrets`, `push_tokens`,
`brochure_views`, `conversion_events`, `form_field_map`, `website_leads`,
`contact_identities`, `login_attempts`, `wa_templates`.

---

## 4. Roles and permissions as they stand

`server/src/auth/rbac.ts` holds a 21-permission matrix over the roles
`owner · admin · manager · agent · automation`.

Enforcement that already works:
- `requireAuth`, `requirePermission`, `requireRole`, `requireManager`,
  `requireAdmin` in `server/src/http/middleware/auth.ts`
- `server/src/auth/scope.ts` — `visibleUserIds()` and `ownerPredicate()` fence
  every list query to what the role may see, in SQL

**Three gaps against the spec (Part D1), to close in Step 3:**

1. **`export` is granted to `admin`.** The spec says **owner only**. Same for
   `bulk:delete` and `audit:read`.
2. **`contacts:delete` is granted to `admin`.** Spec says soft-delete is owner
   only — and there is no `deleted_at` on `contacts` or `opportunities` yet, so
   "delete" today is a real delete.
3. **No rate limit or volume alarm on an agent browsing leads**, and phone
   numbers are returned in full in list payloads.

---

## 5. The UI that exists

### Design system — `web/src/design/`

`AppShell` (sidebar + top bar + mobile bottom nav), `Icon` (a fixed Lucide
subset), `CountUp`, theme handling (`applyAppearance`, light/dark/system plus a
"reduce glass" setting), `stages.ts` (stage colours, `avatarColour`,
`initials`), and `ui.tsx`:

> `Avatar · StagePill · Score · Tag · ChannelBadge · Panel · Toolbar · Chip ·
> Seg · Spinner · Empty · ErrorNote · Note · useToast · ToastHost · Modal ·
> Drawer · DrawerHead · Field · Input · Select · TextArea · budgetLabel ·
> duration · ago · useNow · useCountdown`

Tokens live in `web/src/styles/tokens.css`, ported verbatim from the approved
design file. The accent is **teal `--primary:#00AFC8`**, not the spec's
`#0E7C86`.

**Missing against Part C3:** Button (there is only a `.btn` CSS class),
IconButton, Combobox, DatePicker/DateTimePicker, PhoneInput, CurrencyInput,
Slider, Badge, StatCard, BottomSheet, Tabs, SegmentedControl (there is `Seg`),
Skeleton, CountdownRing, TimelineItem, ConfirmDialog, CommandPalette.

### Pages — `web/src/pages/`

Dashboard, Pipeline (kanban), Inbox, Contacts + ContactDetail, Tasks, Library
(projects), Offers, Lists, Campaigns + Dialler, Imports + wizard, Incoming,
Pool, Automations, Settings, Login, Setup, ChangePassword.

Routing: the real app uses `BrowserRouter` with ordinary paths
(`/contacts/c-1`). **The preview build uses `HashRouter`** so it can be served
from any static host with no rewrite rule — so a preview URL is
`http://localhost:5182/#/contacts/c-1`, and a Playwright script driving the
preview must include the `#`. Reading `location.pathname` to decide a route is
therefore right in production and wrong against the preview.

### Realtime

`server/src/realtime/hub.ts` with an SSE endpoint in the inbox router;
`web/src/lib/realtime.ts` subscribes and **falls back to 4-second polling**.
It already declares a `lead.assigned` event type that nothing publishes yet —
the new-lead card currently polls every 10 s instead.

---

## 6. Background work

`server/src/jobs/` — a `jobs` table polled by a worker (`WORKER_IN_PROCESS`
runs it inside the API process; `npm run worker` runs it separately).
`cron.ts` holds the schedules. Jobs are deduplicated by key and are
idempotent. Workflows A/B/C, the SLA sweep, the Meta backfill and the import
chunks all run through it.

**This is the job runner the spec's Part E3 asks for. Use it.** Do not add a
second scheduler.

---

## 7. What is already built against the spec

Worth knowing before building something twice:

- **Workflows A/B/C**, weighted round-robin assignment, the shared pool, the
  SLA breach job, FCM push — all exist.
- **Incoming** page and `/api/incoming` with bulk assign, accept, and
  owner-only routing settings — built last week.
- **The 5-minute bounce** with `accept` and `action` phases, and the new-lead
  alert card — built last week; `decideSla()` is the pure state function.
- **Bulk import** wizard (upload → map → clean → dedupe → settings → assign →
  report) with background chunking and 24-hour undo.
- **Lists, smart lists, call campaigns and a power dialler.**
- **Project library** with units, price versions, payment plans, media,
  documents, developers and commissions.
- **Sales offers** — builder, client page, tracking, PDF.
- **Emir AI** — Gemini behind a provider-agnostic interface, read-only
  function-calling tools, the Ask bar, knowledge base.

### What is genuinely missing

Notes panel · notifications centre · email to clients and campaigns ·
agent profiles and business card · Team Wall, kudos, XP, badges, Best of
Homes · session/activity tracking with GeoIP · the owner's Team Activity
report · command palette · guided tour · PWA install prompt and sounds ·
"My Leads" with the smart tabs and the next-step rule · the Add Lead popup ·
soft delete.

---

## 8. Conventions to follow

- **Comments explain why, not what.** The existing code is written this way
  throughout; match it.
- Money is stored in AED as `BIGINT UNSIGNED`; Books would use fils, but Books
  is out of scope here.
- Times are `DATETIME(3)` in UTC. Dubai is UTC+4 with no DST, so a date in
  Dubai is `DATE(CONVERT_TZ(t,'+00:00','+04:00'))`.
- Every data-changing endpoint calls `writeAudit()`.
- Every list endpoint is fenced with `visibleUserIds()` / `ownerPredicate()`.
- IDs are `CHAR(36)` UUIDs generated in the application.
- Server files are ESM with `.js` import specifiers, even from `.ts`.
