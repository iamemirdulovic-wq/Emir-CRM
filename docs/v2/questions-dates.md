# Dates on the leads — what was built, and what is left for the owner

*Written 14 Nov 2026, the day Talha sent the owner a screenshot of his leads
list — 105 new leads, every card identical — and said:*

> "Brother, there is one issue — you need to put dates on the leads once they
> assign, so we know which one is today leads, which one is yesterday, and
> which one is day before yesterday."

*The owner confirmed the same day: when an owner or admin gives a lead to an
agent, show that date and time, on the computer and on the phone. He chose
that date deliberately over "when the lead arrived" — the two differ when a
lead moves between agents, and when an old list is imported months after
those people enquired.*

---

## 1. Was `assigned_at` actually populated? Yes — and this was plumbing

`opportunities.assigned_at DATETIME(3)` has been on the table since
`server/migrations/0001_init.sql`. **No migration was needed.** It was simply
never selected into `/api/my-leads`, so it never reached a screen.

Every path that gives a lead to somebody writes it, and I read each one:

| Where | What it writes |
|---|---|
| `ingestion/ingest.ts` | the received time, but only when the lead lands with an owner |
| `workflows/workflow-a.ts` | `NOW(3)` on the instant assignment and on the SLA re-assignment |
| `routing/assignments.ts` | `NOW(3)` when a lead is handed over |
| `http/routes/incoming.ts`, `v2/incoming.ts` | `NOW(3)` when an agent claims one |
| `v2/transfers.ts`, `leads/move.ts` | `NOW(3)` when it is moved to another agent |
| `http/routes/add-lead.ts` | `NOW(3)` on a lead typed in by hand |
| `services/opportunities.ts` | `NOW(3)` on reassignment |
| `assignment/apply.ts` | `COALESCE(assigned_at, NOW(3))` — see §2 |
| `routing/handover.ts`, `leads/move.ts` | `NULL` when the lead goes back to the pool |

So on real-shaped data the column is reliably filled for an owned lead, and
null for one that has never been owned. I could not query the live database
from here, so this is read from the code rather than counted in production;
if the owner wants it counted, the query is one line and I will run it.

**Two honest wrinkles**, both pre-existing and neither introduced by this
change. Both are the owner's to decide, and I have changed nothing:

### 2. A bulk assignment keeps the *first* date, not the new one

`assignment/apply.ts` writes `assigned_at = COALESCE(assigned_at, NOW(3))` in
two places — the bulk "assign these leads" plan, and "claim the next lead"
from the pool. Every other path writes `NOW(3)` flat.

So a lead moved **one at a time** (a transfer, a move, the row menu) shows the
day the new agent got it, which is what the owner asked for. A lead moved in a
**bulk assignment** keeps the day the first agent got it.

That is inconsistent, and only one of the two can be right. I did not change
it, because changing how an assignment is recorded is a change to something
that is working and the rule is to ask first.

> **Which should it be?**
> **A) The new agent's date** (recommended — it is what the owner asked for in
> words: "when an owner or admin gives a lead to an agent", and it is what
> every other path already does)
> **B) The first date** (keeps "how long has this lead been with us at all")
>
> If A, the fix is two `COALESCE(assigned_at, NOW(3))` becoming `NOW(3)`.

### 3. A lead sent back to the pool can keep a date

Three places set `owner_user_id = NULL` without clearing `assigned_at`:
`assignment/apply.ts` (unassign, release a claim, recycle) and
`routing/assignments.ts` (the SLA bounce). `routing/handover.ts` and
`leads/move.ts` do clear it.

The effect on screen is small but worth naming: on the owner's book such a
lead shows **Incoming** in the Agent column with a time beside it. The time is
true — it is when it was last given to somebody — but a reader could take it
for a current assignment. Nothing is invented; it is just older than it looks.

> **Leave it, or clear the date when a lead goes back to the pool?**
> **A) Clear it** (recommended — "Incoming" and a hand-over time next to each
> other say two different things)
> **B) Leave it** (it is the last time it was worked, which has its own use)

---

## 4. What was built, in the three places

