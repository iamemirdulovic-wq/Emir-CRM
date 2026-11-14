# The no-answer rule, on the server

*Built 14 Nov 2026. The shape is `docs/v2/call-results-contract.md`, which four
agents built against at once — read that first for what the screens expect.
This is the engine behind it: where the numbers come from, and the decisions
that are easy to undo by accident.*

Emir's section A, in his words: *"One tap on 'No answer' saves a call try with
date and time and counts it: 'No answer · try 2 of 5'. No typing. It makes the
next follow-up by itself: try 2 after 2 hours, try 3 next morning, try 4 next
evening, try 5 two days later. Only when the client is awake and inside our
work hours."*

The whole engine is `server/src/v2/call-results.ts`. The addresses are
`server/src/http/routes/call-results.ts`.

## It added no table and no column

This is the part worth keeping. Everything the rule needs was already in the
database, and a second record of "did we reach them" is how the call figures
went wrong the first time.

| What the rule needs | Where it lives | Why not a new column |
|---|---|---|
| `tries` | `opportunities.no_answer_count` (migration 0017) | Already counted up by `runLeadAction` for a no-answer, and for a busy, because `v2/calls.ts` has always mapped busy onto the same action. The contract's "tries counts the two together" was already true in the database. |
| `nextTryAt` | `opportunities.next_step_at` | The one promise a lead carries. It is what the Today and Overdue tabs are built from, and the existing next-step editor is already "the agent can change the time with one tap" (A.2). |
| `lastTryAt` | newest `activities` row of type `no_answer` | **Not `call_logs`.** That table is written by the dialler only, so a result logged from the lead page has no row in it. `activities` is written by every path, because they all go through `runLeadAction`. |
| the undo's before-state | `audit_log.before_json` | It is already a before/after journal of every change. |
| the owner's numbers | `app_settings` through `saveSetting` | `name` is `VARCHAR(64) PRIMARY KEY`; a new key needs no DDL. |

**The one hole that had to be closed:** `no_answer_count` had been counted up
since January and never once counted down, so a lead rung three times in March
still read 3 after the client answered in April. Invisible while it only fed an
AI prompt; not invisible now it reads "try 2 of 5" on a card. `ENDS_A_RUN` in
`server/src/leads/actions.ts` puts it back to zero — deliberately there and not
in the new code, so the dialler, the lead page's own buttons and the new
endpoint all agree. `whatsapp` is excluded: a tap on WhatsApp is not evidence
anybody read it.

## The ladder

`nextTryFor()` is the whole rule and it is pure, so the awkward cases are
settled in a test rather than argued about from a screenshot.

| After try | Next try | Setting |
|---|---|---|
| 1 | +2 hours | `callTries.steps[0]` |
| 2 | next morning (11:00) | `steps[1]` |
| 3 | next evening (17:00) | `steps[2]` |
| 4 | +2 days, in the morning | `steps[3]` |
| 5 | nothing — a person decides (A.5) | `callTries.max` |

