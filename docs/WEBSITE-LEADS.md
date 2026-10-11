# Sending propertyinvestment.ae leads into the CRM

Hand this page to whoever maintains the website. The CRM side is already built
and needs no change — this is entirely work on the website.

Everything below describes `POST /webhooks/website`, implemented in
`server/src/http/routes/webhooks.ts` and `server/src/ingestion/sources/website.ts`.

---

## The prompt to paste into Claude Code on the website repository

> We have a CRM at `https://mycrm.emirdulovic.com` that accepts website leads on
> a signed webhook. I want every lead this site captures to be sent there, **in
> addition to** whatever we already do with it. Do not change or remove the
> existing lead handling — the admin panel must keep working exactly as it does
> now. We will run both for a few weeks before deciding anything.
>
> **Find every place a lead is captured on this site** — contact forms, project
> enquiry forms, callback requests, brochure downloads, WhatsApp click forms,
> landing pages — and send each one to the CRM as well.
>
> **The endpoint**
>
> ```
> POST https://mycrm.emirdulovic.com/webhooks/website
> Content-Type: application/json
> X-Signature: <hex HMAC-SHA256 of the exact raw request body, keyed with the shared secret>
> ```
>
> **Signing — get this right, it is where these integrations usually fail.**
> Serialise the JSON body to a string **once**, sign *those exact bytes*, and
> send *those exact bytes*. Do not sign one object and then let the HTTP client
> re-serialise a different one: any difference in key order, spacing or unicode
> escaping changes the signature and the CRM will return 401. The header value
> may optionally be prefixed `sha256=`; both forms are accepted.
>
> The shared secret is a password. Ask the site owner for it, or generate a
> random 32-byte hex string, show it to them once, and tell them it also has to
> be set in the CRM's hosting panel as `WEBSITE_FORM_HMAC_SECRET`. Store it on
> the website in an environment variable — never in the repository, never in
> client-side JavaScript, and never in a page the browser can read. **The call
> must be made server-side**, because a secret shipped to the browser is not a
> secret.
>
> **The body.** Every field is optional; send what the form actually collected.
> Unknown fields are kept and can be mapped later in the CRM, so extra fields do
> no harm.
>
> | Field | Notes |
> |---|---|
> | `name` / `full_name` / `first_name` / `last_name` | whichever the form has |
> | `phone` or `mobile` | any format — the CRM parses it to +971… itself |
> | `email` | |
> | `message` | whatever the person typed |
> | `project` | the project they enquired about — **important**, it drives routing and the WhatsApp reply |
> | `budget`, `unit_type`, `timeline`, `purpose`, `city`, `language` | if the form asks |
> | `consent` (true/false) and `consent_text` | the exact wording shown next to the tick box. Required by UAE PDPL — send it. |
> | `page_url`, `referrer` | which page they were on |
> | `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | |
> | `gclid`, `fbp`, `fbc` | Google and Meta click/browser ids, if present |
> | `form_id` | a short stable name per form, e.g. `contact`, `project-enquiry`, `brochure`. **Send this** — the CRM reports lead quality per form. |
> | `submitted_at` | ISO 8601. Recorded, but the CRM timestamps the lead itself. |
> | `website` | **honeypot.** Render a hidden input literally named `website`, keep it empty, and pass it through. A real person leaves it blank; a bot fills it and the CRM silently drops the lead. |
>
> **Responses.** `202` means accepted — the CRM processes it after replying, so
> do not wait for anything further. `401` means the signature is wrong. `503`
> means the secret has not been set on the CRM side yet.
>
> **Reliability.** The user must never wait for this call and must never see it
> fail. Make the request server-side after the lead is already saved to our own
> database, with a short timeout (5 seconds), and retry a few times with
> increasing delays if it fails. Retrying is safe: the CRM recognises the same
> person and will not create a second record. If it still fails, log it loudly
> enough that we notice — do not fail the form submission.
>
> **Test it** by submitting a real form on staging and confirming a `202`, then
> deliberately corrupting the secret and confirming a `401`. Tell me both
> results. Then show me a list of every form you wired up.

---

## What happens on the CRM side when a lead arrives

Nothing needs configuring beyond the secret. The lead goes through exactly the
same path as a Meta lead:

1. The signature is checked and the raw payload stored before anything else.
2. The person is matched on phone, then WhatsApp id, then email. A buyer who
   already enquired through Meta does **not** become a second contact, and a
   returning lead goes back to the agent who already owns them.
3. An agent is assigned, and the approved WhatsApp template goes out inside 30
   seconds.
4. The follow-up sequence starts, and stops the moment the lead replies.
5. If nobody touches the lead within 5 minutes, it is reassigned and a manager
   is alerted.

## What the owner has to do, once

Set `WEBSITE_FORM_HMAC_SECRET` in the CRM's hosting panel to the same value the
website uses, and restart the app. Until it is set the endpoint answers `503`
and accepts nothing — it will not quietly accept unsigned leads.