**The rule everywhere:** the day is worked out in **Dubai**, at the fixed
+04:00 the rest of this product uses, through `civil()` in
`web/src/lib/calendar.ts`. "Today" means today in Dubai, not on the reader's
laptop — so a lead given at 00:30 Dubai is today's lead to everyone, including
whoever is looking at it from Europe at 20:30 their own yesterday. Times are
24-hour, through `formatTime` in `web/src/lib/format.ts`, which carries the
`hour12: false` the owner asked for by name on 13 Nov.

All the wording lives in one module, `web/src/lib/assigned.ts`, so the three
screens cannot say the same date three different ways.

1. **The v2 computer table** (`web/src/v2/Leads.tsx`) — a **Given** column
   between Stage and the agent. Today's reads `09:00` in ordinary ink;
   anything older reads `Yesterday 16:51` in warm amber with `21 h ago` in
   grey under it. The header is one word because an 11px uppercase `th` with
   letter spacing set the whole column's width; its `title` says which "given"
   it means, and the cell's `title` carries the full date and weekday.
2. **The v2 phone card** — "Given to you 11:42" as the first line of the card
   foot, above the client's local time and the reason line.
3. **The live v1 screen** (`web/src/pages/MyLeads.tsx`) — the same line as a
   third line in the name cell, so the row's grid and its two breakpoints are
   untouched. It reads "Given to you …" to an agent and plain "Given …" to a
   manager or the owner, who is reading somebody else's row.

**All three are grouped by the day the lead was given out**, with a heading
between the groups — `Today`, `Yesterday`, then `Wednesday 12 Nov` — and how
many leads sit under each. That is how the agent described the problem, so it
is the shape of the answer. Newest day first; the order *inside* a day is left
exactly as the server sent it, because the tab decides that and an agent works
down it. The count beside a heading is the whole filtered list's count, not
the rows on this page — the list endpoint sends a `givenDays` facet for it, so
a book of 2,041 leads does not show "50 leads" under every heading.

**A lead with no date says so**: "Not given out yet", in its own group at the
bottom of the list. It never borrows `created_at` or `last_contact_at` — a
blank beats a confident wrong answer, and `assigned.test.ts` holds that rule
with a test that the helper is handed one value and has nothing else to fall
back on.

### What the phone card lost

The **"New Lead" stage chip is gone from a card whose stage is New**. On the
New tab it repeated the heading above the list and it was sitting in the one
piece of space the date could use. Every other stage — Called, Interested,
Meeting, Offer, Won, Lost — still shows, because each says something the rest
of the card does not.

> **Is that the right reading?** The alternative is dropping the chip on every
> card, which would also free the space but would take Meeting and Offer off
> the list with it. Say the word and I will change it either way.

---

## 5. The one thing that did not fit, and what was measured

The v2 computer table at 1440px was already full. With a 248px sidebar the
card is 1148px wide, and at that width the owner's eight columns measured
**1142px of a 1132px content box** — the design is at its limit before a ninth
column exists. Adding "Given" with the whole line on it
("Yesterday 16:30 · 21 h ago", one line, like every other cell in that table)
took the table to **1227px and pushed the page 79px sideways**. The agent's
narrower table went from 1132 to 1195.

Measured in a real browser, not guessed. What was tried, in order:

| Change | Owner's table | Page overflow |
|---|---|---|
| nothing (before this work) | 1142 | none |
| + Given, one line | 1227 | 79px |
| + Given, two lines, cell may wrap | 1150 | none, but 18px outside its card |
| + the card scrolls sideways | 1228 | none |

The third row is where I stopped squeezing: taking another 18px meant letting
the lead name, the project and the agent's name each wrap to a second line,
which is a visible change to a screen nobody asked me to change.

**In the end the leads card scrolls sideways**, which another agent put in
place the same afternoon for the same table (`v2-shell.css`, the `overflow-x:
auto` on `.p-my-leads`/`.p-all-leads .d-table-wrap`), with the first and last
columns pinned. That absorbs the new column with room to spare.

**One consequence of that, which is not mine and is worth the owner knowing:**
making the card a scroll container stops the table's sticky header sticking.
Scrolling the page 600px now takes the column headings off the top of the
screen instead of leaving them pinned. Measured: the header's top goes to
-394px instead of staying at 68px. It is a fair trade for columns that are not
crushed, but it is a trade, and it was not made deliberately as far as I can
tell.

