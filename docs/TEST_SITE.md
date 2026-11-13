# Putting v2 on new.crm.homes.me — a test site

A second website, on its own address, with **its own copy** of the database and
**every alert switched off**. Nobody is messaged. crm.homes.me is not touched.

Written for Emir to follow in Hostinger's hPanel. I cannot click these myself —
I have no access to the panel. If a button is named differently from what is
written here, send me a screenshot and I will tell you which one it is.

---

## Before you start — the one rule

**The test site must never point at the live database.** Everything below is
built around that. If any step asks for a database name and you are not sure,
stop and ask me. A test site writing into the live database would change real
leads.

---

## Step 1 · Make the address

1. hPanel → **Domains** → **Subdomains**
2. Subdomain: type `new`
3. Domain: choose `crm.homes.me` (or `homes.me` if the list shows it that way —
   the result must read **new.crm.homes.me**)
4. **Create**

Wait a minute, then open `http://new.crm.homes.me` in a browser. An empty page
or a "not found" is the right answer at this stage — it means the address
exists.

## Step 2 · Turn on HTTPS for it

1. hPanel → **Security** → **SSL**
2. Find **new.crm.homes.me** in the list
3. **Install SSL** (free, takes a few minutes)

Do not skip this. The phone app features and the login cookie need https.

## Step 3 · Make a copy of the database

This is the careful one. Three parts.

**3a. Save a copy of the live database**

1. hPanel → **Databases** → **phpMyAdmin**, open the **live** database
2. Top menu → **Export**
3. Method: **Quick**. Format: **SQL**
4. **Go** — a `.sql` file downloads to your computer

This only reads. Nothing changes on the live site.

**3b. Make an empty new database**

1. hPanel → **Databases** → **Management**
2. **Create a new database**
   - Database name: something with `test` in it, e.g. `..._crmtest`
   - Username: a new one, e.g. `..._crmtest`
   - Password: press **Generate** and **save it somewhere safe**
3. **Create**

Write down the three values the panel shows you: database name, username,
password. You need them in step 5.

**3c. Put the copy into the new database**

1. **phpMyAdmin** again, this time open the **new** database
2. Top menu → **Import**
3. Choose the `.sql` file from 3a
4. **Go**

When it finishes, the new database has the same tables and the same data as the
live one, frozen at the moment you exported it.

## Step 4 · Make the second website point at the v2 branch

1. hPanel → **Websites** → the entry for **new.crm.homes.me**
2. **Advanced** → **GIT** (on some plans it is **Deployment** or **Git version
   control**)
3. Repository: the same GitHub repository as the live site
4. **Branch: `v2`** ← this is the important one. The live site watches a
   different branch; this one must watch `v2`.
5. Install path: the folder for new.crm.homes.me
6. **Create** / **Deploy**

## Step 5 · Switch every alert off

In the same website's settings, find where environment variables are set
(hPanel → the site → **Advanced** → **Node.js**, or a `.env` file in the
site's folder through **File manager**).

Paste this block. The lines that are blank are blank **on purpose** — a blank
key is how each thing stays off.

```
NODE_ENV=production
APP_URL=https://new.crm.homes.me

# --- the copy of the database, from step 3b ---
DB_HOST=localhost
DB_NAME=PUT_THE_TEST_DATABASE_NAME_HERE
DB_USER=PUT_THE_TEST_USERNAME_HERE
DB_PASSWORD=PUT_THE_TEST_PASSWORD_HERE

# --- WhatsApp: nothing is sent, ever ---
WHATSAPP_PROVIDER=log
ALLOW_FAKE_WHATSAPP=1
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=

# --- Email: nothing is sent, nothing is read ---
SMTP_HOST=
SMTP_USER=
SMTP_PASSWORD=
IMAP_HOST=
IMAP_USER=
IMAP_PASSWORD=

# --- Phone notifications: off ---
FCM_PROJECT_ID=
FCM_CLIENT_EMAIL=
FCM_PRIVATE_KEY=
FCM_VAPID_KEY=

# --- Meta and Google: nothing is reported back to the ad accounts ---
META_APP_SECRET=
META_SYSTEM_USER_TOKEN=
META_CAPI_ACCESS_TOKEN=
GOOGLE_LEAD_FORM_KEY=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_REFRESH_TOKEN=

# --- Homes AI: off until you want to try it ---
GEMINI_API_KEY=
```

**What each block means in plain words**

| Block | What happens on the test site |
|---|---|
| WhatsApp | A message is written down as *"Not sent — WhatsApp is not connected"*. No client ever receives anything. |
| Email | No email leaves. No mailbox is read. |
| Phone notifications | Nobody's phone buzzes. |
| Meta and Google | Nothing is sent to your ad accounts, so your real campaigns cannot be affected. |
| Homes AI | The AI screens say the key is missing instead of answering. Add a key later if you want to try them. |

`ALLOW_FAKE_WHATSAPP=1` is there because the server normally refuses to start
with WhatsApp switched off — that guard exists so a silent CRM can never be
mistaken for a working one. On a test site it is exactly what you want.

## Step 6 · Open it on your phone

`https://new.crm.homes.me/v2`

Sign in with the same email and password as the live site — it is a copy of the
same database, so the same accounts work. Changing anything there changes only
the copy.

Add it to your home screen: Safari → Share → **Add to Home Screen**.

---

## How to be sure it is safe, in three checks

1. **Open the live site in another tab.** It should look exactly as it did.
2. **On the test site, change something small** — rename a lead. Refresh the
   live site. The live one must still show the old name. If it changes, stop
   and tell me: the test site is pointing at the wrong database.
3. **On the test site, press WhatsApp on any lead.** The message must appear in
   the thread marked *"Not sent"*. If a client actually receives something,
   stop and tell me.

---

## Taking it down

Delete the subdomain (step 1) and the test database (step 3b). Nothing else is
affected.
