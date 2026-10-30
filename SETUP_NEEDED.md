# What Emir needs to do

Things only you can do, because they need a password, a key or an account I
don't have. Everything else is built and working.

Each item says **why it matters** and **exactly what to click**. Do them in
order — the first three are the urgent ones.

---

## 🔴 1. Change the leaked Gemini key (do this first)

A Gemini API key was shown in a screenshot earlier, which means it must be
treated as public. Anyone who has it can spend your money.

1. Go to **https://aistudio.google.com/apikey**
2. Find the key starting `AQ.Ab8RN6JG…` and click the **bin icon** → **Delete**
3. Click **Create API key** → copy the new one
4. Go to **hPanel → Websites → crm.homes.me → Advanced → Node.js**
5. In **Environment variables**, find `GEMINI_API_KEY`, paste the new value
6. Click **Save**, then **Restart**

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
3. If there is an **Application mode** setting, make sure it is **Production**
4. If there is an **Auto restart** or **Always on** switch, turn it **on**

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
   - `EMAIL_API_KEY` = *(the key you copied)*
   - `FEATURE_EMAIL_SENDING` = `true`
4. **Save**, then **Restart**

**Then prove emails are yours** so they don't go to spam. In Brevo go to
**Senders, Domains & Dedicated IPs → Domains → Add a domain** → enter
`homes.me`. Brevo gives you three records to add:

1. **hPanel → Domains → homes.me → DNS Zone**
2. Add each record Brevo shows you (they look like `brevo._domainkey`, an SPF
   `TXT`, and a `DMARC` record) — copy the name and value exactly
3. Back in Brevo, click **Verify**

Until this is done, leave `EMAIL_TEST_MODE` = `true` and set
`EMAIL_TEST_INBOX` to your own email. Every client email will come to you
instead of going out, so you can check them safely.

---

## 🟡 8. Turn on phone alerts (Web Push)

So agents get the lead alert even when the CRM is closed.

I generate the keys for you — you only paste them.

1. **hPanel → Advanced → SSH Access**, connect, then run:
   ```
   cd /home/USERNAME/domains/crm.homes.me/public_html && node scripts/make-vapid-keys.mjs
   ```
2. It prints two lines. Copy both.
3. **Environment variables**, add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   and `VAPID_SUBJECT` = `mailto:crm@homes.me`
4. **Save**, then **Restart**

---

## 🟡 9. Show which city agents log in from (optional)

For the Team Activity report. Free.

1. Sign up at **https://www.maxmind.com/en/geolite2/signup**
2. **My License Key → Generate new license key**
3. Add `MAXMIND_LICENSE_KEY` to the environment variables, and
   `FEATURE_GEOIP` = `true`
4. **Save**, then **Restart**

Without this, the report says "Unknown" for the city. Everything else works.

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

| Feature | Switch | Needs |
|---|---|---|
| Meta lead ads | `FEATURE_META_LEADS` | Meta app review |
| Google lead forms | `FEATURE_GOOGLE_LEADS` | Google Ads developer token |
| WhatsApp inside the CRM | `FEATURE_WHATSAPP_API` | WhatsApp Business API approval |
| Emir AI | `FEATURE_AI` | the Gemini key from step 1 |

---

## One last thing — check nothing broke on 29 October

Between **17:22 and 19:01 on 29 Oct 2026**, a deployment I made may have taken
the CRM offline for about an hour and a half. Please check:

1. **hPanel → Websites → crm.homes.me → Advanced → Node.js → Runtime logs**
2. Scroll to that time and look for repeated errors

If agents reported the CRM being down that evening, that was the cause, and it
is fixed now. I'm sorry about it.
