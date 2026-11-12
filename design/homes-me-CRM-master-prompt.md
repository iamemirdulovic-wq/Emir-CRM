# Master prompt: homes.me CRM — new version, phone and computer (A to Z)

Version 3 · 12 November 2026. This file replaces every earlier version. Read all of it before you do anything.

You are working on the in-house CRM of **Emigeo Homes Real Estate LLC (homes.me)**, a Dubai off-plan real estate brokerage with about 10 agents. Owners: Emir Dulovic (Founder & CEO) and George Vanous. Admin: Abdullah Mahi. Time zone: **Asia/Dubai**. The team's English is basic: every text in the product must be short and simple.

**The job in one paragraph.** The CRM at **crm.homes.me** is live and the team uses it every day. It stays exactly as it is until the new version is ready. You build the **new version** from the SAME codebase (do not start from zero): a new look and many new features, for the **phone and the computer with the same features**, following the design in `/design` as closely as possible. The new version runs on its own address with a copy of the data. When Emir approves it, it replaces the old one in one planned switch.

---

## 0. How to work (read first)

### 0.1 Two versions side by side
1. **Do not touch production.** `crm.homes.me`, its database and its deployment stay unchanged during the whole build. No migration, no deploy, no config change there without Emir's written yes.
2. **Branch.** Create a long-lived branch `v2` from the current production branch. All work goes into `v2` through one pull request per phase (section 10). Bug fixes that production needs go to the production branch and are merged into `v2`.
3. **Second address.** Deploy `v2` to **`new.crm.homes.me`** (ask Emir to confirm the name) as a separate app instance with its own environment values. Tell Emir exactly what he must click in the hosting panel and in DNS; he is not a developer.
4. **Copy of the database.** `new.crm.homes.me` uses its OWN database, created as a copy of production. Give a one-command script `scripts/refresh-v2-db` that takes a fresh copy (so testing always has recent, real-looking data). In the copy: turn off every real outgoing channel (push to real devices, email, Telegram) except for test users, so no agent gets a fake alert.
5. **No two live systems.** Real work happens only on crm.homes.me until the switch. `new.crm.homes.me` shows a thin banner "TEST VERSION · data here is a copy" for everyone.
6. **The switch (cutover), planned and reversible:** freeze production for a short window outside work hours → backup → run the `v2` migrations on the production database (they only ADD tables and columns) → deploy `v2` to crm.homes.me → smoke test with the checklist → open. Keep the old build and the backup ready for one-click rollback for 14 days. Write this as `docs/cutover.md` with exact commands before the pilot.

### 0.2 Working rules
1. **Discover before you change anything.** Read the codebase: stack, folders, database schema, auth, roles, API routes, background jobs, deployment. Write `docs/build-plan.md`: what exists, what you reuse, what is new, database changes, risks, the hosting steps for 0.1, and a **feature parity table** (section 4). Show Emir the plan and stop for approval.
2. **One codebase, one database, one API.** Every feature is built once on the server. The phone layout and the computer layout are two views of the same data and the same components where possible (responsive), not two apps. No separate native app.
3. **Reuse what the live CRM already has; restyle it, do not rebuild it:** install instructions, theme switch, the import, the duplicate-number check, the add-lead form, the business card tool, the service worker with push and notification-click, attendance grid, team activity, team wall, automations, sales offers. Extend them to match this file and give them the new look.
4. **Migrations only add.** Never delete or rename live data. New tables and nullable columns only, so the cutover is safe and the old build could still run.
5. **Ask before deciding** anything in section 12.
6. **Definition of done for every phase:**
   - works on iPhone Safari (iOS 16.4+), Android Chrome, and on a computer (Chrome, Safari, Edge) at 1280 px and wider
   - the feature exists in **both** layouts (section 4)
   - **looks like the design**: for every screen of the phase, put a screenshot of your build next to the design file (phone 390 px, computer 1440 px, light and dark) in the pull request; differences are fixed or listed with a reason
   - light and dark theme both readable
   - no console errors; tap targets at least 44 px on the phone
   - loading, empty and error states exist
   - every permission is checked **on the server**
   - tests cover the new rules
   - a short demo note lists what to click on `new.crm.homes.me`
7. **Leftover test data in production — ask Emir, then delete:** lead "TEST Claude" (+971 500000001), an empty "New sales offer" draft, the "Test Agents" account.

---

## 1. The design (source of truth)

Unzip `homes-me-CRM-design-package.zip` into **`/design`**. It contains:

| Folder / file | What it is | Use it for |
|---|---|---|
| `design/web/*.html` + `ui.css` + `app.js` + `lead-kit.js` | **Computer design**: 48 clickable pages. Open `login.html`, choose Owner or Agent. | Exact look, layout, wording and behaviour of the computer version. **`ui.css` is the design system for the whole product.** |
| `design/web/research/sage.md` | Page-by-page checklist: every block, button, dialog, field and rule (43 pages + 3 LATER). | Your build checklist per page. |
| `design/web/research/nova.md`, `atlas.md` | Sidebar, top bar, 10 interaction rules; dashboard layout rules. | Rules for anything not drawn. |
| `design/web/test-reports/*.md` | Findings of 4 broker testers (agent, newer agent, owner, admin). | Real-use rules; do not repeat these mistakes. |
| `design/screens/*.dc.html` | **Phone design**: 59 clickable screens (+ `Dark_*` examples). Open `Login`, choose Agent · Rocky or Owner · Emir. | Exact layout, wording, flows and behaviour of the phone version. |
| `design/homes-me-CRM-Team-Test-Round-2.pdf` | Phone test results and decisions. | Background. |

Rules for using the design:
- **Copy layout, spacing, wording and behaviour as exactly as you can — not the code.** The files are prototypes with demo logic. Sample data (names, numbers, prices, week/month totals, reply times) is invented; use real data.
- The computer design is only `design/web/`.
- Screens marked **LATER** (Inbox, Chat, Email, Templates) are drawn but **not** part of this build. Show them in the menu as "later", greyed.
- Where the phone design and the computer design show the same feature with different wording or rules, the newer computer design (`design/web`, `sage.md`) wins; tell Emir about each case in the plan.

### 1.1 ONE design system for phone and computer

The phone design was drawn first in a green look. **That green look is retired.** The whole product uses the look of the computer design: warm-grey page, white cards, one near-black hero card, **homes.me orange as the only accent**. Take every colour, radius, shadow and font from the variables at the top of `design/web/ui.css` (light and dark). Build them once as theme tokens and use them on phone and computer.

| Token | Light | Dark |
|---|---|---|
| Page background | `#F2F0EC` | `#0C0C0E` |
| Card / surface | `#FFFFFF` (also `#F7F5F2`, `#EEEBE6`) | `#17171A` (also `#1E1E22`, `#27272C`) |
| Lines | `#EAE6E0` | `#28282D` |
| Text / muted | `#16151A` / `#4E4B54` / `#86828C` | `#F4F3F1` / `#BDBAC1` / `#86838B` |
| **Accent (orange)** | `#FF5A2E`, hover `#EB491D`, soft `#FFEDE6`, text on soft `#C53B12` | `#FF6436`, soft 16 % |
| Hero card (near-black) | `#141317` with white text | `#1D1C21` |
| Status green / amber / red / blue / violet | `#17A569` / `#E89B0C` / `#E5484D` / `#3E7BFA` / `#8B5CF6`, each with a soft background | lighter versions, see `ui.css` |
| Radius | cards 22, controls 12, pills 999 | same |
| Font | system font stack (see `--font`) | same |

How to read the PHONE design files with the new look (layout and behaviour stay; only colour and surface change):

| In the phone design (old) | Build it as (new) |
|---|---|
| Forest green `#0F5132` buttons, headers, active tab, dial button | Primary action → orange accent. Large dark blocks (hero, VIP card, check-in card) → near-black hero card |
| Lime `#C6F36B` highlights and badges | Orange soft `#FFEDE6` with `#C53B12` text, or white on the hero card |
| Page `#F6F7F4`, cards `#FFFFFF` | Page `#F2F0EC`, cards `#FFFFFF` |
| Pastel tiles (mint, sky, lavender, peach, sand, rose) | White cards; colour only where it means a status (green good, amber warning, red late, blue outside, violet leave) |
| Green "In office", success ticks | Status green `#17A569` (status colours keep their meaning) |
| Fonts Inter / Manrope | System font stack from `ui.css` |
| Floating bottom bar (Home, Leads, Calendar, Tasks, More) + round dial button | Keep the same bar and button; white bar, active item orange, dial button orange |

- Colour means **status only**; orange is for the one main action per screen, active states and urgent things. One filled primary button per screen.
- Stage chips are neutral pills with a small dot (grey → dark → orange for Offer → green for Won), as in `ui.css`.
- In dark theme no element may have light text on a light background: selected and unselected states of every chip, tab and switch must both be readable.
- Motion: 150 ms hovers, count-up numbers, live countdowns, a "now" line on timelines; on the phone, sheets slide up and cards rise in; confetti on Won / Booked. Respect `prefers-reduced-motion`.
- Sounds: small WebAudio sounds with a setting to turn them off.
- Theme: Light / Dark / Auto per user. Language: English now; all text through i18n keys so Arabic (right-to-left) can be added.
- Brand: the homes.me mark is an orange rounded square with a house icon and the word "homes.me". The business card artwork keeps its own fonts and layout (reuse the live tool).