---

## 6. Where the code is

| What | File |
|---|---|
| the wording and the Dubai day arithmetic | `web/src/lib/assigned.ts` |
| its tests | `web/src/lib/assigned.test.ts` |
| the wiring on all three screens | `web/src/v2/leads-dates.test.ts` |
| the field, on the list endpoint | `server/src/http/routes/my-leads.ts` (the `SELECT`) |
| its tests | `server/src/http/routes/lead-assigned-date.integration.test.ts` |
| the computer colours and the heading row | `web/src/styles/v2-shell.css` (base layer, at the end) |
| the phone colours and the heading | `web/src/styles/v2-phone-a.css` (inside the 767px query) |
| the v1 row and heading | `web/src/styles/kit.css`, under "My Leads" |

The warm colour is a token that already existed in each sheet: `--amber-ink`
in the v2 design system, `--att-late` in v1 — the only warm value there picked
for contrast on both themes. No new colour was invented.

---

# Part two — the second date, 14 Nov (later the same day)

*After the "Given out" column shipped, Emir asked for the other half:*

> "We can add like something kind of like, exact date when leads coming from
> admin and owner, always need to show date, and if we have another agents
> like transfer leads date it's need to also showing like on the leads page,
> this leads transfer from this agent with the date, mean 2 dates."

*So: the date the owner or admin first handed the lead out, always visible —
and, when it has moved between agents, the transfer date and who it came from.
Two dates, not one.*

## 7. Which table is the truth, and why

`opportunities.assigned_at` is **one** date: the current holder's. The second
date cannot come off the lead row at all, so it comes from the history. There
are two candidate tables and they can both describe the same move, so one had
to be picked:

| Table | What it really holds |
|---|---|
| `lead_assignments` (migration 0013) | **One row per hand-out.** `agent_user_id` got it, `assigned_by_user_id` handed it over — NULL when the CRM did it by itself, which is the normal case for Workflow A |
| `lead_transfers` (migration 0036) | One row per **request** to pass a lead sideways. Most of them are `pending`, `refused`, `cancelled` or `expired` |

**`lead_assignments` is authoritative.** A refused transfer request is not a
hand-over and must not be drawn as one. When a transfer *is* accepted,
`server/src/v2/transfers.ts` writes a `lead_assignments` row for it inside the
same transaction, so the move is already in the chain exactly once.
`lead_transfers` is therefore read for one thing only: the **reason** the
sending agent gave, which `lead_assignments` has no column for. The reason is
tied to its move by the pair of agents plus a ten-second window around the
decision, and each transfer is spent once, so the same two agents swapping a
lead back and forth cannot have one reason printed twice. Nothing appears in
the block twice.

**No migration was needed**, and none was written.

## 8. Where it is and what it says

A quiet block on the lead page called **"Who has had this lead"**, in the
middle column under "In short" — the column for what has happened. The design
package has no block for a hand-over chain, so it borrows the one idiom the
design does have for a short list of past events with a date on the right: the
Change history's divided rows. It is there for every lead, because the whole
complaint was that a lead carried no date at all.

- **"Given out by Emir Dulovic to Talha Khan · 12 Nov 10:05"** — the first
  hand-out.
