# Webhooks

Every inbound endpoint follows the same order:

1. **Verify the signature.** An unsigned or mis-signed request is rejected with
   401 and never stored.
2. **Store the raw payload** in `inbound_events`, unique on
   `(source, external_id)`.
3. **Respond within 2 seconds** — 200 for Meta and Google, 202 for the website.
4. **Process after the response is flushed**, so a slow Graph API call can never
   cause a retry of a request we already accepted.

A replayed delivery is detected at step 2 and does nothing.

Sample payloads for all of these live in [`/fixtures`](../fixtures) and are
replayed by the test suite, so they stay accurate.

---

## Meta Lead Ads

### Verification handshake

```
GET /webhooks/meta/leadgen?hub.mode=subscribe&hub.verify_token=<META_VERIFY_TOKEN>&hub.challenge=123
→ 200 with the challenge echoed back
```

### Lead notification

```
POST /webhooks/meta/leadgen
X-Hub-Signature-256: sha256=<hmac of the raw body with META_APP_SECRET>
```

```json
{
  "object": "page",
  "entry": [{
    "id": "102938475610111",
    "time": 1774000000,
    "changes": [{
      "field": "leadgen",
      "value": {
        "leadgen_id": "987654321098765",
        "form_id": "1234567890123456",
        "ad_id": "23851234567890123",
        "adgroup_id": "23851234567890124",
        "page_id": "102938475610111",
        "created_time": 1774000000
      }
    }]
  }]
}
```

The webhook carries **only identifiers**. The answers are fetched in a
retryable job:

```
GET https://graph.facebook.com/v21.0/{leadgen_id}
    ?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,
            campaign_name,form_id,form_name,platform,is_organic,field_data
    &access_token=...
```

Custom questions in `field_data` are mapped through the `form_field_map` table,
never hard-coded. Anything unmapped is preserved on the lead and surfaced at
**Templates → Unmapped lead-form questions**.

### Backfill

A cron job runs every 10 minutes against `/{form_id}/leads`, filtered on
`time_created`, to recover anything a missed or late webhook lost. It relies on
the same `inbound_events` uniqueness, so recovered leads are never duplicates.

---

## WhatsApp Cloud API

```
GET  /webhooks/whatsapp      ← the same verification handshake
POST /webhooks/whatsapp
X-Hub-Signature-256: sha256=<hmac of the raw body with META_APP_SECRET>
```

One envelope can carry three things:

### `messages[]` — what the person sent

Handled types: `text`, `button` (template quick reply), `interactive`
(`button_reply` / `list_reply`), `image`, `video`, `audio`, `document`,
`sticker`, and `location`.

```json
{
  "from": "971501234567",
  "id": "wamid.HBgMOTcxNTAxMjM0NTY3...",
  "timestamp": "1774001000",
  "type": "text",
  "text": { "body": "Hi, what is the price for a 2 bedroom?" }
}
```

A message timestamp in the past is honoured — a late webhook genuinely has a
shorter window. A timestamp in the *future* is clamped to receipt time, because
provider clock skew would otherwise push our 24-hour window past Meta's real one
and get free-form replies rejected.

### `referral` — click-to-WhatsApp attribution

```json
"referral": {
  "source_url": "https://fb.me/2abcDEF",
  "source_id": "23851234567890123",
  "source_type": "ad",
  "headline": "Own in Dubai from AED 1M",
  "ctwa_clid": "ARAaZmFrZV9jdHdhX2NsaWNrX2lkXzEyMzQ1"
}
```

A referral makes the lead's source `meta_ctwa` instead of `whatsapp_direct`, and
`ctwa_clid` is stored for Conversions API matching.

### `statuses[]` — delivery ticks

```json
{
  "id": "wamid.HBgLOTcxNDEyMzQ1NjcVAgAR...",
  "status": "delivered",
  "timestamp": "1774002100",
  "recipient_id": "971501234567"
}
```

Statuses only move a message forward (`queued → sent → delivered → read`), so an
out-of-order delivery cannot undo a read receipt. A `failed` status with error
code `131049` (marketing limits) schedules the email fallback.

The idempotency key is `status:{message_id}:{status}`, so the normal progression
is recorded while an identical repeat is ignored.

---

## Website forms

```
POST /webhooks/website
X-Signature: sha256=<hmac of the raw body with WEBSITE_FORM_HMAC_SECRET>
```

Either an HMAC (server to server) or a reCAPTCHA token in the body
(`recaptcha_token`, verified against `RECAPTCHA_SECRET`). At least one of the two
must be configured or the endpoint returns 503 rather than accepting unverified
leads.

```json
{
  "name": "Ahmed Khalil",
  "phone": "050 987 6543",
  "email": "ahmed.khalil@example.com",
  "message": "Looking for a 3 bedroom in Dubai Creek Harbour",
  "project": "Dubai Creek Harbour",
  "consent": true,
  "consent_text": "I agree to be contacted by Emir Real Estate…",
  "page_url": "https://…?utm_source=google&utm_campaign=creek-harbour-2026",
  "utm_source": "google",
  "gclid": "Cj0KCQiA…",
  "fbp": "fb.1.1774000000000.1234567890",
  "form_id": "creek-harbour-enquiry",
  "website": ""
}
```

- `website` is a honeypot. If it is filled, the submission is stored and ignored.
- `consent_text` is stored verbatim against the contact for UAE PDPL.
- `submitted_at`, if sent, is recorded as data but **not** used as the lead's
  creation time. It comes from a site we do not control, and a wrong timezone or
  a cached page would backdate the lead — silently breaking the 30-day
  re-inquiry rule and the speed-to-lead report.

The external id is derived from phone, email, form and the minute of submission,
so a double-clicked form produces one lead.

---

## Google Ads lead forms

```
POST /webhooks/google
```

Google authenticates with a shared key in the body, compared in constant time
against `GOOGLE_LEAD_FORM_KEY`. The key is redacted before the payload is
stored.

```json
{
  "lead_id": "gads-lead-7766554433221100",
  "form_id": 9988776655,
  "campaign_id": 1122334455,
  "gcl_id": "Cj0KCQiA…",
  "is_test": false,
  "google_key": "…",
  "user_column_data": [
    { "column_id": "FULL_NAME", "string_value": "Fatima Noor" },
    { "column_id": "PHONE_NUMBER", "string_value": "+971 55 111 2233" },
    { "column_id": "EMAIL", "string_value": "fatima.noor@example.com" }
  ]
}
```

`is_test: true` is stored and ignored. `gcl_id` is kept for offline conversion
uploads.

---

## Branded brochure links

```
GET /b/{project-slug}?a={agent_user_id}&c={contact_id}
```

Public by design — the lead taps it from WhatsApp. It records the open in
`brochure_views`, notifies the agent (at most once per contact per hour), and
redirects to the file. Only a **verified** project's brochure is served.

---

## Testing a webhook locally

```bash
BODY=$(cat fixtures/website_form.json)
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac 'your-secret' -hex | sed 's/^.* //')

curl -X POST http://localhost:3000/webhooks/website \
  -H 'Content-Type: application/json' \
  -H "x-signature: sha256=$SIG" \
  -d "$BODY"
```

The signature is computed over the **raw bytes**, so the body must be sent
byte-for-byte as it was signed.

## Operational checks

`GET /api/reports/health` (manager and above) reports inbound events by source
and status for the last 24 hours, failing job types, templates that are not
approved, unverified projects, the unassigned queue and cron freshness.
