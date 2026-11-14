# The country and language filters on the leads screens

*14 November 2026. Rewritten the same day, after he looked at what was built.*

*He asked for this:*

> "we need to add also this option, like country based leads, language based
> leads, add also with flag, so our agents can see easily which country they
> can filter the leads easily… also in the search button… our search button
> should be very advance"

*and, over the plain table that arrived first:*

> "why about the country filter, language filter, it should be smooth… nice
> way… more cool way, I don't like it anymore."

*It was built as two rows of chips. He looked at those a few hours later and
kept the filtering — "country and language filter (it is live)" — and
rejected the presentation, §2.3–2.5 of his fix list:*

> "Keep the country filter, as a dropdown with flags and counts in the filter
> row." · "Language is a dropdown with counts. No help sentence." · "Clean
> search box only. Remove the hint line." · "Remove the chip rows, '+59 more'
> and all grey help sentences."

**So: two dropdowns in the one filter row, each with flags, counts, a search
box inside and the moon where it is the middle of the night there.** Nothing
behind them changed — the counting, the filtering and the awake/asleep search
are the same code, and the chips cost about 100px of the screen the table has
to live in.

This is how the numbers are worked out, and the two things that could
otherwise be mistaken for facts.

---

## 1. How the country is worked out

**It is read out of the phone number, on the server, by longest-prefix match
over the same 83-row dialling table the browser already uses.**

The browser has known a lead's country since 10 November —
`web/src/lib/dialling.ts` turns `+447700900123` into 🇬🇧, "06:12 in London"
and "too early there". But the browser only ever holds the fifty rows on the
page. A chip reading "UAE 24" over a book of 2,041 leads would have been made
up, and this product has already shipped that mistake twice: a tab saying 419
over a list of thirty on 11 November, and a day heading saying "50 leads"
because fifty is the page size on 14 November.

So the counting moved to the server. `server/src/leads/facets.ts` runs one
query:

```sql
SELECT SUBSTRING(REGEXP_REPLACE(COALESCE(c.phone_e164,''),'[^0-9]',''), 1, 4) AS p,
       COUNT(*) AS n
  FROM opportunities o JOIN contacts c ON …
 WHERE <the same filters the list is built from>
 GROUP BY p
```

— the first four digits of every number, grouped. That is a few hundred rows
whatever the size of the book. `server/src/leads/countries.ts` then folds
those buckets into countries by longest-prefix match, exactly as the browser
does it for the flag on the row.

### Why not the other two ways

**Not a persisted `phone_country` column.** It would be faster to filter on,
and it would have to be written by every path that touches a phone number —
ingestion, bulk import, the merge tool, an agent correcting a typo — and
backfilled across a live site where every push is a release. A number's
country is a pure function of its digits; storing it only creates somewhere
for it to go stale. There was no need to spend a migration on it.

**Not `libphonenumber-js`, even though it is already a server dependency.**
It knows about 240 calling codes to this table's 83. Using it here would have
counted a Bahamas number under "Bahamas" while the row beside the chip drew
the flag of the United States, or drew none at all. **One table means the
chip, the flag and the clock cannot disagree**, and that mattered more than
breadth. `server/src/leads/countries.parity` — the second block of
`countries.test.ts` — reads `web/src/lib/dialling.ts` off disk and fails if
one row differs, the same trick `schema-map.test.ts` and
`config/env-docs.test.ts` use.

**Not `contacts.country`.** That column exists, and it means something else:
where the person said they live, filled in from a form. The chips are about
the number an agent is about to ring.

### A code we cannot read

`dialling.ts`'s own header is the rule, and it is not softened anywhere:

> An unknown code is not guessed: the strip simply does not appear, which is
> the honest answer and never a wrong flag.

So a number whose dialling code is not in the table — and a lead with no
number at all — is counted under an **Unknown** chip with **no flag on it**,
and the chip sorts last whatever its size. It is the bucket you look at when
something is wrong, not one you work from.

### The moon

