# Lead notifications on a phone

An agent who is not told about a lead does not answer it. This is how the
telling works, what the owner has to set up once, and what to check when a
phone is silent.

## The honest state of it before this was built

The server half had been in place since Phase 5 and was sending into the void.
Nothing in the browser ever asked for permission or registered a device, so
`push_tokens` was empty and **no agent had ever received a lead notification**.
The server logged `no push tokens registered for user` at debug level, where
nobody was going to see it.

## How it works now

1. An agent opens **Settings → You → Using the CRM on your phone** and presses
   **Turn on notifications**.
2. The browser asks their permission. If they agree, Firebase gives the phone a
   token and the CRM stores it against that user.
3. When a lead arrives, the server posts to Firebase, Firebase wakes the
   service worker, and `sw.js` shows the notification.
4. Tapping it focuses the CRM if it is already open — rather than stacking a
   third tab — and goes to that lead. A notification carrying a phone number
   also offers a **Call** action.

Two notifications about the same contact replace one another rather than
piling up, and a high-priority one stays on screen until it is dealt with.

Firebase is loaded only when somebody turns notifications on: it is about
100 KB, and most of a working day is spent on screens that never need it.

## What the owner sets up, once

Create a free Firebase project at <https://console.firebase.google.com>, then
collect five values.

**Project settings → General → Your apps → Web app** (create one if there is
none; no hosting needed):

| Hosting panel name | Where it is called in Firebase |
|---|---|
| `FCM_PROJECT_ID` | Project ID |
| `FCM_WEB_API_KEY` | `apiKey` |
| `FCM_WEB_APP_ID` | `appId` |
| `FCM_MESSAGING_SENDER_ID` | `messagingSenderId` |

**Project settings → Cloud Messaging → Web Push certificates** → Generate key
pair:

| Hosting panel name | Where it is called in Firebase |
|---|---|
| `FCM_VAPID_KEY` | the public key of that pair |

**Project settings → Service accounts → Generate new private key** downloads a
JSON file. Three fields out of it:

| Hosting panel name | Field in the JSON |
|---|---|
| `FCM_PROJECT_ID` | `project_id` (same as above) |
| `FCM_CLIENT_EMAIL` | `client_email` |
| `FCM_PRIVATE_KEY` | `private_key` — the whole thing, `-----BEGIN` to `-----END`, newlines and all |

Add them in the Hostinger environment panel and restart. All of them, or
notifications stay off: a partly filled set is treated as unconfigured, because
a config the browser accepts and then fails on is worse than none.

**The first five are public.** Google ships them to every phone that opens the
CRM; they identify the project and authorise nothing. **`FCM_PRIVATE_KEY` is
not.** Anyone holding it can send a notification to every agent in the
brokerage, so it never leaves the server, and there is a test asserting it
never appears in the browser's config response.

## iPhone

**Notifications only work once the CRM is on the home screen.** A Safari tab
gets none at all. That is Apple's rule, and no amount of code changes it.

So on iPhone the order is: Safari → Share → **Add to Home Screen** → open it
from the icon → **Turn on notifications**. The Settings panel detects this and
says so, rather than offering a button that cannot work.

Android has no such restriction, though installing is still better.

## When a phone is silent

Work down this list; it is roughly in order of likelihood.

| What the panel says | What it means |
|---|---|
| *Not set up yet* | The Firebase keys are missing or incomplete. Owner's job. |
| *Add to your home screen first* | An iPhone in Safari. Install it. |
| *Off — you will miss new leads* | Nobody pressed the button on this device. |
| *Blocked in your phone settings* | They pressed No once. The CRM cannot ask again — iPhone: Settings → Notifications → homes.me. Android: hold the icon → App info → Notifications. |
| *Not possible in this browser* | An old browser, or a private window. |

A token is per device. An agent with a phone and a tablet turns it on twice,
and turning it off on one leaves the other working.

The CRM quietly re-registers on every sign-in, because browsers rotate these
tokens and an agent who already agreed should not have to agree again. It never
re-prompts someone who said no.

## Where it lives

| File | What it does |
|---|---|
| `web/src/lib/push.ts` | permission, token, register, the device's state |
| `web/public/sw.js` | receives the push, shows it, handles the tap |
| `web/src/components/PhoneApp.tsx` | the Settings panel |
| `server/src/messaging/push.ts` | sends via Firebase, drops dead tokens |
| `server/src/http/routes/users.ts` | `/me/push-config`, `/me/push-tokens` |
