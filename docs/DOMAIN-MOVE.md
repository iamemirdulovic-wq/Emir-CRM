# Moving the CRM to crm.homes.me

From `mycrm.emirdulovic.com` to `crm.homes.me`.

The code side is done. What is left is DNS, a certificate, and telling five
other systems the new address — because a webhook pointed at the old domain
does not fail loudly, it just stops delivering leads.

## What changed in the code

Almost nothing, and that is the point: the address lives in one environment
variable, `APP_URL`. The three places that spelled out the old domain by hand
were the "add to home screen" instructions in **Settings → You**, and those now
read the address off the page the agent is looking at, so they can never go
stale again.

Offer links (`/offer/{slug}`), brochure links (`/b/{project}`) and the client
offer page already build themselves from whatever host they are served on. The
app manifest uses relative paths. There is no CORS allowlist to update, because
the app and the API are the same origin.

`MAIL_REPLY_DOMAIN` is separate and is **not** changed by this. It is the
domain that receives `reply+{conversation_id}@…` email replies, and it only
changes if the mailboxes move too.

## Your steps, in order

### 1. DNS

In whoever manages `homes.me`, add a record for the `crm` subdomain pointing at
the Hostinger server's IP — the same IP `mycrm.emirdulovic.com` points at today.

```
Type  Name  Value
A     crm   <the Hostinger server IP>
```

Give it a few minutes. `dig crm.homes.me` should return that IP before you go on.

### 2. Add the domain in Hostinger, and get a certificate

hPanel → your Node.js app → **Domains**. Add `crm.homes.me` and issue the free
SSL certificate for it.

**Do not skip the certificate.** Meta refuses to deliver webhooks to a domain
whose certificate is invalid, and it does not tell you — leads simply stop
arriving.

### 3. Change one environment variable

hPanel → **Environment variables**:

```
APP_URL=https://crm.homes.me
```

Restart the app. That is the whole code-side change.

### 4. Tell the five systems that call us

Each of these holds our address and will keep using the old one until changed.

| System | Where | New value |
|---|---|---|
| **Meta Lead Ads** | developers.facebook.com → your app → Webhooks → Page → `leadgen` | `https://crm.homes.me/webhooks/meta/leadgen` |
| **WhatsApp Cloud API** | same app → WhatsApp → Configuration → Callback URL | `https://crm.homes.me/webhooks/whatsapp` |
| **Google Ads lead forms** | each lead-form asset → Webhook integration | `https://crm.homes.me/webhooks/google` |
| **property-investment.ae** | their side — tell the website team | `https://crm.homes.me/api/webhooks/property-investment` |
| **Firebase (push)** | console.firebase.google.com → Authentication → Settings → Authorized domains | add `crm.homes.me` |

**Change only the domain in each one — keep the path exactly as it is above.**
The website uses the `/api/webhooks/…` form and the others do not; both work,
but changing a path at the same time as the domain means two things can break
and you cannot tell which.

The verify tokens and shared secrets do not change. Only the address does.

After each one, send yourself a test lead and check it arrives. One at a time —
if you change all five and nothing works, you will not know which.

### 5. Keep the old domain alive

**Do not let `mycrm.emirdulovic.com` stop answering.** Every sales offer your
agents have already sent sits in a client's WhatsApp as a link on the old
domain. So does every brochure link. If the old domain dies, those all go dead,
and the client sees an error rather than the offer they were sent.

Point it at the same app and add a redirect to `crm.homes.me`. Keep it for at
least as long as your longest price-hold deadline — six months is a reasonable
floor, and there is no real cost in keeping it indefinitely.

### 6. Check for the old domain inside your own data

Brochure and document links are stored per project, and if any were saved as a
full address on the old domain they will break with it. This finds them:

```sql
SELECT id, name, brochure_url, image_url FROM projects
 WHERE brochure_url ILIKE '%emirdulovic.com%'
    OR image_url    ILIKE '%emirdulovic.com%';

SELECT project_id, kind, url FROM project_media
 WHERE url ILIKE '%emirdulovic.com%';
```

Anything that comes back, edit on the project page to the new address. If
nothing comes back, there is nothing to do — most of these are the developer's
own links and were never on our domain.

Uploaded files are not affected: they are stored by path on the server's disk,
not by full address, so they follow the app wherever it answers from.

### 7. Tell the team two things

**Everyone will be signed out once.** The session cookie belongs to the old
hostname. They sign in again at the new address; nothing is lost.

**Agents must re-install the app on their phones.** The icon on their home
screen points at the old domain. Until they delete it and add the new one from
`crm.homes.me`, they are using the old address — and on an iPhone that also
means no lead notifications. The install steps are in **Settings → You**, and
they now show the correct address automatically.

## After it is done

Check, in this order:

1. `https://crm.homes.me/health` returns ok.
2. Sign in.
3. The lead board loads, and one lead's WhatsApp history shows.
4. A test lead from the website arrives.
5. Settings → Health shows every integration green.
6. Open an offer link you sent last week on the **old** domain — it should
   redirect, not break.

## If something is wrong

Set `APP_URL` back to `https://mycrm.emirdulovic.com`, restart, and point the
five webhooks back. Nothing is deleted by a domain change; the only thing that
moves is the address.
