# Deployment

## What the hosting plan must support

The master prompt asks for Hostinger Cloud Professional. I cannot inspect your
account, so this is the checklist to confirm before the first deploy. Each row
says what breaks if the answer is no.

| Requirement | Why | If unavailable |
|---|---|---|
| **Node.js 20.11+ long-running process** | The API is a persistent server, not PHP-style per-request execution | Blocking. Hostinger's Cloud plans support Node via the hPanel Node.js app manager or SSH + PM2; shared hosting generally does not |
| **A second long-running process** (the worker) | Workflows, follow-ups and the Meta backfill run outside the request cycle | Run the worker on any small VPS against the same database; it needs no inbound ports |
| **MySQL 8** (MariaDB 10.6+ works) | `FOR UPDATE SKIP LOCKED`, `DATETIME(3)`, JSON columns | Blocking below these versions |
| **Inbound HTTPS with a valid certificate** | Meta refuses to deliver webhooks to a self-signed or invalid certificate | Blocking |
| **Outbound HTTPS** | Graph API, Conversions API, Google Ads, FCM | Blocking |
| **Cron at 5-minute granularity or finer** | Only needed as a safety net — the worker schedules its own recurring jobs | Not blocking if the worker stays up |
| **SMTP** | Outbound email and the Workflow B fallback | Degrades: WhatsApp still works, email sends are recorded as failed and surfaced |
| **IMAP** | Threading email replies back into the inbox | Degrades: replies still arrive in the mailbox, just not in the CRM |
| **WebSockets** | Not required — realtime uses SSE, which falls back to 4-second polling | No impact |

Two things worth confirming with Hostinger specifically:

- **Whether the plan kills idle or long-running processes.** If it does, run the
  API under a process manager that restarts it, and put the worker elsewhere.
- **Whether the proxy buffers `text/event-stream`.** The app sets
  `X-Accel-Buffering: no`, which nginx respects. If the platform buffers anyway,
  realtime degrades to polling on its own — nothing to fix.

## NODE_ENV=production and the build

Worth knowing before it costs an hour: `NODE_ENV=production` makes npm omit
devDependencies, and TypeScript and Vite are devDependencies — correctly, since
they build the app and are not needed to run it. A platform that sets NODE_ENV
for the build phase as well as the runtime will therefore install, then fail the
build on `tsc: command not found`, with everything configured exactly right.

`npm run build` runs `scripts/build.mjs`, which fetches the build tools when they
are missing and does nothing when they are not. No build command in any panel
needs to know about this.

## Which shape of hosting this needs

The CRM is two processes: the API, and a worker that drains the `jobs` table.
The worker is not optional — it is what assigns a lead and sends the welcome
message inside thirty seconds, runs the +2h / +24h / +72h follow-ups, checks the
five-minute SLA, and processes imports in chunks.

Hosting comes in two shapes, and both are supported:

| | Two processes | One process |
|---|---|---|
| Examples | VPS, a machine you control | Hostinger Cloud, most managed Node hosting |
| API | `npm start` | `npm start` |
| Worker | `npm run worker`, its own process | inside the API: `WORKER_IN_PROCESS=1` |
| Deploy | `.github/workflows/deploy.yml`, over SSH | the host's own GitHub integration |
| Keeping it awake | pm2 | a scheduled ping to `/health` |

`WORKER_IN_PROCESS=1` is what makes the single-process shape work. Both may run
at once without fighting: `claimJobs` takes its rows `FOR UPDATE SKIP LOCKED`,
so two workers never get the same job.

Two processes is the better shape where you can have it — a slow job cannot
stall a webhook, and either half restarts alone. One process is not a
compromise on correctness, only on isolation.

### Managed hosting also idles

A managed application that sees no traffic is suspended, and a suspended
application is one whose follow-ups never fire. `/health` reports where the
worker is running (`in-process`, `separate` or `off`) precisely so a scheduled
ping can both keep the app awake and confirm the worker is there:

```
*/5 * * * * curl -fsS https://crm.example.ae/health > /dev/null
```

On Hostinger that goes in **hPanel → Advanced → Cron Jobs**. It is part of the
deployment, not a nicety.

## Automatic deploy from GitHub

The repository deploys itself. `\.github/workflows/deploy.yml` runs after CI
passes on `main`, or on demand from the Actions tab, and does the whole thing:
build, upload, install, migrate, switch, restart, health check, and roll back if
the new release does not answer.

