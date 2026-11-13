# Audit 4 — pages 35–44 of `design/web/research/sage.md`, plus §2, §4, §5

Audited 13 Nov 2026 against branch `claude/new-session-krd7bx`, build
`web/src/v2/**`, server `server/src/**`, and the running preview
(`http://127.0.0.1:5195`, owner and agent, 900 px / 1440 px / 1500 px, light
and dark). Every item below was checked in a real browser, in the design file
(`design/web/<page>.html` — body *and* `<style>`), in the phone prototype
(`design/screens/<Name>.dc.html` + `design/phone-shots/`), and in the source.

**Built** = there, with the design's layout, fields, buttons and wording.
**Partly** = exists, but something is missing or different — the note says what.
**Not built** = absent.

A page existing does not make it Built.

---

## 35. messaging-report.html — Messaging report (`/v2/messaging`)

| Item | State | Note |
|---|---|---|
| Page in the build at all | Built | `web/src/v2/Messaging.tsx` |
| Top-bar segmented control Activity · Live · Messaging | Partly | present, but drawn inside the page (`d-filters`) instead of the top bar. The design puts it in `data-topbar`, which `design/web/app.js` moves into the header beside the title |
| Page sub "WhatsApp and Telegram taps" | Partly | shown as grey text at the end of the filter row, not as the top bar's `tb-sub` |
| Heading "From tap to reply" | Built | |
| Period segmented control Today · Week · Month | Built | |
| Funnel card 1 — label "Taps on WhatsApp or Telegram" | Built | |
| Funnel card 1 — big number, delta "N vs yesterday" | Built | week/month say "vs the week before" / "vs the 30 days before"; design says "6% vs last week" / "11% vs October" — build shows a count, design a percentage |
| Funnel card 1 — "104 WhatsApp · 28 Telegram" split line | Built | |
| Funnel card 2 — label "Confirmed · agent said what happened" | Partly | build says "Confirmed · the agent answered" |
| Funnel card 2 — number + "95% of taps" | Built | |
| Funnel card 2 — red link "7 with no update" jumping to #no-update | Built | a button that scrolls to the agents card |
| Funnel card 3 — label "Client replied" | Partly | build says "The client replied" |
| Funnel card 3 — "46% of confirmed" | Built | |
| Funnel card 3 — sub "37 interested · 21 not now" | Not built | `message_taps.result` stores *that* they replied, not what they said. Build shows "N still waiting · N no reply" instead. Needs a new column to split interested / not now |
| Funnel card 4 — "Links opened by clients", "of 74 links" | Built | |
| Funnel card 4 — sub "Brochure is opened most" | Not built | links are not broken down by kind. Build shows "N opens in total" |
| Four step-bars under the funnel cards | Built | |
| "By agent" card head + "“No update” = the agent did not answer “What happened?”" | Built | wording exact |
| Agent table columns Agent · Taps · Confirmed · Replied · Reply rate · Links opened · No update | Built | all seven |
| Reply-rate bar, green at ≥45% | Built | |
| "Remind" button per agent with an open "no update" count | Built | |
| Remind toast "Shan gets one reminder with 3 open “What happened?” questions" | Partly | build drops the quoted phrase: "Omar gets one reminder with 2 open questions" |
| Row shows "Reminded 14:55" after reminding | Partly | build shows "Reminded" with no time |
| Rows sorted most "no update" first | Built | sorted server-side |
| Card foot "Most “no update” first. Remind sends one notification with the open questions." | Partly | build: "…with every open question in it." |
| "What the agents answered" card + "125 today" | Partly | build sub reads "69 answered" |
| Stacked `segbar` of the six answers | Built | |
| Row "Sent, waiting for reply" | Partly | build: "Sent, waiting for a reply" |
| Row "He replied: interested" (green dot) | Not built | build has one row "The client replied" — interested/not now are not stored separately |
| Row "He replied: not now" (amber dot) | Not built | same cause |
| Row "Not interested" (red dot) | Built | |
| Row "Wrong number" | Built | |
| Row "Didn't send" | Partly | build: "Did not send it" |
| Extra row "Not answered yet" | — | addition, not in the design (reasonable) |
| "Links opened by clients" card head + "Tracked links · homes.me/p/…" | Partly | build head reads "Tracked links the CRM made"; the `homes.me/p/…` shape is never shown, and the server's tracked link is `/b/{project}?a={agent}` (`server/src/http/routes/brochure.ts:16`), not `/p/…` |
| Link row: client · what · "opened 2 times · last 14:37" · the URL · agent · chevron | Partly | the URL is missing from the row; everything else is there |
| Link row opens the lead | Built | |
| "How it is counted" card, 4 numbered points | Built | |
| Point 3 wording "the agent chose “He replied: interested” or “not now”" | Partly | build: "the agent said the client wrote back" |
| Card foot "We do not read the chats. Only taps and answers are counted." | Built | exact |
| Owner-only on screen | Partly | an agent gets a red error strip "This report is for managers and owners.", not the design's "Only for owners and admin" block with "Go to My Day" |
| Owner-only on the server | Built | `GET /api/v2/messaging` → `requireRole('owner','admin','manager')` |

---

## 36. feedback-inbox.html — Feedback inbox (`/v2/settings/feedback`)

