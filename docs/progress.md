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

## Settings pages that had nothing behind them · 13 Nov

- **Done.** Team and roles (people, who has alerts on, what each role can do),
  System health, Phone app, Feedback inbox, Home banners, and the agent's own
  "report a bug" page. Feedback and banners are new on the server, with tests;
  both tables already existed from migration 0036 and had no routes.
- **Not done.** Desks, the business card, manage projects and the messaging
  report are still placeholders.
- **Failed.** Nothing.

## A check for invented class names · 13 Nov

- **Done.** `web/src/styles/design-classes.test.ts`. Every `d-` class a screen
  uses must exist in the ported design stylesheets. A `d-` name that is in no
  stylesheet styles nothing, and it looks right in the code while the screen
  renders unstyled — which had already happened twice on the calendar.
- **Not done.** It cannot see a class that exists but is wrong for the job.
  Only a screenshot catches that.
- **Failed.** Nothing. It found three already-shipped misses: `d-card-t` on
  Add Lead, `d-gap-12` twice, and `d-lt`.

## Tasks and follow-ups · 13 Nov

- **Done.** Two tabs, the week as seven cards each saying how much is left on
  it, the day's list beside the "left today" card, and the follow-ups table
  with its four time tabs. The split between the two tabs is the design's and
  it is a real one: a task is something the agent has to do, a follow-up is a
  promise made to a client, and being late with one is a different kind of
  late.
- **Not done.** Changing or deleting a task from the row menu.
- **Failed.** Nothing.

## The full dashboard, and the screens that had no door · 13 Nov

- **Done.** `design/web/dashboard.html` had never been built — 47 design pages
  and this was the missing one. It is at `/v2/dashboard` now, owner and admin
  only, fed by one new endpoint (`GET /api/v2/dashboard?period=`) with six
  tests behind it: totals, the stage strip with Lost kept apart, fourteen days
  of new leads, projects, sources, the whole team in one table, and the leads
  going cold with a Move button that sends one agent's open leads back to
  Incoming.
- **Not done.** The design's hero is headed "Homes AI · Morning brief" over a
  written sentence. What the server has is counted facts, so the card says
  "Counted from your own data" — its own words — and shows them. No machine
  opinion is dressed up as one.
- **Failed.** Nothing.

## Follow-ups, and the command palette · 13 Nov

- **Done.** The sidebar's Follow-ups row now opens the Tasks page's second tab,
  which is where the design puts it (`tasks.html#follow-ups`). Which tab is
  open lives in the address, so the sidebar can tell which of the two rows
  pointing at `/v2/tasks` to light — React Router cannot, it matches on the
  path alone. `EXTRA_SCREENS` in `nav.ts` is the design's palette list: the
  business card, system health, the install guide, Team live, the full
  dashboard and sixteen more, none of which is in any menu. Search finds them
  now, by name or by the words somebody would actually type.
- **Not done.** Nothing left on this.
- **Failed.** Nothing.

## Two tests that only fail in company · 13 Nov

- **Done.** Found them: both in `src/workflows/workflows.integration.test.ts`,
  about the five-minute rule. Added a read-back check in that file's setup so
  the next full run names the cause instead of failing a hundred lines later.
- **Not done.** The cause itself. Both tests pass on their own, the whole file
  passes on its own (32 of 32), and they fail only inside a full-suite run —
  so it is state leaking between files, not a bug in what they test.
- **Failed.** Three attempts at the cause, which is the limit agreed. Written
  down here and moved on.

## Dead stylesheet rules, counted but not swept · 13 Nov

- **Done.** Counted them: `v2-shell.css` defines 498 `v2-` classes and 227 are
  referenced nowhere in the app — leftovers from every screen's rebuild, since
  a screen rebuilt from its design file stops using the hand-written classes
  it had before.
- **Not done.** Removing them. A blind sweep is not safe: a class built by
  joining strings (`v2-att-` plus a status) reads as dead to a search and is
  not. It needs one careful pass with the collision test as the net.
- **Failed.** Nothing. It costs bytes, not behaviour, and
  `css-collisions.test.ts` is what guards the thing that actually bites.
