# Going live on Hostinger Cloud — the short version

Four steps, all of them clicks. No terminal anywhere.

Your details, already confirmed:

| | |
|---|---|
| Address | `crm.emirdulovic.com` |
| Database name | `u942058886_emircrm` |
| Database user | `u942058886_emircrm` |
| Database host | `localhost` |
| Repository | `iamemirdulovic-wq/Emir-CRM` |
| Branch | `claude/new-session-krd7bx` |

---

## Step 1 · Find the Node.js page and connect GitHub

In hPanel, open the Node.js deployment page for `crm.emirdulovic.com`. If you
cannot find it, click the **✈ Agent** button and ask:

> Where do I set up the Node.js deployment for crm.emirdulovic.com?

Connect it to GitHub and choose:

- **Repository:** `iamemirdulovic-wq/Emir-CRM`
- **Branch:** `claude/new-session-krd7bx`

If it asks for these, use exactly:

| Setting | Value |
|---|---|
| Node version | 22, or 20 if 22 is not offered |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Start command | `npm start` |
| Entry / startup file | `scripts/start.mjs` |
| Application root | leave blank (the repository root) |

If there is no build command box, that is fine — `npm start` builds by itself
when it needs to.

---

## Step 2 · Environment variables

Still on that page, find **Environment variables** and add these. Copy them
exactly; the one marked **← you** is yours to fill in.

```
NODE_ENV=production
APP_URL=https://crm.emirdulovic.com
COOKIE_SECURE=true
TRUST_PROXY=true

DB_HOST=localhost
DB_PORT=3306
DB_NAME=u942058886_emircrm
DB_USER=u942058886_emircrm
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

Do not set `PORT`. Hostinger provides it.

---

## Step 3 · Deploy

Press **Deploy**.

It takes a few minutes: it installs, builds, creates all 42 database tables, and
starts. Then open:

**https://crm.emirdulovic.com/health**

You want to see:

```json
{"ok":true,"service":"emir-crm","worker":"in-process"}
```

`"worker":"in-process"` is the line that matters. If it says anything else,
`WORKER_IN_PROCESS` did not take.

### Then make your account

Open **https://crm.emirdulovic.com**. Because nobody has an account yet, it
shows a setup screen rather than a login you could not pass. Fill in your name,
email and a password, press the button, and you are inside.

That screen also shows a generated `ENCRYPTION_KEY`. Copy it, paste it into the
environment variables from Step 2, and restart the app when convenient — it
protects saved WhatsApp and Google tokens, and nothing needs it before then.

The setup screen works exactly once. The moment your account exists the server
refuses it for good, so open the site soon after it deploys rather than leaving
a fresh install sitting on a public address.

If the page does not load, open the deployment log on that same panel page — it
says what went wrong, and the messages are written to be read.

---

## Step 4 · Keep it awake

Managed hosting suspends an application nobody is visiting. A suspended
application sends no follow-ups, so this is part of the deployment, not an extra.

**hPanel → Advanced → Cron Jobs → Create new**

- **Run:** every 5 minutes
- **Command:**

```
curl -fsS https://crm.emirdulovic.com/health > /dev/null
```

---

## Then you are live

From then on, every push to the branch redeploys by itself.

### What still needs you, later

- **WhatsApp.** Not connected. The CRM runs on calls, imports and email until a
  number is approved by Meta. Switch `WHATSAPP_PROVIDER` to `cloud`, add the
  tokens, and remove `ALLOW_FAKE_WHATSAPP` when it is ready.
- **Email.** Optional. Add the `SMTP_*` and `IMAP_*` variables to get email into
  the shared inbox.
- **Your agents.** Create their accounts in Settings once you are in.