| Item | State | Note |
|---|---|---|
| Page in the build at all | Built | `web/src/v2/settings/FeedbackInbox.tsx` |
| Title "Feedback inbox" + "Bugs, problems and ideas from the team." | Built | |
| Tabs New · Planned · Fixed · All, each with a count | Built | counts correct; "All" is the four states added up |
| Tab "New" is the one that opens | Not built | build opens on "All" |
| Extra tab "Stopping somebody" | — | addition, not in the design |
| Sub "Every report gives the sender +15 points" | Not built | §4.10 says +15 points for feedback; the page never says so |
| "Export file" button (download icon, toast "File saved · feedback-11-Nov.xlsx") | Not built | no export anywhere; the phone prototype also has "Send all open items to the developer (file)" |
| **Table** with columns # · Report · Type · From · Urgency · Status · actions | Not built | the build is a card list. §1 of sage is explicit: "tables instead of cards" |
| Ticket number (`#1042`) | Not built | not shown anywhere; the design puts it in the first column and in the panel title |
| Report title + "where · when" sub line | Partly | build shows the body text as the title and "who · when · on /v2/…" beneath — there is no separate title field, so a long report becomes the heading |
| Type chip Bug · Issue · New feature · Idea, colour-coded | Partly | build has Bug · Idea · Question only; "Issue" and "New feature" do not exist, and the chips are not colour-coded |
| From column with avatar | Partly | name only, no avatar, inside the sub line |
| Urgency column Low · Normal · Blocking my work | Not built | only a red "Stops them working" chip; Low and Normal are not recorded or shown |
| Status chip New · Planned · Fixed | Built | plus a fourth, "Not doing this" |
| Row buttons "Plan it" | Partly | on a phone only (`useIsPhone`); on a computer you must open Reply first |
| Row button "Mark fixed" | Partly | same — phone only |
| Row button "Open again" | Not built | build offers "Not doing this" instead |
| Clicking a row opens the side panel | Not built | no side panel at all |
| Panel title "#1042 · <title>" | Not built | |
| Panel chips (type, status, urgency) | Not built | |
| Panel full report text | Partly | the text is on the card instead |
| Panel key-values From · Where · Sent | Partly | run together on one grey line |
| Panel screenshot block "Screenshot from the sender · click to open" | Not built | `feedback` has no screenshot column or upload endpoint |
| Panel voice-note player with waveform and "0:18" | Not built | no voice column or endpoint |
| Panel "Replies" thread (several replies, each with author and time) | Not built | the table holds **one** `reply` + `replied_by`, so a thread is impossible without a schema change |
| Reply box placeholder "Write a reply. The sender gets a notification." | Partly | build: "What are you doing about it? They will see this." |
| Reply validation error "Write your reply first." | Not built | no validation; an empty reply just changes the status |
| Panel foot buttons + Close | Not built | |
| Status-change toast with **Undo** | Not built | toast has no undo |
| Empty state "Nothing here / No report has this status now." | Partly | build: "Nothing here / When somebody reports a bug or sends an idea it appears here." |
| Banner "N person cannot work properly right now" | — | addition, reasonable |
| Owner-only on screen | Not built | an agent who types the address sees the **whole inbox**, including other people's reports and the owner's replies (verified in the browser as `?as=agent`) |
| Owner-only on the server | Built | `GET/PATCH /api/v2/feedback` → `requireRole('owner','admin')` |

---

## 37. settings-team.html — Team and roles (`/v2/settings/team`)

| Item | State | Note |
|---|---|---|
| Page in the build at all | Built | `web/src/v2/settings/Team.tsx` |
| Settings shell with the Mine / Office section list | Built | |
| Title "Team and roles" + "Who can sign in, what they can do, and who gets alerts." | Built | exact |
| "Invite a person" primary button | Built | |
| Stat card "People" with the count | Built | |
| Stat card "People" delta "0 invites waiting" / "· N deactivated" | Not built | no invite-pending state exists |
| Stat card "Roles" — N owners · N admin · N agents | Partly | labels are hard-coded singular/plural ("1 owner", "0 admin", "3 agents"); design says "2 owners / 1 admin / 10 agents" |
| Stat card "Notifications on" — "9 of 13 · 4 get no alerts", clickable to the tab | Built | |
| Tab "People N" | Built | |
| Tab "Who has notifications on · N off" | Built | this is spec §7.8, and it is there |
| Tab "What each role can do" | Built | |
| Search box "Search name or email" | Built | |
| Role filter All · Owners · Admin · Agents | Partly | build order is All · Agents · Managers · Admin · Owners, and adds Managers |
| Result count "13 people" | Built | |
| People table columns Person · Work email · Role · Last sign-in · actions | Partly | build drops the **actions** column and inserts an **Open leads** column |
| Person cell: avatar + name + their title/desk ("Founder & CEO", "Agent · Dubai off-plan") | Partly | build shows the role word or "You" under the name — titles and desks are never shown |
| Avatar carries the attendance status dot (office/late/outside/leave/absent) | Not built | plain avatar |
| Own row: chip "Owner · you" and "You cannot change yourself" in the actions cell | Partly | chip says "Owner" and the sub says "You"; the sentence only appears once in the footer note |
| Role `<select>` per row | Built | |
| Role change to/from **Owner** needs a second click ("Tap again · full access" / "Tap again · no longer owner") | Not built | the build saves the new role the instant the select changes. §4.13 names this rule |
| Role-change toast with Undo | Not built | toast, no undo |
| Row "⋯" menu | Not built | no menu, so none of the three items below exist |
| Menu item "Send a reset link" | Not built | `POST /api/users/:id/reset-password` exists on the server and is not reachable from this page |
| Menu item "Sign out everywhere" | Not built | no endpoint and no button |
| Menu item "Deactivate" with two-click confirm "Tap again to deactivate" | Not built | `PATCH /api/users/:id {isActive:false}` exists and does return the leads to Incoming — but nothing in the v2 UI calls it |
| Menu hint "N open leads go to Incoming. Notes and history stay." | Not built | |
| An owner cannot be deactivated (menu item disabled, "An owner cannot be deactivated.") | Not built | no UI; and the server has **no guard** either — `PATCH /api/users/:id` will deactivate an owner (`server/src/http/routes/users.ts`). §4.13 |
| Deactivated row greyed with "Activate again" | Not built | the `v2-tm-off` class exists, nothing sets the state |
| Search empty state "Nobody found / Try another name or email, or choose “All”." + "Show everyone" | Not built | the table just goes empty |
| Footer "Admin can do the same as an owner, but cannot remove or change owners. An owner can never be deactivated." | Partly | build: "An admin can do nearly everything an owner can, but cannot change or remove an owner. You cannot change your own role." — the owner-deactivation sentence is gone |
| **Notifications tab** — amber banner "4 agents get no alerts. A VIP lead for them can run out of time without a sound." | Built | wording near-exact |
| Notifications tab — "Remind all 4" button in the banner | Not built | |
| Notifications tab — **table** Person · Phone app · Computer · Last alert · Remind | Not built | build is a flat name list with a "No phone registered" chip |
| Per-person phone-app state (On · iPhone / Not installed / Blocked in phone settings / Switched off) | Not built | the server only knows whether a device token exists |
| Per-person computer state (On / Off) | Not built | |
| "Last alert" column (Opened an alert 5 min ago / Gets no alerts) | Not built | |
| Per-person "Remind" button + toast "Tej sees “Turn on notifications” on My Day" | Not built | |
| Footer "Each person turns alerts on for themselves. You can only remind them." + link "Open the install guide" | Partly | build: "…You can only see who has not and ask them." and no link to the install guide |
| **Roles tab** — table Can do · Agent · Admin · Owner, 9 rows | Built | 9 rows, right shape |
| Row wording "Give, move and import leads" | Partly | build: "Give out, move and import leads" |
| Row wording "Projects, banners, automations, desks" | Partly | build: "Projects, automations, office rules" |
| Row wording "Deactivate a person" | Partly | build: "Deactivate somebody" |
| Row wording "Company details and Homes AI budget" | Partly | build: "Company details and the AI budget" |
| Green ticks / "–" / "not owners" | Built | |
| **Invite dialog** — Full name* with error "Write the full name." | Partly | the field is there, the error text is not — the Make button is simply disabled |
| Invite dialog — Work email* with error "Write a real email, like name@homes.me." | Partly | same: no message, just a disabled button |
| Invite dialog — duplicate email blocked with "This email is already in the team." | Partly | the server rejects a duplicate; the dialog shows whatever the server says, not this sentence |
| Invite dialog — role segmented Agent / Admin with a changing hint | Built | hints match |
| Invite dialog — "They get an email with a link to set a password." / button "Send the invite" | Partly | the build cannot email, so it shows a one-time password and says so. Honest, but a different flow and different words ("Make the account") |
| Invited row appears with "Invite waiting" chip, "Send again", "Cancel invite" | Not built | the account is created immediately; there is no pending-invite state |
| Owner-only on screen | **Not built** | an agent who types `/v2/settings/team` sees the page, the list of everybody, their roles and the role table. Verified in the browser |
| Owner-only on the server | **Not built** | `GET /api/users` has **no role guard** (`server/src/http/routes/users.ts`). It does trim an agent's view to id/name/role/active, but an agent still gets the full staff list. `GET /api/v2/health` (the alerts tab) is guarded |

