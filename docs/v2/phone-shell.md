# Phone shell — read from `design/screens/`

What the 68 phone prototypes in `/design/screens/` actually show: the shell every
screen shares, an inventory of all of them, layout notes for the twelve screens
that matter most, how dark mode is wired, and the patterns that have no computer
equivalent.

**Status of this document.** It is a *reading* of prototypes drawn in the retired
green look. Layout, controls and behaviour below are what we build. **Colours are
not** — every colour named here is from the old green palette and is replaced per
`design/homes-me-CRM-master-prompt.md` §1.1 (warm-grey page, white cards, one
near-black hero card, homes.me orange as the only accent). Where a measurement is
load-bearing (bar height, radii, safe-area padding) it is quoted, because the
prototypes are pixel-exact at 390 × 844.

Source of truth for *what* each screen is: `design/screens/canvas.json`, which
names every board. Source of truth for *how* it behaves: the `<script
type="text/x-dc">` block at the foot of each file.

---

## 1. The shell

### 1.1 The frame

Every screen is one file with the same three-layer skeleton:

```
.hm-root            390 × 844, position:relative, overflow:hidden, background = page colour
└── .scr            height 844, overflow-y:auto, padding 14px 20px 108px, flex column, gap 16px
└── <nav>           floating bottom bar + dial button (absolute)
└── sheets/overlays dim layer + .sheet (absolute, bottom 0)
```

Three things to carry over:

- **The 108px bottom padding on the scroller** is what keeps content clear of the
  floating bar. Nothing else does.
- **`.scr > *` children animate in on a stagger** (`rise`, 14px up + fade, 0.55s,
  50ms apart for the first six, then all at 300ms). It is the "screen loads" feel.
- **The scrollbar is hidden** (`.scr::-webkit-scrollbar{display:none}`) and every
  animation is cancelled under `@media (prefers-reduced-motion:reduce)`.

### 1.2 The floating bottom bar

Identical on **64 of the 68 screens** — verified: same five items, same order, same
markup, no variants.

| # | Item | Goes to |
|---|---|---|
| 1 | **Home** | `Main` (agent) / `OwnerHome` (owner — rewritten at click time) |
| 2 | **Leads** | `Leads` (agent) / `AllLeads` (owner) |
| 3 | **Calendar** | `Calendar` |
| 4 | **Tasks** | `Tasks` |
| 5 | **More** | `Menu` |

Geometry and behaviour:

- `<nav aria-label="Main">` is absolutely positioned `left:14px; right:14px;
  bottom:14px`, a flex row with `gap:10px`.
- Inside it, the **pill** is `flex:1`, `height:66px`, `border-radius:33px`, white,
  `padding:0 8px`, with a soft two-stop shadow. It floats clear of the screen
  edges — it is not a docked tab bar.
- Each item is `flex:1`, a vertical icon-over-label stack, `gap:3px`, label 10px,
  `min-height:52px`. Active item: weight 700 + accent colour + class `navon`,
  which bounces the icon once on arrival (`bounce`, 0.7s, 400ms delay). Inactive:
  weight 500, muted colour, 1.9 stroke icon (active icons use 2.3 stroke).
- Icons are inline 21px stroke SVGs: house, two people, calendar, check, 2×2 grid.

**The four screens with no bottom bar** are full-attention modes: `Login`,
`Dialer`, `Chat`, `Email`. Treat "no bar" as the signal that the user is in a
single task they should finish or explicitly leave.

### 1.3 The round dial button

- A **66 × 66 circle, radius 33**, a flex *sibling* of the pill inside the same
  `<nav>` — so it sits to the **right of** the bar on the same baseline, never
  overlapping it. Same height as the bar.
- Filled accent (old: `#0F5132`), white phone-handset icon, 24px, with a lifted
  shadow.
- **It always opens the power dialer** (`Dialer`) — on all 64 screens, no
  exceptions. `aria-label="Start calling"`.
- It **pulses** (`fabpulse`: expanding ring shadow, 2.6s loop, 1.5s delay) to pull
  the eye. The nudge to call is the whole point of the design.
- It has **two forms depending on the check-in gate** (see §5.1):
  - checked in → an `<a href="Dialer">` that just goes,
  - not checked in → a `<button>` that opens the check-in bottom sheet instead.
  Both render identically; only the element and the handler change.

### 1.4 The top of a screen

There is no persistent app bar. Each screen draws its own header as the first
child of the scroller, and it scrolls away. Three patterns:

**A. Home header (`Main`, `OwnerHome`)** — no title, no back button. A single
row: round avatar (46px, initials, green presence dot) linking to `Profile` →
flexible spacer → *attendance pill* (44px tall, white, live pulsing dot, label
"In office" / "Outside", links to `Attendance` / `WorkOutside`) → round **Search**
button → round **Notifications** button (with an unread count badge and a one-off
`wiggle` animation). Below that row: a small date line and an `<h1>` greeting
("Good afternoon, **Rocky**").

**B. Standard page header** — the pattern on ~60 screens:

- A row with a **round 44px white back button** (`aria-label="Back"`, chevron-left,
  soft shadow) on the left, and `justify-content:space-between` so that an
  optional **single round action button** sits on the right (filled accent, 46px:
  `+ Add lead` on `Leads`, `+ Add event` on `Calendar`, `+ Add task` on `Tasks`).
  Screens with no action put an empty `<span>` there to keep the title aligned.
- Then a title block: `<h1>` at **30px / weight 800 / letter-spacing −0.8px /
  line-height 1.1**, and under it a 13px muted subtitle that carries the live
  count ("62 open · 12 to call today", "Shift 09:00 – 18:00 · Business Bay office").
  The subtitle is where the prototype puts status, never a separate strip.
- Back targets are **hard-coded per screen, not history**: `Leads` → `Main`,
  `Attendance` → `Menu`, `TransferLead` → `Lead`. The design assumes a known
  parent, which matters for a web app where real history exists.

**C. Context header** — `Lead` and `ProjectDetail` replace the title with the
record. On `Lead`: back button, then a **stage pill** and a **score pill** on the
same row, then a 2-line identity block (avatar initials, `<h1>` name, phone,
owner, trait chips). On `ProjectDetail` the header sits over the cover photo with
a status pill.

Two one-offs worth knowing: **`Search`** has no back button at all — a full-width
search field plus a text "Close" link. **`AskAI`** keeps the bottom bar but adds a
fixed composer pinned at `bottom:92px` (just above the bar).

