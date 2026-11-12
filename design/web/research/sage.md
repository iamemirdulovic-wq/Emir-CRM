# Sage — full feature map for the computer version (homes.me CRM)

Sources: master prompt (12 Nov 2026), all 59 phone screens (template text + script of each file read), old `s_web.py`. Nothing here is invented; wording in "quotes" is the phone wording and must be kept. Pattern (spec §4): tables instead of cards, side panels/dialogs instead of bottom sheets, same fields, buttons, rules, wording.

## 1. PAGE LIST (46 pages cover all 59 phone screens)

Roles: O = Owner, Ad = Admin (same as Owner, cannot remove owners), Ag = Agent.

### Start
1. **login.html** — all. Replaces `Login`. Email + password (email format checked, password min 4; error "Write your work email and your password."), "Keep me signed in", Sign in, language English / العربية, link to install guide, two-step sign-in for owner/admin. Demo role chooser (Agent · Rocky / Owner · Emir) is demo only.
2. **install-guide.html** — all. `InstallGuide`. iPhone (5 steps, iOS 16.4+, Safari only) / Android (4 steps) switch, "What you will see" notification samples, table "tap a notification, it opens…", "Turn on notifications" → "Notifications are on · test sent", link to alert settings. On computer add: browser notifications are optional.

### Home
3. **my-day.html** — Ag. `Main`. Greeting + date; owner banners carousel (3 slides, dots, 4.5 s); check-in card ("OFFICE WI-FI FOUND · Ready to start your day? · Shift 09:00 – 18:00", Check in, "I'm working outside today") → becomes pill "In office" / "Outside · place · with whom · back by" + "I'm back"; "Are you back in the office?" dialog (Yes / Not yet); "Turn on notifications" card (Turn on, How to install, dismiss) until answered; **VIP card**: "VIP LEAD FROM EMIR", live countdown "24:12 left to call", lead, Emir's note, "Accept VIP lead", "I can't take it" → "Tap again to send it back" → message + Undo; after accept "Call now"; when time ends "Time is over · back in Incoming"; Next up; tiles My leads / To call today / Hot leads / Meetings; Today's calls ring (18 of 40, 9/20 WhatsApp, 1/2 meetings, 12 days streak, +240 points); "Start calling · 12 ready" (locked text "Check in to start calling"); "2 messages waiting for your update" (each "What happened?"); "Marco Bellini opened your brochure link"; shortcuts Add lead / Follow-ups / Calendar / Projects; My leads by stage (→ Pipeline); Best time to call now (3 leads, call buttons); Meet your colleagues strip; Projects we sell now; Homes AI tip; lead transfers "1 for you" (from old web). Confetti on check-in/accept.
4. **owner-home.html** — O/Ad. `OwnerHome`. "Add a lead and give it", "Import Excel", "Incoming · 3"; NEEDS YOU NOW (VIP not called → Give again; 2 leave requests → Answer; absent agent → See; leads waiting → Give; transfer approval → Approve; blocking bug → Open); Team today (In office / Late / Outside / Absent-leave, each opens team attendance); TODAY IN NUMBERS, each row opens its filtered list (New leads, Calls · WhatsApp · Telegram, Meetings booked, Units booked, Follow-ups overdue, No next step); "Open the full dashboard"; team-right-now table. Agents get "Only for owners and admin" block (applies to every owner page).
5. **notifications.html** — all. `Notifications`. Counter "N new", "Mark all read", tabs Agent: All/Leads/Meetings/Tasks/Team; Owner: All/Leads/Team/System; rows icon, title, text, age, unread dot, action link that opens the exact page/tab/dialog; empty state; link "Choose what reaches you".
6. **search.html** (+ top-bar box) — all. `Search`. One box "Name, phone, project, screen"; chips All/Leads/Projects/Tasks/Screens; Recent; results with type tag; any phone format; other agents' leads show agent name only; none → "Nothing found" + "Add as a new lead".
7. **homes-ai.html** (+ floating pill) — all. `AskAI`. Chat, 5 "TRY ASKING" chips, answers with a link to the right page; empty question error; "reads only your own leads. It never sends a message for you."