---

## 38. settings-attendance.html — Attendance rules (`/v2/settings/attendance`)

| Item | State | Note |
|---|---|---|
| Page in the build at all | Built | `web/src/v2/settings/Attendance.tsx` |
| Title "Attendance rules" + "When the day starts, where check-in works, and what agents may do outside." | Built | exact |
| Row label "Office Wi-Fi" + "Check-in works only on these networks. Keep at least one." | Partly | build: "The office network" / "Check-in works only from here. Keep at least one." |
| List of **Wi-Fi network names** ("homes.me-Office", "homes.me-Office-5G") | Not built | the build lists **IP addresses** instead. The code says why (a browser cannot read the SSID) — but it means the owner cannot type the network name the design asks for, and the hint "Network name, exactly as on the phone" is gone |
| Sub line "Main office · 9 people on it now" | Not built | build: "This is where you are now" / "Office internet line" |
| Green chip "You are on it" | Built | |
| "Remove" with two-click confirm "Tap again to remove" | Partly | the button is there; **there is no confirm step** — one click removes it |
| Removal toast "<name> removed. Check-in no longer works on it." with Undo | Not built | |
| Add field "Network name, exactly as on the phone" + "Add network" | Partly | the field adds an IP, button is "Add" |
| Add errors "Write the network name." / "This network is already in the list." | Not built | |
| Keep at least one — the last Remove is disabled | Built | |
| Keep-one note "This is the last network. Add another one before you remove it." | Not built | the button is just disabled, with nothing said |
| Shift row + "Call buttons ask for check-in only inside these hours." | Built | exact |
| Field "Starts" (time) | Built | |
| Field "Ends" (time), error "Must be after the start." | Built | |
| Field "Late after" as a **time** (09:10) with error "Must be after the start and before the end." | Partly | build makes it a **minute count** ("10 minutes") and shows "Late from 10:10" beneath. Same effect, different control and no error text |
| Shift bar with the grace band, the "now" marker and "9 hours · 10 min grace" | Built | |
| Extra "Saturday has its own hours" block | — | addition, not in the design |
| Extra "Ask people to check in" switch | — | addition; the design puts that switch on automations.html |
| Days off chips Mon–Sun | Built | |
| Days-off note "5 working days: Monday to Friday." | Built | the design's own script writes the list form too |
| Guard "Keep at least one working day" | Built | |
| **Working outside** card head | Built | |
| Switch "Agents can work outside" + "Viewings, site visits and developer events count as work" | Built | exact |
| Switch "Ask for the location once" + "Shared one time when they start, not followed after that" | Built | exact |
| Switch "Ask “Are you back in the office?”" + "Asked once at the back-by time" | Built | exact |
| Switch "Tell owners when someone starts" + "A line in the bell, no sound" | Built | exact |
| **Calls** card head | Built | |
| Switch "Ask to check in before a call" + "Agents only, inside the shift. Owners and admin are never asked." | Built | exact |
| Switch "Allow “Call anyway”" + "The call is marked “not checked in” and owners see it" | Built | exact |
| Per-switch toast "<name> · on / · off" | Not built | |
| **Monthly report** row + "One Excel file: every agent, every day, late minutes, leave, outside work." | Partly | build has "The month / Every agent, every day, late minutes, leave and outside work." but no report |
| Month `<select>` (November / October / September 2026) | Not built | |
| "Download Excel" button + toast "Attendance-October-2026.xlsx is downloading" | **Not built** | there is no Excel or CSV export anywhere in `server/src/http/routes/attendance.ts`. §4.21 |
| Note "22 working days · 10 agents" | Not built | |
| Save bar "Changes start tomorrow morning. Today's check-ins stay as they are." | Built | exact |
| Save bar link "Open team attendance" | Built | |
| "Save rules" button + toast "Attendance rules saved" | Built | |
| Submit guard "Check the shift times first. Nothing was saved." | Not built | the Save button disables instead |
| Admin may edit | Not built | `canEdit = role === 'owner'` in the page and `requireRole('owner')` on `PUT /attendance/settings`. sage §1 says Admin = Owner here |
| Owner-only on screen | **Not built** | an agent who types the address sees the whole form, switches and all. Verified in the browser |
| Owner-only on the server | Built | `GET /attendance/settings` → `requireRole('owner','admin')`; the page shows the raw 403 instead of the design's block |

---

## 39. desks.html — Desks (`/v2/settings/desks`)