Nothing in the repository holds a credential. The four values GitHub needs live
in **Settings → Secrets and variables → Actions**, and the database password
never leaves the server at all.

| Secret | What it is |
|---|---|
| `HOSTINGER_SSH_HOST` | the server address |
| `HOSTINGER_SSH_USER` | the SSH username from hPanel |
| `HOSTINGER_SSH_KEY` | a private key generated in hPanel — not a password |
| `DEPLOY_PATH` | where the app lives, e.g. `/home/uXXXXXXXX/crm` |
| `HOSTINGER_SSH_PORT` | optional; Hostinger often uses 65002 rather than 22 |
| `APP_URL` | optional; set it and every deploy is verified from outside too |
| `HOSTINGER_SSH_KNOWN_HOSTS` | optional; pins the host key instead of trusting it on first use |

### The layout it builds on the server

```
$DEPLOY_PATH/
  current -> releases/<commit sha>     the live release
  releases/<sha>/                      the last five, for rollback
  shared/
    .env                               your configuration, never in git
    var/uploads/                       import files, survive a deploy
    logs/
```

`current` is a symlink, swapped with an atomic `mv`, so a request is either
served by the old release or the new one and never by half of each.

### Preparing the server, once

```bash
ssh -p <port> <user>@<host>
bash deploy/server-setup.sh $HOME/crm
```

It checks Node is present and new enough, installs pm2, creates the layout, and
writes `shared/.env` with a freshly generated `ENCRYPTION_KEY`. Fill in the
database credentials and `APP_URL`, then create the first account:

```bash
cd $DEPLOY_PATH/current/server
set -a; . $DEPLOY_PATH/shared/.env; set +a
SEED_OWNER_EMAIL=you@yourdomain.ae SEED_OWNER_PASSWORD='a temporary one' node dist/db/seed.js
```

The password must be changed at first login.

### Rolling back

Every deploy keeps the previous five releases, and a failed health check rolls
back on its own. To go back by hand:

```bash
ln -sfn $DEPLOY_PATH/releases/<older sha> $DEPLOY_PATH/current.new
mv -Tf  $DEPLOY_PATH/current.new $DEPLOY_PATH/current
cd $DEPLOY_PATH/current && pm2 delete emir-api emir-worker; pm2 start deploy/ecosystem.config.cjs
```

Note that migrations are forward-only: rolling back the code does not roll back
the schema. That is deliberate — every migration so far only adds — but it means
a release that changes a column is not safely reversible by symlink alone.

## First deploy

```bash
git clone <repo> && cd emir-crm
npm ci
cp .env.example .env            # fill in, at minimum DB_* and ENCRYPTION_KEY
openssl rand -hex 32            # ENCRYPTION_KEY

npm run migrate
npm run seed                    # prints the owner's temporary password once
npm run build                   # compiles the server and builds the web bundle

npm start                       # API on $PORT
npm run worker                  # in a second process
```

The API serves the built SPA from the same origin, so there is one hostname,
one certificate, and no CORS.

### Process manager

```bash
pm2 start dist/index.js            --name emir-api
pm2 start dist/jobs/worker-entry.js --name emir-worker
pm2 save && pm2 startup
```

### Optional cron safety net

The worker schedules its own recurring jobs. A cron entry only matters if the
worker may be down:

```cron
*/5 * * * * cd /path/to/emir-crm && /usr/bin/node server/dist/jobs/worker-entry.js --once
```

## Connecting the integrations

Each of these needs an action from the owner that no code can perform.

### Meta (Lead Ads, WhatsApp, Conversions API)

1. Create a Meta app, add **WhatsApp** and **Webhooks**.
2. Set `META_APP_SECRET` and choose a `META_VERIFY_TOKEN`.
3. Subscribe the webhook to `https://your-domain/webhooks/meta/leadgen` for the
   `leadgen` field, and `https://your-domain/webhooks/whatsapp` for `messages`.
   Meta calls the GET handshake immediately; it will succeed once
   `META_VERIFY_TOKEN` matches.
4. Generate a system user token with `leads_retrieval`, `pages_show_list`,
   `whatsapp_business_messaging` and `business_management`.
