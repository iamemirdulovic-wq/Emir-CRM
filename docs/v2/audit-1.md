# v2 audit, part 1 — pages 1 to 11 of `design/web/research/sage.md`

*Written 13 Nov 2026. Audit only: nothing was fixed, no application file was
touched.*

Every block, field, button, dialog, rule and piece of wording that
`sage.md` §1 lists for these eleven pages is one line below, checked against
`design/web/<page>.html` (the authority on layout and wording), the phone
design where sage names one, the built screen in `web/src/v2/`, the server in
`server/src/`, and the running preview on `http://127.0.0.1:5195` in a real
browser at 1440px.

**Built** — there, with the design's layout, fields, buttons and wording.
**Partly** — exists, but something is missing or different; the note says what.
**Not built** — absent. Where the design asks for something the server cannot
supply, it is still **Not built**, and the note names the missing field or
endpoint.

---

### 1. login.html — Login

The v2 rebuild never touched this screen. `docs/v2/screens.md` records it as
"Done — the existing sign-in screen, unchanged", which is why almost nothing
of `login.html` is on it. The build is `web/src/pages/Login.tsx`.

| Item | State | Note |
|---|---|---|
| Email field | Built | `#email`, type=email, autocomplete username |
| Password field | Built | `#password` |
| Email format checked | Partly | the form is `noValidate` and nothing checks the shape; the only error is the server's "could not sign in" |
| Password min 4 | Not built | no client length check at all; the server's own rule is 8 (CLAUDE.md LOGIN), so the design's 4 is also contradicted |
| Error "Write your work email and your password." | Not built | the build says "Could not sign in. Please try again." or "Type your email address first." |
| "Keep me signed in" | Built | ticked by default, as the design has it |
| "Sign in" button | Built | |
| Language switch English / العربية | Built | `.login-lang`, switches `locale()` |
| Link to the install guide | Partly | the words are there ("No app to download…") but it is prose, not a link; the guide lives behind the sign-in so there is nothing to link to |
| Two-step sign-in for owner/admin | Not built | no second factor anywhere in the build. `web/src/v2/settings/Security.tsx` states this in words; CLAUDE.md LOGIN says "no OTP" |
| …6 code boxes, paste, auto-advance | Not built | same |
| …"Write the 6 digits." | Not built | same |
| …"Confirm and open the dashboard" / Back | Not built | same |
| "Show" / "Hide" password toggle | Not built | |
| "Forgot password?" as a link with the toast "Ask Emir, George or Abdullah…" | Partly | a static grey line, "Forgot your password? Ask your admin to reset it." — not a link, no toast, and it names no one |
| Light/dark toggle on the sign-in screen | Not built | the design puts one top-right beside the language switch |
| Two-panel layout: brand left, form right | Partly | the shape is right; the left panel is a team photo, not the design's dark brand panel |
| Brand headline "Every lead called. **On time.**" | Not built | the build's own line is "Every lead answered in seconds." |
| Brand lead line "One screen tells you who to call now…" | Not built | |
| Brand preview card "Needs you now" (VIP row with countdown, overdue row, site visit) | Not built | |
| Brand preview card "Calls today · 214" with the 6-bar chart | Not built | |
| Brand preview card "In office now · 6 of 10 · 1 late · 1 outside · 1 leave · 1 absent" | Not built | |
| Brand footer "Emigeo Homes Real Estate LLC · Wednesday, 11 November 2026 · 14:55" | Not built | |

*Not in the design and on the screen anyway: an "Email me a sign-in link"
button and the `or` divider under Sign in. Not counted as a gap; flagged
because it is a second way in that the design does not draw.*

---

### 2. install-guide.html — InstallGuide

Built as Settings → Phone app, `web/src/v2/settings/PhoneApp.tsx`, at
`/v2/settings/phone-app`.

| Item | State | Note |
|---|---|---|
| Page title "Phone app" + "…It takes 2 minutes." | Built | |
| Settings sidebar, Phone app selected | Built | |
| QR code | Not built | the design draws a 21×21 QR; the build prints `window.location.host` as text instead, which in the preview reads "127.0.0.1:5195" |
| "Scan with your phone camera" + "It opens **crm.homes.me**" | Not built | replaced by "Open the CRM on your phone · Type {host}…"; the real address is never written down |
| iPhone / Android switch | Built | |
| iPhone · 5 steps | Built | all five, in order; wording generalised ("Open the CRM in Safari", not "Open crm.homes.me in Safari") |
| Chip "iOS 16.4 or newer · Safari only" | Partly | the chip says only "Safari only" — the iOS version, which is the thing that actually fails, is gone |
| "Old iPhone? Open Settings → General → Software Update first." | Built | |
| Android · 4 steps | Built | |
| Android chip "Chrome" | Built | |
| "No alerts? Open phone Settings → Apps → homes.me → Notifications" | Built | |
| Installed state chip "Installed on your iPhone" / "Notifications are on since 3 Nov" | Not built | the chip reports this computer's `Notification.permission`; nothing records that a phone installed the app or when alerts were turned on |
| Owner variant "9 of 13 people have notifications on" | Not built | no endpoint counts it (sage §7.8 names this as having no screen) |
| "What you will see" — 3 notification samples | Partly | three samples, but generic ("VIP lead · Call within 30 minutes"); the design names the lead, the project and the real times |
| Table "Tap a notification, it opens…" | Partly | a 6-row definition list, not a table; the design has 16 rows split agent/owner, and each row is clickable through to that page |
| …"Always the exact page, never just the home screen" | Partly | shortened to "Always the exact page" |
| "Turn on notifications" → "Notifications are on · test sent" | Partly | the button asks the browser and toasts; it never sends a test, and the card never changes to the design's "test sent" wording |
| …"Send another test" after it is on | Not built | |
| "Choose my alerts" link to notification settings | Built | |
| On a computer: browser notifications are optional | Built | "Optional. Your phone is the main place." |