| Item | State | Note |
|---|---|---|
| Page in the build at all | Built | `web/src/v2/settings/Desks.tsx` |
| Title "Desks" + "Groups of agents. Each desk has a limit of open leads per agent." | Built | exact |
| "Add a desk" primary button | Built | |
| Summary — "Desks N" | Built | |
| Summary — "Agents on a desk N" + "Rocky sits on 2" / "N with no desk" / "One desk each" | Built | all three phrasings present |
| Summary — "Over the limit now N" + "Shan 57 of 50 · Bassam 44 of 40" / "Everyone is under the limit" | Built | |
| Summary — "Move leads" button to All leads | Built | |
| Desk card: name, "N agents · N open leads" | Built | |
| Desk card: "Max open leads" segmented 40 · 50 · 60 · 80 | Built | |
| Max-change toast "<desk> · max N open leads per agent" with Undo | Partly | toast present, no undo |
| Desk card: "Edit" button | Built | |
| Desk card: "Delete" with two-click "Tap again to delete" | Built | |
| Delete toast "<desk> deleted. The agents keep their leads." with Undo | Partly | no undo |
| Member grid: avatar with status dot, name, load bar, "22 / 60" | Partly | avatar has no attendance status dot |
| Member grid sorted heaviest first, over-limit rows red | Built | |
| Empty state "No desks yet / Add a desk to set a lead limit for a group of agents." | Built | exact |
| Footer "An agent over the limit gets no new leads from “Share equally” and from imports. You can still give a lead by hand." | **Not built** | the rule itself is not implemented. The build says so instead: "Nothing is blocked by this number yet: sharing leads out and imports do not look at it." Honest, but the desk limit does nothing |
| Panel title "New desk" / "Edit <name>" | Built | |
| Panel field "Desk name *" with error "Write a desk name." | Built | |
| Duplicate name error "There is already a desk with this name." | Built | |
| Panel "Max open leads per agent" segmented 40/50/60/80 + hint "Above this number the bar turns red and new leads skip the agent." | Partly | the control is there; the hint is not (and would be untrue — see the footer above) |
| Panel "Members · N chosen" with a picker showing avatar, name, other desks / languages, "N open" | Built | |
| Members error "Choose at least one agent." | Built | |
| Panel "Delete desk" with two-click confirm | Built | |
| Panel Cancel / "Save desk" | Built | |
| Save toast "<name> added · N agents" / "<name> saved" | Built | |
| Owner-only on screen | Partly | an agent sees a red strip "Desks are set by the owner." — not the design's "Only for owners and admin" block with "Go to My Day" |
| Owner-only on the server | Built | `/api/v2/desks` GET/POST/PATCH/DELETE → `requireRole('owner','admin')` |

---

## 40. automations.html — Automations (`/v2/settings/automations`, also `/v2/automations`)

| Item | State | Note |
|---|---|---|
| Page in the build at all | Built | `web/src/v2/Automations.tsx` |
| Title "Automations" + "Rules the CRM runs by itself, so no lead is forgotten." | Built | exact |
| Hero card with undo icon, "Take-back rule", "A lead that nobody calls goes back to Incoming, and you are told." | Built | exact |
| On/Off switch with the word beside it | Built | |
| Turning it **off** needs a second click ("Tap again to turn take-back off. Uncalled leads will stay with agents.") | **Not built** | one click switches the whole rule off |
| VIP box: "VIP" tag + "VIP lead" | Built | |
| VIP big number + unit | Built | |
| VIP chips 15 min · 30 min · 1 hour · 2 hours | Built | |
| VIP note "The agent sees a live countdown and gets a warning 10 min before the end." | Partly | build drops the "10 min": "…and a warning before the end." §4.1 |
| Imported box: upload icon + "Imported lead" | Built | |
| Imported chips 4 hours · 24 hours · 48 hours · 72 hours | Built | |
| Imported note "Counted in working time. The agent sees the day and hour on the lead, like “goes back tomorrow 09:00”." | Partly | build: "Counted in working time, so the agent sees a day and an hour rather than a countdown." — the example is gone |
| Chip toasts "VIP leads go back after 30 min" / "Imported leads go back after 24 hours" | Built | |
| Clock strip "The clock stops outside 09:00 – 18:00" with the day bar and 00:00 / 09:00 · clock runs / 18:00 · clock stops / 24:00 | Built | the build reads the real shift instead of hard-coding 09:00–18:00, which is better; the labels are right |
| Summary sentence "A VIP lead not called in **30 min** goes back to Incoming **and you get an alert**. An imported lead not called in **24 hours** of working time (about N working days) goes back too. **Notes and history stay with the lead.**" | Partly | build: "A VIP lead not called in 30 minutes goes back to Incoming. An imported lead has 24 working hours." — the alert, the working-days estimate and the notes-and-history reassurance are all gone |
| Off-state sentence "Take-back is **off**. Leads stay with the agent even when nobody calls them." | Partly | build says it in the toast, not in the card |
| "Taken back today" card + "Open Incoming →" link | Built | |
| Row: crown/upload icon, name, VIP tag, "Shahrukhz · Bassam did not call in 30 min", time | Partly | build says "did not call in time" without the interval |
| Row chip "Waits 11 min" / "Waits 42 min" | Not built | |
| **LEADS** group head + "N of M on" count | Built | |
| Switch "Warn the agent before a lead goes back" + "10 min before for a VIP lead, 1 hour before for an imported lead" | Partly | build: "10 minutes before a VIP lead, an hour before an imported one" |
| Switch "Mark leads as “going cold”" + "No call, no message and no plan for 7 days · 12 leads now" | Partly | the live count "· 12 leads now" is dropped |
| Switch "Ask “What happened?” after WhatsApp or Telegram" + "The agent must answer. Open ones show on My Day and in the messaging report." | Partly | build: "The agent answers. Open ones show on My Day." — the messaging report is dropped |
| **Follow-ups and meetings** group head + count | Partly | build heads it "FOLLOW-UPS AND MEETINGS" in caps |
| Switch "Remind the agent when a follow-up is due" + "At the planned time, and again after 1 hour" | Partly | "…after an hour" |
| Switch "Remind 2 hours before a meeting" + "Agent only. The client message is ready, the agent presses send." | Partly | "The agent only. The client message is ready; the agent presses send." |
| Switch "Ask “How did it go?” after each meeting" + "Answer before 21:00. Owners see who did not answer." | Partly | "Answered before 21:00…" |
| Switch "Red flag after 2 no-shows" + "Cancelled is not a no-show" | Partly | "A cancelled meeting is not a no-show" |
| **Attendance** group head + count | Built | |
| Switch "Check-in reminder at 09:00" + "Only on working days, only if not checked in" | Partly | build: "Remind people to check in" / "At the start of the shift, on working days, only if they have not" — the time is gone from the label |
| Switch "Mark late after 09:10" + "The agent can write a reason" | Partly | build: "Mark somebody late" / "After the grace minutes. The agent can write a reason." |
| Switch "Tell owners about an absent agent at 10:00" + "No check-in and no leave" | Partly | build: "Tell owners about an absent agent" / "An hour into the shift, with no check-in and no leave" |
| Switch "Ask “Are you back in the office?”" + "Asked once at the back-by time" | Not built | the fourth Attendance switch is not on this page — it was moved to Attendance rules. sage §1 item 40 says ATTENDANCE (4) |
| Per-switch toast "<label> · on / · off" | Built | |
| Footer "Times come from [Attendance rules]. Every change here is saved at once and written in the activity log." | Built | the link works |
| Owner-only on screen | **Not built** | an agent who types `/v2/settings/automations` sees every rule and every switch (read-only). Verified in the browser |
| Owner-only on the server | Partly | `PATCH /api/v2/rules` is guarded; `GET /api/v2/rules` and `GET /api/automations` have **no role guard** at all |

