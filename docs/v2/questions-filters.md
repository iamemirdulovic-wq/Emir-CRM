# The country and language filters on the leads screens

*14 November 2026. Written while building the chips Emir asked for:*

> "we need to add also this option, like country based leads, language based
> leads, add also with flag, so our agents can see easily which country they
> can filter the leads easily… also in the search button… our search button
> should be very advance"

*and, over the plain table that arrived first:*

> "why about the country filter, language filter, it should be smooth… nice
> way… more cool way, I don't like it anymore."

This is what was built, how the numbers are worked out, and the two things
the screen says plainly because they could otherwise be mistaken for facts.

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

- The **English** chip is labelled English, and a line under the row says so
  in words: *"English is what the language field starts as, so that chip also
  holds every lead nobody has been asked."* It is on the screen, not in a
  tooltip, because a default presented as a fact is the kind of number this
  product has already been caught inventing.
- A row whose language is blank gets its own **Not known** chip. Those exist
  — an import that mapped no language column, a row written with an empty
  string — and they are never folded into English.
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

Each chip's count is a **real query over the whole filtered list**, never the
page — the shape of the `givenDays` counts beside the day headings.

One deliberate exception, which is standard and which the owner's own
reference picture already assumes: **a country chip's number ignores the
country chip**, and a language chip's ignores the language chip. Otherwise
choosing UAE makes every other country read 0 and there is no way to move
from one country to another except Clear all. His picture reads
`All 26 · UAE 24 · USA/Canada 1 · India 1`, and 24 + 1 + 1 = 26, which is the
same arithmetic. Everything else in force — the tab, the agent, the stage,
the project, the source, the search — narrows both rows.

The tab strip above is deliberately **not** narrowed by the chips, exactly as
it is not narrowed by the project or the stage filter today. Changing that
for the chips alone would have made the screen inconsistent with itself.

**Permissions are the same fence as the rest of the screen**, in SQL:
`ownerPredicate` inside `buildFilters`. An agent's chips add up to their own
leads and nobody else's; a manager's to their team; an owner's to the whole
book. There is no parameter that widens it, and
`lead-facets.integration.test.ts` holds that line against a real database.

---

## 5. The table's header, which had stopped pinning

Not asked for, found on the way: on the build before this, the leads table's
column headers scrolled away with the page. Measured at 1440px, owner's All
leads — header top **206 before a scroll, −394 after 600px of it**.

The cause was `overflow-x:auto` on the card. CSS computes the *other* axis
from `visible` to `auto` the moment one axis scrolls, so the card became a
scroll container in both directions and `position:sticky` resolved against
the card — but the card had no height limit, so it never scrolled vertically
and the header pinned to nothing.

The fix is to let the card be the scroller it had already become, in both
directions, with a height to scroll against. Both scrollbars now live on the
card, the header pins to its top edge and the name column pins to its left,
which is the spreadsheet Emir asked for: *"our all leads should be like move
right left, same like sheet."*

The height is **measured, not guessed**. `useSheetHeight` in `Leads.tsx`
reads where the card really starts and gives it the rest of the window. A
`calc(100dvh − 300px)` would have been a guess about chrome that moves: a tab
strip, a filter row, two rows of chips, and a start-calling strip that is on
Today and nowhere else. It is a `max-height`, never a `height`, so a list of
three leads keeps the height of three leads instead of sitting in a tall
empty box; and it stops shrinking at 360px, below which the page scrolls
instead, because a 200px sheet is not a sheet.

Measured after, in a real browser, scrolling the card 600px:

| | header before | after page scroll | after card scroll |
|---|---|---|---|
| 1440×900 owner | 343 | 323 (page had only 20px to give) | **343** |
| 1440×900 agent | 413 | 393 | **413** |
| 1024×768 owner | 343 | 323 | **343** |
| 1024×768 agent | 453 | 368 | **453** |

In every case the first body row moved up by 600px while the header did not
move at all. That is pinning.

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

3. **"Russia / Kazakhstan", "USA / Canada".** Two countries under one chip,
   because `+7` and `+1` do not distinguish them without going deeper into
   the number than this table goes. The name says both rather than picking
   one, and the clock is labelled with the city it belongs to — "15:30 in
   Moscow" — rather than implying a country spanning eleven zones is on one
   clock. If Emir wants Kazakhstan split out, `libphonenumber-js` on the
   server can do it, at the cost of the browser's flag no longer agreeing
   with the chip unless the browser gets the same knowledge.

4. **How many chips before the row folds.** Eight today, then "+N more". His
   own export runs fifty-odd countries, and fifty pills is a wall rather than
   a filter. Easy to change.
