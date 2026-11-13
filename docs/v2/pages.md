# v2 — Page reference (computer / web)

Condensed from `design/web/research/sage.md` (the Sage feature map, which itself derives
from the 12 Nov 2026 master prompt, 59 phone screens and the old `s_web.py`).
**This file is not the build reference, and it must not be used as one.** Ten
screens were built from it and came out in the right colours with invented
layouts; the owner stopped the build over it on 12 Nov. A screen is built from
its page in `design/web/*.html` — see "The v2 build" in `CLAUDE.md` for the
method. What this file is good for is the list of what a page must contain,
who may see it, and which endpoint feeds it. Where it and the design file
disagree about layout, the design file wins.

Conventions used below:
- Roles: **O** = Owner, **Ad** = Admin (same as Owner but cannot remove owners), **Ag** = Agent.
- `Screen` in backticks = the phone screen the page replaces.
- Text in "quotes" is **exact wording to keep** (phone wording, not to be reworded).
- 46 pages total: 43 built + 3 marked LATER (§44–46).
- Pattern for the computer version: tables instead of cards, side panels / dialogs instead of
  bottom sheets, same fields, buttons, rules and wording as the phone.

---

## Global shell (applies to every page)

**Sidebar** (= phone `Menu`)
- Groups: OWNER & ADMIN (owner/admin only), MY WORK, TEAM; then Notifications, Settings, Sign out.
- Badges: Incoming 3, Leave requests 2, Lead transfers 1, Follow-ups 5.
- Web-only item with no phone screen that stays: **Sales offers**.
- LATER item label: "Inbox · later".

**Top bar**
- Search box, bell with unread count, "+ Add lead" (opens the global add-lead dialog),
  Homes AI pill (floating), profile menu.

**Check-in gate** — fires on every call button, for agents, during work hours 09:00–18:00:
- Dialog "You're not checked in yet" with three choices: *Check in now and call* /
  *I'm working outside* / *Call anyway*.
- "Call anyway" marks the call **"not checked in"** and owners can see it.
- Not asked for: owners, admin, outside work hours, or while the agent is already marked outside.

**Role rules**
- Agent sees own leads + free leads only. Owner never lands on an agent page.
- Owner-only pages show agents the block message "Only for owners and admin".
- No export for agents.

**Cross-cutting UI rules**
- Light / Dark / Auto theme, both readable. Sounds with an off switch. Toasts.
- Confetti on Won / Booked a unit / check-in / VIP accept.
- 24-hour clock. Real date/time pickers. **No past dates anywhere.**
- **Two-click rule for every risky action** (delete, deactivate, check out, send back, etc.).
- Loading / empty / error states on every list.
- i18n: English / العربية; Arabic RTL is LATER.
- **Never write "sent" for WhatsApp/Telegram** — the agent presses send in the real app;
  the CRM only logs the tap and then asks "What happened?".

---

## Start

### 1. `login.html` — all
Purpose: sign in. Replaces `Login`.
- Blocks: email field, password field, "Keep me signed in", Sign in button, language toggle
  English / العربية, link to the install guide.
- Two-step sign-in for owner/admin.
- Demo role chooser (Agent · Rocky / Owner · Emir) is **demo only** — not production.
- Rules: email format checked; password min 4 chars; single error string
  "Write your work email and your password."

### 2. `install-guide.html` — all
Purpose: how to install the app and turn on notifications. `InstallGuide`.
- Blocks: iPhone / Android switch — iPhone 5 steps (iOS 16.4+, **Safari only**), Android 4 steps.
- "What you will see" — notification samples.
- Table "tap a notification, it opens…" (notification type → destination page).
- "Turn on notifications" button → success state "Notifications are on · test sent".
- Link to alert settings.
- Computer addition: a line saying browser notifications are optional.

---

## Home

### 3. `my-day.html` — Ag
Purpose: the agent's start-of-day screen. `Main`.
Blocks, top to bottom:
1. Greeting + date.
2. Owner banners carousel — 3 slides, dots, 4.5 s auto-advance.
3. **Check-in card**: "OFFICE WI-FI FOUND · Ready to start your day? · Shift 09:00 – 18:00",
   buttons *Check in* and "I'm working outside today".
   After check-in becomes a pill "In office", or "Outside · place · with whom · back by" + "I'm back".
   Dialog "Are you back in the office?" (Yes / Not yet) — **asked once only**.
4. "Turn on notifications" card (Turn on, How to install, dismiss) — shown until answered.
5. **VIP card**: "VIP LEAD FROM EMIR", **live countdown** "24:12 left to call", lead name,
   Emir's note, *Accept VIP lead*, "I can't take it" → confirm "Tap again to send it back" →
   message + Undo. After accept the button becomes *Call now*. When the timer ends:
   "Time is over · back in Incoming".
6. Next up.
7. Tiles: My leads / To call today / Hot leads / Meetings.
8. Today's calls ring: 18 of 40, 9/20 WhatsApp, 1/2 meetings, 12 days streak, +240 points.
9. "Start calling · 12 ready" — locked text when not checked in: "Check in to start calling".
10. "2 messages waiting for your update" — each row has "What happened?".
11. "Marco Bellini opened your brochure link" (tracked-link alert).
12. Shortcuts: Add lead / Follow-ups / Calendar / Projects.
13. My leads by stage → links to Pipeline.
14. Best time to call now — 3 leads with call buttons.
15. Meet your colleagues strip.
16. Projects we sell now.
17. Homes AI tip.
18. Lead transfers "1 for you" (carried over from the old web app).
- Confetti on check-in and on VIP accept.