---

## 2. Who uses it and what they may see

| Role | Can |
|---|---|
| **Owner** (Emir, George) | Everything: all leads, owner tools, reports, settings, giving VIP leads, approvals |
| **Admin** (Abdullah) | Like owner: team, import, settings, all leads. Cannot remove owners |
| **Agent** | Only **their own leads**, plus free leads in Incoming. Sees colleagues' profiles and results, never their leads. Cannot export |

- Enforce on the server: an agent asking the API for another agent's lead, an owner page or an owner setting gets **403**.
- The owner has his own home (`OwnerHome`) and never lands on agent pages: Home → Owner home, Leads → All leads, profile and settings show his own name.
- Owners and admin are **not** asked to check in before calling.

---

## 3. Where leads come from

Only three ways. No Meta, website or portal integration.

1. **Owner hand-off:** the owner gets a lead by email, qualifies it, adds it and gives it as **VIP** to a good agent.
2. **Excel import** by owner or admin.
3. **Agents add their own leads.**

---

## 4. Phone and computer: same features (important)

Every feature in section 6 exists on **both** the phone and the computer. Many of them do not exist in the live CRM today, on either.

How:
- Build the feature **once** on the server (database + API + rules + notifications).
- **Phone (under 768 px):** layout and flows from `design/screens/` (bottom bar, cards, bottom sheets), in the new colours (section 1.1).
- **Computer (768 px and wider):** layout from `design/web/` — grouped sidebar that folds to icons, top bar with search (Ctrl K), tables with a filter row, a 480 px right side panel for details, dialogs only for short decisions, bento dashboards. Follow `nova.md` (interaction rules) and `atlas.md` (dashboards).
- Between 768 and 1279 px (tablet, small laptop): the computer layout with the sidebar folded to icons and wide tables scrolling sideways. Nothing may overlap.
- Same fields, same buttons, same rules, same wording in both. One set of components where possible.
- Nothing the live CRM can do today is removed (for example Sales offers).

The phone screen names used in section 6 map to computer pages like this (full map with every detail: `design/web/research/sage.md`):

| Phone screen(s) | Computer page |
|---|---|
| `Main` | `my-day.html` |
| `OwnerHome` · `OwnerDashboard` | `owner-home.html` · `dashboard.html` |
| `Leads` · `AllLeads` | `my-leads.html` · `all-leads.html` |
| `Lead` + `Notes` + `TransferLead` + single call | `lead.html` |
| `AddLead` | `add-lead.html` |
| `Incoming` + `OwnerAssign` | `incoming.html` |
| `Pipeline` · `Dialer` | `pipeline.html` · `calling.html` |
| `Transfers` | `transfers.html` |
| `Calendar` · `Tasks` + `FollowUps` | `calendar.html` · `tasks.html` |
| `LiveProjects` · `ProjectDetail` · `ManageProjects` · `OwnerBanners` | `projects.html` · `project.html` · `manage-projects.html` · `home-banners.html` |
| `TeamDirectory` + `Colleague` · `TeamWall` · `Leaderboard` | `team.html` · `team-wall.html` · `best-of-homes.html` |
| `Attendance` + `WorkOutside` + `LeaveRequest` | `attendance.html` |
| `TeamAttendance` + `LeaveApprovals` | `team-attendance.html` |
| `Profile` + `PersonalInfo` + `Security` · `DigitalCard` · `Feedback` | `profile.html` · `digital-card.html` · `feedback.html` |
| `Settings` + `SettingsNotifications` | `settings.html` |
| `Import` | `import.html` |
| `OwnerLive` · `TeamActivity` · `OwnerMessaging` · `OwnerFeedback` | `team-live.html` · `team-activity.html` · `messaging-report.html` · `feedback-inbox.html` |
| `SettingsTeam` · `SettingsAttendance` · `Desks` · `Automations` · `Company` · `AISettings` · `Health` | `settings-team.html` · `settings-attendance.html` · `desks.html` · `automations.html` · `company.html` · `ai-settings.html` · `system-health.html` |
| `Notifications` · `Search` · `AskAI` · `InstallGuide` · `Login` | `notifications.html` (+ bell panel) · `search.html` (+ Ctrl K) · `homes-ai.html` · `install-guide.html` · `login.html` |
| (live CRM only) Sales offers | `sales-offers.html` |
| LATER: `Inbox` + `Chat` · `Email` · `Templates` | `inbox.html` · `email.html` · `templates.html` |