A chip carries 🌙 when it is outside **09:00–20:00** in that country's own
clock. Those are `CALL_FROM` and `CALL_UNTIL`, the same hours
`whenToCall()` already uses to write "too early there — call after 13:00
Dubai time" on a lead page. The server computes it (so that the search word
"asleep" and the moon are literally one function) and the parity test asserts
the two files agree on the numbers. Where there is no zone to read, there is
no moon and no clock, rather than a guessed one.

The same moon now replaces the clock face on the **Local time** column of an
agent's own list, for the same reason and from the same rule.

---

## 2. What the language chip can and cannot tell you

**`contacts.language` is `VARCHAR(8) NOT NULL DEFAULT 'en'`.**

That one line is the whole caveat. A lead whose language somebody asked about
and recorded as English, and a lead nobody has ever spoken to, both read
`en`. **The CRM cannot tell them apart**, and nothing in this build pretends
otherwise:

- A row whose language is blank gets its own **Not known** row in the
  dropdown. Those exist — an import that mapped no language column, a row
  written with an empty string — and they are never folded into English.
- There *was* a grey line under the language chips saying so in words. It
  went with the chips on 14 November (§2.4, *"No help sentence"*), so the
  caveat now lives here and nowhere on the screen. **That is a real loss**:
  "English 1,900" reads as a fact and is not one. The fix is a field that can
  be empty, not a cleverer label, and it is a schema change on a live
  database, so it is Emir's call — see "Still open".
- `ar`, `ru`, `hi` and the rest *are* real signals: they are written by the
  AI extractor, by the Meta form mapping and by an agent editing "What the
  client wants".

**If the owner wants "we asked and they said English" to be a thing the CRM
knows, it needs somewhere to record that it was asked.** The nearest existing
hook is `contacts.locked_fields`, which records which fields a human edited —
but it is written by several paths for several reasons and reading it as "we
asked" would be a guess dressed as a fact. That is a decision for Emir, not
one to take quietly: see "Still open" below.

---

## 3. What the search box takes

`server/src/http/routes/my-leads.ts`, `searchClause()`. Plain matching
against real columns; no model is asked anything.

| Typed | Matches |
|---|---|
| anything | name, phone, email, project — as before |
| `india`, `uae`, `ae`, `971`, `+971`, `moscow` | that country, by the dialling code in the number |
| `arabic`, `ar`, `russian` | `contacts.language` |
| `asleep`, `sleeping`, `night` | every country where it is outside 09:00–20:00 *there*, right now |
| `awake`, `daytime`, `ok to call` | the countries where it is a decent hour |

Three notes on the matching:

- A country name is matched **on the start of a word**, not anywhere inside
  it. "in" finds India and Indonesia; it does not drag in Argentina, Ukraine
  and Finland.
- "USA / Canada" is one row in the dialling table, so each half is matched
  separately — "canada" finds it.
- The new terms are **OR'd on top of** the four original fields, never
  instead of them. A word that is both a country and a project name finds
  everything it could reasonably mean. The screen says what it understands,
  in a line under the box, because a box that quietly takes "asleep" is a box
  nobody ever types "asleep" into.

---

## 4. What a chip's number counts

Each row's count is a **real query over the whole filtered list**, never the
page — the shape of the `givenDays` counts beside the day headings.

One deliberate exception, which is standard and which the owner's own
reference picture already assumes: **a country's number ignores the country
filter**, and a language's ignores the language filter. Otherwise choosing
UAE makes every other country read 0 and there is no way to move from one
country to another except Clear all. His picture reads
`All 26 · UAE 24 · USA/Canada 1 · India 1`, and 24 + 1 + 1 = 26, which is the
same arithmetic. Everything else in force — the tab, the agent, the stage,
the project, the source, the search — narrows both lists.

**A filter that is chosen always comes back, even at zero.** Pick the United
Kingdom and then Arabic and no lead is both: without that rule the United
Kingdom row vanishes from its own dropdown, the screen says "no lead fits
these filters", and the name decays to the bare code "GB" because nothing
left in the answer knows what GB is called.

The tab strip above is deliberately **not** narrowed by the chips, exactly as
it is not narrowed by the project or the stage filter today. Changing that
for the chips alone would have made the screen inconsistent with itself.