- **"Transferred from Talha Khan to Raj Mehta · Yesterday 11:15"**, with the
  reason underneath in plain English ("Too many leads", "Knows the project
  better") and the sentence the agent typed, where there is one.
- A lead that has never moved shows only the first line. A lead nobody has
  been given reads **"Not given out yet"**, in the same words the three leads
  screens use, from the same module.

**Oldest first.** This is a chain of custody, not a log: read down it and the
story arrives in the order it happened, which is the order Emir described it
in — and the left column of the lead page already says who holds it now. (The
page's other list, Change history, stays newest first, because that one *is* a
log and the latest change is the interesting one.)

**Dates are Dubai, at the fixed +04:00, and 24-hour**, through the same
`given()` the leads list uses, with the whole date and its weekday on the
hover.

**Nothing in it is guessed.** Three rules, each with a test:

- `assigned_by_user_id` NULL means the CRM assigned it, so the line says
  "Given out by the CRM" and never names a person.
- A hand-out this CRM recorded without a giver (see §9) gives the date and
  names nobody at all — not even the CRM.
- A transfer with no reason stored shows no reason.

Picture: `docs/v2/proof/lead-history.jpg`.

## 9. The hole this opened up, which is the owner's to close

Not every way of giving a lead out writes a `lead_assignments` row. Five paths
change `opportunities.owner_user_id` and write nothing to the chain:

| Path | What the screen calls it |
|---|---|
| `assignment/apply.ts` — `applyPlan` | the bulk "assign these leads" plan |
| `assignment/apply.ts` — claim | "Claim next lead" from the shared pool |
| `v2/incoming.ts` — `takeLead` | an agent pressing "Take this lead" in Incoming |
| `v2/incoming.ts` — `shareLeads` | "Share the normal leads equally" |
| `leads/move.ts` — `moveLeads` | the row menu's "Give to another agent" |

Each of them does write an `activities` row and an `audit_log` row, so nothing
is lost — but neither of those is a chain, and `incoming.share` logs one audit
row for the whole batch with no lead id on it at all.

So rather than show a blank block on a lead that plainly has an agent, the
block falls back to the lead's own `assigned_at` for the current holder and
says **"Given out to Talha Khan · 13 Nov 13:00"** — the date, and no name,
because the giver was never written down. That is honest, and it is also
visibly less than the line beside it.

> **Should those five paths start recording who handed the lead out?**
> **A) Yes** (recommended — it is five one-line additions of the call the
> other paths already make, `recordAssignment(...)`, and after it every
> hand-over on every lead names a person. It changes nothing that is on screen
> today; it only starts writing a row that is not written now)
> **B) Leave it** (those leads keep showing the date without a name)
>
> Either way it is a change to code that is working, on a system ten people
> use every morning, so nothing was touched.

## 10. The argument this block creates about `assigned_at` itself

§2 above asks which date a **bulk** assignment should keep: `apply.ts` writes
`assigned_at = COALESCE(assigned_at, NOW(3))` in two places, so a bulk move
keeps the **first** agent's date, while every other path writes `NOW(3)` flat.

Now that the lead page carries the whole chain, there is a new argument for
answering that question **A — always the current holder's start.**

The reason to keep the first date was that it was the only record of when the
lead was first given to anybody; overwriting it threw that away. That is no
longer true. `lead_assignments` keeps the first hand-out whatever
`assigned_at` says, and the lead page now shows it. So `assigned_at` is free
to mean one thing and one thing only: **how long has the person holding it now
had it.** That is the question an agent asks of the leads list — "which of
these is today's" — and it is the question the column was added to answer.

**The consequence, plainly:** change it and the "Given" column moves for
every lead that has ever been through a bulk assignment. A lead first handed
out on 2 August and swept into a bulk move on 13 November reads "2 Aug" today
and would read "13 Nov" after. Some leads would jump from the bottom of the
list to the top of it. Ten people read that list every morning, and the one
who complained in the first place reads it hardest.

> **Should `assigned_at` always be the current holder's start date?**
> **A) Yes** (recommended — one meaning for one column; the first date is kept
> in `lead_assignments` and shown on the lead page regardless. It is two
> `COALESCE(assigned_at, NOW(3))` becoming `NOW(3)` in
> `server/src/assignment/apply.ts`)
> **B) No, leave it** (a bulk-moved lead keeps the first agent's date, and the
> column means two different things depending on how the lead was moved)
>
> **Nothing was changed.** It moves numbers on a live system.

§3's question stands too, and this block makes it more visible rather than
less: a lead back in the pool shows "Incoming" in the agent column with a
stale hand-over time beside it, and now the lead page will say "Given out to
…" about an agent who no longer holds it. Clearing `assigned_at` when a lead
goes back to the pool fixes both at once.

## 11. Where the code is (part two)