### 4. `owner-home.html` — O/Ad
Purpose: the owner's start-of-day screen. `OwnerHome`.
- Top actions: "Add a lead and give it", "Import Excel", "Incoming · 3".
- **NEEDS YOU NOW** list, each row with its own action:
  VIP not called → *Give again*; 2 leave requests → *Answer*; absent agent → *See*;
  leads waiting → *Give*; transfer approval → *Approve*; blocking bug → *Open*.
- **Team today**: In office / Late / Outside / Absent-leave — each opens team attendance.
- **TODAY IN NUMBERS** — every row opens its filtered list: New leads; Calls · WhatsApp ·
  Telegram; Meetings booked; Units booked; Follow-ups overdue; No next step.
- "Open the full dashboard" link.
- Team-right-now table.
- Agents hitting this page get the "Only for owners and admin" block (true of every owner page).

### 5. `notifications.html` — all
Purpose: notification centre. `Notifications`.
- Counter "N new", "Mark all read".
- Tabs — Agent: All / Leads / Meetings / Tasks / Team. Owner: All / Leads / Team / System.
- Row: icon, title, text, age, unread dot, action link that opens the **exact page / tab / dialog**.
- Empty state. Link "Choose what reaches you" → settings.

### 6. `search.html` (+ top-bar box) — all
Purpose: one search across everything. `Search`.
- One box, placeholder "Name, phone, project, screen".
- Chips: All / Leads / Projects / Tasks / Screens. Recent searches.
- Results carry a type tag.
- Rules: accepts **any phone format**; other agents' leads are shown **by agent name only**
  (no detail); no results → "Nothing found" + "Add as a new lead".

### 7. `homes-ai.html` (+ floating pill) — all
Purpose: ask the assistant. `AskAI`.
- Chat thread; 5 "TRY ASKING" chips; every answer carries a link to the right page.
- Error state when the question is empty.
- Disclosure text: "reads only your own leads. It never sends a message for you."

---

## Leads

### 8. `my-leads.html` — Ag
Purpose: the agent's own lead list. `Leads`.
- Header line "62 open · 12 to call today".
- Search by name / phone / project.
- Tabs: Today · 12, New, Overdue, No next step, VIP, Lost, All. Count line under the tabs.
- Links: Free leads, Pipeline.
- "Start calling · 12 ready" (Today tab only) → opens `calling.html`.
- Table columns: lead, phone, project, stage chip, VIP tag, client local time,
  next-step note (**red** if overdue, if the lead goes back, or if VIP), Call + WhatsApp per row.
- Empty state + "Add a new lead".

### 9. `lead.html` — all
Purpose: the single lead record and everything you can do to it.
`Lead` + `Notes` + `TransferLead` + single-call `Dialer`.
**Header:** phone **largest element**, name, "with Rocky" (owner), stage, Score 72, tags,
country, client local time, best time to call, Next step.
**Banner:** "WhatsApp opened · waiting for your update".
**Action row:** Call, WhatsApp, Telegram, Follow-up, Meeting, Won, Lost.
- Under the actions: "Transfer this lead to another agent" (or the status of an open request).
- Owner variant: "give this lead to another agent".
**Body blocks:**
- "In short".
- "What Marco wants": Project, Unit, Budget, Purpose, Timeline, Payment, Language —
  **click a line → inline edit → the change is written on the timeline**.
- Wants / Doesn't want chips. Source. Lead #.
**Tabs:** Notes N / Timeline / Info / Files.
- Info: Phone, WhatsApp 2, Email, Nationality, Birthday, change history.
- Files: list with Open; + Photo, + Booking form, + ID or passport;
  note "only you and owners see it".

**Dialogs:**
- **Add note** — types Note / Call / Viewing / Budget / Objection / Next step; quick phrases per
  type; voice record/stop; "Remind me": In 1 h / Tonight / Tomorrow 10:00 / Pick time;
  @name tag; Pin/Unpin; Edit. *Validation: needs text or a voice recording.*
- **Follow-up** — when: In 1 hour / Tonight 19:00 / Tomorrow 11:00 / Pick date & time;
  How: Call / WhatsApp / Email; what it is about.
- **Meeting** — type Office meeting / Site visit / Show flat / Video call; when; where;
  then WhatsApp opens with the time; reminder 2 h before.
- **Won** — unit, price, paid now (**must be ≤ price**), **booking form or receipt required**,
  what was signed; confetti; posted on the Team wall; +300 points.
- **Lost** — **reason required**: Bought elsewhere / Budget too low / Just browsing /
  Not into off-plan / Is a broker, not a buyer / Other. Sets "Try again in 3 months".
- **WhatsApp / Telegram** — pick a ready message (Meeting time / Hello / Brochure /
  Payment plan / Write my own; tracked link) → "Open WhatsApp" → on return the
  **"What happened?"** dialog: Sent, waiting for reply / He replied: interested /
  He replied: not now / Not interested → *then a Lost reason* / Wrong number / Didn't send;
  plus note and voice; or "Later".
- **Voice notes & gallery** — player with 1.5x, transcript, "AI found fields" → "Save 4 to lead";
  folders Passport & ID / Booking forms / WhatsApp screenshots / Payment receipts;
  Scan/upload. Note "Every view is logged".
- **Transfer panel** — see `transfers.html` (§15) for the form, options and rules.

### 10. `add-lead.html` (page + global dialog) — all
Purpose: create a lead. `AddLead`.
- **Nothing is preselected.**
- Required: full name; phone (**digits only, ≥ 7**, country picker with search and regions
  Popular / GCC / Europe / Asia / Africa / Americas / Oceania / All); lead source.