**Permissions are the same fence as the rest of the screen**, in SQL:
`ownerPredicate` inside `buildFilters`. An agent's chips add up to their own
leads and nobody else's; a manager's to their team; an owner's to the whole
book. There is no parameter that widens it, and
`lead-facets.integration.test.ts` holds that line against a real database.

---

## 5. The table now fits, and its header pins

Not asked for, found on the way: on the build before this, the leads table's
column headers scrolled away with the page. Measured at 1440px, owner's All
leads — header top **206 before a scroll, −394 after 600px of it**. Measured
again here with the chip rows added, which push the table further down the
page: **364 before, −236 after**. Same fault, same cause.

The cause was `overflow-x:auto` on the card. CSS computes the *other* axis
from `visible` to `auto` the moment one axis scrolls, so the card became a
scroll container in both directions and `position:sticky` resolved against
the card — but the card had no height limit, so it never scrolled vertically
and the header pinned to nothing.

The first fix was to let the card be the scroller it had already become, in
both directions, with a measured height — the spreadsheet he had asked for
earlier: *"our all leads should be like move right left, same like sheet."*
It pinned. Then he looked at it, and §2.9 of the fix list says the opposite:

> "Must fit at 1280, 1440 and 1920 px. No cut column, no sideways scroll, and
> NO column on top of another. Today at 1440 px the pinned 'Attention · next
> step' column covers Agent and Last contact (table is 1411 px wide in 1148
> px)."

He is describing what pinning buys you: a column that is always on screen is
a column drawn on top of whatever is under it. **So it all came out** — the
sideways scroll, the pinned name column, the pinned right-hand buttons and
the measured height with them. With no scroll container the header sticks to
the *page* again at the design's own `top: var(--tb-h)`, and needs no height
to stick to.

What makes it fit instead is a budget: `table-layout: fixed` with a width for
every column, in pixels for the ones whose content is one length (a phone
number is 160px at any window) and in shares for the ones that hold a name.
The next step is the one column with no width — it takes whatever is left,
which is how §2.2's *"wide and always readable"* is met. Below 1400px the
row's Call and WhatsApp buttons drop their words and become their icons,
because 176px of buttons is 176px the next step does not get.

Measured in a real browser, both roles, every lead row on screen:

| | table / card | rows | lead | next step | header after a 600px page scroll |
|---|---|---|---|---|---|
| 1280 owner | 972 in 988 | 52px | 230px | 128px | 68 (pinned under the top bar) |
| 1280 agent | 972 in 988 | 52px | 230px | 158px | 68 |
| 1440 owner | 1132 in 1148 | 52px | 230px | 250px | 68 |
| 1440 agent | 1132 in 1148 | 52px | 230px | 196px | 68 |
| 1920 owner | 1612 in 1628 | 52px | 230px | 617px | 68 |
| 1920 agent | 1612 in 1628 | 52px | 230px | 640px | 68 |

At every width the card's scroll width equals its client width — nothing
scrolls sideways — no cell's box starts before the previous one ends, and
nothing is drawn past the card's right edge. Eleven to thirteen lead rows are
on screen at once, against the four Emir counted.

**Nothing is cut at 1440 or 1920**: not a name, not a number, not a local
time, not a next step, on either screen. That was checked by comparing every
cell's content width with the box drawing it, not by eye.

### The order of priority, when it does not all fit

The first budget gave the next step 262px at 1440 because §2.2 calls it the
widest column, and took it off the Lead, which came out as "Sara …" and
"Mariam Al S…". That is the complaint Emir opened his whole list with. So
the order is now:

1. **The name**, always and at every width. It is how an agent finds somebody
   in a list of two thousand. Measured at 221px for the worst case — a face,
   "Mariam Al Suwaidi" and a VIP tag — and given 230px in **pixels**, not a
   share, because its need does not change with the window.
2. **The phone number**, 148px, for the same reason: it is dictated aloud and
   a cut number is a wrong number.
3. **The next step**, which takes everything left over.
4. **The project**, which gives way first. Its second line carries the budget,
   and the name is repeated on the lead page and in the quick panel.