---

## 41. company.html — Company (`/v2/settings/company`)

| Item | State | Note |
|---|---|---|
| Page in the build at all | Built | `web/src/v2/settings/Company.tsx` |
| Title "Company" + "These details show on business cards, sales offers and the sign-in page." | Built | exact |
| **Logo** row + "PNG or SVG, square, at least 512 px." | **Not built** | there is no logo block on the page, although `POST/DELETE /api/company/logo` exist on the server. The phone prototype also shows "Logo · tap to change" |
| Logo preview | Not built | |
| "Upload a new logo" button | Not built | |
| "Remove" with two-click confirm + toast with Undo | Not built | |
| File note "homes-me-mark.svg · 4 KB" / "No logo. Cards and offers show the brand name only." | Not built | |
| **Names** row + "The legal name is on documents. The brand name is what clients see." | Built | exact |
| Field "Legal name *" | Built | |
| Legal name error "Write the legal name, as on the licence." | Not built | Save disables instead |
| Field "Brand name *" | Built | |
| Brand name error "Write the brand name." | Not built | |
| **Licence numbers** row + "ORN is on every business card. TRN is on invoices and sales offers." | Built | exact |
| Field "ORN *", digits only, min 4, hint "Office registration number" | Built | |
| ORN error "Digits only, at least 4." | Not built | |
| Field "TRN", 15 digits, hint "Tax registration number · 15 digits" | Built | |
| TRN error "A TRN has 15 digits." | Not built | |
| ORN beside TRN on one row | Built | verified at 1500 px |
| Extra fields "Trade licence" and "Licence expires" | — | addition, not in the design |
| **Address** row + "Two short lines fit on the business card." | Partly | the row and the note are there |
| Field "Line 1 *" | Partly | build has one field, "Office address" |
| Field "Line 2 *" | **Not built** | there is one address field, so the card's two-line layout has to be faked by splitting on a comma |
| Address errors "Write the office address." / "Write the area and city." | Not built | |
| **Contact** row + "The office line, not a personal number." | Built | exact |
| Field "Phone *" with phone icon, digits only, min 9 | Built | |
| Phone error "Digits only, at least 9." | Not built | |
| Field "Email *" with mail icon | Built | |
| Email error "This email does not look right." | Not built | |
| Field "Website" with globe icon | Built | |
| Extra field "WhatsApp" | — | addition |
| Save bar state "Saved · last change 3 Nov by Emir" | Partly | build shows "Saved" with no date and no name |
| Dirty state "You have changes that are not saved" (amber) | Not built | |
| "Undo changes" button | Built | |
| "Save company" button + toast "Company details saved" | Built | |
| **Where it shows** side panel heading | Built | build caps it "WHERE IT SHOWS" |
| Business-card preview (brand, legal name, ORN) + caption "Business card · back side" | Built | |
| Sales-offer preview (brand, "Sales offer" chip, skeleton lines, legal · TRN · address · phone · email · web) + caption "Footer of every sales offer" | Built | |
| Previews update live as you type | Built | |
| Shortcut "Business card tool →" | Not built | the link to `/v2/card` is missing |
| Extra banner "1 detail to check. No TRN…" | — | addition, useful |
| Owner-only on screen | **Not built** | an agent who types `/v2/settings/company` sees the whole form, with values. Verified in the browser |
| Owner-only on the server | **Not built** | `GET /api/company` has **no role guard** (the code says this is deliberate so an agent can look up the TRN — but the design marks the page owner-only, so at the least the page must not open) |

---

## 42. ai-settings.html — Homes AI (`/v2/settings/ai`)