- Live phone check: "We check every number…" → "New number." or a **duplicate that blocks the
  save** and names who holds it + an Open link.
- Optional: "WhatsApp is the same number" switch (otherwise a 2nd number), Telegram, Email,
  Project (4 projects + "Not sure yet" + Other → type it), Looking for, Budget, Buying to,
  Speaks (multi-select), note.
- **Source lists differ by role:**
  - Agent: Walk-in, Referral, Event / expo, My own call, Old client, Social media (mine), Other.
  - Owner: Email to owner, Owner's contact, Referral, Walk-in, Event / expo, Old client, Other.
  - Referral / Event / Other each ask for a detail.
- Agent extra: "Who works it?" → Me / Leave in Incoming.
- **Owner mode:** agent list with status dot + open-lead count (**agents on leave or absent cannot
  be chosen**), "Leave in Incoming", VIP switch, "Must call within" 15 min / 30 min / 1 hour /
  Today, private note.
- Saved state: *Open lead* / *Add another*. (+10 points for adding a lead.)

### 11. `incoming.html` — all
Purpose: the free-lead queue and the owner's VIP hand-outs. `Incoming` + `OwnerAssign`.
- Rows: lead, project, "waiting 42 min", and the reason it is free
  (e.g. "Shan did not call in 24 h").
- Agent view (labelled "Free leads"): "Take this lead" → the lead moves to My Leads.
- Owner view: "Give to an agent" dialog (agents listed with their open counts);
  "Share the normal leads equally" (**two clicks**; **VIP is never shared**). Rule text shown.
- Owner tab **VIP leads I gave**: sub-tabs All / Needs you / Going well;
  status per row Waiting / Called / Meeting / Offer / Came back;
  actions "Give to another agent" (resets a 30-min call limit), "Remind the agent",
  "I will call myself"; plus "Add a lead and give it as VIP".

### 12. `pipeline.html` — all
Purpose: see the funnel. `Pipeline`.
- Columns with counts: New / Called / Interested / Meeting / Offer / Won.
- Cards open the lead; each card has a Call button.
- **Rules: no drag-and-drop, and no stage change by clicking.** Lost is kept apart.

### 13. `calling.html` — Ag
Purpose: work the day's call queue one lead at a time. `Dialer`.
- Queue = the Today list, **VIP first**. "Lead 1 of 12", progress bar, "+15 points per call".
- Lead card: phone, client local time, why this lead, Project / Budget / Wants, and a "Say:" script.
- Buttons: Call, WhatsApp ("tap logged").
- Outcomes:
  - **Interested** → pick the next step: payment plan on WhatsApp / book meeting-site visit /
    call back tomorrow 11:00 / brochure + location.
  - **No answer** → retry in 2 h, optional WhatsApp.
  - **Busy** → retry in 1 h.
  - **Call back** → date/time + why.
  - **Wrong number** → new number, or flag for the owner.
  - **Not interested** → reason + try again in 3 months.
- Rules: must click Call or WhatsApp **before** an outcome can be set; an outcome is required
  before *Next* (or use *Skip*); *Undo* available; Prev / Skip / Next controls.
- Banner when "not checked in".
- End summary: Calls, WhatsApps, Results saved.

### 14. `all-leads.html` — O/Ad
Purpose: every lead across the company. `AllLeads`.
- Header "863 leads · every agent".
- Agent filter (All + 10 agents).
- Filters: All / Going cold · 12 / Overdue · 9 / No next step · 31, plus stage and project.
- Table: lead, phone, project, stage, agent, last contact, attention.
- Select one or many → **"Move N leads" panel**: target = a working agent or Incoming;
  note shown: "notes and history go with them".

### 15. `transfers.html` — all
Purpose: hand a lead to another agent, and approve those hand-offs.
`Transfers` + `TransferLead`.
- **Agent view:** FOR YOU (*Accept* / "No, thanks", deadline "Answer by 18:00");
  YOU SENT (*Remind*, *Cancel*, status Waiting / Owner must approve / Refused).
- **Owner view:** NEEDS YOUR APPROVAL (*Approve* / *Refuse*);
  ALL TRANSFERS · LAST 7 DAYS;
  "THIS MONTH · WHO GIVES AND WHO GETS" with a flag line ("Shan gave away 6 leads").
- **Transfer form:**
  - Language filter built from agent profiles: All, Arabic, Russian, Hindi, Urdu, Portuguese, Serbian.
  - Agent cards: photo, status, languages, open leads, deals this month, reply time,
    profile link, "Best match" marker.
  - Card order: agents who **can take it now** first, then **fewest open leads**.
  - Reason **required**: Speaks the client's language / I am going on leave / The client asked /
    Knows the project better / I have too many leads / Other + note (**≥ 5 chars**).
- **Rules:** own leads only; agents on leave or absent are not selectable;
  one open request per lead; **VIP cannot be transferred** (send it back to the owner instead);
  stages **Meeting and Offer need owner approval first, then the receiver accepts**;
  the lead stays with the sender until accepted; a request with no answer **ends at 18:00**.

---

## Calendar and tasks

### 16. `calendar.html` — all
Purpose: plans, meetings and their results. `Calendar`.
- Views Month / Week / Day (**Monday start**), arrows, Today.
- Legend: Meeting, Site visit, Call, Follow-up, Team; "3+" badge; multi-day band.
- Day list; busy-day hint.
- **New plan dialog:** type; **lead picked from a list, not free text** (no lead for a Team plan);
  title; day; time; **clash warning**; "Runs for several days" (**2–5 days**);
  length 15 min / 30 min / 1 h / 2 h; place Office / Sales centre / Client's place / Online / Zoom;
  reminder 15 min / 1 h / 2 h before. **Past dates refused.**