### Leads
8. **my-leads.html** — Ag. `Leads`. "62 open · 12 to call today"; search name/phone/project; tabs Today · 12, New, Overdue, No next step, VIP, Lost, All; count line; links Free leads, Pipeline; "Start calling · 12 ready" (Today tab); table: lead, phone, project, stage chip, VIP tag, local time, next-step note (red if overdue/goes back/VIP), Call + WhatsApp per row; empty state + "Add a new lead".
9. **lead.html** — all. `Lead` + `Notes` + `TransferLead` + single-call `Dialer`. Header: **phone largest**, name, "with Rocky", stage, Score 72, tags, country, local time, best time, Next step. Banner "WhatsApp opened · waiting for your update". Actions: Call (tel: or number + QR on computer, logged), WhatsApp, Telegram, Follow-up, Meeting, Won, Lost; under them "Transfer this lead to another agent" (or open-request status). Owner: "give this lead to another agent". "In short". "What Marco wants": Project, Unit, Budget, Purpose, Timeline, Payment, Language (click a line → edit → written on timeline), Wants / Doesn't want chips, Source, Lead #. Tabs Notes N / Timeline / Info (Phone, WhatsApp 2, Email, Nationality, Birthday, change history) / Files (list, Open, + Photo, + Booking form, + ID or passport; "only you and owners see it").
   Dialogs: **Add note** (types Note/Call/Viewing/Budget/Objection/Next step, quick phrases per type, voice record/stop, "Remind me": In 1 h/Tonight/Tomorrow 10:00/Pick time, @name tag, Pin/Unpin, Edit; needs text or voice). **Follow-up** (In 1 hour/Tonight 19:00/Tomorrow 11:00/Pick date & time; How: Call/WhatsApp/Email; what about). **Meeting** (Office meeting/Site visit/Show flat/Video call; when; where; then WhatsApp opens with the time; reminder 2 h before). **Won** (unit, price, paid now ≤ price, booking form or receipt required, what was signed, confetti, posted on Team wall, +300 points). **Lost** (reason required: Bought elsewhere/Budget too low/Just browsing/Not into off-plan/Is a broker, not a buyer/Other; "Try again in 3 months"). **WhatsApp/Telegram**: pick ready message (Meeting time/Hello/Brochure/Payment plan/Write my own; tracked link) → "Open WhatsApp" → on return "What happened?" (Sent, waiting for reply / He replied: interested / He replied: not now / Not interested → Lost reason / Wrong number / Didn't send) + note + voice, or "Later". **Voice notes & gallery** (player 1.5x, transcript, AI found fields "Save 4 to lead", folders Passport & ID / Booking forms / WhatsApp screenshots / Payment receipts, Scan/upload, "Every view is logged"). **Transfer panel** (see page 15).
10. **add-lead.html** (page + global dialog) — all. `AddLead`. Nothing preselected. Required: full name, phone (digits only, ≥7, country picker with search and regions Popular/GCC/Europe/Asia/Africa/Americas/Oceania/All), lead source. Live check: "We check every number…" / "New number." / duplicate **blocks save** and shows who has it + Open. Optional: "WhatsApp is the same number" switch (else 2nd number), Telegram, Email, Project (4 + Not sure yet + Other→type), Looking for, Budget, Buying to, Speaks (multi), note. Source lists differ: agent (Walk-in, Referral, Event / expo, My own call, Old client, Social media (mine), Other) / owner (Email to owner, Owner's contact, Referral, Walk-in, Event / expo, Old client, Other); Referral/Event/Other ask a detail. Agent: "Who works it?" Me / Leave in Incoming. **Owner mode:** agent list with status dot + open leads (on leave/absent cannot be chosen), "Leave in Incoming", VIP switch, "Must call within" 15 min/30 min/1 hour/Today, private note. Saved state: Open lead / Add another.
11. **incoming.html** — all. `Incoming` + `OwnerAssign`. Rows: lead, project, "waiting 42 min", reason it is free. Agent ("Free leads"): "Take this lead" → moves to My Leads. Owner: "Give to an agent" dialog (agents with open counts), "Share the normal leads equally" (two clicks; VIP never shared). Rule text. Owner tab **VIP leads I gave**: tabs All/Needs you/Going well; status Waiting/Called/Meeting/Offer/Came back; "Give to another agent" (30 min to call), "Remind the agent", "I will call myself"; "Add a lead and give it as VIP".
12. **pipeline.html** — all. `Pipeline`. Columns New/Called/Interested/Meeting/Offer/Won with counts; cards open the lead, Call button; **no drag, no stage change by click**; Lost kept apart.
13. **calling.html** — Ag. `Dialer`. Queue = Today list, VIP first; "Lead 1 of 12", progress, "+15 points per call"; lead card (phone, local time, why, Project/Budget/Wants, "Say:" script); Call, WhatsApp ("tap logged"); outcomes Interested (next step: payment plan on WhatsApp / book meeting-site visit / call back tomorrow 11:00 / brochure + location), No answer (retry 2 h, optional WhatsApp), Busy (retry 1 h), Call back (date/time + why), Wrong number (new number or flag for owner), Not interested (reason + try again in 3 months); must click Call/WhatsApp before an outcome; outcome needed before Next (or Skip); Undo; Prev/Skip/Next; banner when "not checked in"; end summary (Calls, WhatsApps, Results saved).
14. **all-leads.html** — O/Ad. `AllLeads`. "863 leads · every agent"; agent filter (All + 10), filters All / Going cold · 12 / Overdue · 9 / No next step · 31 (+ stage, project per spec); table lead, phone, project, stage, agent, last contact, attention; select one or many → "Move N leads" panel (working agents or Incoming; "notes and history go with them").
15. **transfers.html** — all. `Transfers` + `TransferLead`. Agent: FOR YOU (Accept / "No, thanks", "Answer by 18:00"), YOU SENT (Remind, Cancel, status Waiting / Owner must approve / Refused). Owner: NEEDS YOUR APPROVAL (Approve/Refuse), ALL TRANSFERS · LAST 7 DAYS, "THIS MONTH · WHO GIVES AND WHO GETS" with flag ("Shan gave away 6 leads"). **Form:** language filter built from profiles (All, Arabic, Russian, Hindi, Urdu, Portuguese, Serbian), agent cards (photo, status, languages, open leads, deals this month, reply time, profile link, "Best match"), order: can take it now, then fewest open leads; reason required (Speaks the client's language / I am going on leave / The client asked / Knows the project better / I have too many leads / Other + note ≥5 chars); rules: own leads only, on leave/absent not selectable, one open request per lead, VIP cannot be transferred (send back to owner), Meeting/Offer need owner approval then receiver accept, lead stays with sender until accepted, ends at 18:00 with no answer.

### Calendar and tasks
16. **calendar.html** — all. `Calendar`. Month/Week/Day (Monday start), arrows, Today, legend (Meeting, Site visit, Call, Follow-up, Team; 3+ badge; multi-day band), day list, busy-day hint. **New plan**: type, lead picked from list (not free text; none for Team), title, day, time, clash warning, "Runs for several days" (2–5 days), length 15 min/30 min/1 h/2 h, place Office/Sales centre/Client's place/Online / Zoom, reminder 15 min/1 h/2 h before; past dates refused. **Open plan**: Open the lead, Change day or time, Delete (two clicks) / Team plan: owners change, agents "Hide for me". **How did it go?** Showed up (next: Send the offer/Second meeting/Site visit/Follow up in 2 days + date/time, interest Hot/Warm/Cold, note), No-show (counted, message ready, Try again options, red flag after 2), Rescheduled (new day/time, who asked), Booked a unit (project, unit, price, paid ≤ price, receipt → Won), Cancelled (Client/Me/Developer; not a no-show). Answer before 21:00; Undo.
17. **tasks.html** — all. `Tasks` + `FollowUps`. Week strip with "N left", prev/next week, Today; To do / Done; row: checkbox, type (Call/Overdue/Meeting/WhatsApp/From Emir/Other), title, time, "⋯" (Change, Move one day later, Delete two clicks). New task: text, type Call/WhatsApp/Meeting/Other, day (no past), time, optional lead. Meeting task asks result only after its time (Client showed up / No-show / Cancelled / links to Calendar). **Follow-ups**: tabs Overdue/Today/Tomorrow/This week with counts; "Call these N one by one"; Call; Done → "What happened with X?" (Spoke · all done / No answer · try again tomorrow / Booked a meeting / Not interested); Move to tomorrow / one day later.

### Projects
18. **projects.html** — all. `LiveProjects`. Owner message, 4 project cards (status, developer, pitch line, "Your leads 24 · Team 115", new leads go to).
19. **project.html** — all. `ProjectDetail`. Facts (Starting from, Payment plan, Unit types), "The pitch in 3 lines", "Send to a client" (Brochure/Payment plan/Location/Video → pick lead → WhatsApp or Telegram, or copy link), your leads in this project.
20. **manage-projects.html** — O/Ad. `ManageProjects`. Add/edit (Project name*, Developer*, Area, Starting price; unique name), Upload brochure (PDF up to 30 MB), status Selling now / Launching soon / Hidden, "See as an agent"; new project starts Hidden.
21. **home-banners.html** — O/Ad. `OwnerBanners`. Preview, image upload / project photo, Label (From Emir/Office/Project/Best of Homes/Training), Title, Short text, Button text, Opens (Project page/Best of Homes/Team wall/A web link), Show from / Until, Who sees it (Everyone/Agents/One desk), Publish; list with Live/Scheduled/Ended, "seen by 9 of 10", drag to reorder; max 5, 1200 × 500 px.

### Team
22. **team.html** — all. `TeamDirectory` + `Colleague` (side panel). "10 agents · 6 in office now"; search name or language; filters All / In office now / Dubai off-plan / Arabic desk / Abu Dhabi; panel: status, languages, sells, 4 stats, deals last 6 months bars, badges, Phone / WhatsApp (plain links, nothing logged, no check-in question).
23. **team-wall.html** — all. `TeamWall`. Post box (text required), posts, 👏 🔥 reactions, owner news.
24. **best-of-homes.html** — all. `Leaderboard`. Week 46 podium, ranking (calls · meetings · points), "6 calls or 1 meeting puts you in first place", Level 7 · Closer, badges.

### Attendance
25. **attendance.html** — Ag. `Attendance` + `WorkOutside` + `LeaveRequest`. States: not checked in → in office → outside → checked out; Check in (office network only, real time, late after 09:10), Check out (two clicks), "Check in again"; colour guide; week strip; month view (Sep/Oct/Nov) with totals; day details; "Month PDF". **Working outside**: Share my location (once), why (6 reasons), with who, where exactly (required), back by (16:30/17:30/18:00/Tomorrow), note; "I'm back in the office". **Request leave**: 14 annual left / 3 sick used / pending; type Annual/Sick/Personal/Half day/Work from home/Other; From/To (working days counted, days off and past refused); reason; sick note; pending card + Cancel; history.
26. **team-attendance.html** — O/Ad. `TeamAttendance` + `LeaveApprovals`. Counters; everyone by name with status, time, place/reason; "Phone Bassam", "Mark as leave", "See shared location"; last 8 working days grid × 10 agents; **Leave requests** (Approve / Refuse with reason: Too many people away / Busy week · launch / Talk to me first; "Change my answer"; ANSWERED list); link Rules.

### Me
27. **profile.html** — all. `Profile` + `PersonalInfo` + `Security`. Performance card (86%, deals, viewings, avg reply), links; personal info: photo change/remove, name*, title, phone* (≥9 digits), WhatsApp, email, languages (feed transfer + team filters), BRN* (4–6 digits), completion bar; security: change password, two-step (owner/admin), signed-in devices, Sign out one / all others.
28. **digital-card.html** — all. `DigitalCard`. Public share switch + copy link; 3 steps: design (Signature/Reverse/Light, flip, compare) → details (name, title, BRN, phone, WhatsApp same, email, website, 2 address lines, switches Tagline/WhatsApp QR/Rounded corners/Company name, size 85 × 55 mm or 3.5 × 2 in, safe area) → download (PDF + crop marks, PNG, JPG, Mockup). Must match the live tool.
29. **feedback.html** — all. `Feedback`. Type Bug/Issue/New feature/Idea, title, text (required), where, screenshot, voice note, urgency Low/Normal/Blocking my work, send → ticket #1042, MY REPORTS with status.
30. **settings.html** — all. `Settings` + `SettingsNotifications`. Appearance Light/Dark/Auto, sounds, language; notifications: Test button, per-alert switches (agent groups MY LEADS / MY DAY / TEAM AND OFFICE; owner groups LEADS / TEAM / SYSTEM), quiet hours Off / 22:00 – 08:00 / 20:00 – 09:00, VIP exception; owner sections hidden from agents; Sign out.

### Owner tools
31. **import.html** — `Import`. 6 steps Upload (Excel/CSV, ≤5,000 rows, template) → Columns (Name + Phone required, a field used once) → Check (240 = 208 new + 18 duplicates + 14 bad; Skip them / Fill empty details only / Import them again as new; download bad rows) → Give (project; Agents I choose · equal split / A desk / Incoming) → Confirm → Done (per-agent result, Undo 24 h with confirm, one grouped notification each).
32. **dashboard.html** — `OwnerDashboard`. Period Today/Week/Month/Year (changes calls, meetings, deals only); totals; by stage; attendance; Morning brief; Touched in 2 h, First click, Call clicks, Meetings booked; by project; Team today table; sources; new leads per day; GOING COLD (Move 31, View).
33. **team-live.html** — `OwnerLive`. Call/WhatsApp clicks, clicks by hour, "Right now · 8 online", attendance, AI suggestion.
34. **team-activity.html** — `TeamActivity`. Tabs Time in CRM / Sign-ins (Sign out) / Unusual (Review: "It was them" / "Sign out everywhere and reset the password").
35. **messaging-report.html** — `OwnerMessaging`. Taps/Confirmed/Replied/Links opened, per-agent table incl. NO UPDATE, links opened by clients, "How it is counted".
36. **feedback-inbox.html** — `OwnerFeedback`. Tabs New/Planned/Fixed/All; Plan it, Mark fixed, Open again, Reply; export file.
37. **settings-team.html** — `SettingsTeam`. Counts; 13 people; Invite (name, real email, role Agent/Admin, no duplicates); role change (Owner needs second click); reset link; sign out everywhere; Deactivate (two clicks, never an owner, leads → Incoming); cannot change yourself; role table. Add spec §7.8: who has notifications on.
38. **settings-attendance.html** — `SettingsAttendance`. Office Wi-Fi list (add, remove two clicks, keep one), shift 09:00/18:00, late after 09:10, days off, WORKING OUTSIDE switches (4), CALLS switches (2), monthly report (Excel).
39. **desks.html** — `Desks`. Add/edit/delete (two clicks), members, max open leads 40/50/60/80.
40. **automations.html** — `Automations`. Take-back: VIP 15 min/30 min/1 hour/2 hours; imported 4/24/48/72 hours; clock stops outside 09:00–18:00; switch groups LEADS (3), FOLLOW-UPS AND MEETINGS (4), ATTENDANCE (4).
41. **company.html** — `Company`. Logo, legal name, brand name, ORN, TRN, address, phone, email, website.
42. **ai-settings.html** — `AISettings`. Budget $38 of $100, 5 "AI CAN" switches, "What AI should know about us".
43. **system-health.html** — `Health`. 6 services with status, "Run a check now".

### LATER (drawn, clearly labelled, not built)
44. **inbox.html** — `Inbox` + `Chat`. 45. **email.html** — `Email` (VIP email preview). 46. **templates.html** — `Templates` (16 WhatsApp templates). Each carries the banner "LATER PHASE · Not in the first build. For now WhatsApp and Telegram open on the agent's phone and every tap is logged."; sidebar label "Inbox · later".

## 2. GLOBAL (every page)
- Sidebar = phone `Menu`: OWNER & ADMIN group (owner only), MY WORK, TEAM, plus Notifications, Settings, Sign out; badges (Incoming 3, Leave requests 2, Lead transfers 1, Follow-ups 5). Live computer items with no phone screen stay: **Sales offers**.
- Top bar: search, bell with unread count, "+ Add lead", Homes AI pill, profile.
- **Check-in gate** on every call button (agents, work hours 09:00–18:00): "You're not checked in yet" → Check in now and call / I'm working outside / Call anyway (marked "not checked in", owners see it). Not asked: owners, admin, outside work hours, while outside.
- Role differences: agent sees own leads + free leads; owner never lands on agent pages; owner pages show the block message to agents; no export for agents.
- Light / Dark / Auto theme, both readable; sounds with off switch; toasts; confetti on Won/Booked; 24-hour clock; real date/time pickers; no past dates; two-click rule for every risky action; loading/empty/error states; i18n (Arabic RTL later).
- Never write "sent" for WhatsApp/Telegram; the agent presses send.

## 3. SAMPLE DATA (use exactly)
- **Now:** Wednesday, 11 November 2026, 14:55 (Asia/Dubai). Shift 09:00–18:00, late after 09:10. Week 46. Office Wi-Fi "homes.me-Office".
- **People (13):** Emir Dulovic (Founder & CEO, Owner), George Vanous (Partner, Owner), Abdullah Mahi (Office admin, Admin), 10 agents:

| Agent | Status today | Check-in | Open leads | Languages | Desk | Deals / meetings (month) |
|---|---|---|---|---|---|---|
| Talha | In office | 08:52 | 22 | English, Urdu, Hindi | Dubai off-plan | 7 / 14 |
| Rocky (Rocky Khan) | In office | 08:55 | 14 | English, Arabic, Hindi | Dubai off-plan | 4 / 9 |
| Yuliia | In office | 08:58 | 18 | English, Russian, Ukrainian | Dubai off-plan | 5 / 11 |
| Olga | In office | 09:03 | 12 | English, Russian | Dubai off-plan | 2 / 6 |
| Srdjan | In office | 09:06 | 16 | English, Serbian | Dubai off-plan | 2 / 5 |
| Tej | In office | 09:08 | 11 | English, Hindi, Punjabi | Dubai off-plan | 1 / 4 |
| Shan | Late · 24 min · traffic on SZR | 09:24 | 57 | English, Arabic, Urdu | Arabic desk | 2 / 5 |
| Nelson | Outside until 16:00 · viewing with Omar K. · Valia sales centre | 10:15 | 9 | English, Portuguese | Abu Dhabi | 3 / 8 |
| Sultan | Annual leave 10–11 Nov | – | 31 | English, Arabic | Arabic desk | 1 / 3 |
| Bassam | Absent · alert 10:00 | – | 44 | English, Arabic | Abu Dhabi | 0 / 2 |

Team today: 6 in office, 1 late, 1 outside, 1 leave, 1 absent. Desks: Dubai off-plan (6, max 60), Arabic desk (Shan, Sultan, Rocky, max 50), Abu Dhabi (Nelson, Bassam, max 40).
- **Rocky's leads** (62 open · 12 to call today · 6 hot · 2 meetings; 18 calls of 40):

| Lead | Phone | Project | Stage | Next step |
|---|---|---|---|---|
| Khalid Al Mansoori (VIP) | +971 50 555 0101 | The Archive · 2BR · AED 2.5M | New | VIP · call within 24 min |
| Sara Nunes | +351 91 234 5678 | Damac Islands · villa | Called | Follow-up overdue since 11:00 |
| Marco Bellini | +39 333 455 4821 | The Archive · 2BR · AED 2M | Interested | Send payment plan · 15:30 |
| Priya Shah | +91 98765 43210 | Valia · 1BR · AED 1.4M | Interested | Call after her meeting · 16:00 |
| Lucas Martin | +33 6 12 34 56 78 | The Archive · 3BR · AED 2.5M | Interested | Compare Archive and Valia · 17:15 |
| Ahmed Hassan | +966 50 123 4567 | Shahrukhz · 1BR | Called | Best time in KSA · 19:00 |
| Sami Najahi | +971 50 410 2233 | The Archive · imported | New | goes back tomorrow 09:00 |
| Neil Smith | +44 7700 900 123 | Shahrukhz · imported | New | goes back tomorrow 09:00 |
| Parvez Hossain | +880 17 1234 5678 | The Archive · imported | New | Not called yet |
| Hanna Alabbas | +971 55 320 7788 | The Archive · 2BR | Called | No answer twice |
| Dave Patel | +44 7700 900 456 | Shahrukhz · 2BR | Called | Wants the floor plan first |
| Vanessa Pecoraro | +39 347 111 2222 | Al Seef · 1BR | Called | No next step |
| Elena Kuznetsova | +7 912 345 67 89 | Damac Islands · AED 4.1M | Offer | follow-up tomorrow |
| Bridget Cardoso | +351 91 220 1188 | The Archive · 2BR | Interested | No next step |
| Omar Khalil | +971 50 222 3344 | Valia · 2BR | Meeting | met today 12:00 |
| Tom Becker | – | Shahrukhz · studio | Lost | budget too low |

- **VIP lead:** Khalid Al Mansoori, given by Emir 14:49 to Rocky, 30 min limit, "24:12 left to call", note "Wrote to me by email. Serious, wants to see the show flat this week. Call him in English."
- **Today (Rocky):** 10:30 Call Marco Bellini (done); 11:00 Follow up Sara Nunes (overdue); 12:00 Meeting with Omar Khalil, Office · Room 2 (result needed); 15:20 Call the VIP lead Khalid; 15:30 Send payment plan to Marco; 16:30 Site visit with Lucas Martin, The Archive sales centre. Tomorrow: Call Ahmed 10:00, Elena Zoom 13:00, Damac Islands tour 16:00, Weekly sales meeting 18:00. 17–19 Nov Cityscape Global expo (DWTC · stand B12).
- **Follow-ups:** Overdue 1, Today 4, Tomorrow 2, This week 2. **Pipeline:** New 18, Called 16, Interested 14, Meeting 8, Offer 6, Won 2.
- **Incoming (3):** Lina Rahimi (Damac Islands, import, 42 min, Shan did not call in 24 h); Kevin Brooks (The Archive, walk-in, 16 min, added by Abdullah); Omar Khan (Shahrukhz, VIP, 11 min, Bassam did not call in 30 min).
- **VIP leads I gave:** Omar Khan → Bassam 14:20 (Came back); Khalid → Rocky (Waiting); Daniel Rossi → Nelson 11:05 (Called); Aisha Noor → Talha (Meeting Thu 15:00); Elena Kuznetsova → Yuliia (Offer).
- **Transfers:** for Rocky: Fatima Al Zaabi from Yuliia (Arabic, answer by 18:00). Owner approval: Omar Khalil, Rocky → Yuliia, stage Meeting. Month: Shan gave 6 · got 0; Rocky 2/1; Yuliia 1/4; Talha 0/3; Olga 1/2.
- **Leave:** Rocky Annual 18–20 Nov (3 days, "Family visit"); Shan Sick 14 Nov.
- **Owner numbers:** 863 leads (open 809, untouched 86): New 456, Called 214, Interested 96, Meeting 31, Offer 12, Won 4, Lost 50. Today: 27 new leads, 214 calls, 104 WhatsApp, 28 Telegram, 5 meetings, 1 unit (Talha, Damac Islands, AED 2.9M), 9 overdue, 31 no next step, 12 going cold. Import: Nov_batch_C.xlsx, 240 rows = 208 + 18 + 14.
- **Projects:** The Archive (Imtiaz, Business Bay, from AED 1.6M, 60 / 40, Q4 2027, team 115 / Rocky 24); Shahrukhz (Danube, Sheikh Zayed Road, AED 1.2M, 1% monthly, 64 / 11); Damac Islands (Damac, Dubailand, AED 2.7M, 75 / 25, 52 / 9); Valia (Emaar, The Oasis, AED 1.4M, 80 / 20, launching soon, 28 / 6); Sei Saadiyat (Aldar, hidden).
- **Best of Homes:** Talha 1,980; Rocky 1,740; Nelson 1,310; Yuliia 1,120; Sultan 960.

## 4. DO NOT FORGET
1. Countdown on the VIP card is live; warning 10 min before; time over → Incoming + owner told.
2. "What happened?" follows every WhatsApp/Telegram click; unanswered ones list on My Day and count in the owner report.
3. Duplicate phone check blocks the save and names the holder.
4. Call on computer: `tel:` or number + QR, logged the same.
5. Local time of the client + best time to call on lead rows and lead page.
6. Tracked links (homes.me/p/…) and "client opened your link" alert.
7. No-show counter, red flag after 2; Cancelled is not a no-show.
8. Meeting result deadline 21:00; owners see who did not answer.
9. Clash warning in the calendar; team plans: agents can only hide.
10. Points (+10 add lead, +15 per call, +300 Won, +15 feedback), streak, levels, badges.
11. "Wrong number" flags the lead for the owner.
12. Import: one notification per agent; undo keeps leads already called; bad-rows download.
13. Deactivate → open leads go to Incoming; an owner cannot be deactivated; giving Owner role needs a second click.
14. Keep at least one office Wi-Fi; "Are you back?" asked once.
15. IDs/passport: only agent and owners, every view logged.
16. Search shows other agents' leads by agent name only.
17. Banner "seen by 9 of 10"; max 5 banners.
18. Audit log entries on timeline ("Rocky changed budget 1.5M → 2M").
19. Quiet hours with VIP exception; Test notification button.
20. Colleague Phone/WhatsApp: no logging, no gate.
21. "Month PDF" (agent) and monthly Excel report (owner).
22. Leftover test data and section 12 open decisions are not design items.

## 5. CONTRADICTIONS FOUND IN THE SOURCES (need one decision)
1. Rocky's open leads: 62 (My Leads, My Day, dashboard) vs 14 (every agent picker). Same for Talha 72/22, Nelson 58/9, Yuliia 61/18.
2. My Day stage strip (18/14/11/6/3/2) does not sum to 62; Pipeline (18/16/14/8/6) does.
3. Rocky is "not checked in" at 14:55 on My Day, but team attendance shows him in office 08:55 and counts 6 in office.
4. Lead owners differ: All leads puts Omar Khalil with Nelson, Sami/Neil/Hanna with Shan, Dave with Sultan, Vanessa/Parvez with Bassam, Bridget with Talha; agent screens show them as Rocky's. Priya is "Called" there, "Interested" elsewhere. Lina Rahimi is Rocky's in Search but free in Incoming. Aisha Noor is Won (Pipeline) and Meeting (VIP list).
5. Calendar lead picker phones differ from My Leads for Sara, Priya, Lucas, Ahmed, Elena. Table above uses My Leads / dialer numbers.
6. 16:30 site visit is with Lucas Martin (calendar, tasks) but with Khalid in Search, ProjectDetail, Inbox.
7. Import is 6 steps in spec §6 and phone, "7-step" in spec §0.
8. Spec bans "EOI"; phone uses it (Won "What was signed?", Valia, banner).
9. "Homes AI" vs "Emir AI" (Notes, Team live, old web pill).
10. "New sign-in" alert opens Team & roles on phone; spec says Team activity / Security.
11. Email appears as a follow-up way and in settings ("Push, email", "Daily summary email") while sending email is LATER.
12. Business card: "Office 16" and "EMIGEO" (both open decisions); card link homes.me/card/rocky vs crm.homes.me/card/rocky.
13. Spec mentions "Hot lead (ready to book)" marked by an agent; no such button on the phone lead page (only Hot/Warm/Cold in the meeting result).
14. Spec §7.8 "who has notifications on" and Telegram backup alerts have no phone screen.