| Item | State | Note |
|---|---|---|
| Page in the build at all | Built | `web/src/v2/settings/Ai.tsx` |
| Title "Homes AI" + "What Homes AI may do, what it knows about the company, and how much it may spend." | Built | exact |
| Hero "Used in November" | Built | |
| Hero "$38 of $100" | Partly | build shows cents: "$38.40 of $100.00" |
| Hero chip "On track" / "A little fast" / "N% used · alert soon" | Built | all three |
| Spend bar with fill and marker, amber past 70% | Built | |
| "Day 11 of 30" | Built | |
| "At this speed: about $104 by 30 Nov" (+ "· over the limit") | Partly | build: "At this speed: about $89 by the end of the month" — no date, no over-the-limit suffix |
| Foot "At the limit Homes AI pauses until 1 December. The CRM keeps working." | Partly | build: "…pauses until the 1st. The CRM keeps working." |
| "Monthly limit" card head | Built | |
| Segmented $50 · $100 · $200 | Built | |
| Limit toast "Monthly limit is $100" | Built | |
| Five spend bars: In short · Voice notes · Chat · Morning brief · Best time | Partly | the fifth is called "Best time to call"; amounts carry cents |
| Card foot "Alert to owners at 80% and at 100%" | Partly | build: "Owners are told at 80% and at 100%" |
| "Homes AI can" card head + "N of 5 on" | Built | build caps the head "HOMES AI CAN" |
| Switch "Write “In short” on each lead" + "3 lines from the notes and timeline, new after each change" | Built | exact |
| Switch "Suggest the best time to call" + "From the client's country, local time and past answers" | Built | exact |
| Switch "Turn voice notes into text" + "And find fields like budget and unit: “Save 4 to lead”" | Built | exact |
| Switch "Write the morning brief for owners" + "One short text on the dashboard at 08:30" | Built | exact |
| Switch "Answer questions in Homes AI chat" + "Agents ask about their own leads. Owners ask about the team." | Built | exact |
| Per-switch toast | Built | |
| "What Homes AI should know about us" card head | Built | |
| Character counter "N of 1,500 letters", red past the limit | Partly | build shows "376 characters" with no limit |
| Textarea, required, minimum 20 characters | Partly | no minimum and no required check |
| Error "Write at least one full sentence." | Not built | |
| Over-length guard "The text is too long. Keep it under 1,500 letters." | Not built | |
| Note "Do not write passwords or client details here. Homes AI uses this text in every answer." | Built | exact |
| "Save text" button + toast "Homes AI will use this from now on" | Built | exact |
| Several knowledge sections instead of one textarea | — | addition (the server stores sections) |
| Banner "Homes AI reads only what the person may see: for an agent it reads only that agent's leads. It never sends a message for anyone." + "Open Homes AI" link | Built | exact |
| The assistant is called **Homes AI** everywhere the user can see | **Not built** | every user-facing AI error on the server still says **"Emir AI"** — including the Google-key ones: `server/src/ai/models.ts:333` "Open Settings → Emir AI and pick one from the list", `:340` "Google would not accept the key. Check it is correct in Settings → Emir AI", `:352` "Emir AI tried the others and waited", `:358` "Emir AI could not complete that"; `server/src/ai/ask.ts:77,79,124,150`; `server/src/http/routes/ai.ts:309`. "Settings → Emir AI" also names a menu item that does not exist in v2 |
| Owner-only on screen | **Not built** | an agent who types `/v2/settings/ai` sees the budget, the spend breakdown, the five switches and the knowledge text. Verified in the browser |
| Owner-only on the server | Partly | `GET /api/ai/knowledge` and `/usage` → `requireManager`, so a **manager** reads the budget the design restricts to owner/admin |

---

## 43. system-health.html — System health (`/v2/settings/health`)

| Item | State | Note |
|---|---|---|
| Page in the build at all | Built | `web/src/v2/settings/Health.tsx` |
| Title "System health" | Built | |
| Sub "Is everything working? Checked by itself every 5 minutes." | Not built | build: "What is connected, and what is quietly doing nothing." — and nothing is checked on a timer |
| Hero big status icon | Built | |
| Hero "5 of 6 services are fine" | Partly | build: "4 of 5 services are set up" — a different count of different things |
| Hero sub "Notifications are slow. Alerts arrive, but late. Last check 14:52." | Partly | build: "What is not set up does not fail loudly — it just never happens." No "last check" time |
| Button "Run a check now" | Partly | build: "Check now" |
| Check animation: rows go "Checking…", then settle | Built | |
| Finish toast "Check finished · all 6 services are fine" | Partly | different wording |
| "Services" card head | Built | |
| Card head sub "Bars: last 30 days" | Not built | build: "Read from where the features read" |
| Service "CRM website and sign-in · crm.homes.me" | Not built | |
| Service "Database · Leads, notes, history · last backup today 03:00" | Not built | |
| Service "Notifications · Phone and computer alerts" | Partly | the build calls it "Phone alerts"; its sub line is clipped mid-word at 1500 px ("The five-minute rule only works with the CRM op…") |
| Service "Tracked links · homes.me/p/… and “client opened your link”" | Not built | |
| Service "File storage · Brochures, IDs, booking forms · 6.2 of 50 GB" | Not built | |
| Service "Homes AI · In short, voice notes, chat · $38 of $100" | Partly | the row exists but the sub is a consequence line, and on the real server it is **titled "Emir AI"** (`server/src/services/setup-checklist.ts:105`). No spend figure |
| Extra services Email · WhatsApp · Office check-in | — | additions |
| 30-day uptime strip per service, with a tooltip "Last 30 days · 99.1% up" | Not built | nothing records history; the build says so |
| Response time per service ("180 ms", "Last alert took 48 s") | Not built | |
| Status chip Fine / Slow | Partly | build: Connected / Not set up |
| Service consequence shown even when the service is green | — | e.g. "Homes AI · Every AI answer fails with a key error. · **Connected**" reads as a contradiction |
| "Set it up" link per unset service | Partly | it points at the **v1** settings page (`/settings?tab=attendance`, `server/src/services/setup-checklist.ts:85-117`), which throws the user out of v2 |
| "What to do" card | Not built | |
| Amber banner "Notifications are slow since 14:20. A VIP lead alert can come late. Phone the agent when you give a VIP lead, until this is green again." | Not built | |
| Button "Who has notifications on" → settings-team#notif-on | Not built | |
| Timeline of past problems (3 items with dot colour, title, detail, time range, "still open" / "closed") | Not built | no incident history is recorded |
| Extra card "Who will not hear an alert" | — | addition, and a good one |
| Extra card "The website form" (Connected / leads in 7 days / last one) | — | addition |
| Footer "Something else is wrong? Tell us with a bug report marked “Blocking my work”." | Partly | build: "Something else wrong? Send it as a report marked “It stops me working”." |
| "Report a problem" button | Built | goes to `/v2/feedback` |
| No key or secret value is ever shown | Built | `GET /api/v2/health` returns booleans only; checked `setup-checklist.ts` |
| Owner-only on screen | **Not built** | an agent who types `/v2/settings/health` sees the service list, which keys are set, and the names of the two people with no phone registered. Verified in the browser |
| Owner-only on the server | Built | `GET /api/v2/health` → `requireRole('owner','admin')`; the page shows the raw 403 strip rather than the design's block |

---

## 44. inbox.html — Inbox (`/v2/inbox`)

sage §1 lists this under **LATER (drawn, clearly labelled, not built)**.