- **Open plan panel:** Open the lead, Change day or time, Delete (**two clicks**).
  Team plan: owners can change it, agents can only "Hide for me".
- **"How did it go?" dialog:**
  - **Showed up** → next step (Send the offer / Second meeting / Site visit /
    Follow up in 2 days + date/time), interest Hot / Warm / Cold, note.
  - **No-show** → counted; a message is prepared; Try again options; **red flag after 2**.
  - **Rescheduled** → new day/time, who asked.
  - **Booked a unit** → project, unit, price, paid (**≤ price**), receipt → becomes Won.
  - **Cancelled** → by Client / Me / Developer. **Cancelled is not a no-show.**
  - **Rule: the result must be answered before 21:00.** Undo available.

### 17. `tasks.html` — all
Purpose: the to-do list and the follow-up queue. `Tasks` + `FollowUps`.
- Week strip with "N left", prev/next week, Today.
- Tabs To do / Done.
- Row: checkbox, type (Call / Overdue / Meeting / WhatsApp / From Emir / Other), title, time,
  "⋯" menu (Change, Move one day later, Delete **two clicks**).
- **New task:** text, type Call / WhatsApp / Meeting / Other, day (**no past dates**), time,
  optional lead.
- A Meeting task asks for its result **only after its time has passed**
  (Client showed up / No-show / Cancelled / links into Calendar).
- **Follow-ups section:** tabs Overdue / Today / Tomorrow / This week with counts;
  "Call these N one by one"; Call button;
  *Done* → "What happened with X?" (Spoke · all done / No answer · try again tomorrow /
  Booked a meeting / Not interested); *Move to tomorrow* / *one day later*.

---

## Projects

### 18. `projects.html` — all
Purpose: the projects we are selling now. `LiveProjects`.
- Owner message block.
- 4 project cards: status, developer, pitch line, "Your leads 24 · Team 115",
  and where new leads for that project go.

### 19. `project.html` — all
Purpose: one project, and sending it to a client. `ProjectDetail`.
- Facts: Starting from, Payment plan, Unit types.
- "The pitch in 3 lines".
- **"Send to a client"**: Brochure / Payment plan / Location / Video → pick a lead →
  open WhatsApp or Telegram, or copy the link (tracked link `homes.me/p/…`).
- Your leads in this project.

### 20. `manage-projects.html` — O/Ad
Purpose: add and edit projects. `ManageProjects`.
- Add / edit form: Project name*, Developer*, Area, Starting price. **Project name must be unique.**
- Upload brochure: **PDF, up to 30 MB**.
- Status: Selling now / Launching soon / Hidden. **A new project starts Hidden.**
- "See as an agent" preview.

### 21. `home-banners.html` — O/Ad
Purpose: the banners on My Day. `OwnerBanners`.
- Live preview.
- Fields: image upload or project photo; Label (From Emir / Office / Project / Best of Homes /
  Training); Title; Short text; Button text; Opens (Project page / Best of Homes / Team wall /
  A web link); Show from / Until; Who sees it (Everyone / Agents / One desk); Publish.
- List with state Live / Scheduled / Ended, "seen by 9 of 10", **drag to reorder**.
- **Rules: max 5 banners; image 1200 × 500 px.**

---

## Team

### 22. `team.html` — all
Purpose: the team directory. `TeamDirectory` + `Colleague` (side panel).
- Header "10 agents · 6 in office now".
- Search by name or language.
- Filters: All / In office now / Dubai off-plan / Arabic desk / Abu Dhabi.
- Side panel: status, languages, what they sell, 4 stats, deals last 6 months as bars, badges,
  Phone / WhatsApp buttons.
- **Rule: colleague Phone/WhatsApp are plain links — nothing is logged and the check-in gate
  does not fire.**

### 23. `team-wall.html` — all
Purpose: the team feed. `TeamWall`.
- Post box (**text required**), posts list, 👏 and 🔥 reactions, owner news.
- Won deals are posted here automatically (see §9 Won).

### 24. `best-of-homes.html` — all
Purpose: the leaderboard. `Leaderboard`.
- Week 46 podium; ranking table (calls · meetings · points);
  motivator line "6 calls or 1 meeting puts you in first place"; "Level 7 · Closer"; badges.
- Points: +10 add lead, +15 per call, +300 Won, +15 feedback. Streak and levels.

---

## Attendance

### 25. `attendance.html` — Ag
Purpose: my own attendance and leave. `Attendance` + `WorkOutside` + `LeaveRequest`.
- States: not checked in → in office → outside → checked out.
- *Check in* — **office network only**, uses real time, **late after 09:10**.
  *Check out* — **two clicks**. "Check in again".
- Colour guide; week strip; month view (Sep / Oct / Nov) with totals; day details; **"Month PDF"**.
- **Working outside dialog:** Share my location (**once**), why (6 reasons), with who,
  where exactly (**required**), back by (16:30 / 17:30 / 18:00 / Tomorrow), note;
  then "I'm back in the office".
- **Request leave dialog:** shows 14 annual left / 3 sick used / pending;
  type Annual / Sick / Personal / Half day / Work from home / Other;
  From / To (**working days counted; days off and past dates refused**); reason; sick note upload.
  Pending card with *Cancel*; history list.

### 26. `team-attendance.html` — O/Ad
Purpose: who is in, and approving leave. `TeamAttendance` + `LeaveApprovals`.
- Counters; everyone by name with status, time, place/reason.
- Row actions: "Phone Bassam", "Mark as leave", "See shared location".
- Grid: last 8 working days × 10 agents.
- **Leave requests:** *Approve* / *Refuse* with a reason (Too many people away /
  Busy week · launch / Talk to me first); "Change my answer"; ANSWERED list.