### 1.5 Bottom sheets

**Bottom sheets are the only modal in the whole phone design.** There is no
centre-screen dialog except one small "are you back in the office?" card. Every
decision, every form, every confirmation is a sheet. 64 of 68 screens carry at
least one; `Lead` and `Tasks` carry four.

Anatomy, consistent across every file:

- A **dim layer** first: `position:absolute; inset:0; background rgba(16,24,20,.45)`,
  class `dim` (0.25s fade in). Tapping it closes the sheet — *except* the
  check-in gate on some screens, where only the explicit close button does.
- Then the **sheet**: `position:absolute; left:0; right:0; bottom:0`, white,
  `border-radius:28px 28px 0 0`, padding `10px 20px 24px`, flex column with
  `gap:10–12px`, and a large upward shadow. Class `sheet` animates
  `translateY(100%) → 0` over 0.38s on a soft-overshoot curve.
- A **44 × 5px grab handle** pill, centre-aligned, as the first child. It is
  decoration — nothing in the prototypes drags it.
- Tall sheets get `max-height: 780–790px` (or `86%`) **plus `overflow-y:auto`**, so
  the sheet scrolls internally while the page behind stays put.
- A header row inside the sheet: optional round coloured icon, a title line and a
  muted sub-line, and a round close button on the right.
- One **filled full-width primary button at the foot**, and its label states the
  chosen outcome rather than "OK" — "Mark as Lost · Bought elsewhere", "Set
  follow-up · Tomorrow 11:00", "Save & mark Won". When nothing is chosen yet the
  same button reads "Pick a reason first" and tapping it plays an error sound.

**What sheets are used for** (from the files):

| Use | Example |
|---|---|
| Blocking gate | check-in gate, on every screen |
| Pick-one-then-confirm | lost reason, follow-up time, meeting type, transfer target, give-lead-to-agent |
| Short form | add task, add calendar event, add note, mark Won (unit, price, receipt) |
| Record detail + actions | tap a task → change / move a day / delete |
| Long picker with search | country-code picker in `AddLead` (search field + region chips + country list) |
| Return-from-WhatsApp prompt | "You opened WhatsApp for Marco — what happened?" |

A sheet is one `<div>` whose mode is driven by state: `Calendar` has **one** sheet
that renders seven different bodies (`mAdd`, `mView`, `mCan`, `mShow`, `mNo`,
`mRe`, `mBook`); `Dialer` has one that renders five (`isLost`, `isCallback`,
`isInterested`, `isWrong`, `isRetry`). Build it as one sheet component with a mode,
not seven sheets.

### 1.6 Toasts, confetti, sound

- **Toast**: injected at `top:58px`, left/right 16px, near-black pill, radius 18,
  a lime tick then the message, `role="status"`, class `drop` (drops in from above
  with a small overshoot), auto-removed after **2600ms**. Replaces any toast
  already showing.
- **Confetti** on a win: 46 absolutely-positioned coloured bars falling and
  rotating for ~2.4s (`Main` check-in, `AddLead` save, `Calendar` unit booked,
  `Lead` marked Won).
- **Sound on tap.** The root `<div>` has a single `onClick` handler. Every `a`,
  `button` or `label` plays a WebAudio tone picked from its `data-sfx` attribute,
  defaulting to `tick`. The kit: `tick` (1.5kHz blip), `pop` (rising glide),
  `success` (4-note arpeggio), `send`, `dial` (two real DTMF pairs), `whoosh`,
  `error` (descending minor), `coin`. `data-sfx="none"` silences one control. The
  master prompt requires a setting to turn the whole kit off.
- **Shake** (`shake`, 0.35s × 2) is the "you can't do that yet" feedback, used
  with an inline red line rather than an alert.

---

## 2. Screen inventory — 68 files

`canvas.json` names 76 boards; 8 of them (`Web_*`) are computer boards with no file
in this folder, leaving **68 `.dc.html` files**. Nine of those are `Dark_*`
duplicates (§4), so there are **59 distinct screens** — which matches the
`design/README.md` count. The task brief said 67; the real number on disk is 68.

**LATER** marks the four screens the README and `canvas.json` put out of this
build: Inbox, Chat, Email, Templates. Each carries a visible "LATER PHASE" banner
in the prototype; `Menu` shows the Inbox row as "Inbox · later".