| Item | State | Note |
|---|---|---|
| Banner "LATER PHASE · **Not in the first build.** For now WhatsApp and Telegram open on the agent's phone and every tap is logged." | **Not built** | there is no banner. The page presents itself as a working shared inbox |
| Banner button "Open the messaging report" (owner) / "Open My leads" (agent) | Not built | |
| Sidebar label "Inbox · later" | Not built | the sidebar says "Inbox" with no marker. `web/src/v2/nav.ts` removed the "later" flag on purpose |
| Page sub "WhatsApp and Telegram chats in one place · later phase" | Not built | |
| Search box "Search chats" | Built | |
| Filter segmented All · WhatsApp · Telegram · Unread · N | Partly | build: All · WhatsApp · **Email** · Unread · N — **Telegram is missing**, which is the channel the whole report page counts |
| Extra segmented Mine · Free · Everyone | — | addition |
| Conversation row: avatar, name, channel badge, time, last line, unread badge | Built | |
| Chat head: avatar, name, "WhatsApp · +39 333 455 4821" | Partly | build: "+971501234567 · Layla Hassan" — the channel word is gone |
| Chat head "Open the lead" button | Partly | moved to the bottom of the side panel |
| Message list with day separators, bubbles, system lines ("Marco opened your brochure link · 10:52") | Built | build also shows stage moves and intent |
| Composer: templates button, "Write a message…", Send | Partly | build has WhatsApp / Email / Note tabs and a Send that really sends |
| Composer is inert, every press toasts "Later phase. For now open the lead and tap WhatsApp: it opens on your phone and you press send." | **Not built** | the composer works. This is the opposite of what the design says |
| Foot "In this later phase messages go out from the company WhatsApp number. Today the agent presses send on the phone." | Not built | build: "Nothing goes out until you press Send." |
| Side panel heading "Lead" | Partly | build caps it "LEAD" |
| Side panel big phone number | Built | |
| Side panel stage chip | Built | |
| Side panel **client's local time** ("Milan 11:55") | Not built | §4.5 |
| Side panel key-values Wants · Agent · Next step | Built | build adds Language and an AI summary |
| "Ready messages" heading | Built | build caps it |
| Ready buttons Hello · Brochure · Payment plan | Not built | build has First message · After a missed call · Sending details · Checking in |
| Ready message fills the composer | Built | |
| Ghost link "All 16 templates" | Partly | build: "All templates" |
| Extra: "Open · 23 h left" window indicator | — | addition (from the master prompt) |
| Extra: "Somebody else is replying to this chat." collision guard | — | addition (from the master prompt) |
| **All times on the page are 24-hour** | **Not built** | every time reads "06:40 PM", "05:44 PM", "12:05 PM". `formatTime` in `web/src/lib/format.ts:22-26` uses the `en-AE` locale with no `hour12:false`, and `en-AE` defaults to 12-hour |
| Owner/agent both reach it | Built | the design marks it `data-role="any"` |

---

## §2 GLOBAL — one line per rule, with the pages that break it