- Link to Rules.

---

## Me

### 27. `profile.html` — all
Purpose: my profile, details and security. `Profile` + `PersonalInfo` + `Security`.
- Performance card: 86%, deals, viewings, average reply time; plus links.
- Personal info: photo change/remove, name*, title, phone* (**≥ 9 digits**), WhatsApp, email,
  languages (**these feed the transfer form and the team filters**), BRN* (**4–6 digits**),
  completion bar.
- Security: change password, two-step (owner/admin only), signed-in devices,
  Sign out one / Sign out all others.

### 28. `digital-card.html` — all
Purpose: the agent's digital business card. `DigitalCard`.
- Public share switch + copy link.
- 3 steps:
  1. **Design** — Signature / Reverse / Light; flip; compare.
  2. **Details** — name, title, BRN, phone, WhatsApp (same-as-phone), email, website,
     2 address lines; switches Tagline / WhatsApp QR / Rounded corners / Company name;
     size 85 × 55 mm or 3.5 × 2 in; safe area.
  3. **Download** — PDF (+ crop marks), PNG, JPG, Mockup.
- **Rule: must match the live tool exactly.**

### 29. `feedback.html` — all
Purpose: report a bug or ask for a feature. `Feedback`.
- Fields: type Bug / Issue / New feature / Idea; title; text (**required**); where; screenshot;
  voice note; urgency Low / Normal / Blocking my work.
