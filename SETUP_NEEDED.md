# What Emir needs to do

Things only you can do, because they need a password, a key or an account I
don't have. Everything else is built and working.

Each item says **why it matters** and **exactly what to click**. Do them in
order — the first three are the urgent ones.

---

## ✅ 0. Deploying — nothing to do, it already works

**This section used to say none of the work was live. That was wrong, and I am
leaving the correction here rather than quietly deleting it.**

Your CRM deploys itself. Hostinger's own GitHub integration is connected to
this repository and watches the branch, so every push is on the site in about
75 seconds with no key, no button and no step for you:

- **hPanel → Websites → mycrm.emirdulovic.com → Deployments**
- Connected with GitHub · Auto-deployment on
- Branch `claude/new-session-krd7bx`, root `./`, Node 20.x
- **Redeploy** on that page re-runs the last one if you ever need it

**What I got wrong.** The repository also contains a GitHub Actions deploy
(`.github/workflows/deploy.yml`) that fires on a branch called `main`. There is
no `main`, so it has never run — and I read that as "nothing has ever
deployed", when in truth Hostinger was doing it all along by a different
route. That workflow is unused and inert. Ignore it; it needs no SSH keys and
no repository secrets, because nothing uses it.

**What this means in practice:** anything I push is live immediately for
everybody on the team. There is no staging and no approval step. That is why
every change is tested before it is pushed.

---

## 🔴 1. Change the leaked Gemini key (do this first)

A Gemini API key was shown in a screenshot earlier, which means it must be
treated as public. Anyone who has it can spend your money.

1. Go to **https://aistudio.google.com/apikey**
2. Find the key starting `AQ.Ab8RN6JG…` and click the **bin icon** → **Delete**
3. Click **Create API key** → copy the new one
4. Go to **hPanel → Websites → crm.homes.me → Advanced → Node.js**
5. In **Environment variables**, find `GEMINI_API_KEY`, paste the new value
6. While you are there, make sure `AI_PROVIDER` is set to `gemini` — the key
   alone does not switch Emir AI on, and with `AI_PROVIDER` unset every AI
   feature stays off
7. Click **Save**, then **Restart**

---

## 🔴 2. Change the database password

The database password was also visible in a screenshot.

1. **hPanel → Databases → MySQL Databases**
2. Next to your database user, click **Change password**
3. Let it generate a strong one, and **copy it**
4. **hPanel → Websites → crm.homes.me → Advanced → Node.js → Environment variables**
5. Update `DB_PASSWORD` with the new password
6. **Save**, then **Restart**

⚠️ Do steps 2 and 5 within a minute of each other — between them the CRM
cannot reach the database.

---

## 🔴 3. Point the CRM at its new address

The CRM now lives at **crm.homes.me**, but it still tells Meta, Google and
your website to use the old address.

1. **hPanel → Websites → crm.homes.me → Advanced → Node.js → Environment variables**
2. Set `APP_URL` to exactly: `https://crm.homes.me`
3. **Save**, then **Restart**

Then update each of these five places. In every case you are replacing
`https://mycrm.emirdulovic.com` with `https://crm.homes.me` and keeping the
rest of the address the same.

| Where | Address to paste |
|---|---|
| Meta → your app → Webhooks → Page → `leadgen` | `https://crm.homes.me/webhooks/meta/leadgen` |
| Meta → WhatsApp → Configuration → Webhook | `https://crm.homes.me/webhooks/whatsapp` |
| Google Ads → Lead form → Webhook URL | `https://crm.homes.me/webhooks/google` |
| property-investment.ae → form settings | `https://crm.homes.me/api/webhooks/property-investment` |
| Firebase → Project settings → Authorized domains → **Add** | `crm.homes.me` |

Keep the old address `mycrm.emirdulovic.com` pointing at the CRM for now, so
anything you forget keeps working.

---

## 🟠 4. Make sure backups are running

The CRM now takes a backup of everything automatically, every time it starts,
just before it changes anything. You only need to check it is working.

1. **hPanel → Websites → crm.homes.me → Advanced → Node.js**
2. Click **Runtime logs**
3. Look for a line that starts `[start] backup` — it shows the file and its size

**If you instead see `⚠ NO BACKUP TAKEN`,** the dump tool is missing. Fix it:

1. **hPanel → Advanced → SSH Access** and connect
2. Run: `which mysqldump`
3. If nothing comes back, run: `sudo apt-get install -y mysql-client`
4. Restart the CRM from hPanel

**Where the backups are kept:** a folder called `crm-backups`, next to the CRM
folder on the server. The last 14 are kept. Turn on **hPanel → Backups** as
well, so you have a copy off the machine.

---

## 🟠 5. Make sure the CRM is set to stay running

**Good news: there is no cron job to set up.** The 5-minute lead timer, the
reminders, the follow-up alerts and the imports all run inside the CRM itself.
As long as the app is running, they run.