| File | What the screen is | LATER |
|---|---|---|
| `Login.dc.html` | Sign in: email, password, "keep me signed in", plus a demo role chooser (Agent · Rocky / Owner · Emir), EN/AR switch, and an "add to home screen" note | |
| `Main.dc.html` | **My Day** — the agent home | |
| `OwnerHome.dc.html` | Owner home: "needs you now" queue, team today, today in numbers | |
| `Menu.dc.html` | **More** — the whole app map, grouped Owner & admin / My work / Team, with badge counts and Sign out | |
| `Notifications.dc.html` | Notification list with type tabs, unread dots, deep-link rows | |
| `Search.dc.html` | Global search over leads, projects and screens | |
| `AskAI.dc.html` | Homes AI chat: message list, "try asking" chips, pinned composer | |
| `Incoming.dc.html` | The free-lead pool: agents take, owner gives | |
| `Leads.dc.html` | **My Leads** — the agent's list with filter chips and search | |
| `AllLeads.dc.html` | Owner version: 863 leads across every agent | |
| `FollowUps.dc.html` | Promises made to clients, due / overdue, with Done + move | |
| `Lead.dc.html` | **Lead page** — the record, actions and the four tabs | |
| `Notes.dc.html` | Voice notes (with transcript and AI-extracted fields) and the file gallery for one lead | |
| `AddLead.dc.html` | Add a lead: identity, project, source, qualification, owner hand-off | |
| `Pipeline.dc.html` | Leads by stage — stage chips + a card list, **not** a kanban board | |
| `Dialer.dc.html` | **Power dialer** — one lead at a time, outcome, next | |
| `TransferLead.dc.html` | Hand a lead to another agent | |
| `Transfers.dc.html` | Transfers in and out, accept / decline, plus a who-gives-who-gets table | |
| `Inbox.dc.html` | WhatsApp, email and notes in one thread list | **LATER** |
| `Chat.dc.html` | One conversation thread | **LATER** |
| `Email.dc.html` | An email view (600 × 1040 board, not a phone size) | **LATER** |
| `Templates.dc.html` | Ready WhatsApp messages agents send in one tap | **LATER** |
| `Tasks.dc.html` | Tasks with a week strip and filter tabs | |
| `Calendar.dc.html` | Month / week / day, plus meeting-result capture | |
| `LiveProjects.dc.html` | What we are selling right now | |
| `ProjectDetail.dc.html` | One project: cover, facts, payment plan, send actions | |
| `ManageProjects.dc.html` | Owner: add/edit what the team sells | |
| `TeamWall.dc.html` | Wins and office news feed | |
| `Leaderboard.dc.html` | "Best of Homes", weekly, with a show-on-office-TV action | |
| `TeamDirectory.dc.html` | Meet the team — searchable people list | |
| `Colleague.dc.html` | One colleague's profile and results (never their leads) | |
| `Attendance.dc.html` | **Wi-Fi check-in**, week strip, month grid, colour legend, month PDF | |
| `WorkOutside.dc.html` | Mark yourself outside: where, why, with whom, back by | |
| `LeaveRequest.dc.html` | Request leave | |
| `LeaveApprovals.dc.html` | Owner: answer leave requests | |
| `TeamAttendance.dc.html` | Owner: today's attendance across the team | |
| `TeamActivity.dc.html` | Owner: who used the CRM and when | |
| `OwnerLive.dc.html` | Owner: team live, ~10s refresh, TV mode | |
| `OwnerDashboard.dc.html` | Owner: full numbers dashboard | |
| `OwnerAssign.dc.html` | Owner: VIP leads given, who took them and how fast | |
| `OwnerMessaging.dc.html` | Owner: calls / WhatsApp / Telegram counts, no API needed | |
| `OwnerBanners.dc.html` | Owner: edit the banners agents see on My Day | |
| `OwnerFeedback.dc.html` | Owner: bug and idea inbox from the team | |
| `Feedback.dc.html` | Agent: report a bug or suggest a feature | |
| `Import.dc.html` | Owner/admin: Excel or CSV lead import | |
| `Desks.dc.html` | Owner: desks — groups of agents that share leads | |
| `Health.dc.html` | System health | |
| `Automations.dc.html` | Owner: rules that run by themselves | |
| `AISettings.dc.html` | What Homes AI can see and do | |
| `Profile.dc.html` | My profile | |
| `PersonalInfo.dc.html` | Personal information shown on the digital card | |
| `DigitalCard.dc.html` | My digital card — link and printed card | |
| `Company.dc.html` | Company details used on offers, emails, cards | |
| `Security.dc.html` | Password and signed-in devices | |
| `Settings.dc.html` | Settings hub, including Light / Dark / Auto | |
| `SettingsTeam.dc.html` | Team & roles — who can see and do what | |
| `SettingsAttendance.dc.html` | Attendance rules (owner & admin only) | |
| `SettingsNotifications.dc.html` | What reaches you, push, sound, quiet hours | |
| `InstallGuide.dc.html` | Install on your phone — 2 minutes, no App Store | |
| `Dark_Main.dc.html` | `Main`, dark | |
| `Dark_Leads.dc.html` | `Leads`, dark | |
| `Dark_Lead.dc.html` | `Lead`, dark | |
| `Dark_Calendar.dc.html` | `Calendar`, dark | |
| `Dark_Attendance.dc.html` | `Attendance`, dark | |
| `Dark_Menu.dc.html` | `Menu`, dark | |
| `Dark_Settings.dc.html` | `Settings` showing the Appearance control, dark | |
| `Dark_OwnerDashboard.dc.html` | `OwnerDashboard`, dark | |
| `Dark_TeamDirectory.dc.html` | `TeamDirectory`, dark | |

---

## 3. Per-screen layout notes — the twelve that matter

Blocks are listed top to bottom as the prototype stacks them.

### 3.1 `Main` — My Day

The busiest screen in the set, and almost all of it is conditional.

1. **Header** (pattern A, §1.4): avatar · spacer · attendance pill · search · bell.
2. **Date + greeting** `<h1>`.
3. **Banner carousel** — 168px tall, three slides (From Emir / Best of Homes /
   Office), each a whole-card link with an eyebrow label, headline, one line of
   body and a "See project →" cue. **Auto-advances every 4500ms**; dots below,
   the active one widening from 8px to 22px; tapping a dot jumps.
4. **Check-in card** *(only when `att === 'before'`)* — "OFFICE WI-FI FOUND /
   Ready to start your day? / Shift 09:00 – 18:00 · you are not checked in yet",
   a filled **Check in** button and a quieter "I'm working outside today" link.
   Checking in fires a success chime and confetti.
5. **Outside card** *(when `att === 'out'`)* — where you are, back-by time, and an
   **"I'm back"** button that opens the Wi-Fi dialog (§5.2).
6. **VIP lead card** *(when a VIP hand-off is pending)* — "VIP LEAD FROM EMIR"
   with a **live countdown ticking every second** ("24:12 left to call", then
   "Time is over · back in Incoming"); the lead's avatar, name and one-line
   qualification; Emir's note; then **Accept VIP lead** and a refuse button that
   requires **two taps** ("I can't take it" → "Tap again to send it back"). After
   accepting: a confirmation strip plus **Call now**. After refusing: a strip
   explaining it went back to Incoming, with **Undo**.