---

### 3. my-day.html — Main (agent)

`web/src/v2/Home.tsx`, `MyDay`, at `/v2` for an agent.

| Item | State | Note |
|---|---|---|
| Greeting + date | Built | "Good evening, Layla" + the Dubai wall clock |
| Owner banners carousel, 3 slides, dots, 4.5 s | Partly | one slide at a time with dots and a 4.5 s timer, but the computer card has no photo, no label chip ("From Emir" / "Project" / "Best of Homes") and the button reads "Open" instead of the banner's own button text |
| Check-in card "OFFICE WI-FI FOUND" | Partly | the chip is there without the network name ("homes.me-Office") |
| …"Ready to start your day?" | Built | |
| …"Shift 09:00 – 18:00 · late after 09:10 · check-in works only on the office network" | Partly | reads "Shift starts 09:00 · check-in works only on the office network" — no end of shift, no late-after time |
| …"Check in" button | Built | disabled off the office network |
| …"I'm working outside today" | Built | links to `/v2/attendance` |
| Becomes a pill "In office" after check-in | Not built | the hero switches to "ready"; there is no state pill on this page |
| "Outside · place · with whom · back by" banner + "I'm back" | Not built | the design's blue bar is absent from this page |
| "Are you back in the office?" dialog (Yes, I'm back / Not yet) | Not built | |
| "Turn on notifications" card (Turn on, How to install, dismiss) | Partly | built as `NotifyCard`, rendered `isPhone &&` only — on the computer page, which is what this audit covers, it does not appear |
| VIP card chip "VIP LEAD FROM EMIR · given 14:49" | Partly | "VIP LEAD FROM {NAME}"; the given-at time is not shown |
| VIP card: phone as the big link | Built | 46px, biggest thing on the screen |
| VIP card: name · project | Built | |
| VIP card: the owner's note, in quotes, attributed | Built | |
| VIP card: live countdown "24:12 left to call" | Built | counted from the server's deadline, ticking each second |
| …"Not called in time → back to Incoming" | Built | |
| …warning 10 minutes before the end (§4.1) | Partly | the number turns `d-warn` under 5 minutes, not 10 |
| "Accept VIP lead" | Built | |
| "I can't take it" → "Tap again to send it back" | Built | two taps, the prototype's own wording, disarms after 6 s |
| …the message afterwards + **Undo** | Partly | it says "Sent back to {owner}"; there is no Undo |
| After accept: "Call now" + "Open the lead" + "Emir is told you accepted." | Built | |
| When the time ends: "Time is over · back in Incoming" + "OK, show my call list" | Built | |
| VIP "called" state — "called 14:55 · clock stopped", "What happened?", "Call again" | Not built | a call from this card is a plain `tel:` link, so nothing stops the clock |
| Next up / "Next plan" card: time + "in 25 min" + what + Calendar link | Partly | time, chip and the one line are there; the design's "then" list of the next two plans is not |
| …"How did it go?" ask row | Partly | the row exists but it is fed by WhatsApp taps, not by a meeting needing a result; the design's row is "Omar Khalil · 12:00 · before 21:00" and the Answer button opens a dialog — here it is a link to the lead |
| "How did it go?" dialog — Showed up / No-show / Rescheduled / Booked a unit / Cancelled | Not built | no dialog on this page; the next-step chips, the per-answer hints, the note box and "Open in the calendar" are all absent |
| Tile "My leads" | Built | |
| Tile "To call today" + overdue chip | Built | |
| Tile "Hot leads" | Built | |
| Tile "Meetings today" | Partly | the chip reads "in the calendar"; the design's is "1 needs a result" |
| Today's calls: 18 of 40 | Partly | only inside the "ready" hero's goals column — there is no "Today's calls" card of its own, so on a VIP or not-checked-in morning the figure is nowhere |
| …9 of 20 WhatsApp | Partly | same place, same condition |
| …1 of 2 meetings | Partly | same |
| …"12 days streak" | Partly | written "12 days in a row" |
| …"+240 points today" | Not built | the second slot shows "kudos this month", a different number |
| …"Ranking" link to Best of Homes | Not built | |
| "Start calling · 12 ready" | Built | |
| Locked text "Check in to start calling" | Built | in the not-checked-in hero, with "12 leads wait for you" |
| Call list card, VIP first | Built | `callNow`, VIP first, 6 rows |
| …stage chip on each row | Not built | the design's row carries a stage pill; the build's does not |
| …"One by one" link, footer bar, "All 12" | Built | |
| "2 messages waiting for your update", each with "What happened?" | Partly | the list and the count are right; the button is a link to the lead page, and the lead page has no way to answer — a dead end (§4.2) |
| "Marco Bellini opened your brochure link" row | Built | with the open count |
| Shortcuts: Add lead (+10 points) / Follow-ups / Calendar / Projects | Not built | |
| "My leads by stage" strip → Pipeline | Partly | six stages with counts and percentages; the design's seventh, "Lost · kept apart", is missing |
| "Best time to call now" — 3 leads, client's clock, Call buttons | Built | worked out from the number's country |
| …footer "Ahmed Hassan is best at 19:00 KSA time" | Not built | |
| "Meet your colleagues" strip | Not built | |
| "Projects we sell now" — 4 project cards | Not built | |
| Homes AI tip line | Built | written from the page's own counts, never a model |
| Lead transfers "1 for you" | Partly | a badge and one row; the design's card has Accept / "No, thanks" (two taps) and "Answer by 18:00" inline, plus a "you sent" row under it |
| Follow-ups card: Overdue / Today counts | Built | |
| Follow-ups card: the three named rows with a "Done" button | Not built | the card is counts only |
| …"What happened with X?" dialog on Done (4 answers) | Not built | it exists on `/v2/tasks`, not here |
| "Today's plan" day timeline 09:00–18:00 with the moving now-line | Not built | |
| …"Shift ends 18:00 · tomorrow starts with Call Ahmed 10:00" | Not built | |
| Confetti on check-in and on accepting a VIP lead | Not built | `web/src/lib/celebrate.ts` exists and no v2 screen calls it |

---

### 4. owner-home.html — OwnerHome (owner/admin)

`web/src/v2/Home.tsx`, `OwnerDay`, at `/v2` for an owner.

| Item | State | Note |
|---|---|---|
| "Add a lead and give it" | Built | |
| "Import Excel" | Built | |
| "Incoming · 3" | Built | |
| Period switch Today / Week / Month / Year | Not built | |
| "Live · 14:55" | Not built | |
| Homes AI line + "Ask Homes AI" button | Not built | the agent's My Day has one; the owner's home does not |
| "Needs you now" as a hero with the count, "Only you can do these" and "Oldest waits 75 min" | Partly | a plain list in a card: no count, no sub-line, no oldest-wait chip |
| …row: VIP lead not called → "Give again" | Built | |
| …row: transfer needs approval → "Approve" | Built | |
| …row: leads wait in Incoming → "Give" | Built | |
| …row: 2 leave requests → "Answer" | Built | opens `/v2/attendance` |
| …row: agent absent → "See" | Built | |
| …row: blocking bug → "Open" | Built | opens `/v2/settings`, not the feedback inbox |
| …each row names the lead or person ("VIP Omar Khan is not called · Bassam had 30 min") | Not built | rows are counts and categories only — "1 VIP lead not called in time" |
| …an icon per row | Partly | rendered `isPhone &&`; the computer rows have none |
| …"All clear" empty state | Built | |
| Leave requests dialog (Approve / Refuse + the three refusal reasons) | Not built | the row links away to Attendance |
| Absent-agent side panel (3 stats, last 8 working days, "Phone Bassam", "Move his 44 leads", "Mark as leave") | Not built | |
| "Give to an agent" dialog on this page | Not built | the row links to Incoming |
| Team today: In office / Late / Outside / Absent-leave, each opening team attendance | Partly | four tiles: In office, Late, Outside, **Not marked** — "Leave" is not one of them, and the design's stacked bar and its coloured legend are both absent |
| Today in numbers: New leads | Built | |
| …Calls · WhatsApp · Telegram | Built | one tile, the two message counts in its note |
| …Meetings booked | Built | |
| …Units booked | Built | |
| …Follow-ups overdue | Built | |
| …No next step | Built | |
| …each row opens its filtered list | Built | checked: every tile carries a `?tab=` that exists |
| Calls today card: bars by hour with the "now" marker | Not built | |
| …"12% vs yesterday" | Not built | |
| …"First contact: 6 min median" | Not built | |
| …"Best hour 10:00" | Not built | |
| New leads card: "4 vs yesterday" | Not built | |
| New leads card: "3 wait in Incoming" link | Partly | the number is on the Incoming button at the top instead |
| Meetings and units card with "Talha · Damac Islands · AED 2.9M" | Not built | the units tile has no who/what/how much |
| Pipeline strip (863 leads · 809 open, seven stages with percentages, Lost kept apart) | Not built | the agent's home has a stage strip; the owner's does not |
| "Open the full dashboard" | Built | |
| Team right now table | Partly | five columns (Who / Today / Open leads / Calls today / Last seen). Missing: check-in time, the 7-day call sparkline, open-vs-desk-max bar, the **Overdue** column, problems-first ordering, the desk-maximum footer and the Desks link |
| Watch list card: Follow-ups overdue / No next step / Transfers today / WhatsApp taps / Going cold | Not built | two of the five exist as tiles elsewhere; the card and the per-row detail lines do not |
| Shortcuts card (Add a lead and give it / Import Excel / Incoming badge) | Partly | the same three as plain buttons at the top of the page, not the design's card at the foot of the right column |
| "Latest leads" table (name + phone, project, stage, agent, added) | Not built | |
| "VIP leads I gave" card, 5 rows with status chips and a live countdown | Not built | there is a whole separate page at `/v2/vip`; nothing on the owner's home shows it |
| Agents see "Only for owners and admin" on owner pages | Built | `web/src/v2/OwnerOnly.tsx` |

---

### 5. notifications.html — Notifications

`web/src/v2/Bell.tsx`, `V2Notifications`, at `/v2/notifications`.

| Item | State | Note |
|---|---|---|
| Counter "N new" | Built | 56px, as the design has it |
| "new notification" / "new notifications" | Built | |
| Sub-line "Click a row and it opens the right page." / "All read…" | Built | both variants |
| "Mark all read", disabled when nothing is unread | Built | |
| Agent tabs All / Leads / Meetings / Tasks / Team | Partly | the tabs are filtered to the groups that have rows, so an agent sees whatever exists — including **System**, which the design gives only to owners. **Meetings can never appear**: no type in `KINDS` maps to it, and nothing in `server/src/messaging/notify.ts` writes a meeting notification |
| Owner tabs All / Leads / Team / System | Partly | no role split at all — one shared list of six groups for everybody |
| Unread count on each tab | Built | |
| "Only new" switch | Built | |
| Row: icon per kind | Built | 14 kinds mapped, unknown kinds fall back to a grey bell |
| Row: title | Built | |
| Row: text | Built | |
| Row: age | Built | "4 min ago", "2 h ago", "3 d" |
| Row: unread dot | Built | |
| Row: "Mark read" | Built | |
| Row: action link that opens the exact page, tab or dialog | Partly | one generic "Open →" on every row. The design labels each one ("Give again", "Approve or refuse", "Open the result") and several point at a tab or a dialog (`#leave`, `#unusual`, `calendar.html#result`); the stored `link` is a bare path |
| Day groups Today / Yesterday / Earlier this week / the date | Built | Dubai's fixed +4 offset |
| Empty state "You are up to date" + per-tab text | Built | |
| …"Show all notifications" | Built | shown only when a filter is on, which is correct |
| Side card "Choose what reaches you" + Quiet hours / VIP leads / Sound | Built | read from `/api/v2/notify`, so it cannot drift |
| …"Choose what reaches you" button | Built | |
| Side card "Alerts on your phone" with an "On" chip | Partly | no state chip |
| …"Test" button | Not built | |
| …"How to install" link | Built | |
| Bell count in the top bar follows the page | Built | |

---

### 6. search.html — Search

`web/src/v2/Find.tsx`, `V2Find`, at `/v2/search`, plus the Ctrl-K palette.

| Item | State | Note |
|---|---|---|
| One box, placeholder "Name, phone, project, screen" | Built | |
| "Enter opens the first result" | Built | and it does |
| Clear (×) | Built | Escape clears too |
| Chips All / Leads / Projects / **Tasks** / Screens | Partly | no Tasks chip, and tasks are not searched — `/api/search` returns leads and projects only |
| Counts on the chips | Partly | they count what came back, and the endpoint caps each kind at 6, so "Leads 6" can mean sixty |
| Result count line | Built | |
| "Recent" chips | Partly | this browser's own last five searches; with none it shows four example chips instead of the design's seeded terms |
| "You opened last" card | Not built | |
| Results grouped by type with "Leads · N" headings | Built | |
| Type tag on each row | Built | |
| The typed word highlighted in the row | Built | `<mark>`, first occurrence |
| Lead row: phone under the name | Not built | the hint is "project · stage"; the number is not in the search response |
| Lead row: stage chip | Not built | the stage is in the hint text, not as a pill |
| Lead row: VIP tag | Not built | not in the search response |
| Another agent's lead found by name or full phone, shown locked: "This lead is with Nelson. You cannot open it." | Not built | `searchLeads` fences on `visibleUserIds`, so another agent's lead is not returned at all — an agent searching a number another agent holds is told it is a new number |
| A free lead shown with "Free in Incoming" | Not built | `ownerPredicate` is `owner_user_id IN (…)`, which never matches an unassigned lead, so Incoming is invisible to search |
| Owner rows show "with {agent}" | Not built | no owner column in the search response |
| "Nothing found" + the reason line (phone / wrong group / nothing at all) | Built | all three variants |
| "Add as a new lead", carrying the name or the phone | Built | |
| "Ask Homes AI" | Built | |
| Rule line at the foot, per role | Built | both the agent's and the owner's |
| `?q=` opens with that term | Built | |
| Screens searchable | Built | from `nav.ts`, role-filtered |
| People searchable, labelled "Person" | Not built | the design puts the 13 colleagues in the results; the build has no person kind |

---

### 7. homes-ai.html — AskAI

`web/src/v2/Ai.tsx`, at `/v2/ai`.

| Item | State | Note |
|---|---|---|
| Chat with the opening hello, named | Built | "Hello Layla…", and the sentence names what it reads |
| Header "Homes AI" + the scope line, per role | Built | |
| "New chat" | Built | clears the thread and the conversation id |
| "TRY ASKING" — 5 chips | Partly | an owner gets 5; an agent gets 7 |
| Answers come back with a link to the right page | Partly | a `[lead:id]` token becomes a small arrow link to that lead. No links to a list, a report or a screen, and none of the design's action buttons under the answer |
| Draft answer with a "Copy the text" action | Not built | |
| Empty question → "Write a question first." | Built | and the box turns `d-bad` |
| "reads only your own leads. It never sends a message for you." | Built | twice: header and under the composer |
| Composer placeholder, per role | Built | |
| "Enter to ask" | Built | |
| Thinking dots | Built | |
| "Homes AI tip for now" hero + its action button | Built | from `/api/activity/do-now`, counted by SQL |
| "What it can do" — 3 can, 1–2 cannot | Built | plus a fourth "can" about the project library |
| "You asked before" card | Partly | this device's own last five; the design seeds three real questions that answer when tapped |
| Floating "Ask Homes AI" pill on every screen | Not built | Homes AI is a sidebar item only — no floating pill anywhere in `Shell.tsx` |

---

### 8. my-leads.html — Leads (agent)

`web/src/v2/Leads.tsx`, at `/v2/leads`.

| Item | State | Note |
|---|---|---|
| Sub-line "62 open · 12 to call today" | Partly | written, but only into the phone header; on the computer the top bar shows "My leads" and nothing else |
| Search by name / phone / project | Built | |
| Tab "Today · 12" | Built | |
| Tab "New" | Built | |
| Tab "Overdue", count in red | Built | |
| Tab "No next step" | Built | |
| Tab "VIP" | Built | |
| Tab "Lost" | Built | |
| Tab "All" | Built | |
| Count line "N of N leads" | Built | the fix for Emir's 11 Nov report is in place |
| Link "Free leads" + badge 3 | Partly | the link is there; no badge, so an agent cannot see from here that anything is waiting |
| Link "Pipeline" | Built | |
| "Start calling · 12 ready" strip on the Today tab | Built | |
| …"+15 points per call" | Not built | |
| …"18 of 40 calls today" with the bar | Not built | |
| …locked when not checked in ("Check in to start calling" / "Check in first", pointing at Attendance) | Not built | the strip is identical whether or not the agent is checked in |
| Stage filter | Built | |
| Project filter | Built | from the real project list |
| Filter chips + "Clear all" | Built | |
| Table column "Lead" with avatar and VIP tag | Built | |
| Table column "Phone" | Partly | unspaced, `+971501234567`; `spacedE164()` exists and the lead page uses it, and this is the column an agent dictates from |
| Table column "Project" + what they want | Built | |
| Table column "Stage" chip | Built | |
| Table column "Local time" | Built | client's clock, 12-hour by Emir's 10 Nov request |
| Table column "Next step", red when overdue / came back / VIP not called | Built | all three red cases |
| "Call" per row | Built | |
| "WhatsApp" per row | Built | |
| Row "⋯" menu — Open the lead / Telegram / Add note / Plan a follow-up / Transfer to another agent | Not built | a single "open" icon button in its place |
| Sort by clicking Lead / Project / Stage | Not built | the headers are plain `<th>` |
| Lead quick-view side panel on a row click | Not built | the whole `#lead-panel` — big phone, stage, VIP, local time, Call/WhatsApp/Telegram, next step, Project / Unit·budget / Speaks / Last contact, the last note, Transfer, Add note, "Open full page" — is absent; a row click navigates to the full page |
| Arrow-up / arrow-down through the rows | Not built | |
| Empty state + "Add a new lead" + the per-tab empty sentence | Built | the server supplies the per-tab wording |
| Table foot "1–N of N" + "Show more" | Built | |

---

### 9. lead.html — Lead / Notes / TransferLead / single-call Dialer

`web/src/v2/Lead.tsx` with `LeadAction.tsx`, `TransferLead.tsx` and
`web/src/components/LeadNotes.tsx`, at `/v2/leads/:id`.

| Item | State | Note |
|---|---|---|
| Header: the phone is the largest text | Built | 28px, measured biggest on the page; grouped for reading aloud |
| Header: name | Built | |
| Header: "with Rocky" | Built | and "in Incoming · no agent yet" when nobody holds it |
| Header: stage chip | Built | |
| Header: "Score 72" | Built | the reason on hover |
| Header: tags | Built | namespace stripped |
| Header: "Hot" chip | Built | from `score_band` |
| Header: "Investor" chip | Not built | `opportunities.purpose` exists and is neither sent nor drawn |
| Header: country and the client's local time | Built | with a flag |
| Header: best time to call | Built | |
| "Transfer this lead to another agent" / owner "give this lead to another agent" | Built | both wordings, by role |
| Open-request status row ("Emir must approve · ends 18:00") + Cancel on two taps | Not built | once a transfer is asked for, this page says nothing about it |
| Back link reads "My leads" for an agent | Not built | the top bar says "All leads" for every role (`Shell.tsx`), and the design's `data-back` is role-dependent |
| Banner "WhatsApp opened · waiting for your update" + "What happened?" | Not built | the banner is on My Day only; the lead page, which is where My Day sends you, has nothing |
| "Next step" card | Built | note, time, and "Plan a follow-up…" when empty |
| …"Done" button on the next step | Not built | only "Change" / "Add one" |
| Action: Call (`tel:`) | Built | |
| …the call is logged | Not built | a plain anchor. `POST /api/v2/calls` exists and only `Calling.tsx` uses it, so a call started from the lead page is invisible in every report (§4.4) |
| …number + QR for a computer without a phone app | Not built | |
| …the check-in gate on the call button | Not built | `useCheckIn` is wired into `Shell` (phone dial button), `Calling`, `Inbox` and `Tasks` only — not this page, not My Day, not the leads table |
| Action: WhatsApp | Partly | a `wa.me` link. No ready-message picker, no tracked link, and `POST /api/v2/taps` is not called, so there is no tap to answer for |
| Action: Telegram | Not built | a button that answers "Not yet — phase 6" |
| Action: Follow-up | Built | |
| Action: Meeting | Built | |
| Action: Won | Built | |
| Action: Lost | Built | |
| "In short" summary card with the Homes AI chip | Not built | no endpoint produces a lead summary |
| "What Marco wants" heading, first-name | Built | |
| …"click a line to edit" | Not built | the hint is gone and the rows are read-only |
| …an edit writes a timeline entry and a change-history row | Not built | |
| …Project | Built | |
| …Unit | Built | |
| …Budget | Built | |
| …Purpose | Not built | `opportunities.purpose` exists; `/api/my-leads/:id` does not select it |
| …Timeline | Not built | `opportunities.timeline` exists; not selected |
| …Payment | Not built | `opportunities.payment_method` exists; not selected |
| …Language | Built | prints the raw code ("en"), not a language name |
| "Wants" chips with + Add and remove | Not built | |
| "Doesn't want" chips with + Add and remove | Not built | |
| Source | Built | |
| Lead # | Built | the first 8 characters of the id |
| Tab "Notes" with the note count | Partly | the tab is there; the count is not — it sits on Timeline instead |
| Tab "Timeline" | Built | |
| Tab "Info" | Built | |
| Tab "Files" with the file count | Not built | the tab exists and holds an explanation, not files |
| The page opens on Notes | Not built | it opens on Timeline |
| Info: Phone | Built | |
| Info: WhatsApp 2 | Not built | `contacts.whatsapp_number` exists (migration 0036); not selected or drawn |
| Info: Telegram | Not built | `contacts.telegram` exists; not selected or drawn |
| Info: Email | Built | |
| Info: Nationality | Not built | `contacts.nationality` exists; not selected or drawn |
| Info: Birthday | Not built | no column anywhere |
| Info: change history ("Rocky changed Budget · 1.5M → 2M") | Not built | `audit_log` holds it; no endpoint serves a record's history |
| Files: the file list with "Open" | Not built | files live on a note; this tab explains that instead |
| Files: "+ Photo" | Not built | |
| Files: "+ Booking form" | Not built | |
| Files: "+ ID or passport" | Not built | |
| Files: folders All / Passport & ID / Booking forms / WhatsApp screenshots | Not built | nothing classifies a file |
| Files: "only you and owners see it" and "Every view is logged" | Not built | no per-view logging on a note file |
| Add note: types Note / Call / Viewing / Budget / Objection / Next step | Built | all six |
| Add note: quick phrases **per type** | Partly | six fixed phrases, the same whichever type is chosen |
| Add note: voice record / stop with a timer | Built | |
| Add note: "Remind me" — In 1 h / Tonight / Tomorrow 10:00 / Pick time | Partly | one date-time field; none of the four chips |
| Add note: "@ Tag a colleague" menu | Partly | you can type `@name`; there is no colleague menu to pick from |
| Add note: Pin / Unpin | Partly | on a saved note; there is no "Pin on top" tick while writing |
| Add note: Edit | Not built | a saved note offers Pin and Delete only |
| Add note: needs text or a voice note | Built | |
| Add note: the design's composer markup | Not built | this is the v1 notes component (`.note-compose`, `.lead-note`), not `lead.html`'s `d-composer` — the one block inside the v2 lead page that is not the design's own |
| Note row: "Pinned" chip and the "Reminder today 15:30" line | Partly | a pin icon only |
| Timeline: calls, messages, stage changes and field edits | Partly | whatever is in `activities` renders with the right dots; nothing on this page writes a call tap, a message tap or a field edit, so three of the design's six kinds of row can never appear |
| Follow-up dialog: when chips (In 1 hour / Tonight 19:00 / Tomorrow 11:00 / Pick date & time) | Built | |
| Follow-up dialog: How — Call / WhatsApp / Email | Built | |
| Follow-up dialog: "What about" required | Built | with the design's error |
| Follow-up dialog: sub-line "Milan is 3 hours behind Dubai" | Not built | |
| Meeting dialog: type chips (Office meeting / Site visit / Show flat / Video call) | Built | |
| Meeting dialog: when, no past dates | Built | |
| Meeting dialog: where, required | Built | |
| Meeting dialog: "then WhatsApp opens with the time; you press send" | Not built | the banner promises a calendar entry instead |
| Meeting dialog: reminder 2 h before | Partly | it goes in the calendar; nothing says 2 hours and no 2-hour reminder is scheduled |
| Won: unit | Built | asked for, not required — a deliberate departure, written up in `docs/decisions-to-confirm.md` §14 |
| Won: price, AED | Not built | |
| Won: paid now ≤ price | Not built | |
| Won: "What was signed" — Booking form / Reservation agreement / SPA | Not built | |
| Won: booking form or receipt required ("Without it the deal is not counted") | Not built | |
| Won: confetti | Not built | |
| Won: posted on the Team wall | Built | `postDealWon()` on the server |
| Won: +300 points | Not built | `recordAchievement` awards XP for reached and meeting_booked only; a Won pays nothing |
| Lost: a reason is required | Built | |
| Lost: the design's six reasons | Partly | three match. "Not into off-plan" and "Is a broker, not a buyer" are missing from the server's `LOST_REASONS` enum, and "Never reachable" / "Changed their plans" are there instead |
| Lost: a note, required ≥5 letters with "Other" | Built | |
| Lost: "Try again in 3 months" | Not built | |
| WhatsApp / Telegram: pick a ready message (Meeting time / Hello / Brochure / Payment plan / Write my own) with a tracked link | Not built | |
| …"Open WhatsApp", then on return "What happened?" with the seven answers + note + voice, or "Later" | Not built | the flow exists in `Calling.tsx` for the dialler and nowhere else |
| Voice note player with 1.5× speed | Not built | a plain `<audio controls>` |
| Voice note transcript | Not built | nothing transcribes |
| "Homes AI found 4 details · Save 4 to lead" | Not built | |
| "Scan / upload" | Partly | a file picker on a note; no scan, no folder choice |
| "Coming up" card with the Calendar link | Built | open tasks with a due date |
| Single-call Dialer from this page | Not built | `/v2/calling` walks the whole Today queue; there is no way to dial just this lead through it |

---

### 10. add-lead.html — AddLead

`web/src/v2/AddLead.tsx`, at `/v2/leads/new`. The strongest page in this
slice.

| Item | State | Note |
|---|---|---|
| Sub-line "Name, phone and source are needed. The rest can wait." | Built | |
| Nothing preselected | Built | checked in the browser: name, phone, source and who are all empty |
| Step 1 card "Who is it?" | Built | |
| …"+10 points" chip for an agent | Not built | |
| Full name, required | Built | |
| Phone, required, digits only, ≥7 | Built | |
| Country picker with a search box | Built | |
| Country picker regions Popular / GCC / Europe / Asia / Africa / Americas / Oceania / All | Built | all eight |
| "We check every number for duplicates while you type." | Built | |
| "New number." | Built | |
| A duplicate blocks the save | Built | the button is disabled and the red banner shows |
| …and says who has it, with "Open" | Built | plus "free lead in Incoming" and "with another agent" variants |
| Lead source, required | Built | |
| Agent source list — 7 chips | Partly | six; **"Other"** is missing |
| Owner source list — 7 chips | Partly | five; **"Old client"** and **"Other"** are missing |
| Referral / Event / Other ask a detail | Partly | Referral and Event do; there is no "Other" chip to ask for one |
| Step 2 "More details · optional" | Built | |
| "WhatsApp is the same number" switch, else a second number | Built | |
| Telegram | Built | |
| Email, format checked | Built | |
| Project: 4 chips + "Not sure yet" + "Other" → type it | Built | the four come from the real project list |
| Looking for: Studio / 1BR / 2BR / 3BR+ / Villa | Built | |
| Budget: Under 1M / 1–2M / 2–3M / 3–5M / 5M+ | Built | |
| Buying to: Live in / Invest / Both | Built | |
| Speaks, multi-select | Built | |
| Note | Built | |
| Step 3 "Who works it?" | Built | |
| Agent: "Me" / "Leave in Incoming" | Built | both with the design's sub-lines |
| Owner: agent list with open-lead counts | Built | |
| Owner: a status dot on each agent | Not built | `GET /api/leads/agents` returns id, name and open_leads only — no attendance |
| Owner: agents on leave or absent cannot be chosen | Not built | same endpoint; every active user is selectable |
| Owner: "Leave in Incoming" | Built | |
| Owner: "Give as a VIP lead" switch + its explanation | Built | |
| Owner: "Must call within" 15 min / 30 min / 1 hour / Today | Built | all four |
| Owner: private note for the agent | Built | |
| Red block banner "This number is already in the CRM. The lead cannot be saved twice." | Built | word for word |
| "Save lead" + the live summary line | Built | "Still needed: name, phone, source, who works it." |
| Saved state: "{name} is saved" + "Open lead" + "Add another" | Built | |

*Not in the design and on the screen anyway: a "When" row (Now / 1–3 months /
3–6 months / 6–12 months / Not sure). Not counted as a gap.*

---

### 11. incoming.html — Incoming / OwnerAssign

`web/src/v2/Incoming.tsx` at `/v2/incoming`, and `web/src/v2/VipGiven.tsx` at
`/v2/vip`.

| Item | State | Note |
|---|---|---|
| **Agent** — sum line "N free leads to take · the first agent who takes a lead gets it" | Built | plus "· 1 VIP lead waits for an owner" |
| Row: lead name | Built | |
| Row: project | Built | |
| Row: source | Built | |
| Row: "waiting 42 min", red over 30 | Built | and "3 hours" / "1 day" rather than "4320 min" |
| Row: the reason it is free | Built | three real reasons |
| "Take this lead" → it moves to My Leads | Built | with "Somebody was quicker" handled |
| VIP row: "Only an owner gives it" | Built | |
| Empty state "Incoming is empty" + "Open My leads" | Built | |
| "The rules" card, 3 rules | Built | word for word |
| "My leads" shortcut with the badge | Partly | no badge |
| **Owner** — tab "Waiting" with the red count | Built | |
| Tab "VIP leads I gave · 5" | Not built | the second tab is "Came back to you". The VIP list exists as a separate page at `/v2/vip` and **nothing on Incoming links to it** |
| "Add a lead and give it as VIP" | Built | |
| Sum line "N leads wait for an agent · the oldest waits 42 min" | Built | |
| Rows show the phone for an owner | Built | and spaced |
| "Give to an agent" / "Give again" per row | Built | |
| Give dialog: agent list, status line, open counts, "Best match" | Built | |
| Give dialog: on-leave / absent rows disabled | Built | `availability === 'off'` is disabled and never the default |
| Give dialog: "Must call within" 15 min / 30 min / 1 hour / Today | Not built | two buttons, "No clock" / "5 minutes to accept" — `/api/incoming/assign` has only the 5-minute `urgent` flag |
| Give dialog: "Fewest open leads first. People on leave or absent cannot be chosen." | Partly | "People marked unavailable cannot be chosen" |
| "Share equally" card + "Gives the N normal leads…" + "A VIP lead is never shared" | Built | word for word |
| "Share the normal leads equally", two clicks | Built | and it reports how many VIP leads it left |
| "How a lead gets here" card, 4 rules | Built | word for word |
| …"Change the take-back times" link | Built | to `/v2/automations` |
| VIP list: seg All / Needs you / Going well **with counts** | Partly | the three tabs are on `/v2/vip`; no counts on them |
| VIP list: table Lead / Agent / Given / Status | Not built | a list of cards; there is no "given at" column, because nothing serves `vip_handoffs` |
| VIP statuses Waiting / Called / Meeting / Offer / Came back | Built | derived from real columns, plus Won |
| VIP row: live countdown "24:12 left to call" | Not built | `vip_handoffs` (given_by, accepted_at, deadline_at) has no listing endpoint — `server/src/v2/vip.ts` only accepts and refuses one by id |
| VIP row: "Give to another agent" (new 30-minute clock) | Partly | it reassigns; no clock is set and the first agent is not told |
| VIP row: "Remind the agent" | Not built | nothing in the build sends an agent a nudge |
| VIP row: "I will call myself" | Built | |
| Footnote "…starts a new clock of 30 minutes. The first agent is told." | Not built | |
| The VIP page has a title in the top bar | Not built | `/v2/vip` is not in `titleFor()`, so the top bar reads "homes.me" |

---

## Totals by page

| Page | Items | Built | Partly | Not built |
|---|---|---|---|---|
| 1. login.html | 23 | 5 | 4 | 14 |
| 2. install-guide.html | 20 | 10 | 5 | 5 |
| 3. my-day.html | 58 | 24 | 17 | 17 |
| 4. owner-home.html | 42 | 19 | 6 | 17 |
| 5. notifications.html | 24 | 19 | 4 | 1 |
| 6. search.html | 24 | 13 | 3 | 8 |
| 7. homes-ai.html | 15 | 10 | 3 | 2 |
| 8. my-leads.html | 33 | 23 | 3 | 7 |
| 9. lead.html | 99 | 41 | 11 | 47 |
| 10. add-lead.html | 38 | 32 | 3 | 3 |
| 11. incoming.html | 34 | 23 | 4 | 7 |

TOTAL: 410 items — 219 Built, 63 Partly, 128 Not built.
