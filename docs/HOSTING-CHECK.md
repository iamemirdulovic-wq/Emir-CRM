# Hostinger plan check — do this before Phase 14

CLAUDE.md says to confirm what the hosting plan supports before building
anything that depends on it. This is that check.

The whole deploy hangs on **question 1**. If the plan cannot keep a Node.js
process running, nothing else on this page matters and the hosting has to change
first — Emir CRM is a Node server, not a PHP site.

## The fast way: one command

If you already have SSH access, connect and paste this whole block. It prints
everything below in one go and reveals no passwords.

```bash
echo "--- machine ---";        uname -a; echo
echo "--- node ---";           (node -v && which node) 2>&1 | head -2; echo
echo "--- npm ---";            npm -v 2>&1 | head -1; echo
echo "--- process manager ---" ; (which pm2 || echo "no pm2") 2>&1; (which systemctl || echo "no systemctl") 2>&1; echo
echo "--- mysql ---";          (mysql --version || mariadb --version) 2>&1 | head -1; echo
echo "--- php (is this a PHP box?) ---"; php -v 2>&1 | head -1; echo
echo "--- disk ---";           df -h . | tail -1; echo
echo "--- memory ---";         free -m 2>/dev/null | head -2; echo
echo "--- can it reach SMTP? ---"; (timeout 5 bash -c 'cat </dev/null >/dev/tcp/smtp.gmail.com/587' && echo "port 587 open" || echo "port 587 BLOCKED"); echo
echo "--- cron ---";           crontab -l 2>&1 | head -5
```

Paste the output back. That answers 1, 2, 3, 6 and 8 at once.

## The manual way: what to look for in hPanel

### 1. Can it run Node.js? — the deciding question
**Where:** hPanel → Advanced → look for "Node.js" or "Application Manager".

- **A Node.js / Application setup page exists** → good, tell me the Node version
  it offers. We need **18 or newer**; the code is built and tested on 22.
- **Only PHP settings, no Node anywhere** → this plan cannot host the CRM. A
  Hostinger **VPS** can, and is the usual upgrade. Tell me and we will plan that
  instead of fighting the plan.

### 2. SSH access
**Where:** hPanel → Advanced → SSH Access.

Tell me: **host**, **port**, **username**. Not the password — if we automate the
deploy later, you will generate a key on that same page and paste it straight
into GitHub, never into this chat.

If SSH is switched off or absent, automatic deploy is off the table and we do it
through the file manager instead. Slower, but it works.

### 3. MySQL
**Where:** hPanel → Databases → MySQL Databases.

Tell me the **version** shown. We need **MySQL 8.0+** or **MariaDB 10.5+** — the
schema uses features older versions do not have. While you are there you can
create the database and user; keep the credentials on the server, they never
need to reach me or GitHub.

### 4. The subdomain
**Where:** hPanel → Domains → Subdomains.

Decide the address, e.g. `crm.yourdomain.ae`. Create it if you like, or tell me
the name and leave it.

### 5. SSL
**Where:** hPanel → Security → SSL.

Confirm a **free Let's Encrypt certificate** can be issued for that subdomain.
The CRM refuses to start in production without a secure cookie, and a secure
cookie needs HTTPS — so this is not optional.

### 6. Long-running processes
This is question 1 again from the other side, and the most common way a Node app
quietly dies on cheap hosting.

Ask Hostinger support, in these words:

> Does my plan allow a Node.js process to run continuously in the background,
> managed by PM2 or systemd, without being killed by an idle or resource timeout?

A **yes** means the API and the background worker can both stay up. A **no**
means jobs only run when someone pokes the site, which breaks speed-to-lead —
the whole point of the product.

### 7. Cron
**Where:** hPanel → Advanced → Cron Jobs.

Tell me the **shortest interval** allowed (often 5 or 15 minutes on shared
plans). The worker schedules its own recurring jobs from inside the process, so
cron is only a safety net that restarts it if it dies — a coarse interval is
survivable, I just need to know which.

### 8. Outbound email
Only matters if you want email in the shared inbox on day one.

- Is outbound **SMTP on port 587 or 465** allowed? Some hosts block it.
- Do you have a **mailbox** (hPanel → Emails) you want the CRM to send from and
  read replies into?

Skipping this is fine. The CRM runs on WhatsApp and calls without it.

## What I do with your answers

| Your answer | What changes |
|---|---|
| Node.js supported + SSH | Automatic deploy on every push, via GitHub Actions |
| Node.js supported, no SSH | A build you upload through the file manager |
| No Node.js | We move to a VPS before anything else |
| No long-running processes | Rework the worker, or move to a VPS — this one is serious |
| MySQL below 8 / MariaDB below 10.5 | Migrations need reworking; tell me before deploying |