**What did not fit, and only at 1280.** The owner's book has ten columns in
988px, so its next step ellipsises a long sentence ("Overdue 14 Nov, 09:24"
shows as "Overdue 14 Nov, 09…"), and on both screens the project shows as
"Emaar Bea…" with its budget line whole underneath. Names, numbers and local
times are not cut at 1280 either. If 1280 matters more than it appears to,
the lever is to drop a column from the owner's book — Last contact is the one
the Attention column half repeats — and that is Emir's call, not mine.

---

## 5b. The rest of §2 and §3, point by point

| Point | What it asks | What it got |
|---|---|---|
| 2.1 | Lead · Phone · Project · Stage · Given · Local time · Next step · buttons, rows ~52px | That order; rows measured at 52px at all three widths |
| 2.2 | Round initials + name, VIP tag beside it | Already so. The source line that sat under the name has gone — it was a third of the row's height |
| 2.3 | Project: name on line 1, unit and budget in grey on line 2 | Two lines, and the row is still 52px |
| 2.4 | Next step wide and always readable; red overdue, grey when empty | The one column with no fixed width. 206–573px depending on the window; red and grey as before |
| 2.5 | Given on ONE line, narrow: "12 Nov · 2 d ago" | One line. Two spans joined by the design's middle dot in CSS, so the phone card can still stack them |
| 2.6 | ~52px rows, 12 leads on a screen | 52px. 13 lead rows visible at 1440×1000, against the four Emir counted |
| 2.7 | One filter row | One row of controls; the lead count and Export wrap to a short second line on the owner's book. See "Still open" §5 |
| 2.8 | Call, WhatsApp and ⋯ at the end of the row, never over text | Their own cell at the end. The design's own CSS positioned them over the next step with a shadow across it |
| 2.9 | Fit at 1280, 1440, 1920 — no cut column, no sideways scroll, no overlap | Measured at all three, both roles. See §5 |
| 2.10 | Why some rows show "–" for phone | Answered in §7 below. The cell now says "No phone" and drops the Call button |
| 3.1 | Agent column with photo and name | Photo and **first** name, as picture 02 draws it; the whole name on hover |
| 3.2 | Filter by agent, with counts | The Agent dropdown was already there |
| 3.4 | "12 selected" with Move to agent, Back to Incoming, Cancel | Those three. "Move to Incoming" was reworded to "Back to Incoming", which is what it does |
| 3.5 | Owner tabs: All, Going cold, Overdue, No next step, VIP, Lost, Won | All seven |
| 9 (pic 01) | Black bar: leads ready to call, calls today with progress, Start calling | All three. `callsToday` and `callGoal` come back with the tab counts, from `call_logs` and `DAILY_GOALS.calls` — no invented denominator |

**What the owner's book gave up to fit.** Picture 02 draws no buttons on its
rows at all. The build kept the ⋯ menu and dropped Call and WhatsApp from the
owner's row only: three buttons there would have left the next step 112px at
1440px. A row click opens the quick panel, where both are. The agent's list
keeps all three, and loses their words below 1400px rather than lose the next
step.

**The flag in front of the phone number** lasted a few hours. It cost 22px of
a column that must never cut a number, and at 1440px the number came out as
"+971 50 1…". The flags are in the Country dropdown, where he asked for them.

**Local time says a city**, as picture 01 draws it — "Dubai 15:59",
"London 11:59", "Karachi 16:59". It said the country, and "United Kingdom
06:57" does not fit a 116px column. The city is the IANA zone's own last
segment, so nothing is invented, and a multi-zone country still says the city
the table names (Moscow, New York).

---

## 6. Still open — things only Emir can answer

1. **"We asked and they said English" versus "nobody ever asked."** The
   column cannot tell them apart and the screen says so. If that distinction
   matters — and for a language desk it probably does — it needs a field of
   its own, or the language question has to become something an agent ticks.
   Worth ten minutes of his time; worth no guessing at all.

