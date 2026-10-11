# property-investment.ae ↔ Emir CRM

The connection between the website and the CRM. Hand the prompt below to
whoever maintains the site.

There are two directions. **Inbound** is built (this document). **Outbound** —
the CRM telling the site when a lead's stage changes — comes next.

The CRM also has an older, generic `POST /webhooks/website` for plain contact
forms. **Do not use it for this site.** It takes a flat form and has nowhere to
put the matchmaker answers, the viewed projects or the site's own score.

---

## Inbound: `POST /api/webhooks/property-investment`

Also answers on `/webhooks/property-investment`; either address is fine.

```
POST https://mycrm.emirdulovic.com/api/webhooks/property-investment
Content-Type: application/json
X-Signature: <hex HMAC-SHA256 of the exact raw request body>
```

### The event

```json
{
  "event": "lead.created",
  "sent_at": "2026-10-11T08:30:00.000Z",
  "lead": {
    "id": 90210,
    "public_ref": "PI-90210",
    "created_at": "2026-10-11T08:29:40.000Z",
    "status": "new",
    "temperature": "hot",
    "first_name": "Ahmed",
    "last_name": "Khan",
    "phone_e164": "+971501234567",
    "email": "ahmed.khan@example.com",
    "country": "AE",
    "language": "en",
    "source": "organic",
    "cta_location": "project-page-sticky-bar",
    "campaign": {
      "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "saadiyat-2026",
      "utm_content": "hero-a", "utm_term": "abu dhabi off plan",
      "gclid": "GCL-123", "fbclid": "FB-456", "landing_path": "/projects/sei-saadiyat"
    },
    "project": { "id": "p-77", "slug": "sei-saadiyat", "name": "Sei Saadiyat" },
    "request_type": "book_viewing",
    "message": "Looking for a 2 bedroom with a sea view.",
    "matchmaker": {
      "answers": { "budget": "2-3m", "bedrooms": 2, "purpose": "investment" },
      "best_areas": ["Saadiyat Island", "Yas Island"],
      "best_projects": ["sei-saadiyat", "yas-acres"]
    },
    "viewed_projects": ["sei-saadiyat", "yas-acres", "the-sustainable-city"],
    "ai_summary": "Investor, 2BR, AED 2–3M, ready to view this week.",
    "score_reasons": ["matched budget", "viewed 3 projects", "asked to book a viewing"],
    "advisor": { "id": "adv-4", "name": "Site Advisor" }
  }
}
```

`event` is `lead.created` or `lead.updated`. `project`, `matchmaker` and
`advisor` may be `null`. Unknown extra fields are kept, not rejected.

### Two fields that are not in that list, and matter

```json
"consent": true,
"consent_text": "I agree to be contacted about this enquiry on WhatsApp, phone and email."
```

**Send them.** The CRM may not send an automated WhatsApp to someone who has
not consented — UAE PDPL requires it, and Meta bans the number of a brokerage
that messages people who did not ask to be messaged.

A lead with no `consent` field is accepted and stored, and **no instant
WhatsApp goes out**. The agent sees "consent missing" on the card. Since the
30-second WhatsApp reply is the main reason these leads are coming into the
CRM at all, a site that never sends consent turns off the thing it was
connected for. `consent_text` must be the exact wording shown beside the tick
box, not a paraphrase.

### Responses

| Code | Meaning |
|---|---|
| `202` | Accepted. Body: `{ ok, external_id, duplicate }`. |
| `400` | The event did not match the shape above. The response says which fields. |
| `401` | Signature missing or wrong. |
| `503` | The shared secret has not been set in the CRM yet. |

### What the CRM does with it

The lead becomes an ordinary contact and opportunity — the same path a Meta
lead takes — so it is deduplicated against every other source, keeps its
existing agent if the person already enquired, gets assigned, and starts the
follow-up sequence.

`lead.id` is the key. Every event for the same lead updates one record:
`lead.updated` never creates a second lead, and a replayed event is answered
`202` with `duplicate: true` rather than an error, so retrying is always safe.

`created_at` is stored but the CRM timestamps the lead itself. A site clock
running fast would otherwise backdate leads and flatter the speed-to-lead
report, which is the number the sales team is measured on.

The site's `status` is kept separately from the CRM's pipeline stage, and never
overwrites it. The stage is what the agent has actually done.

---

## The prompt to paste into Claude Code on the website repository

> Our CRM accepts leads at
> `https://mycrm.emirdulovic.com/api/webhooks/property-investment`. Send every
> lead there, **in addition to** what we already do — do not change or remove
> the existing handling, the admin panel must keep working exactly as it does.
>
> Send `{ event, sent_at, lead }` exactly as specified in
> `docs/PROPERTY-INVESTMENT.md` in the CRM repository (I will paste it if you
> do not have it). Send `lead.created` when a lead is captured, and
> `lead.updated` whenever its status, temperature, score or matchmaker answers
> change.
>
> **Include `consent` and `consent_text`** — a boolean for whether they ticked
> the box, and the exact wording they were shown. Without them the CRM is not
> allowed to send the automatic WhatsApp reply, which is the whole point.
>
> **Signing.** `X-Signature` is the hex HMAC-SHA256 of the raw request body.
> Serialise the JSON **once**, sign *those exact bytes*, send *those exact
> bytes*. Do not sign one object and let the HTTP client re-serialise another:
> any difference in key order or spacing gives a 401. The secret lives in an
> environment variable, the call is made **server-side**, and the secret never
> reaches the browser.
>
> **Reliability.** Never make the user wait for this and never let it fail a
> form. Call it after the lead is saved to our own database, 5-second timeout,
> retry with increasing delays. Retrying is safe — the CRM answers `202` with
> `duplicate: true` and creates nothing. Log failures loudly.
>
> **Test**: submit a real form on staging, confirm `202`; corrupt the secret,
> confirm `401`; send the same event twice, confirm the second says
> `duplicate: true`. Report all three results and list every place you wired up.

---

## What the owner sets, once

| Where | Name | Value |
|---|---|---|
| Hostinger panel, or the CRM's settings | `PROPERTY_INVESTMENT_HMAC_SECRET` | the shared secret, same as the website's |
| Hostinger panel, or the CRM's settings | `PROPERTY_INVESTMENT_URL` | where to report stage changes back to (used by the outbound half) |

Until the secret is set the endpoint answers `503` and accepts nothing. It will
not quietly take unsigned leads.
