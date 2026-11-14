# The computer lead page — §5 of the 14 Nov fix list

*Built from `design-pictures/Computer-Lead-page.png` and the numbered points
on `04-Computer-Lead-page.png`. Emir's summary of what was wrong:*

> "Raw import tags under the name, no place to write a note, page opens on
> Timeline, German text from Excel in the timeline, Lead # is a code."

*Picture of the result, beside the design: `docs/v2/proof/lead-page.jpg`.*

---

## Done

| § | What it was | What it is now |
|---|---|---|
| 5.1 | The page title was "All leads" | "← All leads" small, the lead's **name** under it |
| 5.2 | `leads_gesamtliste_12nov_f3d5`, `csv_import`, `en` under the name | Only Stage, Score, Hot, VIP, Investor. The tags moved to Info, as words |
| 5.2 | "with Test Agents" | "with Test Agents · since 12 Nov 10:05" |
| 5.3 | — | The middle column in the design's order: WhatsApp line, Next step, In short, Who has had this lead, note box, tabs |
| 5.3d | No place to write a note | A note box above the tabs, always there |
| 5.3e | Opened on Timeline | Opens on **Notes** |
| 5.3a / 5.10 | — | The blue "WhatsApp opened · waiting for your update" line with **What happened?** |
| 5.7 | — | "Who has had this lead" stays, under "In short" |
| 5.8 | "New lead from csv_import" and the sheet's German text in the history | "Imported from a spreadsheet", "Given to Test Agents by import". The file's own columns are on Info under **From the file** |
| 5.6 | A browser-local clock beside a Dubai day | Both Dubai, and the kind of plan in words ("Follow-up", not `follow_up`) |

**The tap outcome was the one real find.** `PATCH /api/v2/taps/:id` has existed
since the calling screen was built and **nothing in the web app had ever
called it**. Every WhatsApp this company sends was recorded as a tap and never
as an outcome, so "sent / replied / no reply / wrong number" was a column of
nulls. The blue line is what asks. Six answers, in words.

**Two note boxes, and why there is now one.** The design draws the box above
the tabs and the Notes tab below it shows only notes. Ours had the box inside
the tab. Putting a second one above gave the page two places to type, so the
one above stands down while the Notes tab is open — the full box (quick
phrases, attachments, voice, "remind me") is two inches below in the same
column. On every other tab the new one is the only one. No feature was
removed, and `web/src/components/LeadNotes.tsx` was left exactly as it was.

---

## Not done, because the data is not there

Each of these is a block in the design picture that cannot be filled from
anything this CRM stores. Nothing was invented and no blank card was left.

### 1. WANTS and DOESN'T WANT chips (§5.5)

`opportunities.wants VARCHAR(500)` exists — added in `0036_v2_foundations.sql`
— and **nothing writes it, nothing reads it, and no endpoint sends it**. There
is no column at all for "doesn't want".

> **Two chip rows, green and red, with "+ Add".** To build them I need:
> **A)** a second column (`opportunities.avoids`), both sent on the lead
> endpoint and editable through the existing `PATCH /api/my-leads/:id/wants`
> (recommended — it is the same shape as the seven lines above it), or
> **B)** leave both out until there is somewhere to put them.
>
> Either way it is a migration and a change to `server/src/leads/wants.ts`,
> neither of which is mine this week.

### 2. "Lead # 4821" (§5.9)

There is **no short, sequential number on a lead anywhere in the schema.**
`opportunities.id` is a UUID, and `#34bf4bfb` — the first eight characters of
it — is what the page shows. That is a database id, which is the thing the
rule at the top of the list forbids.

> **A short lead number needs a column.** `opportunities.ref_no INT
> AUTO_INCREMENT`-style, numbered from 1 for the whole brokerage, filled in
> for the 2,039 leads already there and shown everywhere a lead is named.
> **Recommended**, because an agent reading a number down the phone cannot
> read a UUID. It is a migration; say the word and it is half a day.
>
> Until then the page still shows `#34bf4bfb`. Shortening it differently
> would be a second made-up identifier, and two leads could collide.

### 3. "Best time 12:00 – 14:00 his time" (§5.2)

The CRM knows the lead's country, its timezone and the hours it considers
callable (09:00–20:00 local, in `web/src/lib/dialling.ts`). It does **not**
know a best two-hour window, and nothing in the product has ever defined one.

The line that is there instead is live and says more: "Good time to call them
now", or "Too early there — call after 09:00 Dubai time".

> **What is the best time to call, and where does it come from?**
> **A)** One fixed window for everyone, e.g. 12:00–14:00 their time (say the
> hours and it is one line)
> **B)** Per country
> **C)** Leave the line that is there, which answers "can I call now" rather
> than "when is best" (recommended — it is the question an agent actually has
> with the phone in their hand)

### 4. "Done" on the Next step card (§5.3b)

"Change" works. "Done" cannot, yet: ticking the task behind the next step
(`POST /api/tasks/:id/complete`) does **not** clear
`opportunities.next_step_at`, so the card would keep showing the step it had
just said was finished. The fix is three lines in
`server/src/services/tasks.ts` — clear the lead's next step when the task that
set it is completed — in a file that is not mine this week.

### 5. The voice transcript and "Homes AI found 4 details" (§5.4)

The notes already carry who, when, the type chip, Pinned, the reminder and the
voice player with its speed control. The two the design adds —
**the transcript** under a voice note and **the row of details the AI pulled
out of it** — are not stored anywhere: there is no transcript column and no
table of AI-extracted fields. They need speech-to-text and somewhere to put
the result, which is its own piece of work.

---

## One thing fixed that was not on the list

Every time on this page was printed in the **reader's own timezone** while the
day beside it was worked out in Dubai — so on a laptop in London a task due at
15:00 Dubai read "Today 11:00". Next step, the timeline, "Last spoken to",
every file date and the Coming up card, all of them. They now go through
`civil()` and `formatTime()`, which is what the rest of the CRM uses and what
`CLAUDE.md` requires.

## Files

| What | File |
|---|---|
| the page | `web/src/v2/Lead.tsx` |
| its tests | `web/src/v2/lead-page.test.ts` |
| the title above the name | `web/src/v2/Shell.tsx` — six lines in `TopBar` |
| the hand-over card | `web/src/v2/LeadHandover.tsx`, `server/src/leads/handovers.ts` |
| something to look at | `web/src/preview/mock-api.ts` |