5. Submit the day-one templates for review (**Templates → Seed library**, then
   submit in Meta's console). Nothing marketing-related can be sent until they
   are approved — the CRM falls back to email in the meantime.
6. Create a CRM dataset for the Conversions API and set `META_DATASET_ID` and
   `META_CAPI_ACCESS_TOKEN`.

**Owner action required:** Meta app review for `leads_retrieval` and WhatsApp
production access, plus template approval. Both take days, not minutes.

### Google Ads

1. Set `GOOGLE_LEAD_FORM_KEY` and paste the same value into the lead form
   extension's webhook settings, pointing at `/webhooks/google`.
2. For offline conversions, create a conversion action and fill in
   `GOOGLE_ADS_*`.

**Owner action required:** a Google Ads developer token with at least basic
access.

### Email

Set `SMTP_*`, `MAIL_FROM`, and `MAIL_REPLY_DOMAIN`. Inbound replies arrive at
`reply+{conversation_id}@MAIL_REPLY_DOMAIN`, so that domain needs a catch-all
mailbox, and `IMAP_*` must point at it.

**Owner action required:** SPF, DKIM and DMARC for the sending domain. Without
them the follow-up emails land in spam, which quietly halves the fallback's
value.

### Push

Create a Firebase project, enable Cloud Messaging, and set `FCM_PROJECT_ID`,
`FCM_CLIENT_EMAIL` and `FCM_PRIVATE_KEY` from the service account JSON.

## Security checklist before going live

- [ ] `COOKIE_SECURE=true` and the site is HTTPS-only — the server refuses to
      start in production without it, and HSTS is sent only in production
- [ ] `ENCRYPTION_KEY` is 32 random bytes and is **not** the example value
- [ ] `NODE_ENV=production`
- [ ] The database user has no privileges beyond the CRM schema
- [ ] `.env` is not readable by the web server's document root
- [ ] The owner's seeded password has been changed
- [ ] `WEBSITE_FORM_HMAC_SECRET` or `RECAPTCHA_SECRET` is set — without one the
      website endpoint refuses submissions rather than accepting unverified ones
- [ ] `WHATSAPP_PROVIDER` is a real provider, or `ALLOW_FAKE_WHATSAPP=1` is set
      deliberately because WhatsApp is not connected yet. The server refuses to
      start otherwise, on purpose: on `log` it would show agents messages that
      were never sent.
- [ ] `npm run build` has run, so `web/dist/index.html` exists — the
      Content-Security-Policy hashes its inline script at boot, and a stale
      build means a stale hash. Rebuild and restart together.
- [ ] The worker is running. Uploaded import files, expired sessions and old
      cron keys are cleaned up by its hourly maintenance job; without it
      `UPLOAD_DIR` grows forever.

## Upgrades

```bash
git pull && npm ci && npm run migrate && npm run build
pm2 restart emir-api emir-worker
```

Migrations are forward-only and recorded in `schema_migrations`. DDL is not
transactional in MySQL, so a failed migration leaves the file unrecorded and is
fixed forward, not rolled back.

## Backups

The database is the entire system: `contacts`, `messages`, `audit_log` and
`inbound_events` are not reconstructible from anywhere else. `inbound_events`
holds the raw payload of every lead ever received, so a restore can replay
history if it ever comes to that.

```bash
mysqldump --single-transaction --routines emir_crm | gzip > emir-$(date +%F).sql.gz
```

## Bulk import file storage

Import files are written to `UPLOAD_DIR` (default `./var/uploads`) and read back
by the chunked import job, so the directory must be on persistent disk that the
web process and the worker both see — on Hostinger that is the same filesystem,
which is why local disk was chosen over an object store for files we delete
within days.

- `UPLOAD_DIR` — create it and make it writable by the app user. Exclude it from
  backups if you like; the rows are already in MySQL by the time an import
  finishes.
- `MAX_UPLOAD_MB` — default 64, which is roughly half a million rows of CSV.
  Raise it only with the reverse proxy's own body limit raised to match, or the
  upload is cut off before the app ever sees it.
- Files are deleted by the worker's hourly maintenance job once an import's
  24-hour undo window closes, and after a week for an upload nobody finished.
  The sweep will not touch a path that does not resolve inside `UPLOAD_DIR`, so
  point `UPLOAD_DIR` at a directory the app owns, not at a shared one.

The upload endpoint streams the request body straight to disk, so it needs no
temporary space beyond the file itself and holds nothing in memory.