| What | File |
|---|---|
| which table is the truth, and the reconciling | `server/src/leads/handovers.ts` |
| the endpoint, behind the screen's existing fence | `server/src/http/routes/my-leads.ts` — `GET /:id/handover` |
| its tests, including a real transfer end to end | `server/src/http/routes/lead-handover.integration.test.ts` |
| the block | `web/src/v2/LeadHandover.tsx` |
| its tests, rendered in a browser | `web/src/v2/lead-handover.test.tsx` |
| the three rules it needs | `web/src/styles/v2-shell.css` (base layer, with the lead page's) |
| something to look at in the preview | `web/src/preview/mock-api.ts` |

The reason wording is `REASONS` in `web/src/v2/Transfers.tsx` — the same map
the transfer screen offers, so a reason cannot be worded one way when it is
chosen and another way when it is read back.

---

# Part three — the transfers that did not happen, 14 Nov (§1.5 and §1.6)

*Emir checked the card on the real CRM the same evening:*

> "Lead page 'Who has had this lead': show who gave it ('Given out by <name>
> to <agent> · date time') and every transfer, also cancelled and refused
> ones, with from, to, date, time and reason. Today a cancelled transfer
> (Test Agents to Tej, 13 Nov) does not show on the lead."

> "Transfers page: the When column shows only the day. Show date AND time."

## 12. Why the cancelled one was missing, and what the table really holds

§7 above says `lead_assignments` is the chain and `lead_transfers` only
supplies the reason. That was right about **moves** and wrong about
**history**: the query read `status = 'accepted'`, so a request that was
refused, cancelled or is still waiting left no trace at all. A refused request
is the record of an agent turning a lead down and a cancelled one of a manager
pulling it back. Both are history; neither is a hand-over.

**Checked before building, as asked.** Every field the card needs is really
stored for a cancelled or refused row:

| Field | Stored? |
|---|---|
| from, to | `from_user_id`, `to_user_id` — both NOT NULL |
| reason | `reason` ENUM — **NOT NULL**, so there is always one |
| the note beside it | `note` — optional, shown only when it is there |
| the date and time it was asked for | `requested_at` — NOT NULL |
| the date and time it ended | `decided_at` — set on refuse and on cancel; **null while a request is still waiting**, which is the truth and is shown as such |

So nothing had to be invented. Two things are worth knowing:

- **`refused` does not say who refused.** Two different people can refuse a
  transfer — the agent it was offered to, and the owner whose approval a
  Meeting or Offer lead needs — and the table stores the same `refused` for
  both. The card says "refused" and names nobody rather than guessing.
- **Nothing in this CRM ever writes `expired`.** The ENUM allows it and
  `lead_transfers.expires_at` is set on every request, but no code path turns
  a lapsed request into an expired one; a request nobody answers stays
  `pending` for ever. The card handles `expired` in case that changes, and
  "waiting for Raj" is what an unanswered one reads today.

  > **Should a request that passes its `expires_at` be closed off?** It would
  > be a line in the worker. **Recommended**, because "waiting for Raj" on a
  > request from three weeks ago is not true. Not built — it changes
  > behaviour on a live system.

## 13. What the card says now

- A move still reads **"Transferred from Talha Khan to Raj Mehta"**.
- A request that did not move the lead reads **"Transfer from Test Agents to
  Tej Singh · cancelled"** — the noun, not the past tense — with the reason
  under it, the whole row greyed and the outcome word in amber. Three signals,
  because one is easy to miss.
- The outcome is in English: *cancelled*, *refused*, *ran out of time*,
  *waiting for Raj Mehta*, *waiting for the owner*. Never the stored key.
- The row's date is **when it was asked for**. When it ended is on the hover
  ("Asked Friday 13 Nov 2026, 10:05 · Cancelled Friday 13 Nov 2026, 16:20")
  rather than as a second date on the line.
- Attempts are woven into the chain by date, oldest first, with the moves.

## 14. The Transfers page (§1.6)

`when()` in `web/src/v2/Transfers.tsx` put a clock on today's rows and dropped
it on every older one, so a request from yesterday read "Thu 13 Nov" with no
way to tell one sent before the morning meeting from one sent after it. It now
reads "Thu 13 Nov 10:05". 24-hour, Dubai, like everything else.