That makes one setting important: the app must restart by itself if it ever
stops. Please check it:

1. **hPanel → Websites → crm.homes.me → Advanced → Node.js**
2. Check the app shows **Running**
3. In **Environment variables**, check `WORKER_IN_PROCESS` is `1`. **This is
   the one that matters most on this page.** Your hosting runs a single process
   per app, and the timers live inside a worker — with this off the CRM looks
   completely normal and silently never sends a welcome message, never fires a
   follow-up and never checks the 5-minute rule. If it is missing, add it as
   `1`, **Save**, **Restart**
4. If there is an **Application mode** setting, make sure it is **Production**
5. If there is an **Auto restart** or **Always on** switch, turn it **on**

**How to check it took, in your browser.** Open
**https://crm.homes.me/health** — it answers with one line of text. You want to
see `"worker":"in-process"`. If it says `"worker":"separate"` the timers are not
running, and step 3 is why. (`"off"` means `WORKER_ENABLED` has been set to 0.)
This is also the quickest way to tell whether the CRM is up at all, and it is
the page the deploy itself checks before it keeps a new release.

If the app is ever stopped for a while, nothing is lost. When it starts again
it catches up on the leads whose time ran out and sends you **one** summary
("7 leads bounced while the system was offline"), not seven separate alerts.

---

## 🟠 6. Fill in your company details, then re-submit the WhatsApp templates

**New:** the company's name, TRN, ORN, licence, address and logo are now
yours to set, in **Settings → Company**. They used to be written into the code,
so changing them needed me. They appear at the bottom of every WhatsApp
template, in the signature of every follow-up email, and on every offer and
business card.

1. Open the CRM → **Settings → Company**
2. Fill in the registered name, TRN, ORN, licence number and expiry, address,
   phone, WhatsApp, email and website
3. Drop your logo in on the right — PNG or JPG, under 2 MB
4. Press **Save the company details**

Anything missing or odd is listed under **Worth fixing** on the same screen.

**Then the templates.** Your company name changed to **Emigeo Homes Real
Estate**, and the 16 approved WhatsApp templates still say the old name.
Changing it in Settings updates what the CRM would submit next time — it
cannot change a template Meta has already approved, because Meta approves the
footer as part of the template.

1. **business.facebook.com → WhatsApp Manager → Message templates**
2. For each template, click **⋯ → Edit**, change the company name, **Submit**
3. Approval usually takes a few hours

Until they're approved, the old templates keep working — nothing breaks.

---

## 🟡 7. Connect email sending (needed for client emails and campaigns)

The CRM can write and send emails to clients, but it needs an email service.
It is free up to about 300 emails a day.

1. Sign up at **https://www.brevo.com** (free plan is fine)
2. Go to **SMTP & API → API Keys → Generate a new API key**, copy it
3. **hPanel → Websites → crm.homes.me → Advanced → Node.js → Environment variables**, add:
   - `EMAIL_PROVIDER` = `brevo`
   - `BREVO_API_KEY` = *(the key you copied)*
   - `FEATURE_EMAIL_SENDING` = `true`
4. **Save**, then **Restart**

Those are the exact names the CRM reads. A name that is nearly right is the
same as nothing at all: the CRM starts, says email is not connected, and
nothing goes out.

**Then prove emails are yours** so they don't go to spam. In Brevo go to
**Senders, Domains & Dedicated IPs → Domains → Add a domain** → enter
`homes.me`. Brevo gives you three records to add:

1. **hPanel → Domains → homes.me → DNS Zone**
2. Add each record Brevo shows you (they look like `brevo._domainkey`, an SPF
   `TXT`, and a `DMARC` record) — copy the name and value exactly
3. Back in Brevo, click **Verify**

Until this is done, leave `EMAIL_TEST_MODE` = `true` and set
`EMAIL_TEST_REDIRECT` to your own email. Every client email will come to you
instead of going out, with the real recipient written into the subject, so you
can check them safely.

---

## 🟡 8. Turn on phone alerts (Firebase)

So an agent gets the lead alert on their phone even when the CRM is closed.

This is seven values copied out of a free Firebase project. There is no key to
generate yourself — Firebase makes them, you paste them. **`docs/NOTIFICATIONS.md`
has the same steps with a table of exactly where each value sits in Firebase**;
this is the short version.

1. Create a free project at **https://console.firebase.google.com**
2. In it, add a **Web app** (the `</>` icon). Firebase shows you a snippet —
   from it you need `apiKey`, `appId` and `messagingSenderId`
3. **Project settings → Cloud Messaging → Web Push certificates →
   Generate key pair**, and copy the public key
4. **Project settings → Service accounts → Generate new private key**. A `.json`
   file downloads; open it and you need `client_email` and `private_key`
