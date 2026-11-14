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
