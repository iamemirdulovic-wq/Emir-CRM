## Group 2 — plan, attendance and transfers

*Audit written 13 Nov 2026 against `design/screens/*.dc.html` at 390 × 844 and the
preview build at `http://127.0.0.1:5182` at the same size. Audit only — no source
file was changed. Colour is not part of this audit; the prototypes are in the
retired green look. Layout and content are.*

**The prototypes do not run their own runtime.** `design/screens/support.js` is
missing from the repository, so a screenshot of a `.dc.html` file shows every
conditional branch stacked at once and `{{…}}` as literal text. Everything below
is therefore read from each file's `<body>` and its `<script type="text/x-dc">`
block, which is where the behaviour and the wording live, with the screenshots
used only to confirm shape.

**The build moved while this was being written.** The screens were measured
between 08:43 and 08:58; somebody landed a phone-shell header
(`v2-phone.css` + `phone.tsx`, `.v2-phone .v2-ptop`) in the middle of that.
Everything below was re-measured at 08:58 and still holds, except where the
shell note says otherwise.

### What all twelve share, and what the build does instead

- **The header.** The design has no app bar: every screen draws its own header as
  the first thing in the scroller and it scrolls away — a round 44px white back
  button with a hard-coded parent, an `<h1>` at 30px/800, and under it a 13px
  subtitle that carries the live count ("Shift 09:00 – 18:00 · Business Bay
  office", "3 left today · 1 overdue", "Promises you made to clients"). As of
  08:58 the build matches the first two: `.v2-ptop` computes `position: static`
  with a 30px/800 title and a 44px round back button. **The subtitle is still
  missing on all twelve.** `phone.tsx` has the slot for it — `usePhoneHead({ sub
  })` — and no screen in this group passes one. Each block below therefore loses
  its subtitle line; it is not repeated every time.
- **The design's single round action button** sits on the right of the header
  (`+ Add event` on Calendar, `+ Add task` on Tasks). `usePhoneHead({ action })`
  now exists for exactly this, but of these twelve only Calendar uses it — and it
  points at `/v2/calendar?new=1`, which `Calendar.tsx` never reads, so the button
  does nothing. On the other eleven the `+` in the header still means **Add
  lead**.
- **The check-in gate.** In the design the dial button is a `<button>` that opens
  the gate sheet when the agent is not checked in, on all twelve of these
  screens, and the sheet's three ways out and the exemption line are identical
  everywhere. In the build (`check-in.tsx`) the gate is only wired to
  `/v2/calling`; the floating dial button is a plain `<Link to="/v2/calling">`
  and the per-row call buttons on Follow-ups do not exist at all.
- **Bottom bar.** Same five items in the same order (Home · Leads · Calendar ·
  Tasks · More) plus the dial button beside the pill. That part matches.

---

| Phone screen | Address in the build | Layout | Why |
|---|---|---|---|
| `Calendar.dc.html` | `/v2/calendar` | **Different** | Design is one column — segmented control, grid, day list, Add button. The build keeps the computer design's two-column grid at 390px, so the month grid is **26px wide** and a day cell **9px**; week and day are 26px with `overflow-x:hidden`. The design's whole "new plan" sheet and its seven result modes have no equivalent. |
| `Tasks.dc.html` | `/v2/tasks` | **Different** | Design is a 5-day week strip + two filter chips + rows with a round tick on the left and a **⋯** on the right. The build is 7 scrolling day cards, a segmented To do/Done inside a card head that overflows it, rows with a checkbox and an "Open" link, no ⋯, and an extra side card. |
| `FollowUps.dc.html` | `/v2/tasks?tab=follow-ups` | **Different** | Design is a card list with a call button per row and Done / Move buttons under each. The build is a 7-column **table 779px wide**, which pushes the whole page to 803px and makes it scroll sideways, and the four period tabs collapse to **0px wide**. |
| `Attendance.dc.html` | `/v2/attendance` as agent | **Different** | Design is one scrolling column: state card → colour legend → this week → this month → day detail → footer actions. The build splits it across three tabs (Today · Month · Leave), so the week and the month are never on screen together, and the legend sits after the week instead of before the grids. |
| `TeamAttendance.dc.html` | `/v2/attendance` as owner | Same | Counters, a person-by-person list, the last-8-days grid and a link to the leave requests, in that order. The list is a 4-column table rather than cards, but it reflows to rows at 390 and reads the same. |
| `WorkOutside.dc.html` | a panel on `/v2/attendance` | **Different** | Design is a **whole screen** with its own header, reached from the Attendance card and from the gate sheet, and it has a second, confirmed state you come back to. The build is a bottom sheet with the form only — there is no "you are outside" state and no way back to it. |
| `LeaveRequest.dc.html` | a panel on `/v2/attendance` | **Different** | Design is a **whole screen**: three allowance tiles, the pending card, the form, then HISTORY. The build splits it — the tiles and the history are the Leave *tab*, the form is a bottom sheet opened from it. |
| `LeaveApprovals.dc.html` | the leave tab on `/v2/attendance` as owner | Same | Waiting cards with Approve / Refuse, refusal-reason chips, then an ANSWERED list. Same blocks, same order. |
| `Transfers.dc.html` | `/v2/transfers` | Same | Grouped cards — "For you", "You sent" for an agent; "Needs your approval", "All transfers", the gives-and-gets table for an owner — in the design's order. |
| `TransferLead.dc.html` | the transfer panel on `/v2/leads/o-1` | **Different** | Design is a **whole screen** with a VIP block state that replaces the entire form, and a sent state with two links. The build is a bottom sheet; VIP shows a red banner but leaves the form usable, and there is no sent state. |
| `Search.dc.html` | `/v2/search` | Same | Full screen, search field, kind chips, results or the idle card, with the rule printed at the foot. |
| `Notifications.dc.html` | `/v2/notifications` | **Different** | Design is header → type chips → flat row list → settings row → one closing line. The build opens with a hero count card and "Only new" toggle, groups rows by day, and ends with a three-row settings card plus an install card. |

---

### `Calendar.dc.html` → `/v2/calendar`

**Missing from the build:**

- **The month grid is unusable.** `.v2 .p-calendar .d-cal-layout` in
  `v2-home.css` (three classes) beats `.v2 .d-cal-layout` in the `max-width:900px`
  block of `v2-shell.css` (two classes), so the computed columns at 390px are
  `26px 316px`. Measured: `.d-cal` is 26px wide, a `.d-cal-day` is 9px. The
  phone override never applies. Same fault on `.d-wk`: the week and day views
  compute to 26px wide with `overflow-x:hidden`, so only the 07:00–22:00 hour
  gutter is on screen and the day columns are clipped away entirely.
- **The "new plan" flow does not exist.** The design's `+` opens a sheet in
  `mAdd` mode with: "What is it?" chips (Meeting · Site visit · Call ·
  Follow-up · Team); "With which lead?" — a search field that offers matching
  leads and refuses a name not on the list ("Pick the lead from the list. If the
  lead is new, add the lead first."); "Title or note (optional)"; native `date`
  and `time` inputs; a **clash warning** — *"You already have "{title}" at
  {time} ({duration}) that day. You can still save, or pick another time."*; a
  **"Runs for several days / Roadshow, expo, launch week"** switch that swaps the
  time input for "How many days?" (2–5 days); "How long?" (15 min · 30 min ·
  1 h · 2 h); "Where?" (Office · Sales centre · Client's place · Online / Zoom);
  "Remind me" (15 min before · 1 h before · 2 h before); and a save button
  labelled with the outcome — "Add · Thu 12 Nov · 16:00". The build's **New
  plan** button is `<Link to="/v2/tasks?new=1">`, and `Tasks.tsx` never reads
  `?new=1` — pressing it lands on the Tasks page with nothing open. The same is
  true of "Add a plan on this day" (`?new=1&on=…`), and of the phone header's new
  **+ Add event**, which points at `/v2/calendar?new=1` that `Calendar.tsx` never
  reads. **All three buttons do nothing.**
- **The whole meeting-result flow.** The design's one sheet has seven modes; the
  build has a five-button radio list (`They came / They booked / They did not
  come / Moved it / Cancelled`) and a Save. Missing per mode:
  - *Showed up*: the explanation "The client came. The lead stays in **Meeting**
    until you pick the next step."; "What's next?" chips (Send the offer ·
    Second meeting · Site visit · Follow up in 2 days); day + time inputs that
    appear when the next step needs them; "Client interest" (Hot · Warm · Cold);
    the meeting-note textarea; and the rule that the next step is **forced**.
  - *No-show*: "**No-show** means the client didn't come and didn't tell you… After
    2 no-shows the lead gets a red flag so you don't waste more time."; the
    prepared message under the banner **"MESSAGE READY · WHATSAPP OPENS · YOU
    PRESS SEND"**; "Try again" chips (Tomorrow 11:00 · Fri 13 · 12:00 · I'll call
    first · Stop trying).
  - *Rescheduled*: the explanation, new day + new time inputs, "Who asked to move
    it?" (Client · Me), and the save label "Move to Thu 13 Nov · 12:00".
  - *Cancelled*: "**Cancelled** means the meeting was called off before it
    started. It is not a no-show. The lead keeps its stage."; "Who cancelled?"
    (Client · Me · Developer).
  - *Booked a unit*: "**Booked a unit** means the client paid the booking
    (deposit). The lead becomes **Won**, the owners are notified and it counts on
    your leaderboard."; project chips; unit number; price; booking amount paid;
    an attach-receipt zone that flips to "booking_receipt.jpg added · tap to
    remove"; five validation messages including "The amount paid cannot be more
    than the price." and "Add the booking form or receipt. Owners check it before
    the deal counts."; then **"Save & mark Won"** with confetti.
- **The result prompt is in the wrong place and in the wrong words.** The design
  puts it as a dark **inline card at the top of the screen**: eyebrow "MEETING
  ENDED · 12:00", "How did the meeting with Omar K. go?", four two-line choices
  in a 2×2 grid, a full-width "Cancelled before it started", and the rule *"You
  must answer before 9 pm. Owners see every meeting result."* The build puts a
  "How did it go?" card in the **316px right-hand column** with the chip
  "Answer before 21:00" and no mention of owners.
- **The answered state with Undo.** After answering, the design swaps the card for
  "12:00 MEETING · OMAR A." + the result line ("Met · Send the offer", "No-show ·
  try again Tomorrow 11:00", "Booked The Archive A-1204 · Won") and an **Undo**
  button. Nothing in the build.
- **Tapping an event opens nothing useful.** The design's `mView` sheet has
  "Open the lead", "How did it go?" for a past event, **"Change day or time"** and
  a two-step delete whose label becomes "Tap again to confirm" — and for a team
  plan the label is "Hide for me" with the toast "Hidden from your calendar · the
  team still has it". The build's panel has "Open the lead" and a Save; there is
  no edit, no delete, no team-plan rule.
- Month-grid detail: the **"+N" overflow count badge** on days with 3 or more
  plans (the build hides `.v2-cal-more` on phone and shows at most 3 dots), the
  **multi-day bar** under consecutive days, the legend (hidden by
  `display:none` at phone width), and the two explainers "**3** 3+ plans · tap
  the day" and "— runs several days".
- Week view: the design's seven **full-width day rows** (day box, two event
  chips, "+N more · tap to see all", a count on the right). The build has an
  hour grid instead.
- The **busy warning** wording: design "Busy day: 4 plans. Leave 30 min between a
  site visit and the next plan for traffic." — build "4 plans on one day. That is
  a lot." and only at 5 or more.
- The day heading words: design says "Today's plan" and "Tomorrow" for those two
  days; build always prints the date.
- The dashed full-width **"Add a plan on Wed 11"** button at the foot of the day
  list (the build's equivalent is inside the side card and is dead, above).
- Empty state: "Nothing planned · tap **+** to add".

**Extra in the build:** a Mine/Everyone scope switch for managers and owners;
a now-line on the time grid; done/late styling on rows.

**DISAGREEMENT:** the phone month legend carries two extra explainers ("3+ plans ·
tap the day", "runs several days"); `design/web/calendar.html` has the plain
five-dot legend only.

**DISAGREEMENT:** `design/web/calendar.html` gives the no-show and reschedule
messages three buttons — "Open WhatsApp", "Open Telegram", "Copy" — and a
"Later / Before 21:00" pair on the result sheet. The phone has only the one
"MESSAGE READY · WHATSAPP OPENS · YOU PRESS SEND" banner and no Telegram.

---

### `Tasks.dc.html` → `/v2/tasks`

**Answer to "one screen with tabs, or two?":** in the prototype they are **two
separate screens**. `Tasks.dc.html` is reached from the bottom bar and its back
button goes to `Main`; its two chips are **"To do · N"** and **"Done · N"**.
`FollowUps.dc.html` is a different file reached from `Menu`, its back button goes
to `Menu`, and its four chips are Overdue · Today · Tomorrow · This week. Neither
file links to the other. The build makes them two tabs of one page.

**Missing from the build:**

- **The ⋯ button on every row, and the sheet behind it:** "Change the text, day or
  time" · **"Move one day later"** (toast: "Moved to Thu 12 Nov, same time") ·
  a two-step delete whose label becomes **"Tap again to delete"**. The build's
  row has a checkbox, a time, a type chip, the text and an "Open" link, and no
  menu at all.
- **Ticking a Meeting asks how it went.** The design intercepts the tick: if the
  meeting has not happened yet it refuses with the error sound and the toast
  "This meeting is at 16:30. Give the result after it."; if it has, it opens a
  sheet titled "How did it go? {task}" with **Client showed up · No-show ·
  Cancelled**, plus two hand-off links: *"Moved to another day · pick the new day
  in the Calendar ›"* and *"Unit booked · add unit, price and receipt in the
  Calendar ›"*. The build just completes the task.
- **The add/edit sheet's kind chips** — Call · WhatsApp · Meeting · Other — are in
  the build, but the design's **"For which lead? (optional)"** field is not: the
  build's New task panel has no lead field at all, so a task can never be tied to
  a lead from this screen.
- The design's four validation messages, in its own words: "Write what must be
  done." · "Pick a day in 2026." · **"This day is in the past. Pick today or
  later."** · "Pick the time." The build only checks the title is 2 characters.
- The sheet title and save label change for an edit ("Change the task" / "Save
  changes"); the build has no edit at all.
- The header subtitle **"3 left today · 1 overdue"** / "… · nothing overdue".
- The week strip is **five days** (Mon–Fri of the selected week) with ‹ and ›
  either side, each day showing "N left". The build shows **seven** cards in a
  horizontal scroller (824px of content in a 358px box) with the two arrows
  **stacked vertically** in the first slot, and only three days visible.
- Each row's link carries a destination: a Meeting row opens the **Calendar**, a
  lead row opens the **Lead**. In the build every row's "Open" goes to the lead,
  and a meeting task has no route to the calendar.
- Empty states in the design's words: "Nothing left on Wed 11 Nov." /
  "Nothing done yet on Wed 11 Nov."
- The toasts after each action ("Task added · Wed 11 Nov · reminder at 17:00",
  "Done · Call Marco Bellini", "Back in To do").

**Also wrong at 390px:** the card head holding the day title, the Today button,
the To do/Done segment and the New task button is 348px of content in a 314px
card, so **New task bleeds past the card's right edge**.

**Extra in the build:** the top-level Tasks / Follow-ups tabs; a Mine/The team
scope switch; a "Left today — N of M tasks" progress card; a "Follow-ups overdue"
and a "Plans today" watch row.

**DISAGREEMENT:** `design/web/tasks.html` has Tasks and Follow-ups as two tabs of
one page, and gives the Done flow a much larger sheet ("What happened with
Sara?" → Spoke · No answer · Booked a meeting · Not interested, then a required
next step, a meeting day and time, or a Lost reason). The phone splits them into
two screens and has only the four plain answers. The computer design wins, so the
build's tab arrangement stands — but the phone's own back targets (Tasks → Main,
Follow-ups → Menu) still have to be honoured.

**DISAGREEMENT:** the computer design's follow-up table has a **Stage** column and
the footnote *""Done" asks what happened, so the lead always has a next step."*
The phone has neither.

---

### `FollowUps.dc.html` → `/v2/tasks?tab=follow-ups`

**Missing from the build:**

- **The four period tabs are 0px wide.** Measured at 390: `.d-fu-head .d-tabs`
  computes to `width: 0` with `scrollWidth: 472`. Overdue · Today · Tomorrow ·
  This week are in the DOM and completely invisible, so the list cannot be
  changed from Overdue.
- **The table is 779px wide inside a 358px wrapper** whose `overflow-x` is
  `visible`, so it pushes the whole document to `scrollWidth: 803` at a 390
  viewport — the page itself scrolls sideways, carrying the sticky header and the
  floating bar with it, and the Done button's right edge sits at x = 803. The
  design has no table — each follow-up is a card: time column (red when overdue),
  name, the promise in quotes, the project, a round message button and a round
  call button, then a second row with **Done** and **Move to tomorrow**.
- **The per-row call button**, gated by check-in, is not in the build at all.
- **"Move to tomorrow" / "Move one day later"** — the design's second button on
  every row, with its two toasts ("Sara Nunes moved to tomorrow, same time",
  "… moved one day later · open the lead to pick another day"). Not in the build.
- **The result sheet.** Design: tapping Done opens "What happened with Sara
  Nunes?" with four answers — **"Spoke · all done" · "No answer · try again
  tomorrow" · "Booked a meeting" · "Not interested"** — and each writes a
  different follow-on line ("… · open the lead to set the day and time",
  "… · open the lead to mark Lost with a reason"). The build's Done completes the
  task silently.
- The wide gated **"Call these 3 one by one"** button above the list. The build
  has a link of the same name but it is in the head row, unlabelled by count
  position, and not gated.
- The header subtitle **"Promises you made to clients"**, and the back target
  `Menu`.
- The design's own counts on each tab ("Overdue · 1", "Today · 4") are present in
  the build but, being 0px wide, unreadable.
- Empty states: "Nothing overdue. Well done." / "No follow-ups here."
- The design's deep link: a "Follow-up overdue" notification sets `hmFuTab=Overdue`
  so this screen opens on the Overdue tab. The build has no `?when=` parameter.

**Extra in the build:** a "See them as leads" link to `/v2/follow-ups`; a Phone
column; an Agent column for team scope; the footnote "A follow-up not done by the
end of its day moves to Overdue."

---

### `Attendance.dc.html` → `/v2/attendance` as agent

**Answer to "how is each of the three presented?":**

| | Prototype | Build |
|---|---|---|
| Working outside | **A full screen**, `WorkOutside.dc.html`, with its own back button to Attendance. Reached from the state card ("I'm working outside today"), from the gate sheet, and from the "Going to a viewing or meeting?" prompt row | A **bottom sheet** at 390 (`.d-panel`, x 0, width 390, radius 28/28/0/0), form only |
| Requesting leave | **A full screen**, `LeaveRequest.dc.html`, with allowance tiles, the pending card, the form and a history list | Split: the tiles and the history are the **Leave tab**; the form is a **bottom sheet** |
| "Are you back in the office?" | A **centre-screen card that drops in from the top** over a dim layer, with a rippling Wi-Fi icon — the only centre dialog in the whole phone design. It fires 6 s after you mark yourself outside, on `WorkOutside` and on `Main` | **Does not exist anywhere in the build** |

**Missing from the build:**

- The **state card never names the network**. The design's not-checked-in card
  carries the `shine` sweep and reads "OFFICE WI-FI FOUND / **homes.me-Office**".
  The build says "Office Wi-Fi found" with no SSID.
- The **checked-in** state's prompt row: "Going to a viewing or meeting? Mark
  yourself outside ›" as a separate tappable row under the card.
- The **outside** state's card linking to WorkOutside ("You are working outside /
  Owners see where and why · tap to see or to come back") and its end-the-day
  button.
- The **checked-out** state in the design's words: "Checked out · day saved /
  Today stays green on your calendar. **Calls after this are marked "not checked
  in".**" plus a "Check in again" button.
- **The colour legend is a card of its own, placed before the grids** — "What the
  colours mean": In office · Outside (shared) · Absent · **!** Late · **L** Leave ·
  Weekend / holiday. The build's legend is five dots at the bottom of the week
  card, inside the Today tab only, and uses different words ("In office, on
  time", "Not marked, or still to come").
- **The week and the month are on one screen** in the design. The build puts them
  on separate tabs, so you cannot see "no absence this week" against the month.
- The week card's badge **"✓ No absence this week"**.
- The month grid's **status glyphs**. The design draws a tick / pin / cross /
  **!** / **L** in each cell; the build colours the cell background only, with no
  glyph, so a printout or a colour-blind reader gets nothing.
- The **month chips** (Sep · Oct · Nov) exist in the build; the small stat row
  under the grid exists; but the **tap-a-day detail block** below the month is
  only on the Month tab, not under the week as the design has it.
- **"Month PDF"** — the design's second footer button. Nothing in the build
  downloads anything.
- **"Request leave"** as a footer link on the main screen; in the build it is only
  reachable by first switching to the Leave tab.

**Extra in the build:** a "Today, step by step" timeline; a "How check-in works"
key-value card; three tiles (days in office / late / working outside); a
Month/Today/Leave tab bar.

**DISAGREEMENT:** `design/web/attendance.html` also has "Hours in the office:
60 h 12 min", "Week 46 · 24 h 14 min so far" and a "Demo: see each state"
switcher. The phone has no hours figure at all. Neither is in the build.

---

### `TeamAttendance.dc.html` → `/v2/attendance` as owner

**Missing from the build:**

- **The per-person actions.** The design puts a button row inside the row that
  needs one: on an absent agent, **"Phone Bassam"** and **"Mark as leave"**; on an
  outside agent, **"See shared location ›"** (to `OwnerLive`). The build's table
  has no buttons at all.
- **The agent's name is not a link.** In the design every name is an `<a>` to
  `Colleague` carrying `data-set="hmCol=Bassam"`. In the build it is a plain
  `<b>`, so there is no way from this screen to a colleague's profile.
- The **absent** row's full sentence: "No check-in, no leave, nothing shared ·
  **alert sent 10:00**" — the build prints "Office Wi-Fi" or "Outside, no place
  written down".
- The **late** row's reason: "24 min late · reason: traffic on SZR". The build
  shows the chip and the time only.
- The **outside** row's detail: "Outside · viewing with Omar K. · Valia sales
  centre · back by 16:00".
- The **leave** row's provenance: "Annual leave 10–11 Nov · approved by George".
- The footer link pair **"Leave requests · 2"** and **"Rules"**. The build has
  Rules in the tab bar and no link to the leave tab from the bottom of the list.
- The header subtitle "Owner · today, Wed 11 Nov".
- The **"Month per person ›"** link on the last-8-days card.
- The **agent block**: if an agent reaches this URL the design replaces the whole
  page with "Only for owners and admin / You are signed in as an agent. This page
  is not in your menu and you cannot open it." + "Go to My Day". The build simply
  renders the agent version of the screen instead, which is a different answer to
  a different question.

**Extra in the build:** a filter row of status counters that narrows the list; a
hero "N agents today · N working now · N away" card; a per-person summary line on
the 8-day grid ("1 late · 1 absent"); hover titles on each cell.

**DISAGREEMENT:** `design/web/team-attendance.html` has a **Desk** column in the
team table, a **"Month report (Excel)"** button, and a per-person side panel
("Nelson is outside" — Why / With who / Where / Back by / Checked in / "Phone
Nelson" / "Location shared once at 10:15, when he started. It is not followed
live."). The phone has none of those; the build has none of them either.

---

### `WorkOutside.dc.html` → a panel on `/v2/attendance`

**Missing from the build:**

- **"Share my location."** The design's first block is "Where are you? / Shared
  once now, and again when you tap I'm back", a filled **Share my location**
  button, and under it *"Your phone will ask once. No tracking in the
  background."* On tap it is replaced by a map stub and "Location shared · Dubai
  Hills · 14:55". **The build has no location step at all** — nothing asks for,
  shares or shows a position.
- **Sharing is required.** In the design the save button cannot fire until the
  location is shared, a reason is picked and "Where exactly" is filled, and its
  own label says which one is missing: **"Share your location first"** →
  **"Pick why you are outside"** → **"Write where exactly"** → **"I'm going
  outside"**. The build's button always reads "Start working outside" and uses
  inline field errors instead.
- **"With who" is a picker, not a text box.** The design offers four rows with
  avatars and sub-lines — Khalid A. (Lead · The Archive) · Marco Bellini (Lead ·
  The Archive) · Imtiaz team (Developer) · **No one (On my own)**. The build has a
  free-text input with the placeholder "Omar K.".
- The **"Note (optional)"** textarea ("e.g. bringing the payment plan").
- **The whole confirmed state.** After saving, the design replaces the form with:
  "You're marked outside / since 14:55 · back by 17:30"; a line repeating the
  reason, the person and the place; *"Keep working: calls and WhatsApp work as
  normal. No check-in question while you are outside."*; *"Emir and George can see
  where and why. When your phone is back on the office Wi-Fi, the CRM will ask you
  to mark yourself back."*; an **"I'm back in the office"** button; and then
  **"Go to My Day & keep working"** and a gated **"Continue calling"**. The build
  closes the sheet and returns you to the attendance screen.
- **The "Are you back in the office?" interrupt.** A dim layer plus a card that
  drops in from the top with a rippling icon: "Are you back in the office? /
  Office Wi-Fi found. Tap yes, and your outside time is saved on today's
  attendance." → **"Yes, I'm back in the office"** / "Not yet". Nothing in the
  build.
- **The returned state**: "Back in the office / Your time outside, the place and
  the reason stay on today's attendance" + "Go to My Day".
- Reason wording drift: design "Developer sales centre" and "Client meeting";
  build "Site visit" and "Meeting at the developer". Design "Event / roadshow" vs
  build "Event or expo"; design "Bank / paperwork" vs "Bank or papers"; design
  "Other" vs "Something else".

**Extra in the build:** the one-line explanation "Tell the office where you are.
It shows on the team screen, and it is the same as checking in."; a toast on save.

**DISAGREEMENT:** the phone says the location is "Shared once now, **and again
when you tap I'm back**"; `design/web/attendance.html` says "Share my location /
**one time only** / We read it once, now. We do not follow you." Two different
promises about the same button.

---

### `LeaveRequest.dc.html` → a panel on `/v2/attendance`

**Missing from the build:**

- **The allowance is framed the wrong way round.** The design's three tiles are
  **"14 Annual left"**, "3 Sick used", "N Pending". The build's are "Days off
  taken this year 8", "Sick days used 2", "Waiting for an answer 1" — it never
  says how many days are left, which is the only number anyone opens this screen
  for.
- **Three of the six leave types.** Design: Annual · Sick · **Personal** ·
  **Half day** · **Work from home** · Other. Build: Annual · Sick · Unpaid ·
  Emergency · Something else.
- **The working-days line under the dates.** Design, in green: "3 working days ·
  **your leads stay with you; urgent ones go to Incoming**"; in red when the dates
  are wrong: "Pick a start and an end day. The end must be after the start." The
  build shows a count but not the sentence about the leads.
- The two refusals the design spells out: **"These days are not working days.
  Pick other days."** and **"The start day is in the past. Pick today or later."**
- **"Attach sick note (optional)"** — the build has no attachment.
- **The pending card and its Cancel.** The design shows "Pending · Annual · 3
  days · 18 Nov to 20 Nov · waiting for Emir or George" with the sub-line *"Sent
  to Emir and George. You get a notification when they answer."* and a **Cancel**
  button, and **hides the form entirely while a request is pending**. The build
  shows the form and the waiting list at the same time.
- The header subtitle **"Emir or George approves it"**.
- The design's HISTORY list is two plain rows ("Annual · 2–3 Oct / Approved by
  Emir"); the build's is a table that names the approver nowhere — it prints
  "Approved" with no "by Emir".

**Extra in the build:** "A sick note is needed from day two." as a card footer;
a Cancel-request button on the waiting row.

**DISAGREEMENT:** `design/web/attendance.html` adds a **"Which half"** choice
(Morning · 09:00 – 13:30 / Afternoon · 13:30 – 18:00) for a half day, the line
"Choose the days. Saturday and Sunday are days off and are not counted.", and
"Emir or George answers. You get a notification. **Your leads stay with you.**"
The phone has the leads sentence but not the half-day choice.

---

### `LeaveApprovals.dc.html` → the leave tab on `/v2/attendance` as owner

**Missing from the build:**

- **"Change my answer."** Once answered, the design keeps the card and shows a
  text button to undo the decision. The build moves the row into "Answered" and
  there is no way back.
- **The consequence line after answering**, in the design's words: *"Rocky got a
  notification. The days show purple on the attendance calendar."* and, on a
  refusal, *"Rocky got a notification: refused · Busy week · launch."* The build
  shows a toast that disappears.
- **The context line on each request.** Design: "14 annual days left · **2
  meetings on those days must move**" and "Sick note attached". The build shows
  the working-day count and the reason only, so the owner cannot see what
  approving breaks.
- One refusal reason's wording: design **"Busy week · launch"**, build "Busy week".
- The header subtitle "Owner · you or George answers".
- The **agent block** ("Only for owners and admin / You are signed in as an agent.
  This page is not in your menu and you cannot open it." + "Go to My Day"). The
  build shows an agent their own Leave tab instead.
- The ANSWERED list in the design names who answered — "Approved by George · 6
  Nov", "Approved by you", "Refused by you · launch week". The build prints the
  decision note but not the person.

**Extra in the build:** an empty state ("No leave request is waiting / New
requests show here and in the menu."); a "See the calendar" link on each request;
a role check that tells a manager "Only an owner or admin can answer this."

---

### `Transfers.dc.html` → `/v2/transfers`

**Missing from the build:**

- **"Remind".** The design's sent-transfer row has two buttons, **Remind** (toast
  "Reminder sent") and Cancel. The build has Cancel only, so an agent waiting on a
  colleague has no nudge.
- **The gives-and-gets block is "this month" in the design and "last 7 days" in
  the build**, and the design's reading of it is a sentence an owner can act on:
  *"Shan gave away 6 leads this month. Worth a talk."* The build prints
  "2 transfers in seven days · 1 accepted · 1 refused".
- The design's agent header subtitle "Leads you give and leads you get" and owner
  subtitle "Owner · approve and see every transfer".
- The design's two empty states in its own words: **"You have not sent a transfer.
  Open a lead and tap "Transfer this lead"."** and "No requests for you." /
  "Nothing to approve."
- The closing rule printed at the foot of the design's screen as one sentence:
  *"Normal leads move when the other agent accepts. VIP leads cannot be
  transferred. Leads with a meeting or an offer need an owner first."* The build
  has a five-bullet rules card instead, which says the same things in more words.
- The design's refusal toast on the owner's screen: "Refused · the lead stays
  where it is · the agent was told".

**Extra in the build:** a "Pick a lead to transfer" button at the top; an
All / Open / Finished filter on the last-7-days table; a countdown ("Answer by ·
9 h left"); three summary tiles; the bar chart beside each agent's gave/got
numbers.

**DISAGREEMENT:** `design/web/transfers.html` gives the agent two tiles —
"This month · 2 You gave · 1 You got" — and adds to the owner's sentence "He has
**57 open, desk maximum 50**". The phone has neither. The build has neither.

**DISAGREEMENT:** the computer design says "Agents on leave **or absent** cannot
be chosen"; the phone's `TransferLead` greys out *on leave*, *absent* **and**
lets you tap them, refusing with "Sultan is not working today. Pick another
agent." The build only disables people on leave.

---

### `TransferLead.dc.html` → the transfer panel on `/v2/leads/o-1`

**Missing from the build:**

- **The VIP block.** The design replaces the entire form with a card: **"A VIP
  lead cannot be transferred / Emir gave this lead to you. If you cannot take it,
  send it back to him from My Day ("I can't take it"). He will choose the next
  agent."** plus a "Go to My Day" button. The build shows a red banner saying "A
  VIP lead goes back to the owner" and **leaves the form fully usable underneath**
  — confirmed on `/v2/leads/o-1`, which is a VIP lead: the agent list, the reason
  chips and the Send button are all live.
- **The owner-approval warning** above the form: "This lead has a meeting or an
  offer. Emir or George must approve the transfer first." The build only reveals
  this after sending, in the result message.
- **The count line** under the language chips: "9 agents · the freest first" /
  "2 agents speak Russian · the freest first". The build has a small grey hint
  "· free now first, then fewest open leads" and no count.
- **"Best match"** — the design badges the top agent when a language is chosen.
  The build badges the first row "Fewest leads" regardless of language.
- **What each agent row says.** Design: avatar, name, a coloured status badge
  ("In office" / "Outside until 16:00" / "In office · very busy" / "On leave
  today" / "Absent today"), the languages, and a sub-line **"22 open leads · 7
  deals this month · replies in 1 min 50 s"**. The build shows the language, a
  one-word state and "22 open" — no deals, no reply speed.
- **"See {name}'s full profile ›"** under every agent row, carrying
  `data-set="hmCol={name}"` so the colleague screen opens on that person. Not in
  the build.
- The refusal when an unavailable agent is tapped: "Sultan is not working today.
  Pick another agent."
- **The empty state** for a language with no speaker: "No agent speaks this
  language. Choose "All" or ask the owner."
- **The printed rule** under the send button: *"The lead stays with you until the
  other agent accepts. Notes, calls, meetings and files go with it. **Owners see
  every transfer.**"* The build's three-bullet list drops the owners sentence and
  adds "No answer by 18:00 ends the request."
- **The sent state**: a confirmation card, then "See my transfers" and "Back to
  the lead". The build closes the sheet and drops a green banner on the lead.
- The language chip set is fixed in the design (All · Arabic · Russian · Hindi ·
  Urdu · Portuguese · Serbian); the build derives it from the data and showed only
  "All · ar · en" — raw language codes, not names.

**Extra in the build:** a required note of at least 5 characters when the reason
is "Something else"; a send button labelled with the target's name.

---

### `Search.dc.html` → `/v2/search`

**Answer to "full screen or dropdown?":** the prototype is a **full screen** and
so is the build — this one matches. The build *additionally* has a centred
command palette (`.d-cmdk`, 350 × 167 at 390px) that opens when the magnifier in
the app bar is tapped, so on a phone the magnifier never reaches `/v2/search`.
The design's magnifier on `Main` is a plain link straight to this screen.

**Missing from the build:**

- **The "Tasks" kind chip.** Design: All · Leads · Projects · **Tasks** ·
  Screens, and its data includes task rows ("Site visit with Khalid · Today
  16:30 · Due"). Build: All · Leads · Projects · Screens — tasks are not
  searchable.
- **Other agents' leads.** The design returns them with a grey tag naming the
  owner — "Khalil Rahman · Damac Islands · **Talha's lead**" — and no link, and
  prints the rule at the foot: *"Any phone format works (+971, 05…, 971…). You
  see your own leads in full; other agents' leads show the agent's name only."*
  The build's `/api/search` scopes to `visibleUserIds` only, so another agent's
  lead is invisible, and the footnote reads "You can open your own leads and the
  free leads." — a different rule.
- **The RECENT card.** Design: a white card headed "RECENT" with three rows, each
  a magnifier icon and the term (Marco · 050 555 0101 · Damac Islands). The build
  shows chips headed "TRY ONE OF THESE" with clock icons.
- The result count heading **"3 RESULTS" / "1 RESULT"** above the list.
- The nothing-found card's words. Design: **"Nothing found for "xyz"" / "Check
  the spelling, or try the phone number."** Build: "Nothing found" / "No lead,
  project or screen for "xyz"." — the advice to check the spelling or try the
  number is gone. (The **"Add as a new lead"** button itself is there, and
  carries the typed term through to the form, which the prototype does not.)
- The design's **"Close"** text link beside the field, instead of a back button —
  this screen is the one header in the whole set with no back button.
- The per-row tag chip carrying the stage ("Interested", "New", "Called",
  "Selling now", "Soon", "Due").

**Extra in the build:** the command palette; grouped results under kind headings;
screens from the menu are searchable with alias words.

**DISAGREEMENT:** `design/web/search.html` has an **"Ask Homes AI"** action on the
nothing-found state and the hint "Enter opens the first result"; the phone has
neither. The build follows the computer design on Ask Homes AI and has no
Enter hint.

---

### `Notifications.dc.html` → `/v2/notifications`

**Answer to "full screen or dropdown?":** the prototype is a **full screen** and
so is `/v2/notifications`. The build *additionally* has a bell drop-down
(`.v2-bell-panel`), which at 390px renders as a bottom sheet (x 0, width 390,
radius 28/28/0/0) showing the first 8 rows with a "See all" foot. The design has
no drop-down — the bell on `Main` is a link straight to this screen.

**Missing from the build:**

- **The header.** Design: back button → `<h1>Notifications</h1>` → subtitle
  **"5 new"** or **"All read"** → a text **Mark all read** on the right. Build:
  app bar title, then a hero card reading "2 / new notifications / Click a row
  and it opens the right page." with a full-width Mark all read button.
- **A fixed chip set per role.** Design gives an agent `All · Leads · Meetings ·
  Tasks · Team` and an owner `All · Leads · Team · System` — the same chips every
  time, so the shape of the screen does not move. The build keeps only the groups
  present in the current data (`GROUPS.filter(name => name === 'All' ||
  live.has(name))`), so the chip row changes from day to day; at 390 it showed
  `All · Leads · Team`. **"Meetings" can never appear at all** — no entry in the
  build's `KINDS` map is filed under it, so a meeting-result reminder has no
  chip to sit behind.
- **The call-to-action line on every row.** The design prints a verb under the
  body — "Accept and call ›", "Answer ›", "Give the result ›", "Open follow-ups
  ›", "Approve or refuse ›", "Give it again ›". The build has a generic
  "Open →" button.
- **The deep link into a state.** Design rows carry `data-set` so the destination
  opens in the right state — a "Follow-up overdue" notification sets
  `hmFuTab=Overdue` and lands on Follow-ups already filtered. The build's links
  are plain paths with no state.
- **The unread dot.** Design: a blue dot on the right of each unread row that
  clears when the row is opened. The build has a dot plus a separate "Mark read"
  button per row.
- **The settings row**, one line: "Choose what reaches you / Phone push, sound,
  quiet hours 22:00–08:00 ›". The build has a three-row settings card repeating
  the current values.
- **The closing sentence**: *"Tap a notification on your phone and the CRM opens
  on that same page."* Not in the build.
- The empty state "Nothing here."
- The design's emoji-on-tinted-tile icon (⭐ 🔁 👥 📅 ❓ ⚠️ 💬 ⏰ ✅ 🏆) per
  notification type; the build uses line icons, and two of the stand-in rows
  carry an emoji inside the title text instead.

**Extra in the build:** an "Only new" toggle; day groupings (TODAY / YESTERDAY /
EARLIER THIS WEEK); a per-row "Mark read"; an "Alerts on your phone / How to
install" card.

**DISAGREEMENT:** `design/web/notifications.html` has **no type chips at all** —
only "Only new", "Mark all read" and "Show all notifications". The phone has the
chips. The computer design wins, so the chips are optional; but the phone's
owner-vs-agent split (`System` for an owner, `Meetings`/`Tasks` for an agent) is
the only place either design says what the categories are.

**DISAGREEMENT:** the build's closing card is the computer design's — "Alerts on
your phone / Add homes.me to your phone's home screen to get alerts **when the
computer is closed**." On a phone that sentence is about the wrong device; the
phone design's closing line is about the phone.
