# Call results and the "no answer" rule — the shared contract

*Written 14 Nov by the coordinator, before any of it was built. Four agents
build against this at once, so it is fixed here rather than invented four
times. If something in it is wrong, say so and I will change it here — do not
quietly build something else.*

Emir's brief is sections A–I of his 14 Nov message. This is only the shape
they share.

## 1. Saving a result

```
POST /api/v2/leads/:opportunityId/call-result
```

```jsonc
{
  "result": "answered" | "no_answer" | "busy" | "call_back"
          | "wrong_number" | "not_interested",
  "callBackAt": "2026-11-15T07:00:00.000Z",  // required only for call_back
  "note": "optional free text"
}
```

Answers **200** with the lead's whole no-answer state afterwards:

```jsonc
{
  "tries": 2,                                 // no-answer/busy tries so far
  "maxTries": 5,                              // from Automations
  "lastTryAt": "2026-11-14T12:20:00.000Z",
  "nextTryAt": "2026-11-15T07:00:00.000Z",    // null when nothing is scheduled
  "exhausted": false,                         // tries >= maxTries
  "whatsapp": { "lang": "en", "text": "…" }   // the "I tried to call you"
}                                             // template, or null
```

- **One tap, no typing** (A.1). Every field above is derived; the agent is
  never asked for any of it.
- `tries` counts `no_answer` and `busy` together — they are both "did not
  speak to them" (A.4).
- Any of `answered`, `call_back`, `wrong_number`, `not_interested` **ends the
  run**: `tries` resets to 0, `nextTryAt` becomes null, and the lead leaves
  the No answer tab (B.4). The history stays in the timeline (A.6).
- `whatsapp.text` is the approved "I tried to call you" template in the
  client's language. **The server never sends it.** The agent taps Send
  WhatsApp himself (A.3).

## 2. When the next try is

From Automations, so the owner can change it (A.7). Defaults:

| After try | Next try |
|---|---|
| 1 | +2 hours |
| 2 | next morning |
| 3 | next evening |
| 4 | +2 days |
| 5 | nothing — ask what to do (A.5) |

`busy` is +30 minutes and does not advance the step (A.4).

Every computed time is moved to the next moment that is **both** inside the
client's waking hours **and** inside our work hours (A.2). The waking-hours
rule already exists — `whenToCall()` / `CALL_FROM`–`CALL_UNTIL` in
`web/src/lib/dialling.ts` and `server/src/leads/countries.ts`. Use it; do not
write a second one.

After try 5 nothing happens on its own. The screen offers **Mark Lost · Not
reachable** or **Give back to Incoming**, and neither does anything without a
tap (A.5).

## 3. What a lead row carries

Every list that draws leads gains one optional field:

```jsonc
"noAnswer": { "tries": 2, "lastTryAt": "…", "nextTryAt": "…" }  // or null
```

Used for the grey `No answer ×2` tag beside the stage, and for the Next step
column reading `No answer ×2 · try again tomorrow 11:00` (B.5).

## 4. The tab

`no_answer` joins `LEAD_TABS` in `server/src/leads/tabs.ts`, between
`no_next_step` and `vip`:

```
Today | New | Overdue | No next step | No answer | VIP | Lost | Won | All
```

A lead is in it when `tries > 0` and the lead is open. Sorted by `nextTryAt`,
soonest first (B.3). It is a *view*, not a stage — nothing about the
pipeline stage changes.

## 5. Settings

In Automations, owner only:

| Key | Default |
|---|---|
| `callTries.max` | 5 |
| `callTries.steps` | `2h`, `next_morning`, `next_evening`, `2d` |
| `callTries.busyMinutes` | 30 |

## 6. Rules that are not negotiable

- **Build on what exists.** `call_logs`, `message_taps` and the dialler's
  outcomes are already there, and `PATCH /api/v2/taps/:id` has existed since
  the calling screen was built with nothing ever calling it. Survey all of
  it before adding a table. A second, parallel record of "did we reach
  them" is how the call numbers went wrong the first time.
- **No emoji anywhere** (E.1). Line icons, the same set as the rest of the CRM.
- **No raw codes on screen.** Never `en`, `no_answer`, `csv_import` or an id —
  always plain English.
- 24-hour time, Dubai time, everywhere.
- Every save writes to `audit_log`.
- Nothing is sent to a client automatically, ever. The agent presses send.
- **Never invent a number.** If a field is not in the data, leave it out and
  say so.
