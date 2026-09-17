# Going live on Hostinger Cloud — the short version

Four steps, all of them clicks. No terminal anywhere.

This is the record of a real deploy, not a plan: it was followed end to end on
17 September 2026 and the CRM came up on the fourth attempt. What went wrong on
the first three is written into the steps below, so it does not go wrong again.

Your details, already confirmed:

| | |
|---|---|
| Address | `mycrm.emirdulovic.com` |
| Database name | `u942058886_emircrm2` |
| Database user | `u942058886_emircrm2` |
| Database host | `localhost` |
| Repository | `iamemirdulovic-wq/Emir-CRM` |
| Branch | `claude/new-session-krd7bx` |

---

## Step 1 · Create the app and connect GitHub

Hostinger confirmed the path:

**Websites → Add Website → Deploy Web App → Import Git Repository**

Then choose the subdomain as the deployment domain.

**Give the CRM its own empty database.** Two applications must never share one —
they overwrite each other's tables, and the CRM refuses to start rather than
migrate over someone else's schema. Create a fresh one in
**Databases → Management** before you begin.

Connect GitHub and select:

- **Repository:** `iamemirdulovic-wq/Emir-CRM`
- **Branch:** `claude/new-session-krd7bx`

On the **Review build settings** screen:

| Field | Value |
|---|---|
| Framework preset | Other / None — this is not a frontend framework |
| Branch | `claude/new-session-krd7bx` |
| Node version | 20.x or 22.x — both work |
| Root directory | `/` — leave it |
| Build command | `npm run build` |
| Output directory | leave blank — the server serves its own files |
| Entry file | `scripts/start.mjs` |

`scripts/start.mjs` is the one thing to get right. It builds if the platform
has not, applies migrations, and starts the server — so whatever the panel does
or skips, the app comes up correctly.

---

## Step 2 · Environment variables

Still on that page, find **Environment variables** and add these. Copy them
exactly; the one marked **← you** is yours to fill in.

```
NODE_ENV=production
APP_URL=https://mycrm.emirdulovic.com
COOKIE_SECURE=true
TRUST_PROXY=true

DB_HOST=localhost
DB_PORT=3306
DB_NAME=u942058886_emircrm2
DB_USER=u942058886_emircrm2
DB_PASSWORD=                    ← you (your database password)

WORKER_ENABLED=true
WORKER_IN_PROCESS=1

WHATSAPP_PROVIDER=log
ALLOW_FAKE_WHATSAPP=1
```

`ENCRYPTION_KEY` is deliberately absent: the app generates one for you on the
setup screen in Step 3, ready to copy and paste back here. Nothing needs it
until you connect WhatsApp or Google.

Two of these matter more than they look:

- **`WORKER_IN_PROCESS=1`** — without it the site works but no follow-up is ever
  sent, and nothing tells you.
- **`ALLOW_FAKE_WHATSAPP=1`** — WhatsApp is not connected yet, so the server
  would otherwise refuse to start. With it, messages are recorded as
  *"Not sent — WhatsApp is not connected yet. Call or email this lead instead."*
  Agents see the truth rather than a message that never went.

Do not set `PORT`. Hostinger provides it, and the app reads it — it also binds
`0.0.0.0` so the platform's proxy can reach it.

---

## Step 3 · Deploy

Press **Deploy**.

It takes a few minutes: it installs, builds, creates all 42 database tables, and
starts. Then open:

**https://mycrm.emirdulovic.com/health**

You want to see:

```json
{"ok":true,"service":"emir-crm","worker":"in-process"}
```

`"worker":"in-process"` is the line that matters. If it says anything else,
`WORKER_IN_PROCESS` did not take.

### Then make your account

Open **https://mycrm.emirdulovic.com**. Because nobody has an account yet, it
shows a setup screen rather than a login you could not pass. Fill in your name,
email and a password, press the button, and you are inside.

That screen also shows a generated `ENCRYPTION_KEY`. Copy it, paste it into the
environment variables from Step 2, and restart the app when convenient — it
protects saved WhatsApp and Google tokens, and nothing needs it before then.

The setup screen works exactly once. The moment your account exists the server
refuses it for good, so open the site soon after it deploys rather than leaving
a fresh install sitting on a public address.

If the page does not load, open the **deployment logs** on the application
dashboard — Hostinger provides them alongside a **Restart** control. The
messages there are written to be read: a failed build says exactly why.

---

## Step 4 · Keep it awake

Managed hosting suspends an application nobody is visiting. A suspended
application sends no follow-ups, so this is part of the deployment, not an extra.

**hPanel → Advanced → Cron Jobs → Create new**

- **Run:** every 5 minutes
- **Command:**

```
curl -fsS https://mycrm.emirdulovic.com/health > /dev/null
```

---

## Then you are live

From then on, every push to the branch redeploys by itself.

### The three that caught us out

1. **`DB_NAME` is a database name, not a password.** Pasting the password there
   gives `Access denied for user`, which reads like a password problem and is not.
2. **A database with tables already in it stops the deploy dead**, with
   `Table 'users' already exists`. That is the CRM refusing to migrate over
   another application's data. Use an empty database.
3. **`NODE_ENV=production` hides the build tools** — npm omits devDependencies,
   and TypeScript and Vite are devDependencies. `npm run build` now installs them
   when they are missing, so this one is already handled.

### What still needs you, later

- **WhatsApp.** Not connected. The CRM runs on calls, imports and email until a
  number is approved by Meta. Switch `WHATSAPP_PROVIDER` to `cloud`, add the
  tokens, and remove `ALLOW_FAKE_WHATSAPP` when it is ready.
- **Email.** Optional. Add the `SMTP_*` and `IMAP_*` variables to get email into
  the shared inbox.
- **Your agents.** Create their accounts in Settings once you are in.