- **11:00 is the owner's own number**, from A.3's example line ("next try
  tomorrow 11:00"). 17:00 is the evening: late enough to catch somebody,
  inside our hours either way. Both are constants in one place.
- **A busy line counts as a try and never takes a rung.** `tries` goes up —
  "try 2 of 5" has to be honest about how many times we rang — and the wait is
  always `callTries.busyMinutes`, so five busy signals in an afternoon cannot
  burn the ladder the owner set for a phone nobody answers.
- **A ladder shorter than `max` repeats its last rung** rather than stopping
  early, so shortening the list in Automations cannot silently drop the last
  follow-ups.
- **After the last try nothing happens on its own.** The promise is cleared, so
  the lead sits in both No answer and No next step, where a person can see it
  is waiting on a decision. The server never marks it Lost and never returns it
  to Incoming; those are the screen's two buttons and both need a tap.

## The hours, which are two windows and not one

`fitToHours()` moves a computed moment forward until it is inside **both**:

- the client's own waking hours — `CALL_FROM`–`CALL_UNTIL` and `isNight()` in
  `server/src/leads/countries.ts`, the same rule as the moon on a lead card and
  the word "asleep" in the search box;
- our working hours — `WORK_START_MINUTE`–`WORK_END_MINUTE` (09:30–19:30) in
  `server/src/leads/next-step.ts`.

Neither is rewritten here; both are imported. **Do not write a third copy of
either.** `call-results.test.ts` sweeps five time zones × all 24 Dubai hours ×
tries 1–4 × no-answer and busy and checks every answer against both windows,
which is the only way to test a rule whose output depends on what time of day
it is asked.

It returns **null** when there is no such moment inside a week. That is
possible — a client whose waking hours mirror our office day has no overlap at
all — and the honest answer is to promise nothing and leave the lead for a
person, not to schedule a call that breaks the rule we just wrote.

## One tap, one record

There was a second schedule until this was built. `PATCH /api/v2/calls/:id`
(`finishCall`) had its own table — two hours for a no-answer, one for a busy —
written before the rule existed, so the same tap gave a different follow-up
time depending on which screen it was pressed on, and the Automations numbers
changed one of them and not the other. **`finishCall` now hands the outcome
straight to `saveCallResult`.** The dialler's screen was deliberately *not*
moved to the new endpoint instead: that would have left the old path alive for
the next person to find, which is exactly how `PATCH /api/v2/taps/:id` sat
unused for months while every WhatsApp went unanswered.

`saveCallResult` takes an optional `callId`. Given — the calling screen already
starts calls through `POST /api/v2/calls` — the outcome is written onto *that*
row. Left out, one row is written here. Either way there is one record of the
call and never two.

## Taking one back (§1b)

`DELETE /api/v2/leads/:id/call-result` restores the fifteen columns a result
can touch, read out of the audit row's `before_json`: the try count, the
promise, the stage, the sub-status, the status and the lost reason. So undoing
a wrongly-tapped **Not interested** brings the lead back out of Lost, not just
the counter back to 2.

- Only the agent who saved it, or an owner or admin. A manager who can see the
  lead may not rewrite somebody else's call.
- Only the latest result, and only within `UNDO_WINDOW_MINUTES` (10). After
  that it answers **409 with a sentence a person can read**, never a silent
  failure.
- Nothing is erased. The timeline row is retitled "… — taken back" and flagged
  in its `meta`, and the per-agent figures stop counting it because they read
  the same flag.
- "Already taken back" is decided by whichever of `lead.call_result` and
  `lead.call_result_undone` is the newer audit row, so no audit row is ever
  mutated.

## The settings (owner and admin)

`GET` / `PATCH /api/v2/call-tries`. Stored as three rows in `app_settings`:
`CALL_TRIES_MAX` (5), `CALL_TRIES_STEPS` (`2h,next_morning,next_evening,2d`)
and `CALL_TRIES_BUSY_MINUTES` (30). The GET also returns the defaults and every
rung **with its words** ("Next morning", not `next_morning`), so no screen
writes a raw value at a person. A stored value that cannot be read falls back
to the defaults whole, never to the half that parsed.

`GET /api/v2/call-tries/report?period=today|week` is H.1: tries and leads per
agent, role-scoped, counted from `activities` so every path is included and a
result taken back is not. "week" is the last seven Dubai days, the same window
`v2/messaging.ts` uses, so "this week" means one thing in both places.

## Two things to know before you touch it

- **`call_logs.outcome` has no `answered` value.** The ENUM from migration 0036
  is `interested|no_answer|busy|call_back|wrong_number|not_interested`, and
  widening it is `ALTER … MODIFY`, which `migrations.safety.test.ts` refuses
  and is right to. So the contract's `answered` stores `interested` **in that
  column only**. The one place that reads it already reads it as "the call
  connected" (`v2/home.ts` counts `outcome IN ('interested','call_back')` as
  the day's answered calls), and the lead is moved by action `call`, so nothing
  claims the client is interested: the timeline says "Called". It is still a
  fib in a raw column. The fix is an additive `outcome_v2 VARCHAR(24)` beside
  it, and it is waiting because no new migration can reach the live database
  until `0038_meeting_results.sql` stops failing on every boot.
- **An undo of a Lost does not un-cancel the tasks** that
  `cancelTasksForClosedLead` closed with the lead. The lead, its stage and its
  promise come back; a task closed ten minutes ago stays closed.

## Tests

```
cd server && TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3306 \
  TEST_DB_USER=crm TEST_DB_PASSWORD=crmtest \
  npx vitest run src/v2/call-results.test.ts src/v2/call-results.integration.test.ts
```

33 unit and 28 integration. A run that says "skipped" has not touched the
database and has not tested any of this.
