# The leads table, width by width — what was counted

Emir, 14 Nov, on the live site as owner: *"Leads list: project name, Given
date and 'Last contact' header are still cut at 1440 px."*

This is the measurement the column widths come from, written down so the next
person does not re-argue it from taste. The script is
`scripts/leads-columns.mjs`: it counts cells whose text is actually clipped
(`scrollWidth > clientWidth`) over the fifty rows the page draws, per column,
per role, at whatever widths you give it. A column budget that was argued
three times and shipped twice without being counted is how we got here.

Run it against a preview build **started with its own config** — without
`--config vite.config.preview.ts` the preview proxies `/api` to port 3000,
every row is an error card, and the count is a meaningless zero.

## Where it stands

| width | agent's list | owner's book |
|---|---|---|
| 1440 | 18 | 6 |
| 1700 | 13 | 6 |
| 1920 | 13 | 0 |
| 2560 | 5 | 0 |

At 1440 the agent's list was **29**, and 55 at 1700.

## The owner's book — done

Two changes cleared it at the width Emir reported:

- the project cell wraps to two lines (`-webkit-line-clamp:2`), which holds
  "ROSE HILL BY EMAAR" whole in 137px of column;
- the Agent cell drops the face and keeps the name, so "Abdulrahman" and
  "Mohammed" read whole instead of "Abdulra" and "Moham".

The missing face is a deviation from picture 02 and it is Emir's to
overrule — the 45px it wants are not spare anywhere on this row at 1440.

What is left at 1440 and 1700: six long free-text tails in **Attention ·
next step** (*"Due 16 Nov, 21:35 · Waiting on the devel…"*). The date reads
whole, the rest is on hover. From 1920 up the book is clean.

## The agent's list — the 14px, and where they came from

Its project cell cannot wrap: the second line is the unit and budget (§2.3),
and a 52px row holds two 12.5px lines, not three. So the name fits one line
or it is cut, and some column pays.

Counted at 1440:

| plan | total | breakdown |
|---|---|---|
| Lead 230 · Project 152 *(as it was)* | 29 | Project 21 · next step 8 |
| Lead 230 · Project 166 | 23 | Project 10 · next step 13 ✗ |
| Lead 210 · Project 166 | 19 | Project 10 · next step 8 · **Lead 1** ✗ |
| **Lead 216 · Project 166** | **18** | Project 10 · next step 8 ✓ |

The two marked ✗ score well and are each wrong, for a reason that has
already been shipped once:

- **Taking it from the next step.** 168px is not a preference — it is what
  *"Overdue 14 Nov, 12:50"* measures. One pixel under and that cell reads
  "Overdue 14 Nov, 12:…": the red, call-them-now line, cut at the clock.
  Every plan giving the Project more than 166 does this.
- **Taking it from the Lead.** At 210 the column cuts "Mariam Al Suwaidi".
  A cut person's name is the complaint this rebuild started from, and it
  does not become acceptable one column to the left.

216 is where neither happens. The longest name in the data measures 184px,
so the column keeps 32px of headroom — about four characters. **If a longer
name turns up on the live site, this is the number to raise**, and the
Project gives it back.

Two donors that look available and are not:

- **The row's four buttons.** The cell renders 124px whatever width is
  declared on it: the buttons measure 116 and `overflow:visible` lets them
  spill across the sentence rather than shrink. Forcing it to 96 in a test
  looked like the best plan on the board and was the buttons sitting on top
  of the next step.
- **The Stage column.** 96px cuts "Interested" — 25 cells.

## The 1700 band, found while measuring this

At a 1700px window the next-step column was **30px** — not ellipsised,
gone — and fifty cells on the screen were cut, where at 1699 it had 232px
and cut eight. From 1700 up the Project widens to 214 and the row's buttons
took their words (344px), on a card that is only 1,392px; the Stage was
already 204 from 1600. Nobody had looked at the band: 1440 and 1920 are the
two widths anybody tests, and both happen to be fine.

**A MacBook Pro 16" is 1728 by default**, which lands in the middle of it.

Fixed by moving the buttons' words from 1700 to 1920 — `TIGHT` in
`Leads.tsx` and the rule in `v2-no-answer.css`, which must stay the same
number. 1920 is where the next step can hold *"No answer ×2 · try again 16
Nov 00:26"* (267px) **and** the words.

The clock face in Local time comes off below 2000 for the same kind of
reason: 124px holds the clock and "Karachi 16:59" but not the clock and
"Moscow 18:51". Above 2000 the next step has 330px to spare, so the column
takes 144 and keeps its clock. The moon stays at every width — it is not
decoration, it is "do not ring them now".

## Still cut, and Emir's call

The ten longest project names on the agent's list — *"Saadiyat Lagoons by
Aldar"*, *"THE OASIS — PALMIERA BY EMAAR"*, *"Mohammed Bin Rashid City
District One"*. One line cannot hold those at any width this table can
spare; five of them survive even at 2560. The full name is in the hover and
on the lead page.

Three levers would fix them and each changes something Emir asked for, so
none was pulled:

1. **Drop the unit and budget sub-line** from the project cell. The second
   line then belongs to the name and every one of them fits. §2.3 asks for
   *"name on line 1, unit and budget in grey on line 2"*.
2. **Drop the Local time column** at 1440, worth 124px. It is the column
   that stops an agent ringing Moscow at 03:00.
3. **Drop the Given column.** The design's own `my-leads` table has seven
   columns where we draw eight — there is no Given in it at all. §2.5 asks
   to keep it; without it the Project would have 78px more and none of this
   would be a trade.
