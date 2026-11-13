# Three things only you can do

*Everything else I can fix myself. These three need your accounts, so they
are the only things standing between the CRM and your agents using it.*

---

## 1. Phone alerts — about 20 minutes

**Why:** without this, an agent only sees a new lead when they next open the
CRM. Not on a locked phone, not in a pocket. The whole "call within 30
seconds" idea depends on it.

1. Go to **https://console.firebase.google.com** and create a free project.
2. Inside it, click the **`</>`** icon to add a **Web app**. It shows you a
   snippet — copy three values from it: `apiKey`, `appId`,
   `messagingSenderId`.
3. **Project settings → Cloud Messaging → Web Push certificates →
   Generate key pair.** Copy the key.
4. **Project settings → Service accounts → Generate new private key.** A
   file downloads. Open it; you need `client_email` and `private_key`.
5. **Project settings → Authorized domains** → add `crm.homes.me`.
6. In Hostinger: **hPanel → Websites → crm.homes.me → Advanced → Node.js →
   Environment variables.** Add these seven, then **Save** and **Restart**:

   | Name | What to paste |
   |---|---|
   | `FCM_PROJECT_ID` | the Project ID |
   | `FCM_WEB_API_KEY` | `apiKey` |
   | `FCM_WEB_APP_ID` | `appId` |
   | `FCM_MESSAGING_SENDER_ID` | `messagingSenderId` |
   | `FCM_VAPID_KEY` | the key from step 3 |
   | `FCM_CLIENT_EMAIL` | `client_email` from the file |
   | `FCM_PRIVATE_KEY` | `private_key` from the file — all of it, `-----BEGIN` to `-----END` |

**`FCM_PRIVATE_KEY` is a real secret.** Do not put it in chat, a screenshot
or a message to me. Paste it straight into Hostinger.

---

## 2. Email — about 20 minutes

**Why:** without it the CRM sends no email at all. No follow-up emails to
clients, no alerts to you.

Full steps are in `SETUP_NEEDED.md` section 7. The short version: make a
free account at **resend.com**, verify `homes.me` as a domain, make an API
key, then add these in the same Hostinger place as above:

| Name | Value |
|---|---|
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | the word `resend` — not your email |
| `SMTP_PASSWORD` | the `re_…` key |

Then in the CRM: **Settings → Health → Send me a test email.** It tells you
plainly if it worked, and the mail server's own reason if it did not.

---

## 3. Tell me what your agents actually see

They said they cannot log in, and I still do not know why. I cannot reach
crm.homes.me from where I work, so I am guessing, and I would rather not.

Ask one of them, and send me **one** of these:

- the exact words on the screen — *"Wrong email or password"*? a blank
  white page? a spinner that never stops?
- or a photo of the screen.

**And one test that would tell me a lot:** ask them to open
**crm.homes.me/login in a private window**. If it works there, the problem
is an old copy of the app stuck on their phone, and I know how to fix that.

---

## Two passwords that are still leaked

Not blocking your agents, but do them this week. Both were visible in
screenshots, so treat them as public:

- **the Gemini key** — anyone who has it can spend your money
- **the database password**

`SETUP_NEEDED.md` sections 1 and 2, about 10 minutes each.

---

## Where the new Google key goes — about 5 minutes

*Added 13 Nov. The "Homes AI" error you are seeing is the key, not the AI.
The old one was in a screenshot, so it has to be replaced anyway.*

1. Get a new key at **https://aistudio.google.com/apikey**, in the Google
   project that has **billing on** — the paid tier is what keeps your clients'
   messages out of Google's training data.
2. **Check Hostinger first.** hPanel → Websites → crm.homes.me → Advanced →
   Node.js → **Environment variables**. If there is a `GEMINI_API_KEY` there,
   **that one wins over anything you type in the CRM** — so either paste the
   new key there and **Restart**, or delete the line and use step 3. One
   place, not both; this is the trap.
3. Otherwise put it in the CRM: open **crm.homes.me/settings?tab=ai** →
   *Connect* → paste the key → press **Connect**. No restart, nothing in
   Hostinger. It asks Google straight away and tells you on the screen
   whether Google answered, and Google's own words if it did not.
4. The same panel then lists the models your key is actually allowed to use.
   Pick a **"lite"** one — cheapest, and plenty for everything here.
5. Check it took: **Settings → Health**. The row is called **Homes AI**, and
   it turns green when a key is saved and answering.

**Heads up on step 3:** the key box is on the older settings page. The new
**Settings → Homes AI** screen has the monthly budget and what the AI is
allowed to do, but no key box yet — that is mine to finish, not yours.

**Never put the key in chat or a screenshot.** Paste it straight into the
CRM or into Hostinger.
