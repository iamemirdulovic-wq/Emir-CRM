# Workflows

## The global guards

Every automated message passes `workflows/guards.ts` before it is sent. The
guards are pure functions, and they are the only thing standing between the
system and a compliance problem, so they are tested exhaustively.

| Guard | Rule | Retryable |
|---|---|---|
| DNC | Contact is on the do-not-contact list | no |
| Suppression | The number or address itself opted out | no |
| Consent | No opt-in recorded for that channel | no |
| WhatsApp window | Outside 24 hours, only an approved template | no |
| Agent pause | An agent messaged by hand in the last 24 hours | yes |
| Rate limit | Already 3 automated messages in 24 hours | no |
| Quiet hours | 22:00–08:00 Asia/Dubai | yes, deferred to 08:00 |

Precedence matters: DNC is reported ahead of everything else, and the closed
WhatsApp window ahead of the automation limits, so the logs name the real reason.

Two exceptions, both deliberate:

- **Workflow A's instant reply** may send during quiet hours. A lead who
  submitted a form thirty seconds ago expects an answer.
- **An agent typing by hand** is not subject to consent, quiet hours, the rate
  limit or the pause. It is still subject to DNC and to WhatsApp's window,
  because those are not ours to waive.

---

## Workflow A — instant capture

Target: under 30 seconds end to end.

```
lead ingested
   ├─ 1. assign
   │     sticky owner? ──yes──► keep the existing agent
   │           │no
   │           ▼
   │     weighted round-robin over agents who are
   │     active + available + on shift, preferring
   │     language match, then project coverage
   │           │
   │     nobody? ──► unassigned_queue + alert every manager
   │
   ├─ 2. send lead_welcome_{lang}
   │     document header: the branded brochure (verified projects only)
   │     variables: name, project, agent, company
   │     quick replies: PRICING · LOCATION · CALL_ME
   │     no WhatsApp consent, or the template is not approved → email instead
   │
   ├─ 3. push the agent (deep link + click-to-call)
   │
   ├─ 4. async: lead score, tags, CAPI "valid_lead", arm Workflow B
   │
   └─ 5. SLA timer at 5 minutes
```

**Assignment** runs inside one transaction holding `SELECT … FOR UPDATE` on the
assignment cursor, so two leads arriving together cannot be handed to the same
agent. Within a preference tier the winner is the agent furthest below their
weighted share, which is what makes the split follow the weights over time
rather than merely rotating.

**Exactly once.** The run is claimed with a unique key
(`workflow_runs.singleton_key = 'A:{opportunity_id}'`). A worker that dies after
sending but before marking the job done will retry it, and the retry finds the
claim taken and does nothing. Ten concurrent retries produce one welcome.

### The 5-minute SLA

If the agent has not touched the lead — no stage move, no outbound message, no
note, and no reply from the lead — the card is reassigned to another available
agent, every manager is pushed, and the contact is tagged `ops:sla-breach`. The
breach is recorded on the opportunity for the agent metrics report.

---

## Workflow B — no-response follow-up

The 24-hour window is closed by definition here, so every WhatsApp step uses an
approved template.

| When | WhatsApp | Also |
|---|---|---|
| +2 hours | `followup_2h` | call task, card moves to Attempted Contact |
| +24 hours | `followup_24h` with the **verified** starting price | project email, call task |
| +72 hours | `followup_3d` — Still interested / Not now / Stop | "should I close your file?" email |
| +96 hours | — | mark Lost (unresponsive), move to long-term nurture |

**The price variable comes only from a verified `projects` row.** With no
verified price on file, the step falls back to the generic follow-up rather than
inventing a figure.

### Stop conditions

The sequence is cancelled when any of these becomes true, checked before every
step:

- the lead replies on any channel (`contacts.last_inbound_at` is set)
- the stage moves past Attempted Contact
- the opportunity closes (won or lost)
- the lead opts out

### Fallbacks

A blocked send that is retryable (quiet hours, agent pause) is re-scheduled for
when the block lifts. A send the provider rejects — most often Meta's marketing
limits, error `131049` — falls back to email immediately.

---

## Workflow C — inbound WhatsApp routing

```
inbound message
   ├─ 1. last_inbound_at updated → Workflow B cancelled
   ├─ 2. Attempted Contact (or New Lead) → Engaged / engaged
   ├─ 3. resolve intent
   │        button payload ──► unambiguous, always wins
   │        keywords (EN + AR)
   │        AI classifier ──► only if both fail, and only above a confidence floor
   └─ 4. route
```

| Intent | Action |
|---|---|
| `PRICING` | Prices from the **verified** `projects` row, plus buttons |
| `PAYMENT` | The same verified row — payment plans live there |
| `LOCATION` | A real WhatsApp location message |
| `BROCHURE` | The branded PDF as a document, tracked per agent |
| `CALL_ME` | Urgent push, a 5-minute task, tag `intent:hot` |
| `STOP` | Confirm, then add to DNC and suppress the identifiers |
| `STILL_INTERESTED` | Keep the file open, hand to the agent |
| `NOT_NOW` | Stop the sequence, move to long-term nurture |
| `APPT_CONFIRM` / `APPT_RESCHEDULE` | Update the appointment, notify the agent |
| Unknown | Leave for a human; after hours, one auto-acknowledgement |

**When there is no verified data**, PRICING, LOCATION and BROCHURE escalate to a
human instead of guessing. That is the hard rule, enforced in code rather than
in a prompt.

**STOP confirms first, then suppresses.** Once the contact is on the DNC list our
own guards correctly refuse to message them — including the confirmation. The
acknowledgement is a direct reply inside the open window, and the opt-out is
honoured even if it fails to send.

**Exactly once per message**, claimed as `C:{message_id}`. A retried job would
otherwise reply to the lead twice and create a duplicate call-back task.

### A brand-new number

An unknown number becomes a contact through the normal ingestion path, so it
gets an opportunity, tags, consent and Workflow A like any other lead. The
source is `meta_ctwa` when the message carries an ad referral, otherwise
`whatsapp_direct`. Workflow A skips its template step and replies free-form,
because the 24-hour window is already open.

---

## Reporting quality back to the ad platforms

Stage changes map to lead-quality events, sent to Meta's Conversions API for CRM
and uploaded to Google as offline conversions.

| Stage / sub-status | Event |
|---|---|
| New Lead | `valid_lead` (never for sub-status `invalid`) |
| Attempted Contact | `contacted` |
| Engaged / Qualified, Deal Sent | `qualified` |
| Appointment Scheduled | `appointment` |
| sub-status `showed` | `show` |
| Won, or `reserved` / `spa_signed` / `commission_received` | `reservation` |
| Lost | nothing |

`conversion_events` is unique on `(opportunity, destination, event)`, so a card
that moves back and forth cannot inflate the platform's numbers. Only
Meta-sourced leads go to Meta; only leads with a `gclid` go to Google.

---

## Background jobs

The worker polls the `jobs` table with `FOR UPDATE SKIP LOCKED`, so several
workers can share it without contention. Failures retry with exponential backoff
up to `max_attempts`, then park as `failed` and appear in the health report.

| Recurring job | Interval | Why |
|---|---|---|
| `meta.backfill_form` | 10 minutes | Recovers leads a missed webhook lost |
| `email.imap_poll` | 2 minutes | Threads email replies back into the inbox |
| `templates.sync` | 1 hour | Alerts when a template is paused or rejected |
| `maintenance.cleanup` | 1 hour | Expired sessions, stale job locks, old events |

Schedules are claimed through the same unique dedupe key, so several workers
produce one run per window rather than one each.