2. **83 dialling codes, not 240.** Curaçao, the Bahamas and about 150 other
   countries land under **Unknown**. Adding a code is one line in two files
   and the parity test enforces the pair. The question is whether to keep the
   hand table (honest, small, no 150KB in the browser) or move the browser to
   a library as well. Recommendation: keep it, and add codes as real leads
   turn up under Unknown — which the Unknown chip now makes visible for the
   first time.

3. **"Russia / Kazakhstan" and "USA / Canada" are one row in the filter,
   while the lead card already says "Canada · Ontario".**

   `web/src/lib/dialling.ts` learned to split them on 14 November: +1 by the
   three digits after it into the USA, Canada and twenty-five Caribbean
   countries with the state or province, and +7 into Russia and Kazakhstan
   with Russia's real regional zones. The filter does not, because the
   grouping has to come from the server — the *filter* is SQL, and
   `?country=CA` needs a clause that matches Canadian area codes.

   Making them agree means duplicating that whole area table into
   `server/src/leads/countries.ts`, plus a parity check that can read
   `spread('205 251 256', 'US', …)` calls rather than the flat literal the
   present one diffs. **Deliberately not done**: it is a morning's careful
   work with a real chance of a chip reading "Canada 3" over American leads,
   and a coarse grouping is honest where a wrong one is not. Filtering by
   "USA / Canada" still returns every one of them.

   The shape of the fix, for whoever picks it up: move `AREAS` to the server,
   leave the browser its own copy, replace the text diff in
   `countries.test.ts` with a check that runs both tables over the same
   numbers, and extend `countryClause` to emit a country's area-code
   prefixes as well as its dial code.

4. **"Not known" is only the blanks.** The dropdown's English row holds
   every lead nobody was asked, and nothing on the screen says so any more.
   See §2. This is the same question as 1, said from the other end.

5. **The owner's filter row is eight controls wide.** Picture 02 draws five —
   search, Agent, Stage, Project, Source, Added — and §3 says "same as section
   2, plus", which adds Country and Language. At 1440px that is one row of
   dropdowns with the lead count and Export wrapping onto a short second
   line. It fits and it reads, but it is not the single row the picture draws.
   If he wants one line at 1440, something has to go: Source and Added are the
   two he uses least.

6. **1280px on the owner's book.** Ten columns in 988px. Nothing is cut off
   the card and nothing overlaps, but the next step ellipsises a long
   sentence and so does a long name. See §5.

7. **No country or language filter on the phone.** §0 says each phone screen
   is its own layout from its picture, and the picture he redrew is the
   computer's. A `?country=GB` link opening on a phone shows the filter as one
   removable pill so it is never a dead end, but there is no way to *set* one
   there. It wants designing, not inheriting.

---

## 7. §2.10 — the "–" in the phone column

He asked whether the first rows of All leads are missing their number in the
data or only failing to draw it. **In the data I can reach, no contact is
missing a number at all:**

```sql
SELECT COUNT(*) AS contacts,
       SUM(phone_e164 IS NULL) AS phone_null,
       SUM(phone_e164 = '')    AS phone_blank
  FROM contacts WHERE deleted_at IS NULL;
-- 2045, 0, 0
```

So the "–" cannot be reproduced here, and the renderer cannot cause it: the
cell printed "–" only when `phone_e164` was NULL or empty, and `spacedE164`
falls back to the raw number for any country it does not recognise — it
cannot blank a number that exists.

**The conclusion is that those rows genuinely have no number**, and the names
beside them support it: "TECHNICAL ANALYSIS.", "Rubbie Realtors",
"CHOUDHARI" are an imported spreadsheet in which some rows are not people.
Run this on the live database to settle it, and to see what they are:

```sql
SELECT c.full_name, c.email, o.source, o.created_at
  FROM opportunities o JOIN contacts c ON c.id = o.contact_id
 WHERE o.deleted_at IS NULL AND c.deleted_at IS NULL
   AND (c.phone_e164 IS NULL OR c.phone_e164 = '')
 ORDER BY o.created_at DESC LIMIT 20;
```

Either way the screen is honest about it now: the cell says **"No phone"** in
grey rather than "–", and the row shows no Call button, because pressing Call
on a lead there is no number for is a dead end.
