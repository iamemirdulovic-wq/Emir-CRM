# The leads screens — what I could not build exactly as drawn

*Written 13 Nov 2026 while fixing the nine faults the owner found by hand on
My leads, All leads, the lead page and the transfer form.*

Each line is one thing `design/web/{my-leads,all-leads,lead,transfers}.html`
asks for that the build does not do, and why. Nothing below was guessed at:
where a number or a field does not exist in the database the screen leaves a
blank rather than inventing one, which is the rule that matters most on these
four pages because every figure on them ends up in a conversation with a
client.

The judgement calls that are mine to be overruled on are in
`docs/decisions-to-confirm.md` §32–§35. These are the ones that need something
I do not have.

---

## 1. A thing that was silently broken, and is the real shape of fault 9

`opportunities.lost_reason` is an `ENUM` of five words written in January:
`not_interested`, `budget_mismatch`, `bought_elsewhere`, `unresponsive`,
`invalid`. The lead page and the dialler have offered a different six since
they were built, and MySQL here runs with `STRICT_TRANS_TABLES` — so writing
one of theirs into that column does not round down to NULL, it raises error
1265 and **the whole Lost transaction rolls back**.

So the fault is bigger than it looked. The owner reported that two of the six
reasons were missing. In fact **five of the six could not be recorded at all**:
only "Bought elsewhere" shared a word with the old ENUM. Everything else —
budget too low, just browsing, never reachable, changed their plans, other —
answered with an error, left the lead open, and did it from the moment the
newer list was written.

Migration 0038 adds `lost_reason_v2` beside the old column, the same way
`stage_v2` sits beside `stage_key`, because the migration guard refuses an
`ALTER … MODIFY` on principle (a MODIFY can truncate real values, and these
migrations run unattended against the live database on every push). The old
column keeps being written with the nearest of its own five values, so the
lost-reasons report and Contact 360 go on meaning something.

**Nothing to decide here** — it is simply fixed. It is written down because
any lead marked Lost before today may have the reason the agent did not
choose, and because the report groups on the old column: `budget_too_low` and
`not_into_offplan` both read as the nearest old word there until the report is
pointed at `lost_reason_v2`.

## 2. "Going cold" needed a definition, and I took the office's own

`all-leads.html`'s second tab is **Going cold · 12** and neither the server
nor the design says what it means. The automations page does:
*"Mark leads as 'going cold' — no call, no message and no plan for 7 days"*
(`v2/office-rules.ts`, `markGoingCold`). So the tab is that, exactly, so the
tab and the rule cannot disagree:

* nothing planned (`next_step_at IS NULL`), **and**
* last contact — or the day it arrived, for a lead nobody has ever rung —
  more than 7 days ago.

A lead with a follow-up booked is not going cold however long ago it was last
spoken to, because somebody is coming back to it on a day they chose. **Is
seven days right, and is "never contacted, arrived eight days ago" a cold
lead or a different problem?**

## 3. The reply time on an agent's card is speed-to-lead

The transfer form's cards say **"replies in 3 min"** and the design does not
say what is being measured. I used the only honest thing the database holds:
the **median** time from a lead being given to somebody to that person first
touching it (`assigned_at` → `first_touch_at`), over the last 90 days — the
same figure the profile page already calls speed-to-lead. The median and not
the average, because one lead answered three days late drags a mean into
uselessness.

It is blank for anybody who has not been given a lead in 90 days, rather than
showing a zero. **Did you mean how fast they answer a *client*, rather than
how fast they pick a lead up?** We do not store the second one: each agent
messages from their own phone, so the CRM never sees the reply.

## 4. "Deals this month" counts Won deals, not commission

**`N` deals this month** on an agent's card is the number of their leads with
status Won and a close date inside Dubai's current month. Not the money, and
not anything from Books, which is not built.

## 5. Four things on the lead page the server cannot supply

**The voice-note transcript and "Homes AI found 4 details · Save 4 to lead".**
Nothing transcribes a voice note, and no endpoint extracts fields from one, so
neither is drawn. The AI's three-line notes digest **is** read, and it is what
the "In short" card prints when it exists.

**"Wants" and "Doesn't want" chips.** `opportunities.wants` exists (migration
0036, a VARCHAR(500)) and nothing writes it; there is no "doesn't want" column
at all. Two chip rows on a lead with nowhere to put either of them is worse
than no chip rows, so they are left out. **One column holding both lists as
JSON, or two?**

**Birthday.** There is no column for it anywhere in the schema, so the Info
tab has six rows rather than seven. Say the word and it is one nullable
column.

**The open-transfer row** ("Emir must approve · ends 18:00", with Cancel on
two taps). The transfer *request* is stored; this needs the lead page to read
`lead_transfers` for the lead it is showing, which is a new endpoint. It is on
the transfers screen already, so the information is not lost — it is just not
on the page the agent is looking at.

## 6. The Files tab logs a view twice, on purpose

The design says, in writing on the tab, **"Every view is logged"** and prints
**"viewed 2 times"** on a passport. So opening a file now does both: it bumps
`note_files.view_count` (which is what the number comes from) and writes a
`note.file_opened` row to `audit_log` (which is what answers *who* looked, and
when). Counting audit rows for the number instead would mean a JSON scan of
the whole log on every page load.

"Only you and owners see it" is drawn as a chip on every file in the Passport
& ID folder. **The folder does not yet restrict who may open the file** — the
existing check is "can this person see the lead", which an agent's own manager
passes. Making it literally true is a change to how a file is served and
belongs with whoever next touches `routes/notes.ts`.

## 7. The row menu has no Telegram item

`my-leads.html`'s "⋯" menu has five items and one of them is Telegram. There
is no Telegram anywhere in this build — the lead page's own Telegram button
says "Not yet — phase 6" — and Telegram cannot open a chat from a phone
number the way `wa.me` can; it needs a username we do not hold. The menu has
the other four. See `docs/decisions-to-confirm.md` §29, which asks the same
question about the dialler.

## 8. Three small things I left alone deliberately

**The call and WhatsApp buttons are still plain links.** Another pair of hands
is writing `web/src/v2/call.ts` this week — the shared helper that asks the
check-in question and records the call or the tap before opening the link. It
did not exist while this work was done, so every Call and WhatsApp button on
these screens is untouched and still unlogged. They should all go through that
helper the moment it lands: the two in each table row, the three in the new
side panel, and the two on the lead page.

**Sortable columns.** The design's `data-sort` headers on Lead, Project,
Stage, Agent and Last contact sort the rows on screen. With 50 rows of 863
that would sort the page and not the list, which reads as a broken sort. It
needs an `order` parameter on the list endpoint.

**The notes count on the Notes tab, and the file count on Files.** The design
puts a number on both; this build puts one on Timeline. Both counts are now a
request away — the files endpoint returns them per folder — but the counts
have to be read before the tab is opened, which means fetching the notes and
the files on every lead page load.
