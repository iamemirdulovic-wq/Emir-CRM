# Going live on Hostinger Cloud — the short version

Six steps. Nothing to install, no terminal except one line to make a password.

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

## Step 1 · Make your secret key

This one line runs on **your own Mac**, not on any server. Open Terminal and paste:

```
openssl rand -hex 32
```

It prints a long line of letters and numbers. **Copy it and keep it somewhere safe.**
You will paste it once in Step 3, as `ENCRYPTION_KEY`.

Do not send it to anyone, including in a chat. If you ever lose it, a new one can
be generated — saved integration tokens would need re-entering, nothing else.

---

## Step 2 · Find the Node.js page and connect GitHub

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

## Step 3 · Environment variables

Still on that page, find **Environment variables** and add these. Copy them
exactly; the two marked **← you** are yours to fill in.

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

ENCRYPTION_KEY=                 ← you (the long line from Step 1)

WORKER_ENABLED=true
WORKER_IN_PROCESS=1

WHATSAPP_PROVIDER=log
ALLOW_FAKE_WHATSAPP=1
```

Two of these matter more than they look:

- **`WORKER_IN_PROCESS=1`** — without it the site works but no follow-up is ever
  sent, and nothing tells you.
- **`ALLOW_FAKE_WHATSAPP=1`** — WhatsApp is not connected yet, so the server
  would otherwise refuse to start. With it, messages are recorded as
  *"Not sent — WhatsApp is not connected yet. Call or email this lead instead."*
  Agents see the truth rather than a message that never went.

Do not set `PORT`. Hostinger provides it.

---

## Step 4 · Deploy

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

If the page does not load, open the deployment log on that same panel page — it
says what went wrong, and the messages are written to be read.

---

## Step 5 · Keep it awake

Managed hosting suspends an application nobody is visiting. A suspended
application sends no follow-ups, so this is part of the deployment, not an extra.

**hPanel → Advanced → Cron Jobs → Create new**

- **Run:** every 5 minutes
- **Command:**

```
curl -fsS https://crm.emirdulovic.com/health > /dev/null
```

---

## Step 6 · Your login

The first account has to be created once. In the same Node.js panel, look for a
**Run command** or **Console** option and run:

```
npm run seed --workspace=server
```

It prints the email and temporary password, and the password must be changed at
first login.

If there is no way to run a command there, tell me — the same thing can be done
from a one-time page instead, and I will add it.

---

## Then you are live

Open **https://crm.emirdulovic.com**, sign in, change the password.

From then on: every push to the branch redeploys by itself.

### What still needs you, later

- **WhatsApp.** Not connected. The CRM runs on calls, imports and email until a
  number is approved by Meta. Switch `WHATSAPP_PROVIDER` to `cloud`, add the
  tokens, and remove `ALLOW_FAKE_WHATSAPP` when it is ready.
- **Email.** Optional. Add the `SMTP_*` and `IMAP_*` variables to get email into
  the shared inbox.
- **Your agents.** Create their accounts in Settings once you are in.
