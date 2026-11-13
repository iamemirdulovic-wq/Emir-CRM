# Where the v2 build is

Three lines after each phase: what is done, what is not, what failed.
Newest last. Nothing here is live — it is all on the `v2` branch.

---

## Settings · 12 Nov

- **Done.** The settings shell and nav, General (theme, sounds, language,
  office shortcuts), My notifications (~30 switches, quiet hours, VIP
  exception), Company (with the live business-card and offer-footer preview),
  Attendance rules, Homes AI. Per-person notification settings, the attendance
  rules the design asks for, what Homes AI may do, and AI spend per feature
  are all new on the server.
- **Not done.** Team and roles, System health and the Phone app guide show a
  "not built yet" panel inside the real shell. Feedback inbox left out.
- **Failed.** Nothing. Three bugs found by screenshots that the tests could
  not see: every icon inside a styled slot was mispositioned (the design
  styles icons by element name, we render SVG), each settings panel wore the
  wrong page stylesheet, and all seven routes overflowed a phone.

## Sales offers · 13 Nov

- **Done.** The whole screen: stats, tabs with counts, search and filters, the
  list, and the panel with the sheet, the private link, the open-tracking and
  the share buttons. Create, share, mark accepted, delete a draft. Migration
  0037 adds four columns to the existing offers table.
- **Not done.** Nothing from this design file.
- **Failed.** Nothing. One real bug caught before it shipped: the price was
  being abbreviated, so a unit at 2,050,000 read as "AED 2.0M" on a document a
  client holds you to.

## Import · 13 Nov

- **Done.** All six steps. The new one is step 3, a dry run that splits the
  file into new, duplicate and bad **before** anything is written, and says
  who holds each duplicate now. "Agents I choose" now really means those
  agents, which it did not before.
- **Not done.** Paste-from-sheet is on the server but not on this screen.
- **Failed.** Nothing. Three findings: the preflight read its headers through
  a function that does not select them and called every row bad; a row with a
  phone and no name is a lead, not a bad row; and the import folds duplicates
  and bad rows into one counter.

## Automations · 13 Nov

- **Done.** The take-back rule as the design draws it — both clocks, the hours
  they run in, a plain sentence of what it will do, and the leads it actually
  took back today. Plus the ten office rules in three groups. All new on the
  server.
- **Not done.** Nothing from this design file.
- **Failed.** Nothing.

## Calendar · 13 Nov

- **Done.** Month, Week and Day, as the design draws them: the date controls
  and the legend across the top, the grid on the left, and a side column with
  "How did it go?" and the chosen day's plans. A meeting that has finished
  with nobody saying what happened is the one thing on the screen that asks
  something of the reader, and it is in accent at the top.
- **Not done.** Making a plan from this screen opens Tasks rather than a
  panel of its own. Dragging a plan to another time is not built.
- **Failed.** Nothing.