- Send → ticket number (e.g. #1042). MY REPORTS list with status. (+15 points.)

### 30. `settings.html` — all
Purpose: appearance and alerts. `Settings` + `SettingsNotifications`.
- Appearance: Light / Dark / Auto; sounds; language.
- Notifications: **Test** button; per-alert switches grouped —
  agent groups MY LEADS / MY DAY / TEAM AND OFFICE;
  owner groups LEADS / TEAM / SYSTEM.
- Quiet hours: Off / 22:00 – 08:00 / 20:00 – 09:00, with a **VIP exception**.
- Owner sections are hidden from agents. Sign out.

---

## Owner tools (all O/Ad; agents see the block message)

### 31. `import.html` — O/Ad
Purpose: bulk-import leads from a spreadsheet. `Import`.
- **6 steps:**
  1. **Upload** — Excel / CSV, **≤ 5,000 rows**, template download.
  2. **Columns** — Name + Phone **required**; a field may be used **once only**.
  3. **Check** — e.g. 240 = 208 new + 18 duplicates + 14 bad; duplicate handling
     *Skip them* / *Fill empty details only* / *Import them again as new*;
     **download bad rows**.
  4. **Give** — project; then *Agents I choose · equal split* / *A desk* / *Incoming*.
  5. **Confirm.**
  6. **Done** — per-agent result; **Undo within 24 h** (with confirm);
     **one grouped notification per agent**.
- Rule: Undo keeps leads that have already been called.
- Imported leads come in with their own take-back clock (see §40).

### 32. `dashboard.html` — O/Ad
Purpose: the full owner dashboard. `OwnerDashboard`.
- Period selector Today / Week / Month / Year — **changes calls, meetings and deals only**.
- Blocks: totals; by stage; attendance; Morning brief; Touched in 2 h; First click; Call clicks;
  Meetings booked; by project; Team today table; sources; new leads per day;
  **GOING COLD** (with *Move 31* and *View*).

### 33. `team-live.html` — O/Ad
Purpose: what the team is doing right now. `OwnerLive`.
- Call / WhatsApp clicks; clicks by hour; "Right now · 8 online"; attendance; AI suggestion.

### 34. `team-activity.html` — O/Ad
Purpose: usage and sign-in security. `TeamActivity`.
- Tabs: Time in CRM / Sign-ins (with *Sign out*) / Unusual.
- Unusual rows have a *Review* action: "It was them" or
  "Sign out everywhere and reset the password".

### 35. `messaging-report.html` — O/Ad
Purpose: did the messages actually go out. `OwnerMessaging`.
- Metrics: Taps / Confirmed / Replied / Links opened.
- Per-agent table including a **NO UPDATE** column (taps with no "What happened?" answer).
- Links opened by clients. "How it is counted" explainer.

### 36. `feedback-inbox.html` — O/Ad
Purpose: triage team feedback. `OwnerFeedback`.
- Tabs New / Planned / Fixed / All.
- Actions: *Plan it*, *Mark fixed*, *Open again*, *Reply*. Export file.

### 37. `settings-team.html` — O/Ad
Purpose: people and roles. `SettingsTeam`.
- Counts; 13 people listed.
- **Invite**: name, **real email**, role Agent / Admin; **no duplicate emails**.
- Role change: **giving the Owner role needs a second click**.
- Per-person: reset link, sign out everywhere,
  **Deactivate (two clicks; never an owner; that person's open leads go to Incoming)**.
- **Rule: you cannot change yourself.** Role table shown.
- Addition from spec §7.8: a column for **who has notifications on**.

### 38. `settings-attendance.html` — O/Ad
Purpose: attendance rules. `SettingsAttendance`.
- Office Wi-Fi list: add, remove (**two clicks**), **must keep at least one**.
- Shift 09:00 / 18:00; late after 09:10; days off.
- WORKING OUTSIDE switches (4); CALLS switches (2).
- Monthly report (**Excel**).

### 39. `desks.html` — O/Ad
Purpose: desks / teams. `Desks`.
- Add / edit / delete (**two clicks**); members; max open leads 40 / 50 / 60 / 80.

### 40. `automations.html` — O/Ad
Purpose: automatic take-back and alert switches. `Automations`.
- **Take-back timers:** VIP 15 min / 30 min / 1 hour / 2 hours;
  imported 4 / 24 / 48 / 72 hours.
- **Rule: the clock stops outside 09:00–18:00.**
- Switch groups: LEADS (3), FOLLOW-UPS AND MEETINGS (4), ATTENDANCE (4).

### 41. `company.html` — O/Ad
Purpose: company identity. `Company`.
- Logo, legal name, brand name, ORN, TRN, address, phone, email, website.

### 42. `ai-settings.html` — O/Ad
Purpose: AI budget and permissions. `AISettings`.
- Budget "$38 of $100"; 5 "AI CAN" switches; free-text "What AI should know about us".

### 43. `system-health.html` — O/Ad
Purpose: are the services up. `Health`.
- 6 services with status; "Run a check now".

---

## LATER (drawn, clearly labelled, not built)

Every page below carries the banner:
"LATER PHASE · Not in the first build. For now WhatsApp and Telegram open on the agent's phone
and every tap is logged." Sidebar label: "Inbox · later".

### 44. `inbox.html` — LATER
`Inbox` + `Chat`. Unified conversation list and thread.

### 45. `email.html` — LATER
`Email`. Includes the VIP email preview.

### 46. `templates.html` — LATER
`Templates`. 16 WhatsApp templates.

---

## Rules that span pages ("do not forget")

1. The VIP countdown is **live**; warning 10 minutes before; when time is over the lead goes
   back to Incoming **and the owner is told**.
2. **"What happened?" follows every WhatsApp/Telegram click.** Unanswered ones are listed on
   My Day and counted in the owner messaging report (NO UPDATE).
3. The duplicate phone check **blocks the save** and names the holder.
4. Calling on a computer uses `tel:` **or** shows the number + a QR code — logged identically.
5. Client **local time** and **best time to call** appear on lead rows and on the lead page.
6. Tracked links `homes.me/p/…` plus the "client opened your link" alert.
7. No-show counter with a **red flag after 2**; **Cancelled is not a no-show**.
8. Meeting result deadline **21:00**; owners see who did not answer.
9. Calendar clash warning; team plans can only be **hidden** by agents.
10. Points: **+10** add lead, **+15** per call, **+300** Won, **+15** feedback. Plus streak,
    levels and badges.
11. "Wrong number" **flags the lead for the owner**.
12. Import: one notification per agent; Undo keeps leads already called; bad rows downloadable.
13. Deactivate → that agent's open leads go to Incoming; **an owner can never be deactivated**;
    giving the Owner role needs a second click.
14. Keep **at least one** office Wi-Fi; "Are you back?" is asked **once**.
15. IDs / passports: visible to the owning agent and owners only; **every view is logged**.
16. Search shows other agents' leads **by agent name only**.
17. Banner "seen by 9 of 10"; **max 5** banners.
18. Audit-log entries appear on the lead timeline, e.g. "Rocky changed budget 1.5M → 2M".
19. Quiet hours with a VIP exception; a Test notification button.
20. Colleague Phone / WhatsApp: **no logging, no check-in gate**.
21. "Month PDF" for the agent; monthly **Excel** report for the owner.

---

## Sample data (sage.md §3 — use exactly when building screens)

- **Now:** Wednesday, 11 November 2026, 14:55 Asia/Dubai. Shift 09:00–18:00, late after 09:10.
  Week 46. Office Wi-Fi "homes.me-Office".
- **13 people:** Emir Dulovic (Founder & CEO, Owner), George Vanous (Partner, Owner),
  Abdullah Mahi (Office admin, Admin), + 10 agents (Talha, Rocky Khan, Yuliia, Olga, Srdjan,
  Tej, Shan, Nelson, Sultan, Bassam) with status, check-in, open leads, languages, desk and
  deals/meetings per the table in sage.md §3.
- **Team today:** 6 in office, 1 late, 1 outside, 1 leave, 1 absent.
- **Desks:** Dubai off-plan (6, max 60), Arabic desk (Shan, Sultan, Rocky, max 50),
  Abu Dhabi (Nelson, Bassam, max 40).
- **Rocky:** 62 open · 12 to call today · 6 hot · 2 meetings; 18 calls of 40; 16 named leads.
- **VIP:** Khalid Al Mansoori, given by Emir at 14:49 to Rocky, 30-min limit, "24:12 left to call".
- **Follow-ups:** Overdue 1, Today 4, Tomorrow 2, This week 2.
  **Pipeline:** New 18, Called 16, Interested 14, Meeting 8, Offer 6, Won 2.
- **Incoming (3):** Lina Rahimi, Kevin Brooks, Omar Khan.
- **Owner numbers:** 863 leads (open 809, untouched 86); New 456, Called 214, Interested 96,
  Meeting 31, Offer 12, Won 4, Lost 50. Today: 27 new, 214 calls, 104 WhatsApp, 28 Telegram,
  5 meetings, 1 unit, 9 overdue, 31 no next step, 12 going cold.
  Import file Nov_batch_C.xlsx, 240 rows = 208 + 18 + 14.
- **Projects:** The Archive (Imtiaz, Business Bay, from AED 1.6M, 60/40, Q4 2027, team 115 /
  Rocky 24); Shahrukhz (Danube, Sheikh Zayed Road, AED 1.2M, 1% monthly, 64/11);
  Damac Islands (Damac, Dubailand, AED 2.7M, 75/25, 52/9); Valia (Emaar, The Oasis, AED 1.4M,
  80/20, launching soon, 28/6); Sei Saadiyat (Aldar, hidden).
- **Best of Homes:** Talha 1,980; Rocky 1,740; Nelson 1,310; Yuliia 1,120; Sultan 960.

---

## Fields implied by the design

Deduplicated list of every distinct data field the pages display or capture.

**User / agent**
id · full name · short name · photo · job title · role (owner/admin/agent) · work email ·
password hash · two-step enabled · phone (≥9 digits) · whatsapp number · languages[] ·
BRN (4–6 digits) · desk/team id · active/deactivated · profile completion % ·
performance % · deals (month, and last 6 months series) · viewings · meetings (month) ·
average reply time · open-leads count · points · level · streak · badges[] ·
notifications-on flag · signed-in devices (device, time, unusual flag) · last sign-in ·
time-in-CRM · projects they sell · theme preference · sounds on/off · language preference ·
quiet-hours setting · per-alert notification switches · VIP-exception flag

**Lead / contact**
lead id (shown as "Lead #") · full name · phone (E.164, digits only ≥7) · phone country ·
client local time (derived) · best time to call · whatsapp number + "same as phone" flag ·
second whatsapp ("WhatsApp 2") · telegram · email · nationality · birthday ·
project interest · unit type · budget · purpose ("Buying to") · timeline · payment method ·
languages spoken · "looking for" · wants chips[] · doesn't-want chips[] ·
source + source detail · stage (New/Called/Interested/Meeting/Offer/Won/Lost) · score ·
tags[] · VIP flag · VIP given-by · VIP given-at · VIP call deadline (15/30/60 min/Today) ·
VIP status (Waiting/Called/Meeting/Offer/Came back) · assigned agent · previous agent ·
"in short" summary · next-step text · next-step due-at · next-step overdue flag ·
"goes back at" (take-back time) · free/unassigned flag + reason-it-is-free ·
waiting-minutes · last contact at · no-answer count · no-show count · red flag ·
hot/warm/cold interest · going-cold flag · untouched flag · lost reason · lost note ·
"try again" date (+3 months) · won unit · won price · paid-now amount · what was signed ·
created at · created by · import batch id · private owner note · change history (audit)

**Note / activity / timeline**
note id · lead id · author · type (Note/Call/Viewing/Budget/Objection/Next step) · text ·
voice recording · transcript · AI-extracted fields + count · reminder-at · @mentions[] ·
pinned flag · edited at · created at · audit entry (actor, field, before, after, time)

**Call log**
lead · agent · timestamp · channel (call / whatsapp / telegram) ·
outcome (Interested/No answer/Busy/Call back/Wrong number/Not interested) ·
chosen next step · retry-at · reason · callback date/time + why · new number ·
"flagged for owner" flag · "not checked in" flag · points awarded

**Message click / tracked link**
lead · agent · channel · template used (Meeting time/Hello/Brochure/Payment plan/Own) ·
tracked link url (`homes.me/p/…`) · tapped at · confirmed flag ·
"What happened?" outcome (Sent waiting / replied interested / replied not now /
not interested / wrong number / didn't send) · outcome note · outcome voice note ·
no-update flag · client opened-at · opens count · replied flag

**Task**
id · title/text · type (Call/Overdue/Meeting/WhatsApp/From Emir/Other) · day · time ·
lead (optional) · done flag · done outcome · created by · assigned to · week bucket

**Follow-up**
lead · due at · channel (Call/WhatsApp/Email) · what it is about ·
bucket (Overdue/Today/Tomorrow/This week) · outcome (Spoke all done / No answer /
Booked a meeting / Not interested) · moved-to date

**Calendar plan**
id · type (Meeting/Site visit/Call/Follow-up/Team) · lead id · title · date · time ·
duration (15/30/60/120 min) · multi-day flag + end date (2–5 days) ·
place (Office/Sales centre/Client's place/Online/Zoom) · reminder (15 min/1 h/2 h) ·
created by · team-plan flag · hidden-for-user[] · clash flag ·
result (Showed up/No-show/Rescheduled/Booked a unit/Cancelled) · result note ·
result answered-at (deadline 21:00) · interest (Hot/Warm/Cold) · next action ·
rescheduled-to · who asked · cancelled-by (Client/Me/Developer) ·
booked unit / price / paid / receipt file

**Attendance**
user · date · check-in time · check-out time · late flag · office Wi-Fi matched (SSID) ·
state (not checked in / in office / outside / checked out) · shared location (once) ·
outside reason (1 of 6) · with whom · where exactly (required) ·
back-by (16:30/17:30/18:00/Tomorrow) · outside note · back-in-office at ·
"are you back" answered flag · month totals · month PDF

**Leave**
user · type (Annual/Sick/Personal/Half day/Work from home/Other) · from · to ·
working-days count · reason · sick-note file · status (pending/approved/refused) ·
refuse reason (Too many people away / Busy week · launch / Talk to me first) ·
answered by · answered at · annual days left · sick days used

**Transfer**
lead · from agent · to agent · reason (1 of 6) + note (≥5 chars) ·
status (Waiting / Owner must approve / Refused / Accepted / Cancelled) ·
created at · answer-by (18:00) · needs-owner-approval flag · approved/refused by ·
reminder sent at · month counters (gave / got per agent)

**Project**
id · name (unique) · developer · area/community · starting price · payment plan · unit types ·
handover · "pitch in 3 lines" · brochure PDF (≤30 MB) · payment-plan file · location ·
video link · photo/cover · status (Selling now / Launching soon / Hidden) ·
my-leads count · team-leads count · where new leads go · tracked link slug

**Desk / team**
id · name · members[] · max open leads (40/50/60/80)

**Banner**
id · image (1200×500) or project photo · label (From Emir/Office/Project/Best of Homes/Training) ·
title · short text · button text · opens-target (Project page/Best of Homes/Team wall/web link) ·
show-from · show-until · audience (Everyone/Agents/One desk) · status (Live/Scheduled/Ended) ·
sort order · seen-by count / total (max 5 banners)

**Team wall**
post id · author · text (required) · created at · reaction counts (👏, 🔥) · owner-news flag ·
auto-post on Won

**Leaderboard**
week number · agent · points · calls · meetings · rank · level name · badges[]

**Lead files**
file id · lead id · type (Photo / Booking form / ID or passport / Payment receipt /
WhatsApp screenshot / Passport & ID) · folder · file name · uploaded by · uploaded at ·
view log (viewer, time) · visibility (owning agent + owners only)

**Digital card**
public-share flag · share link · design (Signature/Reverse/Light) · name · title · BRN · phone ·
whatsapp (same flag) · email · website · address line 1 · address line 2 ·
switches (Tagline / WhatsApp QR / Rounded corners / Company name) ·
size (85×55 mm or 3.5×2 in) · outputs (PDF + crop marks, PNG, JPG, Mockup)

**Feedback ticket**
ticket number · reporter · type (Bug/Issue/New feature/Idea) · title · text (required) ·
where · screenshot · voice note · urgency (Low/Normal/Blocking my work) ·
status (New/Planned/Fixed) · owner reply · created at

**Notification**
id · user · category (Leads/Meetings/Tasks/Team/System) · icon · title · text · created at ·
read flag · deep-link target (page + tab + dialog) · grouped-import flag

**Import**
id · file name · total rows · new count · duplicate count · bad count · column mapping ·
duplicate strategy (Skip / Fill empty only / Import as new) · project · assignment mode
(chosen agents equal split / desk / Incoming) · per-agent result · status · created by ·
created at · undo-until (24 h) · bad-rows file

**Automation settings**
VIP take-back (15/30/60/120 min) · imported take-back (4/24/48/72 h) ·
clock-stops-outside-hours flag · LEADS switches (3) ·
FOLLOW-UPS AND MEETINGS switches (4) · ATTENDANCE switches (4)

**Attendance settings**
office Wi-Fi SSIDs[] (≥1) · shift start · shift end · late-after time · days off ·
working-outside switches (4) · calls switches (2) · monthly Excel report

**Company**
logo · legal name · brand name · ORN · TRN · address · phone · email · website

**AI settings**
monthly spend · monthly budget cap · 5 "AI CAN" switches · "what AI should know about us" text ·
AI suggestion text (team live) · AI tip (my day)

**System health**
service name (6) · status · last checked · run-check action

**Owner reporting / metrics**
period (Today/Week/Month/Year) · totals by stage · new leads per day · calls · WhatsApp ·
Telegram · meetings booked · units booked · follow-ups overdue · no next step · going cold ·
touched-in-2-h · first-click time · call clicks · clicks by hour · online-now count ·
sources breakdown · by-project breakdown · morning brief text · attendance summary ·
messaging taps / confirmed / replied / links opened / NO UPDATE per agent

---

## Open decisions (contradictions in sage.md — owner must choose)

Carried verbatim from sage.md §5; these are **not** design items to build, they are decisions.

1. **Open-lead counts disagree.** Rocky: 62 (My Leads, My Day, dashboard) vs 14 (every agent
   picker). Same split for Talha 72/22, Nelson 58/9, Yuliia 61/18. Which number is "open leads"?
2. **Stage strip does not add up.** My Day's strip (18/14/11/6/3/2) does not sum to 62;
   Pipeline's (18/16/14/8/6) does.
3. **Rocky's check-in state.** My Day shows him "not checked in" at 14:55, while team attendance
   shows him in office from 08:55 and counts 6 in office.
4. **Lead ownership disagrees between screens.** All-leads assigns Omar Khalil to Nelson,
   Sami/Neil/Hanna to Shan, Dave to Sultan, Vanessa/Parvez to Bassam, Bridget to Talha — the
   agent screens show all of them as Rocky's. Priya is "Called" on one screen and "Interested"
   on another. Lina Rahimi is Rocky's in Search but free in Incoming. Aisha Noor is Won in
   Pipeline and Meeting in the VIP list.
5. **Phone numbers disagree.** The calendar lead picker has different numbers from My Leads for
   Sara, Priya, Lucas, Ahmed and Elena. (sage.md's own table uses the My Leads / dialer numbers.)
6. **The 16:30 site visit** is with Lucas Martin in Calendar and Tasks, but with Khalid in
   Search, ProjectDetail and Inbox.
7. **Import step count.** 6 steps in spec §6 and on the phone; "7-step" in spec §0.
8. **"EOI".** The spec bans the term; the phone uses it (Won → "What was signed?", Valia, banner).
9. **Assistant name.** "Homes AI" vs "Emir AI" (Notes, Team live, the old web pill).
10. **"New sign-in" alert destination.** Opens Team & roles on the phone; the spec says
    Team activity / Security.
11. **Email as a channel.** Email appears as a follow-up method and in settings
    ("Push, email", "Daily summary email") while *sending* email is marked LATER.
12. **Business card details.** "Office 16" and "EMIGEO" are both open; card link is
    `homes.me/card/rocky` in one place and `crm.homes.me/card/rocky` in another.
13. **"Hot lead (ready to book)".** The spec says an agent marks this; no such button exists on
    the phone lead page — only Hot/Warm/Cold inside the meeting result.
14. **No screen exists** for spec §7.8 "who has notifications on", nor for Telegram backup alerts.