| Rule | State | Note |
|---|---|---|
| Sidebar = the phone `Menu`: Owner & admin group (owner only), My work, Team | Partly | the computer sidebar uses its own groups (unlabelled · LEADS · PLAN · PROJECTS · TEAM · MESSAGES). The three design blocks exist only on the phone's More screen (`V2More`) |
| Sidebar also holds **Notifications** | Not built | no Notifications row in the computer sidebar; the bell in the top bar is the only way in |
| Sidebar also holds **Settings** | Built | pinned above the profile |
| Sidebar also holds **Sign out** | Not built | no Sign out row in the computer sidebar; it is inside the Settings page |
| Badges: Incoming 3, Leave requests 2, Lead transfers 1, Follow-ups 5 | Built | Incoming, Follow-ups, Transfers, Tasks, and the leave count on the Attendance row |
| "Sales offers" stays in the sidebar | Built | |
| **The sidebar does not hide rows** | **Not built** | at 900 × 800 as owner the scrolling block is 520 px tall holding 812 px of rows, so Attendance, Activity, Inbox, Email and Templates are all below the fold with no visible scroll affordance. The same happens at 1300 × 900. As an agent at 900 × 800, Attendance is half-cut and Inbox/Email/Templates are gone. This is exactly the fault the owner reported |
| Sidebar keeps its labels at 900 px | Not built | below 1200 px it folds to a 68 px icon rail with no text at all (`AUTO_FOLD = 1200`, `web/src/v2/Shell.tsx:36`) |
| Top bar: search | Built | with Ctrl K |
| Top bar: bell with unread count | Built | |
| Top bar: "+ Add lead" | Partly | the design's is a **split** button with a dropdown (New lead / Task / …); the build's is a plain link |
| Top bar: Homes AI pill | Not built | no pill in the top bar or floating; Homes AI is a sidebar row. (The design's own `app.js` does not draw one either — spec and design disagree) |
| Top bar: profile | Partly | an avatar that links to the profile; the design opens a profile menu |
| Top bar: agent check-in pill showing state ("In office · 08:55" / "Check in" / "Outside · back 15:00") | Partly | hard-coded to "Check in" in the out state on every screen (`web/src/v2/Shell.tsx`, `v2-checkin v2-checkin-out`) |
| Top bar absorbs each page's `data-topbar` content | Not built | pages draw their own segmented controls in the body — messaging-report is the one in this slice |
| **Check-in gate on every call button** | **Not built** | the gate exists (`web/src/v2/check-in.tsx`) and is wired into Calling, Tasks, Inbox and the phone dial button. It is **not** on the Call buttons in `Leads.tsx` (2), `Lead.tsx` (2), `Home.tsx` (3, including the VIP "Call now"), `Pipeline.tsx` (2), `Projects.tsx` and `Activity.tsx` |
| Gate wording "You're not checked in yet" / Check in now and call / I'm working outside / Call anyway | Built | exact |
| Gate not asked of owners, admin, outside work hours, or while outside | Built | |
| **Owner pages show the block message to agents** | **Not built** | only `ManageProjects.tsx` and `VipGiven.tsx` draw "Only for owners and admin". In this slice: settings-team, settings-attendance, automations, company, ai-settings, system-health, feedback-inbox all render content or a raw red error strip; desks and messaging show a one-line error of their own words |
| Agent sees own leads + free leads only | Partly | true for leads, but `GET /api/users` hands an agent the whole staff list and `GET /api/company`, `GET /api/automations`, `GET /api/v2/rules` and `GET /api/teams` are ungated |
| Owner never lands on agent pages | Built | |
| No export for agents | Built | export is `requirePermission('export')` |
| Light / Dark / Auto, both readable | Built | checked all ten pages in both; no unreadable text found |
| Sounds with an off switch | — | on settings.html (page 30), outside this slice |
| Toasts | Built | on every page in this slice that changes something |
| Confetti on Won/Booked | — | outside this slice |
| **24-hour clock** | **Not built** | `web/src/lib/format.ts:22-26` formats with `en-AE` and no `hour12:false`, so `formatTime` returns "06:40 PM". It is used throughout `/v2/inbox`. Separately `clockIn` in `web/src/lib/dialling.ts:193-194` and `:272-273` deliberately formats the client's local time in 12-hour `en-US` — that reaches My Day, My leads, the lead page and the dialer |
| Real date/time pickers | Built | on settings-attendance and company |
| No past dates | — | outside this slice |
| **Two-click rule for every risky action** | Partly | Built on: desk delete (card and panel). **Not built** on: turning the take-back rule off (automations), removing an office network (settings-attendance), promoting/demoting an Owner (settings-team — the whole control is missing), changing a feedback status (no undo either) |
| Loading / empty / error states | Partly | loading and error are everywhere; the design's **named** empty states are missing on feedback-inbox ("No report has this status now.") and settings-team ("Nobody found" + "Show everyone") |
| i18n, Arabic RTL later | — | not checked; out of scope for this slice |
| **Never write "sent" for WhatsApp/Telegram; the agent presses send** | Partly | messaging-report obeys it carefully. `/v2/inbox` breaks it: outbound bubbles carry delivered ticks and the header says "Sent automatically · lead_welcome_en" |

### The raw role error

> "This action requires one of: owner, admin"

| Item | State | Note |
|---|---|---|
| `requireRole` / `requireManager` / `requireAdmin` no longer show it | Built | all three now return `ONLY_FOR_OWNERS = 'Only for owners and admin.'` (`server/src/http/middleware/auth.ts:51-78`) |
| **No raw role text reaches a user anywhere** | **Not built** | `assertCan` still throws `Role "agent" is not allowed to reports:team` (`server/src/auth/rbac.ts:103`), and `requirePermission` is used on ~20 endpoints (templates, projects, activity, exports, audit). Same fault, different sentence |
| The message is shown as the design's block, not a red strip | Not built | every page in this slice renders the server's text inside `<ErrorNote>` |

---

## §4 DO NOT FORGET — the items that touch this slice

| # | Item | State | Note |
|---|---|---|---|
| 1 | VIP countdown, warning 10 min before, time over → Incoming + owner told | Partly | automations sets the window, and the warning switch is there, but its note drops "10 min"; "and you are told" is gone from the summary sentence |
| 2 | "What happened?" follows every WhatsApp/Telegram click; unanswered ones count in the owner report | Built | the messaging report's No-update column and the Remind button |
| 5 | Client local time | Not built on `/v2/inbox` | the side panel has no local time, and where local time does appear elsewhere it is 12-hour |
| 6 | Tracked links (homes.me/p/…) and "client opened your link" | Partly | opens are counted and listed; the link URL is never shown, and the server's shape is `/b/{project}?a={agent}`, not `/p/…` |
| 10 | Points — +15 feedback | Not built | the feedback inbox never mentions points |
| 13 | Deactivate → open leads go to Incoming; an owner cannot be deactivated; giving Owner needs a second click | Not built | no deactivate control in v2 at all; the server does move the leads but has **no owner guard**; no second click on the role change |
| 14 | Keep at least one office Wi-Fi | Partly | the last Remove is disabled, but the explanatory line is missing |
| 14 | "Are you back?" asked once | Built | the switch is on settings-attendance with the design's wording |
| 17 | Banner "seen by 9 of 10"; max 5 banners | — | home-banners.html, outside this slice |
| 19 | Quiet hours with VIP exception; Test notification button | — | settings.html, outside this slice |
| 20 | Colleague Phone/WhatsApp: no logging, no gate | Built | `Team.tsx` uses plain `tel:` links with no gate |
| 21 | Monthly Excel report (owner) | **Not built** | no export on settings-attendance and none on the server |

---

## §5 CONTRADICTIONS — how the build resolved each

These are decisions, not features; marked by whether the build made a choice
and whether it is consistent.

| # | Contradiction | State | Note |
|---|---|---|---|
| 1 | Rocky 62 vs 14 open leads | — | n/a: the build reads the database, so no fixed figure is carried |
| 2 | My Day stage strip does not sum to 62 | — | n/a, same reason |
| 3 | Rocky "not checked in" vs in office 08:55 | — | n/a, live attendance |
| 4 | Lead owners differ between screens | — | n/a, live data |
| 5 | Calendar lead picker phones differ | — | n/a, live data |
| 6 | 16:30 site visit: Lucas or Khalid | — | n/a, live data |
| 7 | Import 6 steps or 7 | **Resolved** | 6 — Upload · Columns · Check · Give · Confirm · Done (`web/src/v2/Import.tsx:31-37`) |
| 8 | Spec bans "EOI", the phone uses it | **Resolved** | "EOI" appears nowhere in `web/src/v2/` |
| 9 | "Homes AI" vs "Emir AI" | **Not resolved** | the v2 screens say Homes AI; every server-side AI message, the system-health service title and the AI setup checklist still say Emir AI. The two are shown side by side on `/v2/settings/health` |
| 10 | "New sign-in" alert opens Team & roles vs Team activity / Security | Partly | the bell follows whatever `link` the server stores; no rule is written down either way |
| 11 | Email as a follow-up way while sending email is LATER | **Not resolved** | the build ships a full `/v2/email` page and an Email tab in the inbox composer, with no later-phase marking anywhere |
| 12 | Business card: homes.me/card/rocky vs crm.homes.me/card/rocky | Resolved silently | `web/src/v2/Card.tsx:222` uses `window.location.origin`, so it is crm.homes.me. The choice is not recorded in `docs/v2/decisions.md` |
| 13 | "Hot lead (ready to book)" button with no phone screen | **Not resolved** | there is no such button; "Hot leads" is a score-driven tile on My Day. Neither reading was written down |
| 14 | §7.8 "who has notifications on" | **Resolved** | built as the second tab of settings-team |
| 14 | Telegram backup alerts | **Not resolved** | nothing in the notification settings mentions Telegram |

---

TOTAL: 433 items — 181 Built, 103 Partly, 121 Not built.

(28 of the 181 "Built" are rows marked —, which are either additions the build made that the design does not ask for, or sample-data contradictions that do not apply to a build reading a live database. Counting only the design's own items: **405 items — 153 Built, 103 Partly, 121 Not built**, i.e. fewer than four in ten are built as drawn.)