5. **hPanel → Websites → crm.homes.me → Advanced → Node.js → Environment
   variables**, add all seven:

   | Name | Where it came from |
   |---|---|
   | `FCM_PROJECT_ID` | Project ID |
   | `FCM_WEB_API_KEY` | `apiKey` from step 2 |
   | `FCM_WEB_APP_ID` | `appId` from step 2 |
   | `FCM_MESSAGING_SENDER_ID` | `messagingSenderId` from step 2 |
   | `FCM_VAPID_KEY` | the public key from step 3 |
   | `FCM_CLIENT_EMAIL` | `client_email` from the file in step 4 |
   | `FCM_PRIVATE_KEY` | `private_key` from that file — the whole thing, `-----BEGIN` to `-----END` |

6. **Save**, then **Restart**
7. Also add `crm.homes.me` under **Project settings → Authorized domains**
   (it is in step 3 of this file too)

The first four are public by design — they ship to every phone that opens the
CRM. **`FCM_PRIVATE_KEY` is the real secret:** keep it off chat, screenshots and
the repository.

Until this is done, agents still get every alert — in the bell inside the CRM
and by email. Nothing is lost; it just will not light up a locked phone.

(There is a `scripts/make-vapid-keys.mjs` in the repo. It is for a different,
Firebase-free way of doing push that the CRM does not use. Ignore it — a key
pair from it would do nothing.)

---

## 🟡 9. Show which city agents log in from (optional — skip it)

For one column on the Team Activity report. Free, but it is a download and a
file on the server rather than a key you paste, so it is the one item here I'd
leave until everything else is running.

1. Sign up at **https://www.maxmind.com/en/geolite2/signup**
2. **Download Files → GeoLite2 City → Download GZIP**, and unzip it. Inside is
   a file called `GeoLite2-City.mmdb`
3. Put that file on the server — **hPanel → Files → File Manager** is the
   easiest way — somewhere beside the CRM folder, not inside it
4. **hPanel → Advanced → SSH Access**, connect, then run:
   `cd /home/USERNAME/domains/crm.homes.me/public_html && npm install maxmind`
5. **Environment variables**, add `MAXMIND_DB_PATH` = the full path to that
   `.mmdb` file
6. **Save**, then **Restart**

Without it, sign-ins are simply recorded without a city and every screen reads
naturally — no "Unknown", no gap. The report, the devices list and the alerts
all work exactly the same.

---

## 🟡 10. Put the lead form on homes.me

So enquiries from your website land in the CRM automatically.

1. In the CRM: **Settings → Integrations → Website** and click **Copy snippet**
2. Send that snippet to whoever manages homes.me, and ask them to paste it on
   the contact page where the form should appear

The snippet carries its own key, so no one else can post leads into your CRM.

---

## ⚪ 11. Things that are built but switched off

These are finished and waiting for a key. Nothing is broken; agents don't see
them at all until they're on.

There is no on/off switch to flip for any of them — **each one turns itself on
the moment its keys are in the environment, and stays off and silent until
then.** That is deliberate: a switch that says "on" while the keys are missing
is how a CRM ends up showing an agent a welcome message that was never sent.

| Feature | Turns on when you set | Which needs |
|---|---|---|
| Meta lead ads | `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN` | Meta app review |
| Reporting lead quality back to Meta | `META_DATASET_ID`, `META_CAPI_ACCESS_TOKEN` | the same Meta app |
| Google lead forms | `GOOGLE_LEAD_FORM_KEY` | nothing — you choose the value |
| Google offline conversions | the five `GOOGLE_ADS_*` values | a Google Ads developer token |
| WhatsApp inside the CRM | `WHATSAPP_PROVIDER` = `cloud`, plus `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN` | WhatsApp Business API approval |
| Emir AI | `AI_PROVIDER` = `gemini`, plus `GEMINI_API_KEY` | the new key from step 1 |
| Client email and campaigns | see step 7 | a Brevo account |
| Phone alerts | see step 8 | a Firebase project |

Until WhatsApp is connected, the CRM records what it *would* have sent and
labels it **"Not sent — WhatsApp is not connected yet"**, so an agent is never
misled into thinking a lead has been contacted. (That behaviour is itself
deliberate and needs `ALLOW_FAKE_WHATSAPP` = `1`, which is how the live site
runs today.)

Emir AI also has a spending limit, `AI_MONTHLY_CAP_USD`, which starts at **5
dollars a month** and is checked before each request rather than after. Raise
it in the environment variables when you want more.

---

## One last thing — check nothing broke on 29 October

Between **17:22 and 19:01 on 29 Oct 2026**, a deployment I made may have taken
the CRM offline for about an hour and a half. Please check:

1. **hPanel → Websites → crm.homes.me → Advanced → Node.js → Runtime logs**
2. Scroll to that time and look for repeated errors

If agents reported the CRM being down that evening, that was the cause, and it
is fixed now. I'm sorry about it.