In `docs/build-plan.md` make this table for **every** feature in section 6 and keep it updated:

| Feature | In live CRM on computer? | In live CRM on phone? | To build |
|---|---|---|---|
| Lead transfer between agents | no | no | both |
| Check-in rule before calls | ? | ? | ... |

A phase is not done until its features work in both layouts.

Things the design only simulates — build them for real: sidebar badges and the bell as live counts; settings saved per user; table sorting and paging; file uploads; the QR code next to a number on the computer; voice notes; one fixed date format; the owner view of Follow-ups (starts on "All agents"; the badge is the team's overdue count); every lead link opens that lead; every number on a dashboard opens a list with the same number.

Computer-specific notes:
- Calling: the Call button shows the number with a QR code to scan with the phone, and a `tel:` link; the tap is logged the same way. The check-in question comes first when it applies (section 5).
- WhatsApp / Telegram: open `wa.me` / `t.me` links (WhatsApp Web / Telegram desktop). Same tracking, same "what happened?" question.
- Attendance check-in works on the computer too if it is on the office network.
- Notifications on the computer: browser notifications through the same Firebase setup (section 7).

---

## 5. Rules that apply everywhere

**Stages.** One set: New → Called → Interested → Meeting → Offer → Won. Lost is separate. A lead changes stage through real actions (a logged call, a booked meeting, an offer, Won with details), not by dragging or one tap.

**Take-back rule.** A VIP lead returns to Incoming if it is not called within the time the owner chose (default 30 minutes). Imported and normal leads return after 24 hours with no call. The clock stops outside work hours and on days off. The agent is warned before (10 minutes for VIP, 2 hours for imports). The owner is told when a lead returns. Times are editable in `Automations`.

**Check-in rule for calls.** In work hours an agent who is not checked in (or has checked out) and taps any call button gets a question: check in now and call / I am working outside / call anyway (marked "not checked in", owners see it). Outside work hours calls open directly. While marked outside, no question.

**WhatsApp and Telegram.** No WhatsApp API. Each agent uses his own number. The CRM opens the app with a ready message; **the agent presses send**; the CRM logs the tap and, when the agent returns, asks "what happened?". Never write "sent" for something the CRM did not send.

**No risky one-tap actions.** These need a second tap or a question, and where possible an Undo: refuse a VIP lead, mark a follow-up Done ("what happened?"), delete a plan or a task, share all Incoming leads (VIP leads are never auto-shared), deactivate a person, give the Owner role, undo an import, check out.

**Won / Booked.** Needs unit, price, amount paid (not more than the price) and the booking form or receipt. Same form on the lead page and in the Calendar.

**Dates and times.** Real date and time pickers everywhere. 24-hour clock everywhere. Past dates are refused for new plans, follow-ups, tasks and leave. All rules use Asia/Dubai.

**One source of numbers.** Counts (leads, follow-ups, attendance, calls) are computed once on the server and shown the same on every screen.

**Audit.** Hand-offs, transfers, reassignments, deletions, role changes and setting changes are written to an audit log with who and when.

---

## 6. Every screen and what it must do

Phone screen names are in `code style` (files in `design/screens/`). The matching computer page is in the table in section 4. Open both to see layout and wording; `sage.md` lists every detail per page.

### Start and home
- `Login` — email and password (both validated), remember this phone, link to the install guide, two-step sign-in for owner and admin. (The role chooser on this screen is only for the design demo.)
- `InstallGuide` — iPhone and Android steps for Add to Home Screen, then turn on notifications, and what a notification looks like.
- `Main` (agent home, "My Day") — greeting; owner banners carousel; check-in card (becomes a small pill after check-in; shows "Outside · place · with whom · back by"); "turn on notifications" card until answered; **VIP lead card** with live countdown, Accept, and "I can't take it" (two taps, Undo, lead leaves the agent's lists); next plan; tiles (my leads, to call today, hot, meetings); Start calling; "messages waiting for your update"; leads by stage; best time to call; colleagues strip; live projects; AI tip.
- `OwnerHome` (owner home) — add a lead and give it; import; Incoming; "needs you now" list (VIP not called, leave requests, absent agent, leads waiting, transfer approvals, blocking feedback); team today (in office / late / outside / leave / absent); today in numbers, each row opens the filtered list.
- `Menu` (More) — every tool as tiles. Owner tiles only for owner and admin.
- `Search` — one box for leads, phone numbers, projects, notes, people and screens. Not found → "add as a new lead".
- `Notifications` — in-app list; filters; mark all read; every item opens its exact page, tab or sheet. Separate lists for agent and owner (section 7).
- `AskAI` (Homes AI) — answers the typed question from the user's own leads, calendar, follow-ups, projects and attendance; links to the right page; never sends a message.

### Leads
- `Leads` (My Leads) — tabs Today, New, Overdue, No next step, VIP, Lost, All; search by name, phone or project; each row opens **that lead**; call button per row; Start calling (opens the queue); links to free leads and Pipeline.
- `Lead` — header: **phone number largest**, name smaller, "with <agent>", tags; local time of the client and best time to call; next step. Actions: Call (this lead only), WhatsApp, Telegram, Follow-up, Meeting, Won, Lost (reason needed). Under them: **Transfer this lead to another agent**. "In short" summary. Details: tap any line to edit (written on the timeline). Tabs: Notes (types, voice notes, reminders), Timeline (every call, message tap, note, follow-up, meeting, change, transfer — newest first), Info, Files (list, add photo / booking form / ID). Owners also see "give this lead to another agent".
- `AddLead` — nothing preselected. Needed: full name, phone (numbers only, country picker with search), lead source. Optional: WhatsApp number, project, what they want, budget, purpose, languages, note. Duplicate check on the full number with country code: blocks the save and shows who has the lead. **Owner mode:** choose the agent (list with status and open leads; agents on leave or absent cannot be chosen) or leave in Incoming; VIP switch; "must call within" 15 min / 30 min / 1 hour / today; private note.
- `Notes` — voice notes and photo gallery of a lead.
- `Incoming` — free leads with the reason they are free and how long they wait. Agent: "Take this lead" (it moves to My Leads). Owner: give to an agent, or share the normal leads equally (two taps; VIP stays).
- `FollowUps` — tabs Overdue, Today, Tomorrow, This week; call one by one; Done asks what happened; move to another day.
- `Pipeline` — leads by stage with counts; each card opens the lead; no stage change by tap.
- `Dialer` — the calling queue = the agent's Today list, VIP first; single-lead mode from a lead. The agent must tap Call or WhatsApp before choosing an outcome. Outcomes: Interested (next step, meeting form), No answer, Busy, Call back (date and time), Wrong number (new number or flag), Not interested (reason, try again in 3 months). After a call an outcome is needed before Next (or Skip). End-of-list summary. Calls made "not checked in" are marked.
- `TransferLead` and `Transfers` — section 8.

### Calendar and tasks
- `Calendar` — Month / Week / Day, all starting Monday; arrows cross months; the tapped day is preselected in the + form. New plan: type (meeting, site visit, call, follow-up, team), lead picked from the list (not free text), optional title, date, time, length, place, reminder, multi-day (may cross months). Clash warning on overlap. Open a plan → open the lead, change, delete (two taps). Team plans are changed only by owners; agents can hide them. After a meeting the CRM asks **how it went**: Showed up (next step with its own date and time, interest level, note), No-show (counted on the lead, message ready, try again), Rescheduled (new date and time), Booked a unit (Won form), Cancelled (who cancelled). Must be answered the same day; owners see who did not.
- `Tasks` — any week and day; To do / Done; add task (text, type, date, time, optional lead); change, move, delete; a meeting task asks for the result only after its time; overdue count is live.

### Projects
- `LiveProjects` — projects the team sells now, each with status and the agent's own lead count.
- `ProjectDetail` — one page per project: facts, the pitch written by the owner, "send to a client" (pick the lead, then WhatsApp or Telegram opens with the brochure, payment plan, location or video link), the agent's leads in this project.
- `ManageProjects` (owner) — add, edit, upload brochure, status Selling now / Launching soon / Hidden (agents see the first two).
- `OwnerBanners` (owner) — the banners shown on My Day.

### Team
- `TeamDirectory` (Meet the team) — all agents with live status, desk, languages, deals and meetings this month; search by name or language; desk filters.
- `Colleague` — one colleague: status, languages, what he sells, deals, meetings, calls, average first reply, last 6 months, badges. Phone / WhatsApp buttons are plain links: nothing is logged, no check-in question.
- `TeamWall` — posts and reactions; anyone can post; owners post news.
- `Leaderboard` (Best of Homes) — ranking, levels, badges.

### Attendance
- `Attendance` — one status shared by every screen: not checked in → in office → outside → checked out. Check-in works only on the office network and stores the real time (late after 09:10). Check-out needs two taps and keeps the day; the agent can end the day from outside. Week strip and month view with a colour guide. Tap a day for its details: office time and outside trips together.
- `WorkOutside` — share location once; why; with whom; where exactly (typed, needed); back by; note. The record stays on the day after return. When the office Wi-Fi is seen again the CRM asks once "are you back?".
- `LeaveRequest` — type, dates (working days counted; days off and past days refused), reason, sick note; pending card with dates; cancel; history.
- `TeamAttendance` (owner) — everyone by name with status, time, outside place and reason; absent and late alerts; last days grid for all agents; links to leave requests and rules.
- `LeaveApprovals` (owner) — approve or refuse (reason needed, can be changed); answered list.
- `SettingsAttendance` (owner) — office networks (add, remove, at least one), shift start / end, late time, days off, outside rules, call rule switches, monthly report download.

### Me and settings
- `Profile` — my numbers (same as everywhere else), links to the pages below.
- `PersonalInfo` — name, title, phone, WhatsApp, email, languages, BRN (needed), photo change / remove; edits are kept; completion bar. **Languages here feed the language filter in lead transfer and Meet the team.**
- `DigitalCard` — must look and work exactly like the live business card tool at `/tools/business-card` (reuse it). "Send on WhatsApp" opens WhatsApp on the device.
- `Security` — change password (validated), signed-in devices, sign out a device.
- `Settings` — appearance (Light / Dark / Auto), sounds, language, links to the settings pages. Owner sections are hidden from agents.
- `SettingsNotifications` — per-alert switches (different for agent and owner), test button, quiet hours; everything is saved.
- `Feedback` — report a bug or idea (text needed); my reports list.

### Owner tools
- `AllLeads` — every lead of every agent; filters by agent, going cold, overdue, no next step, stage, project; select one or many and move them to another agent or to Incoming (notes and history go with them).
- `OwnerAssign` ("VIP leads I gave") — each VIP lead with status (waiting, called, meeting, offer, came back); give again; remind the agent; take it myself.
- `Import` — 6 steps: upload (Excel or CSV, template download) → match columns (name and phone needed; a field can be used once) → check (new / duplicates / bad rows must add up; choose skip, fill empty details, or import again) → give (chosen agents equal split, a desk, or Incoming) → confirm → result with undo for 24 hours. One grouped notification per agent.
- `OwnerDashboard` — period filter (today, week, month, year) that really changes calls, meetings and deals; lead totals; team status; speed of first contact.
- `OwnerLive` — who is doing what right now.
- `TeamActivity` — time in the CRM, sign-ins, unusual sign-ins with review (it was them / sign out everywhere and reset password).
- `OwnerMessaging` — WhatsApp and Telegram taps per agent, answered and unanswered "what happened?" questions.
- `OwnerFeedback` — team reports; plan, mark fixed, reply, export.
- `SettingsTeam` — everyone with role; invite (name, email, role; no duplicates); change role; reset link; sign out everywhere; deactivate (two taps; never an owner; open leads go to Incoming).
- `Desks` — groups of agents for import and routing: add, edit, delete, members, maximum open leads each.
- `Automations` — the take-back times and the switches for alerts and reminders.
- `Company`, `AISettings`, `Health` — company details, Homes AI settings, system health (as in the design).

### Later (do not build now)
`Inbox`, `Chat`, `Email`, `Templates` — WhatsApp API inbox, team chat, sending email, template management.

---

## 7. Notifications with Firebase

### Setup
1. The live CRM already has a service worker with push and notification-click (Firebase Cloud Messaging). Keep it. **Switch it on:** create or open the Firebase project, and add the three Firebase values the CRM's own settings page asks for to the hosting panel's environment. Tell me exactly which values and where to paste them.
2. Each user: install the CRM (Add to Home Screen on iPhone — needed there; optional on Android and computer) and tap **Allow**. Ask for permission only after a tap on "Turn on notifications", never on page load.
3. Save one **device token per device** per user (`push_subscriptions`: user, token, platform, last seen). Remove tokens that Firebase reports as dead. One user can have several devices.
4. Sending: the server sends through Firebase from a background job with retry. Every notification is also written to the in-app list, so nothing is lost if the phone blocked it.
5. Tapping a notification opens the CRM **on the exact page, tab or sheet** (deep link). If the user is signed out, sign in first, then go there.
6. iPhone works only as an installed Home Screen app on iOS 16.4+. Show this clearly in the install guide and on `SettingsNotifications`.
7. `SettingsNotifications` has a **Test** button: it sends a test notification to this device and shows whether it arrived.
8. Owner view: a list of who has notifications on and who does not (today nobody has).

### Rules
- **Group:** many events of one kind in a short time become one notification ("35 new leads for you"), never 35.
- **Quiet hours** per user (default 22:00–08:00). In quiet hours nothing rings; items wait in the in-app list. Exception the user may allow: VIP leads.
- **Per-alert switches** per user; owner alerts and agent alerts are separate lists.
- **Order** in the in-app list: newest first. Unread dot. Mark all read.
- **Backup channel:** optional Telegram bot that sends the same alerts to users who connect it.
- Plain words, with the name of the lead or person and the action wanted.

### Events — who is told and where it opens

| Event | Who | Opens |
|---|---|---|
| VIP lead given to me (loud; shows the time limit) | agent | My Day, VIP card |
| VIP time almost over (10 min before) | agent | the lead |
| VIP lead accepted / refused | owner | VIP leads I gave |
| VIP lead not called, came back | owner | Incoming |
| New leads for me (import or hand-off, grouped) | agent | My Leads, New tab |
| Imported lead will be taken back (2 h before) / was taken back | agent | My Leads |
| Leads waiting in Incoming for 15 min | owner | Incoming |
| Follow-up due / overdue | agent | Follow-ups, right tab |
| Meeting or site visit reminder (2 h and 15 min before) | agent | Calendar, that plan |
| Meeting result needed (after the meeting, again at 20:00) | agent | Calendar, result sheet |
| Meeting result missing at 21:00 | owner | Calendar / agent |
| "What happened?" after WhatsApp or Telegram | agent | the lead, question sheet |
| Client opened a link I sent | agent | the lead |
| Hot lead (ready to book) | owner | the lead |
| Unit booked / Won | owner, team wall | the lead / dashboard |
| Transfer request for me | agent | Lead transfers |
| Transfer accepted / refused / approved / ended | sender | Lead transfers |
| Transfer needs approval; transfer completed | owner | Lead transfers |
| Lead moved to me / away from me by the owner | agent | the lead |
| Not checked in at 09:10 | agent | Attendance |
| Late check-in; absent at 10:00; working outside | owner | Team attendance |
| "Are you back?" when office network is seen | agent | My Day |
| Leave request | owner | Leave requests |
| Leave approved / refused | agent | Request leave |
| Calls made while not checked in (daily summary 18:00) | owner | Team attendance |
| Import finished | owner | All leads |
| Feedback from the team | owner | Feedback inbox |
| Reply to my feedback | agent | Feedback |
| Sign-in from a new device | owner, that user | Team activity / Security |
| Team wall post or mention | everyone (off by default except mentions) | Team wall |
| Daily summary (08:30) | owner | Owner home |

---

## 8. Lead transfer between agents

Screens: `TransferLead` (form) and `Transfers` (lists). Tile "Lead transfers" in More for both roles.

- Start: button "Transfer this lead to another agent" on the lead page, under the Follow-up / Meeting / Won / Lost row. While a request is open the same place shows its status.
- The form shows **agent profile cards with a language filter**. The language buttons are built from the languages in agents' profiles, not hard-coded. Each card: photo, name, live status, languages, open leads, deals this month, average first reply, link to the full profile. Order: can take it now first, then fewest open leads; the first is marked "Best match". Choosing a language preselects the reason "speaks the client's language".
- Reason is needed: language, going on leave, the client asked, knows the project better, too many leads, other (with a note). Optional note for the other agent.
- An agent can transfer only his own leads. Agents on leave or absent cannot be chosen. One open request per lead.
- The lead **stays with the sender until the receiver accepts**. "No, thanks", or no answer by the end of the work day, ends the request. The sender can remind or cancel.
- **VIP leads cannot be transferred**: the agent sends them back to the owner.
- Leads in stage **Meeting or Offer need an owner or admin to approve first**; then the receiver must still accept.
- On accept, everything moves: notes, calls, message taps, meetings, tasks, follow-ups, files. Timeline entry: "Transferred from A to B · reason".
- Owners see approvals, every transfer, and per agent how many leads he gave and got this month, with a flag when someone gives away many.
- Keep a `lead_transfers` record (lead, from, to, reason, note, requested at, decided by, decided at, status) so commission questions can be answered later.

---

## 9. Data to add

Adapt to the real schema; propose it in the plan first.

- `call_logs` (with "not checked in" flag), `message_taps` (app, template, tap time, away seconds, result, note), `tracking_links`, `link_opens`
- `meetings` (type, start, end, multi-day, place, result, result reason, next step), `tasks` (with optional lead), `follow_ups`
- `attendance_days` (status, check-in, check-out, late minutes, source network), `outside_trips` (reason, with whom, place, back by, location once, returned at), `leave_requests` (with decision and reason), `office_networks`
- `lead_transfers`, `lead_assignments` history (who had the lead, from when to when, why), `vip_handoffs` (deadline, accepted at, called at, returned at)
- `imports` (file, counts, mapping, undo deadline) and import-to-lead links
- `desks`, `desk_members`, `live_projects`, `banners`, `feedback_tickets`, `team_posts`
- `push_subscriptions`, `notifications` (in-app list with deep link and read flag), `notification_prefs`, `telegram_links`
- `user_settings` (theme, sounds, language, quiet hours), user profile fields (languages, BRN, photo), `badges`, `audit_log`
- lead fields: `source`, `source_detail`, `telegram`, `whatsapp_number`, `wants`, `lost_reason`, `no_show_count`, `is_vip`, `stage`

---

## 10. Build order (one pull request per phase into `v2`; each phase covers phone and computer and is shown on `new.crm.homes.me`)

0. **Discovery and plan** — `docs/build-plan.md`, schema proposal, parity table, hosting steps for the second address and the database copy, questions from section 12. Stop for approval.
1. **Second address** — branch `v2`, `new.crm.homes.me` online with a copy of the database, "TEST VERSION" banner, real alerts switched off there, refresh script.
2. **Design system and shell** — theme tokens from `ui.css` (light / dark / auto); computer shell (grouped sidebar, folded rail, top bar, Ctrl K search, bell panel, profile menu, toasts, side panel, dialog); phone shell (bottom bar, dial button, sheets); owner home vs agent home; server-side permission checks and the "Only for owners and admin" block; sign-in page. Existing pages get the new look in this phase so nothing looks half old.
3. **Notifications on** — Firebase values, device tokens, test button, in-app list with deep links, "who has notifications on" for owners.
4. **Leads core** — My Leads, lead page (edit, notes, files, timeline), add lead with owner mode and VIP, Incoming and "VIP leads I gave", All leads with filters and move, search, take-back rule.
5. **Calling** — check-in rule on every call button, calling list, call logs, follow-ups, pipeline.
6. **WhatsApp / Telegram tracking** — ready messages, tracking links, "what happened?", owner messaging report.
7. **Calendar and tasks** — plans, results, Won form, tasks, follow-ups tab.
8. **Attendance** — check-in, outside, leave and approvals, team attendance, rules.
9. **Lead transfer** — section 8.
10. **Import** — extend the existing import to the 6 steps in section 6.
11. **Owner tools** — owner home and dashboard, team live, activity, desks, projects, banners, feedback inbox, team and roles, automations, company, AI settings, system health, sales offers restyled.
12. **Team and me** — Meet the team, colleague panel, wall, Best of Homes, profile, personal information, business card, security, settings.
13. **All remaining notification events** from the table in section 7, quiet hours, grouping, Telegram backup.
14. **Homes AI.**
15. **Pilot on `new.crm.homes.me`** — 2 or 3 agents and one owner test for a week with copied data; fix what they report. Finish `docs/cutover.md`.
16. **Switch** — the cutover from section 0.1, with Emir's written yes, outside work hours. Then 14 days of rollback readiness.

---

## 11. Quality bar

- Fast on a mid-range phone on 4G: first load under 3 seconds.
- Secure: every permission checked on the server; logins rate-limited; location stored only when shared, once per trip.
- Nothing the live CRM can do today is lost in the new version.
- The build matches the design: side-by-side screenshots in every pull request (section 0.2).
- Both themes readable on every screen.
- Every text simple enough for basic English. No jargon (no "EOI", "SPA", "XP").
- Automated tests for: take-back rule, check-in rule, transfer rules, duplicate check, import counts, Won validation, permissions.

---

## 12. Open decisions — ask Emir before building these

1. Address of the new version: `new.crm.homes.me` (assumed) or another name?
2. Office number on the business card: **16 or 12**? (The live card tool shows 16; Emir's latest info: Floor 16, Office 12.)
3. Company name on the card: "**Emigeo**" or "EMIGEO"? (Emir's latest info: "Emigeo".)
4. Should owners also check in before calling? (Assumed: no.)
5. Take-back times: VIP 30 minutes, imported leads 24 hours. Confirm or change.
6. Lead transfer: is "Meeting and Offer need owner approval" right, or should all transfers be free / all need approval?
7. Who gets owner tools: both owners and the admin? (Assumed: yes.)
8. Telegram backup alerts: build now or later?
9. Sample numbers in the design that do not agree (Won 4 against units booked this month; open leads per agent against 809 open): the real data decides; tell Emir if a definition is unclear (what counts as "open", "won", "booked").

Decided already: one orange design system for phone and computer (section 1.1); the computer look is `design/web`; the old CRM stays live until the switch; AI is called "Homes AI"; Import has 6 steps.

---

Start with **Phase 0**: explore the repo, then show Emir `docs/build-plan.md` with the parity table, the hosting steps and your questions. Do not write feature code until he approves.