7. **Notification permission card** *(until answered)* — "Turn on" / "How to
   install" / dismiss ×. On "Turn on" it is replaced by a **fake lock-screen
   notification preview** that drops in from the top ("homes.me CRM · now · Test:
   notifications work 🎉").
8. **Next up** — one row: clock icon, "Next up · 16:30", "Site visit · Lucas
   Martin", and a right-aligned **"in 1 h 35"** relative countdown.
9. **Overview** — section title + "My Leads" link, then a **4-tile grid**: My
   leads · To call today · Hot leads · Meetings. All four numbers **count up** on
   load (`n()` multiplies by an animated `k`).
10. **Today's calls card** — "+240 points", `18 of 40`, an animated progress bar
    (`grow`, scaleX from 0), sub-counters (9/20 WhatsApp, 1/2 meetings, 12-day
    streak), then the big **"Start calling · 12 ready"** button, gated. Carries
    class `shine` — a slow diagonal highlight sweep every 4.5s.
11. **Pending-update card** *(when a WhatsApp/Telegram tap was never resolved)* —
    "2 messages waiting for your update", one row per lead with a "What happened?"
    cue. See §5.3.
12. **Brochure-opened alert** — "Marco Bellini opened your brochure link · 2 min
    ago · good time to call".
13. **Quick actions** — 4 tiles: Add lead · Follow-ups · Calendar · Projects.
14. **My leads by stage** — a donut/ring (animated `ringin`) with the total in the
    middle, and a legend list: New 18 · Called 14 · Interested 11 · Meeting 6 ·
    Offer 3 · Won 2.
15. **Best time to call now** — three lead rows, each with the lead's **local
    time** and a reason ("Replied on WhatsApp · good time", "Morning there · good
    time", "Missed twice · try now") and a round call button.
16. **Meet your colleagues** — horizontal avatar strip with deal counts.
17. **Projects we sell now** — horizontal project cards with "24 my leads".
18. **Homes AI tip** — a floating-icon card, "5 leads replied yesterday but got no
    call. Start there." → `AskAI`.
19. Bottom bar + dial button; the check-in gate sheet; the Wi-Fi dialog; confetti.

### 3.2 `Lead` — the lead page

1. *(Owner only)* a thin banner: "Owner: give this lead to another agent".
2. **Header**: back · **stage pill** · **score pill** ("Score 72").
3. **Identity**: 1-line avatar + `<h1>` name with a small verified mark, phone
   number, "with Rocky", then trait chips (Investor · Cash buyer · IT · EN).
4. **Time-zone card** — country badge, "Number from Italy", the lead's **local
   time** and the offset ("11:55 AM · 3 h behind Dubai"), a live pulsing dot with
   "Good time to call now · best: 10–12 & after 18:00 his time", and a
   **Next step:** line.
5. **Pending-update button** *(if a WhatsApp/Telegram tap is unresolved)*.
6. **Primary action row**: **Call** (gated) · **WhatsApp** · **Telegram**.
7. **Secondary action row** — 4 buttons, each opening a sheet: **Follow-up ·
   Meeting · Won · Lost**.
8. **Transfer row** — either "Transfer this lead to another agent" → `TransferLead`,
   or, if a transfer is in flight, its status → `Transfers`.
9. **In short:** — the AI summary paragraph.
10. **"What {first} wants"** — a label/value list where **every row is a button
    that opens an edit sheet**: Project, Unit, Budget, Purpose, Timeline, Payment,
    Language; then Wants / Doesn't want chip groups, Source, Lead #.
11. **Four tabs** (`Notes N · Timeline · Info · Files`), a segmented pill control:
    - **Notes** — count + **Add note**; each note card shows a type chip (Note /
      Call / Objection), an optional **PINNED** badge, who and when, body text, an
      optional reminder line, and Pin / Edit buttons. A **voice note** renders as
      a play button + a 24-bar waveform + duration.
    - **Timeline** — icon rows, newest first, mixing calls, WhatsApp taps (with
      "away 1m 10s"), voice notes, the VIP hand-off and the import.
    - **Info** — Phone, WhatsApp 2, Email, Nationality, Birthday, plus an edit
      audit line ("Rocky changed budget 1.5M → 2M · today 10:40 · history").
    - **Files** — file rows with Open, plus upload chips.
12. Link out: "Voice notes and photo gallery ›" → `Notes`.
13. **Four sheets**: the multi-mode action sheet (note / lost / follow-up /
    meeting / won), the messaging sheet, the edit-one-field sheet, the check-in gate.

**Behaviour the prototype shows.** The action sheet is one sheet with a mode:

- **Lost** — six reasons as chips (Bought elsewhere, Budget too low, Just browsing,
  Not into off-plan, Is a broker not a buyer, Other), a "Try again in 3 months"
  toggle that states the exact date it will remind you, a free-text box, and a
  confirm button that refuses (error sound) until a reason is picked.
- **Follow-up** — When (In 1 hour / Tonight 19:00 / Tomorrow 11:00 / Pick date &
  time) × How (Call / WhatsApp / Email).
- **Meeting** — kind (Office meeting / Site visit / Show flat / Video call) × when,
  and a note: "After you save, WhatsApp opens so you can send the time. You get a
  reminder 2 hours before." Saving **chains straight into the messaging sheet**
  with the "Meeting time" template pre-selected.
- **Won** — "Amazing, Rocky!", unit number, what was signed (EOI / Booking form /
  Full payment), a dashed **attach receipt** zone that flips to a solid
  confirmation, inline validation, then "Mark as Won · +300 points" + confetti.
- **Note** — type chips, quick-phrase chips that append to the draft, a
  **hold-to-record** voice note with a live `0:NN` counter and a Stop button, and
  a reminder picker.
- Messaging sheet: see §5.3.

### 3.3 `Leads` — My Leads

1. Header (pattern B): back → `Main`; round filled **+** → `AddLead`; `<h1> My
   Leads`; sub "62 open · 12 to call today".
2. **Search field** — rounded, magnifier icon, "Search name, phone or project".
   Filters live; searching **overrides the active chip**.
3. **Filter chips**, horizontally scrolling: `Today · 12`, `New`, `Overdue`,
   `No next step`, `VIP`, `Lost`, `All`. Active = filled dark pill.
4. **Result line** — "12 leads · best time to call first", or on All, "62 shown of
   62 · most urgent first", or on search, "3 found for "mar"". Beside it, two text
   links: **Free leads** → `Incoming`, **Pipeline** → `Pipeline`.
5. *(Today tab only)* the wide **"Start calling · 12 ready"** button, gated.
6. **Lead rows.** Each row is two stacked parts: an upper link (avatar initials on
   a per-lead colour, name + optional **VIP** badge, project, right-aligned stage
   pill) and a lower bar (the lead's **local time**, a reason note, then a round
   message button and a round call button).
7. **Empty state** — "No lead found", a reason, and "Add a new lead".
8. Bottom bar, dial button, toast, check-in gate.

### 3.4 `AddLead`

One long form, saved in one go.

1. Header: back → `Leads`; `<h1> Add a lead`; sub "Name, phone and lead source are
   needed".
2. **Identity card**: Full name\* · **phone\*** as a country-code button + number
   field · Telegram · Email.
   - A **live duplicate check** under the phone field with three states: idle
     ("We check every number while you type"), **new** ("New number. Not in the CRM
     yet"), **duplicate** ("Marco Bellini is already in the CRM, with Rocky. You
     cannot add this number again") with an **Open** link. The duplicate state
     blocks saving.
   - A switch "WhatsApp is the same number", which when off reveals a **second**
     country-code + number pair.
3. **Project they asked about** — chips, with an "Other" chip that reveals a text
   field.
4. **Lead source** — chips (8), where Referral / Event / Other each reveal their
   own follow-up field.
5. **Qualification** — Looking for · Budget (AED) · Buying to · Speaks, all chip
   groups; then a free-text "Anything worth remembering?".
6. *(Agent)* **Who works it?** chips.
7. *(Owner only)* a distinct **"OWNER · GIVE THIS LEAD"** block: agent list rows
   with initials, name and availability; a **VIP lead** switch explaining the
   consequence ("Top of the agent's My Day, with a timer. Comes back to you if not
   called"); a **"Must call within"** deadline chip row; and a private note to the
   agent.
8. Inline error line (class `shake`), then the filled **Save** button (`data-sfx="coin"`).
9. **Success state** replaces the form: tick, title, one line of what happened,
   then **Open lead** and **Add another**; plus confetti.
10. **Country-code sheet**: title + close, a search field ("Search country or code,
    e.g. India or +91"), region chips, then a scrolling country list of flag ·
    name · code, with "No country found. Try the code, e.g. +44".

### 3.5 `Dialer` — power dialer

**No bottom bar, no dial button.** It is a mode you are in.

1. **Header**: a close/back arrow (to `Leads` in queue mode, to `Lead` in
   single-call mode), a two-line title — `POWER DIALER · 11 LEFT AFTER THIS` over
   `Lead 1 of 12`, or `ONE CALL` over `Call Marco Bellini` — and a "+15 points per
   call" pill.
2. **Progress bar** *(queue mode only)*, filling as you advance.
3. *(if "Call anyway" was used)* a warning strip: "Not checked in · these calls are
   marked for the owners".
4. **The lead card** — a big 76px avatar, name, full phone with country, the lead's
   **local time** and why they are in the list; a 3-up fact grid (Project ·
   Budget · Wants); and a **"Say:"** script line ("Hi Marco, this is Rocky from
   homes.me…").
5. **Call** (gated) and **WhatsApp**, side by side.
6. **Tap-logged strip** once either is pressed: "Call tap logged 14:55 · opening
   your phone…".
7. **"How did it go?"** — a 6-button grid, each with its own status colour:
   **Interested · No answer · Busy · Call back · Wrong number · Not interested**.
8. **Two guard rails, both as a shaking inline line, not a dialog**:
   - picking an outcome before tapping Call or WhatsApp → "Tap Call or WhatsApp
     first, then say how it went";
   - pressing Next after calling without logging an outcome → "You called. Choose
     what happened first, or tap Skip".
9. A saved strip with **Undo**.
10. **Footer row** *(queue)*: ‹ previous · **Skip** · **Next lead / Finish**. In
    single-call mode instead: "Done · back to the lead".
11. **Finished state**: tick, "List finished", a summary line and a 3-up number
    summary, then "See my follow-ups" / "Back to My Day".
12. **One sheet, five modes**, opened by the outcome:
    - *Not interested* → reasons + "try again in 3 months" + note;
    - *Call back* → time chips, a `Pick date & time` chip revealing native **date
      and time inputs**, and a why field;
    - *Interested* → next-step chips, where "Meeting" reveals date/time/place and
      "WhatsApp" explains the hand-off to the phone;
    - *Wrong number* → a field for the correct number, and an explanation that the
      lead is flagged for the owner and removed from your count;
    - *No answer / Busy* → a reminder confirmation plus a prepared WhatsApp
      "I just tried to call you…" follow-up.

### 3.6 `Calendar`

1. Header: back · round **+** (opens the add sheet); `<h1> Calendar`; a dynamic sub.
2. **View segmented control**: Month · Week · Day.
3. **Month view** — ‹ month › with a **Today** button; Mon–Sun letter row; a
   35-cell grid where each cell is a button carrying the date, up to three
   coloured event dots, a "+N" overflow count and a multi-day bar; then a **legend**
   (Meeting · Site visit · Call · Follow-up · Team) and two explainers ("3+ plans ·
   tap the day", "runs several days").
4. **Week view** — ‹ week ›, then seven full-width day rows: day name + number,
   two event lines, "+N more", and a count.
5. **Day list** (Day and Month views) — ‹ day ›, the day title and a sub, an
   optional **busy warning** strip, then event rows: a time column (start / end), a
   coloured spine, a kind chip, the title as a button, a sub-line, a state chip,
   and for a finished meeting a **"How did it go?"** button.
6. Empty state, then a wide **Add** button.
7. **The meeting-result prompt** — not a sheet, an inline card at the top of the
   screen: "MEETING ENDED · 12:00 / How did the meeting with Omar K. go?" and four
   two-line choices — **Showed up · No-show · Rescheduled · Booked a unit** — plus
   "Cancelled before it started", and the rule in plain words: *"You must answer
   before 9 pm. Owners see every meeting result."* Answering swaps the card for a
   confirmation with **Undo**.
8. **One sheet, seven modes**:
   - **Add** — what it is (chips) · which lead (search with suggestions) · title ·
     **native date and time inputs** · a **clash warning** · a "Runs for several
     days" switch that swaps the time input for a day-count picker · duration ·
     where · remind-me · validation · save.
   - **View** — when, sub, open-the-lead link, and for a past event "How did it
     go?"; change day or time; delete (two-step label).
   - **Cancelled / Showed up / No-show / Rescheduled / Booked a unit** — each
     opens with a **plain-English explanation of what the word means and what it
     does to the lead** (e.g. no-show: "After 2 no-shows the lead gets a red flag
     so you don't waste more time"), then its own fields. *Showed up* forces a next
     step and an interest level. *No-show* and *Rescheduled* show a **prepared
     WhatsApp message** with the banner "MESSAGE READY · WHATSAPP OPENS · YOU PRESS
     SEND". *Booked a unit* collects project, unit, price, amount paid and a
     receipt, then "Save & mark Won" with confetti.

### 3.7 `Tasks`

1. Header: back · round **+**; `<h1> Tasks`; dynamic sub.
2. **Week strip** — ‹ then five day buttons (letter, date, a count badge) then ›.
   Selected day is filled.
3. **Filter tabs** (chips) with a **Today** reset button on the right.
4. **Task rows** — a round **tick button** on the left (tapping completes with a
   `pop`), the row body as a link (kind chip, title, meta) carrying a `data-set`
   so the destination screen opens on the right tab, and a **⋯** button on the right.
5. Empty state.
6. **Four sheets**: add/edit a task (what must be done · kind chips · native date
   and time · optional lead · validation); the **⋯** sheet (Change the text, day or
   time / **Move one day later** / Delete, with a two-step label); a meeting-result
   sheet that hands the harder outcomes off to `Calendar` ("Moved to another day ·
   pick the new day in the Calendar ›"); and the check-in gate.

### 3.8 `Incoming` — the free-lead pool

1. Header: back → `Menu`; `<h1> Incoming`; dynamic sub.
2. A **count card**: the number and a one-line lead-in.
3. *(Owner)* an **auto-assign** button.
4. **Lead cards** — avatar, name, project, a right-aligned **"waiting 42 min"**
   age, then a "why it is here" line, then the single action: **"Take this lead"**
   (agent, `data-sfx="success"`) or **"Give to an agent"** (owner).
5. **Taken state** — a confirmation card plus "Open the lead and call".
6. Empty state: "Incoming is empty / Every lead has an agent."
7. **The rule, printed at the foot of the screen**: *"A VIP lead comes back if not
   called in the time the owner set (30 min if he did not choose). An imported lead
   comes back after 24 hours with no call."*
8. **Give sheet** *(owner)*: agent chips, a confirm button whose label names the
   agent, and a reminder that a VIP keeps its timer from the moment it is given.

### 3.9 `Attendance`

1. Header: back → `Menu`; `<h1> Attendance`; sub "Shift 09:00 – 18:00 · Business
   Bay office".
2. **One state card of four** — mutually exclusive:
   - *not in*: "OFFICE WI-FI FOUND / homes.me-Office" (carries `shine`), a filled
     **Check in**, and "I'm working outside today";
   - *in*: "You are checked in / In the office · office Wi-Fi · shift ends 18:00"
     and a check-out button, plus a prompt row "Going to a viewing or meeting? Mark
     yourself outside";
   - *outside*: a card linking to `WorkOutside` and an end-day button;
   - *done*: "Checked out · day saved / Today stays green on your calendar. Calls
     after this are marked "not checked in"." and **Check in again**.
3. **Colour legend** — In office · Outside (shared) · Absent · **!** Late ·
   **L** Leave · Weekend/holiday. The legend comes *before* the grids, because the
   grids are unreadable without it.
4. **This week** — "9 – 15 Nov", an "No absence this week" badge, then seven day
   buttons each showing its status glyph.
5. **This month** — month chips, Mon–Sun row, a date grid of status glyphs, and a
   small stat row under it.
6. **Day detail** — tapping any day fills a detail block (date, title, sub).
7. Footer actions: **Request leave** → `LeaveRequest`, and **Month PDF**.

### 3.10 `TransferLead`

1. Header: back → `Lead`; `<h1> Transfer this lead`; sub = the lead's name.
2. **Blocked state** *(VIP lead)* — the whole form is replaced: "A VIP lead cannot
   be transferred / Emir gave this lead to you. If you cannot take it, send it back
   to him from My Day ("I can't take it")." plus "Go to My Day".
3. *(Conditional)* a warning: "This lead has a meeting or an offer. Emir or George
   must approve the transfer first."
4. **"Who speaks the client's language?"** — language chips, then a count line.
5. **Agent rows** — avatar, name, availability status, a **"Best match"** badge,
   languages, a sub-line, and under each a "See {name}'s full profile ›" link
   (carrying `data-set` so `Colleague` opens on the right person).
6. **"Why?"** — reason chips, then a note textarea that is **required when the
   reason is Other**.
7. Inline error, then the send button whose label names the target agent.
8. **The rule, printed**: *"The lead stays with you until the other agent accepts.
   Notes, calls, meetings and files go with it. Owners see every transfer."*
9. **Sent state** — confirmation, then "See my transfers" / "Back to the lead".

### 3.11 `OwnerHome`

1. Header (pattern A, owner): avatar `ED` · spacer · search · bell with 5.
2. Date + time line, `<h1> Good afternoon, Emir`.
3. A wide primary card: **"Add a lead and give it / Type it once, pick the agent,
   mark it VIP"** → `AddLead`.
4. Two half-width tiles: **Import Excel** · **Incoming · 3**.
5. **"NEEDS YOU NOW"** — the heart of the screen. An action queue where every row
   is title + consequence + a verb link:
   - "VIP lead not called: Omar Khan / Given to Bassam 14:20 · 30 min passed · back
     in Incoming" → **Give again ›**
   - "2 leave requests / Rocky 18–20 Nov · Shan 14 Nov" → **Answer ›**
   - "Bassam is absent / No check-in, no leave, nothing shared" → **See ›**
   - "3 leads waiting in Incoming / Oldest is waiting 42 min · 1 is VIP" → **Give ›**
   - "1 blocking bug from Talha / "Call button does nothing on Pipeline"" → **Open ›**
6. **Team today** — section title + "Attendance" link, then a 4-tile grid: In
   office 6 · Late 1 · Outside 1 · Absent / leave 2, each linking to
   `TeamAttendance`.
7. **"TODAY IN NUMBERS"** — a label/value list, every row a link that carries a
   `data-set` pre-filter: New leads today 27 · Calls · WhatsApp · Telegram
   214 · 104 · 28 · Meetings booked 5 · Units booked 1 · Talha · Follow-ups overdue
   (team) 9 · Leads with no next step 31.
8. **"Open the full dashboard"** → `OwnerDashboard`.
9. **The permission block** — if an agent reaches this URL the entire page is
   replaced by: *"Only for owners and admin / You are signed in as an agent. This
   page is not in your menu and you cannot open it."* + "Go to My Day". The server
   must 403 as well; this is the screen that shows what the user sees.

### 3.12 `Notifications`

1. Header: back → `Main`; `<h1> Notifications`; sub "5 new" or "All read"; a text
   **Mark all read** on the right.
2. **Type chips** — and they differ by role: agent gets `All · Leads · Meetings ·
   Tasks · Team`; owner gets `All · Leads · Team · System`.
3. **Notification rows** — a 40px rounded icon tile with an emoji on a soft
   coloured background, title + a right-aligned relative time ("6 h"), the body
   line, a **"{verb} ›"** call-to-action line, and a **blue unread dot** on the
   right that clears when the row is opened. The whole row is a link that carries a
   `data-set` so the destination opens in the right state (e.g. a
   "Follow-up overdue" notification opens `FollowUps` on its Overdue tab).
4. Empty state: "Nothing here."
5. A settings row: "Choose what reaches you / Phone push, sound, quiet hours
   22:00–08:00" → `SettingsNotifications`.
6. A closing note: *"Tap a notification on your phone and the CRM opens on that
   same page."* — i.e. every notification needs a deep link.

---

## 4. Dark mode

The nine `Dark_*.dc.html` files are **byte-identical to their light twins except
for two things**: `data-theme="{{themeAttr}}"` becomes `data-theme="dark"`, and
`themeName()` returns `'dark'` instead of reading storage. Verified by diff on all
nine pairs — zero structural difference, zero layout difference, zero content
difference.

So: **dark mode is a token swap, not a different design.** What that tells us:

- **Theming is done with CSS custom properties on `[data-theme=dark]`.** Every
  light colour in the prototype is written as `var(--bF6F7F4,#F6F7F4)` — a
  variable named after its own light hex, with the light hex as the fallback. The
  dark block then redefines ~90 of these (`--b…` for backgrounds, `--t…` for text,
  `--l…` for lines). The naming scheme is a hack for a runtime that rewrites
  inline styles, and we should **not** copy it: use semantic token names
  (`--surface`, `--text-muted`, `--line`) per the master prompt. But copy the
  *mechanism* — one attribute on the root, one block of overrides.
- **Dark is not just inverted.** The pastel tiles get darkened, desaturated
  backgrounds *and* lightened text (`#DCF3C4 → #2B3B1A`, `#2E9E63 → #6FD39A`), so
  both halves of every pair are readable. The master prompt makes this a hard
  rule: in dark theme, selected and unselected states of every chip, tab and
  switch must both be legible.
- **Inputs need explicit dark overrides.** The prototypes add
  `[data-theme=dark] input, textarea { background / color / border-color
  !important }` and a placeholder colour, because browser defaults otherwise stay
  light.
- **The floating bar needs a different shadow in dark**, not a different shape:
  `[data-theme=dark] nav>div { box-shadow: 0 12px 32px rgba(0,0,0,.5), 0 0 0 1px
  rgba(255,255,255,.06) }` — a soft dark drop plus a hairline light ring, since a
  grey shadow is invisible on a dark page.
- `color-scheme: dark` is set so native controls (the `<input type="date">` and
  `type="time"` pickers the sheets rely on) render dark too.
- **Three modes, not two.** `Settings` has an Appearance segmented control —
  **Light · Dark · Auto** — stored per user; `Auto` reads
  `prefers-color-scheme`. `Dark_Settings` exists to show it.
- **Watch out:** the prototypes leave the brand green hard-coded (not
  variable-wrapped) in about ten places per screen — the dial button, the active
  nav item, filled primary buttons, the selected chip. Those are exactly the
  places that must become tokens, or the accent will not follow the theme.

---

## 5. Phone-only patterns with no computer equivalent

These are the parts that are not a narrow version of a page. They need designing
as phone behaviour in their own right.

### 5.1 The check-in gate on the call button

**The single most pervasive pattern in the design — it is on 64 of 68 screens.**

Every call affordance exists twice in the markup: as a link when the agent is
checked in, and as a button that opens a sheet when they are not. The sheet,
identical everywhere, offers three ways out:

1. **"Check in now and call" / "Office Wi-Fi found · takes 1 second"** — checks in
   and goes to the dialer in one tap;
2. **"I'm working outside" / "Viewing, sales centre, meeting"** → `WorkOutside`;
3. **"Call anyway" / "Each call is marked "not checked in" · owners see it"** — the
   escape hatch, with the consequence stated.

And the exemption, printed in the sheet: *"After 18:00, on weekends and holidays,
calls open directly. Owners and admin are not asked."*

Why it is phone-only: it is a **physical-presence check on a device that moves**.
A computer at a desk cannot ask it. It means the lock state has to be available
to, and consistently rendered by, every screen in the app, so it belongs in the
shell rather than in each screen. In the prototypes the state lives in
`localStorage` (`hmAtt`, `hmAnyway`, `hmRole`) and is recomputed by a shared
`gateVals()`; in v2 it is a server fact and should be one context/hook.

### 5.2 Wi-Fi presence, and the "are you back?" interrupt

Attendance is driven by **the office Wi-Fi SSID**, not a button: the check-in card
says "OFFICE WI-FI FOUND / homes.me-Office". The reverse is the only centre-screen
dialog in the whole design — when an agent marked outside comes back onto the
office network, a small card **drops in from the top** with a rippling icon:
*"Are you back in the office? / Office Wi-Fi found. Tap yes, and your outside time
is saved on today's attendance."* → **"Yes, I'm back in the office"** / "Not yet".

`WorkOutside` is the other half: where are you (with a **"Share my location"**
button that promises "Your phone will ask once. No tracking in the background"),
why, with whom, where exactly, back-by time, a note — and then a standing
reminder that the CRM will ask you to mark yourself back when the office Wi-Fi
returns.

A browser cannot read the SSID. This needs an honest decision (a network
fingerprint from the server side, a geofence, a QR at the door, or an explicit
tap) and it should be made before the attendance screens are built, because the
whole copy of the feature says "found" rather than "tapped".

### 5.3 Leaving the app to message, and coming back

The design **does not build a chat** (Inbox / Chat / Email / Templates are all
LATER). Instead it opens WhatsApp or Telegram on the phone and reconciles
afterwards. The loop:

1. The agent taps **WhatsApp** or **Telegram** on `Lead` or in `Dialer`.
2. A sheet offers a **ready message** ("Pick a ready message"), explains that
   messages with a link include a tracked URL (`homes.me/p/archive-rk42`) and that
   *"When Marco opens it, you get an alert: a good moment to call"*, then a button
   whose own label warns: *"Opens on your phone. On a computer it opens the web
   version."*
3. The tap is logged, the app loses focus, and **the time away is measured**.
4. On return, the same sheet re-opens in a second mode: *"You opened WhatsApp for
   Marco / Welcome back. Tell the CRM what happened."* with "Logged: tapped at
   14:55 · away **1 min 12 s**", outcome chips, an optional voice note, and a
   "Later · it stays in "waiting for your update"" escape.
5. If never answered, it surfaces as a **"2 messages waiting for your update"**
   card on `Main`, as a button on `Lead`, and as a notification.

Nothing on a computer behaves like this. It needs app-focus/visibility detection,
a durable "unresolved tap" record, and the away-duration measurement — and the
away duration is also written to the lead timeline ("away 1m 10s"), so it is data,
not just UI.

### 5.4 One-at-a-time instead of a table

Where the computer design uses a table with a filter row, the phone replaces it
with a **sequential single-record mode**: the power dialer is one lead filling the
screen, with progress ("Lead 1 of 12", "11 left after this"), ‹ Skip ›, and a
**forced outcome before advancing**. `Pipeline` likewise is *not* a kanban board —
it is stage chips plus a vertical card list, with the stage model explained in
prose at the foot of the screen. There is no horizontal drag anywhere in the 68
files, and no swipe gesture is implemented (one appears only as a *requested
feature* in the `OwnerFeedback` demo data: "Swipe a lead card to call"). Phone
multi-record work is a queue, not a grid.

### 5.5 Everything decided in a sheet from the bottom edge

Covered in §1.5, but it is a pattern, not just a component: on the phone, a
decision is a sheet whose primary button names the outcome, whose explanation of
consequences is inline prose, and which refuses rather than warns. The computer
design has dialogs *only for short decisions* and a 480px side panel for detail —
so the same flow has two genuinely different containers. Build the body of each
flow (lost reason, meeting result, won) as a shared piece, and let the shell
decide sheet vs panel vs dialog.

### 5.6 The native keyboard and the native pickers

The prototypes lean on the phone's own hardware affordances:
`<input type="tel" inputmode="tel">`, `inputmode="numeric"` for prices,
`autocomplete="name"`, `type="search"`, and **native `type="date"` / `type="time"`
inputs inside the sheets** for every when-question. The country-code picker is a
full sheet with its own search and region chips because a `<select>` of 200
countries is unusable by thumb. On a computer these become typed fields and a
calendar popover — so the field components need two presentations.

Two things the sheets must handle that a page does not: the **on-screen keyboard
eating the bottom half of the screen** (sheets are bottom-anchored, and their
primary button is at the very bottom), and the **108px floating-bar gutter** that
every scroller already reserves.

### 5.7 Push notifications as the way in

`Main` asks for notification permission *inside the page* with a card that sells
it ("New leads, meetings and follow-ups on your lock screen, like WhatsApp. Tap one
and it opens the right page"), then proves it worked by **drawing a fake lock-screen
notification** that drops in from the top. `Notifications` closes with *"Tap a
notification on your phone and the CRM opens on that same page"*, and
`SettingsNotifications` owns push, sound and **quiet hours 22:00–08:00**.

So every notification type needs a deep link, and the prototypes show the
mechanism: rows carry a `data-set` attribute (`hmFuTab=Overdue`,
`hmAsk=WhatsApp|Marco Bellini`) that pre-sets the destination screen's state. In
v2 that is a URL with parameters.

### 5.8 Installed-as-an-app, not visited

There is no App Store. `Login` says *"No app to download. Open crm.homes.me in
Safari or Chrome, tap Share › Add to Home Screen. It opens full-screen like an
app."* and `InstallGuide` is a whole screen for the two-minute install. The design
assumes standalone display: a 390 × 844 frame with no browser chrome, which is
exactly why the bottom bar can float 14px off the bottom edge. Real devices need
`env(safe-area-inset-bottom)` added to that 14px and to the 108px scroller gutter,
or the bar lands on the home indicator.

### 5.9 Sound and motion as feedback, with no hover

There is no hover state to carry meaning, so the prototypes substitute:

- **a tap sound per action type** (§1.6) — `dial` plays real DTMF tones, `coin`
  marks money, `error` marks refusal;
- **`a:active, button:active { transform: scale(.97) }`** on every control as the
  press feedback;
- **shake** for refusal, **confetti** for a win, **pop** for "this just appeared",
  **drop** for "this came from outside", **count-up** for numbers, **live
  countdowns** ticking every second;
- `prefers-reduced-motion` kills all of it, and the master prompt requires a
  setting to kill the sound.

### 5.10 Things that are on the phone because the phone is where the agent is

Worth naming, because they are easy to drop when porting: the **lead's local time
and "good time to call now"** on `Main`, `Leads`, `Lead` and `Dialer`; the
**"Say:" opening script** in the dialer; **hold-to-record voice notes** with
transcript and AI field extraction (`Notes`, `Lead`); **Gallery / Scan-or-upload**
of passports, booking forms and receipts straight from the camera (`Notes`); and
the **live VIP countdown** ("24:12 left to call") that an owner started from his
own screen.

---

## 6. Notes for whoever builds this

- **The 64 identical bottom bars mean one shell component.** Nav, dial button,
  check-in gate sheet and toast host are not per-screen furniture — the
  prototypes duplicate them only because each file is standalone.
- **Role switching is a routing concern, not a screen concern.** The prototypes
  rewrite `href`s at click time: `Main → OwnerHome`, `Leads → AllLeads` when the
  stored role is owner. In v2 the two home screens and the two lead lists are
  separate routes behind a role check, with the "Only for owners and admin" block
  as the client-side fallback and a 403 on the server.
- **Ignore the prototype's plumbing.** `localStorage` keys (`hmRole`, `hmAtt`,
  `hmLead`, `hmVip`, `hmXfer`, `hmCallOne`, `hmNotif`, `hmTheme`, `hmPendDone`),
  the `data-set="key=value"` attributes, the `data-ui="act"` generic toast
  handler, the `sc-if` / `sc-for` tags and the `{{…}}` bindings are all the
  prototype runtime. The *states* they switch between are the specification; the
  mechanism is not.
- **The wording is part of the design.** Consequence sentences ("Each call is
  marked "not checked in" · owners see it", "After 2 no-shows the lead gets a red
  flag", "The lead stays with you until the other agent accepts") appear in the
  prototypes at the exact moment of the decision, and the four broker test reports
  in `design/` are what put them there. Carry them across verbatim unless the
  owner changes them.
- **Two-step destructive actions, never a confirm dialog.** Refuse a VIP, delete a
  task, delete an event: the button label changes to "Tap again to…" on first tap.
- **Every colour in this document is from the retired green look.** Map through
  `design/homes-me-CRM-master-prompt.md` §1.1 before using any of them.
