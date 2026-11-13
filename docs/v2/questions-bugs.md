# Questions and bugs, from the build

*Things a fix ran into that only Emir can settle, and figures the database
cannot yet produce. Each entry says what was decided for now, so nothing is
left silently guessed. Newest at the bottom.*

---

## 13 Nov · Should a level be able to fall? (Best of Homes)

**What was wrong.** The ranking table counted points over thirty days and the
"you are 1st" chip next to it counted all time, so the same person read 377 in
one place and 418 in the other, on one screen.

**What I did.** Made both thirty days, because the page says "last 30 days" in
three places and because the figure people are compared on is the one that has
to be true.

**What I need you to decide.** The level bar under that chip ("Level 4 ·
Steady") now follows the same thirty days, because it prints that number
against the level's own threshold and mixing the two windows would just move
the contradiction. The side effect: **a level can go down after a quiet
month.** Two honest options —

- **A) Leave it.** Level is "how you are doing lately". Simple, and everything
  on the screen is one number. *(What is built.)*
- **B) Level is for ever.** It only ever goes up, counted from the day
  somebody joined, and the card shows two figures — "377 points in 30 days"
  beside "Level 4 · 418 all time". Needs a small change to the screen as well
  as the server.

I would leave it as A until somebody complains, but it is your call.

## 13 Nov · A call from the inbox cannot be recorded yet

Every Call and WhatsApp button now records what it did, through one helper
(`web/src/v2/call.ts`). One button cannot: the round Call button in the inbox
thread header. A call is recorded **against the lead**, and the inbox's own
data carries the contact and the conversation but no lead id, so there is
nothing to attach it to.

Not guessed — a call filed against the wrong lead is worse than a call that is
missing. Fixing it means adding the open lead's id to what the inbox sends back
(`server/src/http/routes/inbox.ts`), which is a change to a screen other
people are working on this week.

## 13 Nov · The new AI settings screen has no key box

`Settings → Homes AI` (`/v2/settings/ai`) has the monthly budget, what the AI
may do, and what it is told about the company — but not the Gemini key itself.
The only place to paste a key is still the older settings page
(`/settings?tab=ai`). Every error the server sends now points at
`Settings → Homes AI`, which is the right menu row for everything except the
key. Worth finishing; written up for Emir in `docs/WHAT_EMIR_MUST_DO.md`.

## 13 Nov · A manager is counted as an agent, but never given a lead

Settled with the headcount fix: **an agent for counting purposes is role
`agent` or `manager`** — so a manager is on the attendance register, in the
dashboard's table, on Team live and on Best of Homes.

Routing is the other way round, and was already: both the instant assignment
(`workflows/workflow-a.ts`) and the bulk hand-out (`assignment/apply.ts`) pick
from `role = 'agent'` only, so **a manager never receives a lead
automatically** — only by hand or by transfer.

That is consistent as long as your managers are meant to work the leads they
are given rather than take their share of new ones. If you want managers in
the round-robin too, it is one line in each of those two files. Left alone
because handing a manager 200 imported leads one morning is not something to
decide on my own.
