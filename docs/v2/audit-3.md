# v2 audit 3 — pages 23 to 34

*Written 13 Nov 2026. One line per item in `design/web/research/sage.md` §1
pages 23–34, checked against the page's own design file
(`design/web/<page>.html` — body and `<style>`), its phone screen
(`design/screens/*.dc.html` + `design/phone-shots/*.png`), the build in
`web/src/v2/`, and the server in `server/src/` where a field has to exist
before a screen can draw it.*

**How it was checked.** The preview on `127.0.0.1:5195` is a bundle built at
14:33 and its route table has no `OwnerOnly` wrapper, so it is older than the
branch. Every judgement below is against the source on
`claude/new-session-krd7bx`, looked at in a real browser from a bundle built
from that source (Chromium, 1440 × 1200, owner and agent). Where the two
differ it is said so on the line.

**Three things are true of every page in this slice and are therefore counted
once, here, rather than thirty times below.**

| Item | State | Note |
|---|---|---|
| The grey sub-line under the page title (`data-sub` on every design `<body>`) | Not built | `design/web/app.js` draws `data-title` and `data-sub` as a title and a 13px grey line in the top bar. `V2Shell`'s desktop `TopBar` renders `titleFor(pathname)` only — there is no `.v2-psub` at any width above 767px. The sub-lines exist on the phone, through `usePhoneHead`. Affects all twelve pages in this slice |
| One rule for "how many agents" | Not built | Three different SQL rules are live. `server/src/v2/{dashboard,home,live,incoming,desks,transfers}.ts` use `role IN ('agent','manager')` — right. `server/src/attendance/attendance.ts:233` uses `role NOT IN ('automation','owner')` — **admin counted as an agent** on Team attendance and on Team live's attendance card. `server/src/http/routes/wall.ts:314` uses `role <> 'automation'` — **owner and admin counted as agents** in Best of Homes and in the wall's ranking panel. `/api/activity/team` (routes/activity.ts:252) applies no role filter at all, so the owner appears in Team live's "Right now" list and in Team activity's hours table |
| 24-hour clock everywhere | Built | Every date and time helper on these twelve pages formats with `en-GB` and `hour: '2-digit'`, and the ones that could drift pass `hour12: false` explicitly. No `AM`/`PM` is produced on any of them. One caveat, not a 12-hour one: `Wall.tsx`'s `clock()` has no `timeZone`, so a post's time is the viewer's clock, not Dubai's |

**"Assigned by sticky owner".** Confirmed present, and it is not on these
twelve pages. It is written by the server:
`server/src/workflows/workflow-a.ts:271` stores an activity titled
``Assigned by ${input.reason.replace(/_/g,' ')}`` and
`server/src/assignment/apply.ts:190` stores ``Assigned by ${reason}``
un-prettified, so a lead's history reads "Assigned by sticky owner" and
"Assigned by sticky_owner". Both surface on the lead timeline, `lead.html`
(page 9), which is another slice. Nothing in `web/src/v2/` contains the
phrase.

---

### 23. team-wall.html — the team wall

| Item | State | Note |
|---|---|---|
| Post box: your avatar beside a textarea | Built | |
| Textarea placeholder "Share news, a win or a question with the team" | Partly | reads "Share a win or a tip with the team" |
| Owner switch "Owner news · stays on top" | Built | |
| Agent line "Everyone in the office sees it." | Built | |
| Counter "0 / 500", red over the limit | Built | |
| "Post" button | Partly | reads "Post to the team" |
| "Write something first." / "Too long. Keep it under 500 letters." | Built | |
| Toast "Posted as owner news · everyone gets a notification", with Undo | Partly | reads "· it stays on top"; no Undo on the toast |
| Filter pills All · Owner news (count) · Wins (count) | Built | |
| Post head: avatar, name, "You" chip, "role · when" | Partly | the role is dropped — the sub-line is the time only |
| "Pinned" chip | Partly | drawn with the pin icon; the design uses bookmark |
| "Owner news" dark chip and the accent left edge on a news post | Built | |
| Win post as a black hero card with the big win line and sub-line | Built | the two lines are split off the post body's first line and the rest |
| Win chip "Win · +300 points" | Partly | reads "Win"; the points are not named |
| 👏 and 🔥 buttons with counts and an on state | Built | |
| Per-post action link in the reactions row ("Open Tasks", "Open Projects") | Not built | a comment count sits in that slot; no post stores a link |
| Row menu (⋯) on your own post, and on any post for an owner | Built | |
| Menu item "Pin or unpin" | Partly | reads "Pin it on top" / "Unpin it" |
| Menu item "Delete the post", confirmed with "Tap again to delete", toast with Undo | Partly | second press reads "Press again to delete"; no Undo |
| Empty state "Nothing here yet · Be the first to post." | Partly | an extra sentence is added: "A won deal lands here on its own." |
| Sidebar "Coming up" + Calendar link, date tiles | Built | |
| Sidebar "Best of Homes · week 46" + Ranking link, top three | Partly | the head reads "Best of Homes"; the week is not named |
| Sidebar "What goes on the wall", word for word | Built | |
| The ranking panel counts owners and admin as agents | Not built | `/api/wall/sidebar`, `role <> 'automation'` |
| The phone head's "13 people" count | Partly | counts `leaderboard.length`, which is `LIMIT 10` and includes owners, so it can never say more than 10 and never says the team |

### 24. best-of-homes.html — Best of Homes

| Item | State | Note |
|---|---|---|
| Title "Best of Homes" | Built | |
| Sub "Week 46 · Mon 9 – Sun 15 Nov · ends Sunday 23:59" | Not built | no desktop sub-line; the phone sub reads "Points over the last 30 days · live" |
| Top tabs "Meet the team" / "Best of Homes" | Built | |
| Period segment "Week 46 · Last week · November" | Not built | there is one window, thirty days, and no way to change it |
| Podium hero titled "Podium · week 46" | Partly | reads "Podium · last 30 days" |
| Hero chip "Live · 4 days left" | Partly | reads "Live" |
| Podium: 2nd, 1st, 3rd, rising blocks, the first one larger | Built | |
| Under each podium name, "212 calls · 6 meetings" | Not built | shows the points again; nothing counts calls or meetings per agent per week |
| "· you" after your own name | Built | |
| Agent card head "You are 2nd" | Built | |
| Agent card chip "+240 points today" | Partly | the chip carries the all-time total, not today's |
| Quote "6 calls or 1 meeting puts you in first place." | Partly | reads "N calls or M booked viewings puts you in first place." |
| Level block: big number, "Level 7 · Closer", bar | Built | |
| Level line "1,740 of 2,000 points · 260 to Level 8 · Top closer" | Partly | the "to Level 8 · <next badge>" tail is gone |
| Trio "12 days streak · 188 calls this week · 5 meetings this week" | Partly | streak, badges earned, thank-yous left |
| Card foot "Start calling · 12 ready" and "Book a meeting" | Partly | "Start calling" (no count) and "Open the team wall" |
| Owner card "Week 46 in numbers": team calls + delta, trio, absent-agent banner | Not built | the owner is shown the agent's own card, headed "Your month" |
| Ranking sub "10 agents · week 46 · calls · meetings · points" | Partly | reads "N people · points over 30 days" |
| Ranking columns # / Agent / Calls / Meetings / Points / bar / vs last week | Partly | only # / Name / Points / bar. Calls, Meetings and "vs last week" are absent, and nothing records a weekly position |
| Your own row highlighted with a "You" chip | Built | |
| An owner's ranking row opens that agent's leads | Not built | rows are not links |
| "Your badges" with "4 of 6" and locked badges greyed | Built | |
| Owner's "Badges this month" (the team's badges) | Not built | the owner gets their own badge grid |
| "How you get points": +15 a call with a result, +10 a new lead, +300 a booked unit, +15 feedback | Partly | eight rules with different wording and values, taken from `server/src/wall/xp.ts`; none of the design's four numbers is shown |
| Owners and admin ranked as agents | Not built | same `/api/wall/sidebar` query |
| The page's two numbers for the same person agree | Not built | the ranking row uses the 30-day sum; the "You are 1st" chip and the level bar use `pointsFor()`, which is all time. Checked as Layla: 418 in the table, 377 in the chip, same screen |

### 25. attendance.html — an agent's own attendance

| Item | State | Note |
|---|---|---|
| Tabs Today / Month / Leave (waiting count) | Built | |
| Hero eyebrow "OFFICE WI-FI FOUND · homes.me-Office" | Partly | reads "Office Wi-Fi found"; the network's name is not shown |
| Hero "Ready to start your day?" | Built | |
| Hero sub naming the shift and warning that a late check-in counts as late | Partly | reads "The shift starts at 09:00. The real time is saved." — no late warning |
| Hero buttons "Check in" + "I'm working outside today" | Built | |
| Check in is refused off the office network | Built | the button is disabled and says why |
| Confetti on check-in | Not built | |
| Hero "In office since 08:55" with the on-time / late eyebrow | Built | |
| Hero facts "worked today · shift ends · office Wi-Fi" | Partly | shows "marked at · shift starts · where" |
| Hero in-office buttons "I'm working outside" + "Check out" (two clicks) | Partly | no check-out anywhere; the card says the first tap is the only one |
| Hero outside state: "Working outside · location shared once at 14:55", "Outside · back by 16:30" | Partly | the headline is "Outside today" and the note is whatever line was typed; no location, no back-by in the headline |
| Hero outside buttons "I'm back in the office" + "Change" | Not built | |
| Hero checked-out state: "Day finished", in / out / worked, "Check in again" | Not built | |
| "This week" head "Week 46 · 24 h 14 min so far" | Partly | shows the week's date range; no hours |
| Week strip of seven days, colour bar per day | Built | |
| Each day's cell shows its check-in time | Partly | shows a word (In / Late / Out); `/api/v2/attendance/me` returns no time per day, only `on_date`, `kind`, `was_late` |
| Selected-day detail under the strip, with its chip | Built | |
| Colour guide, six entries including Absent (red) and "Day off or not yet" | Partly | five; Absent and Day off are missing |
| Tile "On time in November · 6 of 8 days" | Partly | reads "In the office · 38 · of 47 days marked" |
| Tile "Late · 1 · Wed 4 Nov · 8 min" | Partly | the day and the minutes late are not shown |
| Tile "Working outside · 1 · Fri 6 Nov · viewing" | Partly | the day and the reason are not shown |
| Tile "Annual leave left · 14 · 3 days asked" | Not built | reads "Days off taken"; no allowance exists in the database |
| Tiles jump to the Month / Leave tab | Not built | `Tile` renders a plain `div` |
| "Today, step by step" timeline | Built | |
| Timeline row "Shift ends · 18:00 · if you forget, the day closes at 18:00" | Not built | replaced by a "One tap a day" row |
| How check-in works: Shift "09:00 – 18:00, Monday to Friday" | Partly | reads "Starts at 09:00"; no end, no days |
| How check-in works: Late "Check-in after 09:10" | Not built | the grace rule is not shown, although `/api/attendance/settings` holds it |
| How check-in works: Where "Only on the office Wi-Fi “homes.me-Office”" | Partly | the network's name is dropped |
| How check-in works: Not in office / Time rows | Built | |
| Month tab: month segment Sep / Oct / Nov | Built | only the months the 60-day window reaches |
| Month tab: "Month PDF" button | Not built | |
| Month grid, Monday first, state and time per day | Built | time is a word, as in the week strip |
| Totals: On time / Late / Outside / Leave / Absent / Days worked | Partly | the Absent row is "Not marked" |
| Totals foot "Hours in the office: 60 h 12 min" | Not built | no marked time per day to add up |
| Day detail: Check in (+ minutes late) / Check out / Worked / Where / Note | Partly | two rows only, "What" and "Note" |
| Leave card "Annual leave left · 14 of 22 days" + 64% bar | Not built | shows days taken; no allowance, no bar |
| Leave card "Sick days used · 3 · last: Wed 14 Oct" + "A sick note is needed from day 2." | Partly | the last sick day is not named |
| Leave card "Waiting for an answer · 1 · Emir or George answers" | Partly | reads "an owner answers" |
| "Request leave" button | Partly | reads "Ask for days off" |
| Waiting rows: type · dates · working days · "reason" · asked at | Partly | the time it was asked is not shown |
| "Cancel request" with "Tap again to cancel" and an Undo toast | Partly | one press, no undo |
| History table: Type / Days / Working days / Reason / Asked / Answer | Partly | the "Asked" column is missing |
| Panel chips "14 annual days left · 3 sick days used · 1 waiting" | Not built | |
| Leave types Annual / Sick / Personal / Half day / Work from home / Other | Partly | Annual, Sick, Unpaid, Emergency, Other — three of the design's six cannot be stored (`LEAVE_KINDS`, `server/src/v2/leave.ts`) |
| Half day → "Which half · Morning 09:00 – 13:30 / Afternoon 13:30 – 18:00" | Not built | |
| Working-days banner: days off not counted, annual days left after this | Partly | counts calendar days and says only "Days the office is shut are not counted" |
| Overlap check "You already asked for these days." | Not built | |
| A weekend start or end refused ("Saturday is a day off.") | Not built | |
| A past date refused | Built | `min` is today |
| Reason required | Built | |
| Sick note upload, "Needed from day 2. You can add it later." | Not built | |
| "Emir or George answers. You get a notification. Your leads stay with you." | Partly | reads "An owner answers…" |
| "Send the request" + toast with the dates | Built | |
| Outside panel: "Share my location" required, "We read it once, now. We do not follow you." | Not built | nothing stores a location |
| Outside panel: six reasons, the design's own words | Built | |
| Outside panel: "With who", picked from your leads | Partly | free text, no lead list behind it |
| Outside panel: "Where exactly" required | Built | |
| Outside panel: "Back by" 16:30 / 17:30 / 18:00 / Tomorrow, required | Partly | optional; saving is allowed with none chosen |
| Outside panel: "Note · Anything the office should know" | Not built | |
| Outside panel button "Start working outside" | Partly | reads "I'm going outside", and names the missing field before that |

### 26. team-attendance.html — the owner's attendance screen

| Item | State | Note |
|---|---|---|
| Title "Team attendance" | Partly | the desktop top bar says "Attendance" for both roles; only the phone head splits them |
| Tabs Team today / Leave requests (red count) / My attendance, and a "Rules" link | Built | |
| Counter "10 agents today · 8 working now · 2 away" | Partly | the count is right in shape but includes admin — `attendanceMonth` filters `role NOT IN ('automation','owner')` |
| Counters In office / Late / Outside / On leave / Absent, each filtering the table | Built | |
| Arriving with `?show=late` from a dashboard opens that filter | Not built | the dashboards link to `/v2/attendance` with no query, and nothing reads one |
| Today table columns Agent / Status / Check-in / Place · reason / Desk / actions | Partly | four columns; Desk and the actions column are missing |
| Check-in time in its own column | Built | renders `marked_at`; it is the preview's stand-in data that sends `null` |
| "Phone <name>" on an absent or late row | Not built | |
| "Mark as leave", two clicks, with an Undo toast | Not built | no endpoint behind it |
| "See shared location" and the location panel (map, why / with who / where / back by / checked in, "Phone Nelson") | Not built | nothing stores a location |
| Counters recount after a row changes, and fall back to "everyone" when a group empties | Not built | nothing on the screen changes a row |
| 8-day grid, a column per open day and a row per agent, ✓ L O V A with tooltips | Built | |
| Grid head "Last 8 working days" | Partly | reads "The last 8 open days" |
| Per-row summary "1 late · 1 absent", red when it matters | Built | |
| "Month report (Excel)" on the grid card | Not built | |
| Leave tab head "Waiting for your answer" + "The agent is told as soon as you answer" | Built | |
| Request card: avatar, "<name> · Annual leave", "Asked today 14:07", Waiting chip | Partly | the asked line carries the date only, not the time |
| Request card stat "Wed 18 – Fri 20 Nov" over "3 working days" | Built | |
| Request card facts: the reason, and "14 annual days left" | Partly | the reason chip only; there is no allowance to show |
| Amber clash banner ("Cityscape Global expo is 17–19 Nov. Nobody else is away…") | Not built | nothing compares a request against the diary or against other leave |
| Approve / Refuse buttons and a "See the calendar" link | Built | |
| Refuse box: three reasons, "Choose a reason first.", "Refuse the request" / Cancel | Partly | the second reason reads "Busy week", not "Busy week · launch" |
| Answered card "last 30 days" | Partly | reads "most recent first" |
| Answered row's "by you · 2 Nov" line | Partly | shows the decision note if there is one; never who answered or when |
| "Change my answer" on an answered row | Not built | |
| Empty state "No leave request is waiting · New requests show here and in “Needs you now”." | Partly | reads "and in the menu" |
| My attendance: Today card, chip, "09:02", "Checked in · office Wi-Fi “homes.me-Office”" | Partly | the network's name is dropped |
| My attendance: "Check out" (two clicks) | Not built | |
| My attendance: "Owners can call without a check-in." | Built | |
| My attendance: week of seven cards showing "08:58 – 18:20" | Partly | a status chip instead of the hours |
| My attendance: Days in office · Nov / Day outside / Late / Leave days | Built | |
| My attendance: "Month PDF" | Not built | the slot holds "Ask for days off" |

### 27. profile.html — My profile

| Item | State | Note |
|---|---|---|
| Title "My profile" | Built | |
| Inside the settings shell, with the section list down the left | Not built | `/v2/profile` is a standalone page; the settings list is not around it |
| Hero: photo, name, "<title> · homes.me" | Built | |
| Hero chips "Agent · Dubai off-plan · Arabic desk" and "Level 7 · Closer" | Partly | shows "Level · <name>" and "BRN <n>" — no role, no desk |
| "Performance this month · 86%" + "5 vs October" + bar + "Calls, follow-ups on time, meetings and deals against your monthly target." | Not built | the card shows "Badges earned · 40%". Deliberate (no target is stored), and the design's number is absent |
| Owner variant "Team performance this month" with the team's numbers | Not built | the owner is shown their own card |
| Stats Deals / Viewings / Avg reply, each a link | Partly | the third reads "Usual reply" |
| Link "Best of Homes · rank 2 · 1,740 points" | Not built | the row reads "Team wall" |
| Link "Business card" | Built | |
| Link "My attendance", and "Team attendance" for an owner | Partly | an owner sees "My attendance" |
| Tabs Personal info / Security on the page | Not built | the two halves live at `/v2/me` and `/v2/settings/security` |
| Completion bar "Profile 100% complete" + "Missing: …" / "Colleagues and transfers use this." | Partly | at `/v2/me`, and it reads "Add: Phone, Email, Photo" |
| Photo row: "Change photo" and "Remove" (two clicks, undo) | Partly | "Change" only; nothing removes a photo |
| "Full name *", min 3, "Write your full name." | Not built | read-only: "Your name is on your account. Ask an owner to change it." |
| "Title" | Partly | labelled "Job title" |
| "BRN *", 4–6 digits, with the hint | Built | |
| "Phone *", digits only, at least 9 | Partly | labelled "Phone for clients" |
| "WhatsApp" + "WhatsApp is the same number" switch | Built | |
| "Email", read-only, "Your sign-in email. Ask an owner to change it." | Partly | labelled "Work email", and it is a second, editable address |
| Languages: ten chips, multi-select, "Choose at least one language." | Partly | the chips are all there; no required error |
| "Save profile" + "Profile saved" | Partly | saves as you type and reports "Saved" |
| "Not saved yet. Check the red fields." | Not built | |
| Security: Password now / New password / New password again / "Change password" | Built | |
| Password strength meter, three bars, with its changing hint | Partly | one fixed hint, no meter |
| "At least 8 letters or numbers." | Built | |
| "The two passwords are not the same." | Partly | reads "Write the new password again." |
| "The new password must be different." | Not built | |
| Owner two-step: switch, "On · code from your phone app", "Asked on a new device and every 30 days" | Not built | there is no second factor in this build |
| Owner two-step: "New backup codes" and "Move to a new phone" | Not built | |
| Agent two-step banner ("Two-step sign-in is for owners and admin…") | Partly | both roles get "Not switched on for anybody yet" |
| Signed-in devices: a row per device, "This device" chip | Not built | one row for this device, plus a note that the others are not shown |
| "new place" chip on an unusual device | Not built | |
| Per-device "Sign out" with "Tap again to sign out" | Not built | |
| "Sign out all others" (two clicks) | Not built | |
| "Sign out here" | Built | |

### 28. digital-card.html — the business card

| Item | State | Note |
|---|---|---|
| Stepper 1 Design · 2 Details · 3 Download, each step clickable | Built | |
| Step 1 head "Choose a design" with a "Compare" button | Built | |
| Three designs, Signature / Reverse / Light, each a working mini card | Built | |
| Design sub-labels "Black with orange · the homes.me look" / "Orange front · strong at events" / "White · cheapest to print" | Not built | all three reworded, and Signature is orange-front here where the design has it black-front |
| Compare panel "Front and back, side by side", three pairs | Built | |
| Step 2 head "Your details" with "Take from my profile" | Built | |
| Fields Name* / Title / BRN* / Phone* / WhatsApp / Email* / Website | Built | |
| "WhatsApp is the same number" switch disabling the field | Built | |
| "Card size" 85 × 55 mm / 3.5 × 2 in | Built | |
| Address line 1 and 2, 48 characters each | Built | |
| Switches Tagline / WhatsApp QR / Rounded corners / Company name / Show safe area | Built | |
| Live preview beside the steps: "Front" head, Flip, "Click the card to flip it", the size line | Built | |
| Step 3 head "Download" + "Signature · 85 × 55 mm · front and back" | Built | |
| Four downloads: PDF + crop marks "3 mm bleed · CMYK", PNG, JPG, Mockup | Partly | the PDF line drops CMYK and the other three are reworded |
| Mockup pair under the download list | Built | |
| "Print tip: 350 g paper, matt. Ask the print shop for a test card first." | Built | |
| Public card link switch + "Anyone with the link sees your card" | Built | |
| The link shown as "homes.me/card/rocky", with "Copy link" | Partly | shows the whole current origin, e.g. `http://127.0.0.1:5199/card/layla-hassan` |
| "Opened 14 times this month" | Not built | nothing counts an open, and the card says so |
| Back / "Step N of 3" / Next along the bottom | Built | |

### 29. feedback.html — report a problem

| Item | State | Note |
|---|---|---|
| Head "Tell us what to fix or build" | Built | |
| Chip "+15 points for each report" | Not built | nothing awards a point for a report |
| Four types Bug / Issue / New feature / Idea, each with its sub-line | Partly | three: "Something is broken", "Hard to use", "An idea". "New feature" is folded into Idea and no type keeps the design's name |
| "Short title *" with "Write a short title." | Not built | there is no title field; the first line of the text stands in |
| "Where" page picker, 25 named screens | Partly | labelled "Where in the CRM?", and the first option is "The page I came from" |
| The text label changes with the type | Partly | three variants ("What happened?" / "What is awkward?" / "What would help?") against the design's four |
| Text required, at least 10 letters | Partly | the rule is right; the message reads "Write a little more — at least a sentence." |
| "Add a screenshot", up to three, and Ctrl-V paste | Not built | |
| "Record a voice note", which can stand in for the text | Not built | |
| Attachment chips with a remove button | Not built | |
| Urgency Low / Normal / Blocking my work | Partly | two states, "Normal" and "It stops me working" |
| The note under urgency changing with the choice, red when blocking | Built | |
| Footer "Sent as <name> · Chrome on Windows · this page address is added by itself." | Partly | reads "The page you came from is added by itself…"; no name, no browser |
| "Send report" | Built | |
| Thank-you panel replacing the form | Built | |
| "Thank you · ticket #1042" | Partly | no ticket number — a report's id is a uuid |
| "+15 points" chip on the thank-you | Not built | |
| "Write another" | Partly | reads "Send another" |
| Blocking variant "Emir, George and Abdullah got an alert just now." | Not built | |
| "My reports" with "3 reports" | Partly | reads "What you have sent", with no count |
| Report rows: title, New / Planned / Fixed chip, "#1031 · Bug · Lead page · 4 Nov" | Partly | no number and no page; the chip reads "On the list" |
| The owner's answer under a report, with their avatar | Built | |
| "What happens next? New → Planned → Fixed…" card | Not built | |
| Owner shortcut "Open the feedback inbox" | Not built | the owner sees the same page as an agent |

### 30. settings.html — General and Notifications

| Item | State | Note |
|---|---|---|
| Settings shell: "Mine" (General, Notifications, My profile, Phone app), "Office" for owners, "Sign out" at the foot | Built | the build adds a "Home banners" row, which the design reaches from elsewhere |
| General head "General" + "How the CRM looks and sounds on this computer." | Built | |
| Appearance: Light / Dark / Auto cards with previews and sub-lines | Built | |
| The note beside it, "Light theme" / "Auto · this computer is dark now" | Built | |
| "Play sounds" switch and "Test sound" | Built | |
| Sound rows "New lead and VIP lead · Two rising notes" and "Won · unit booked · With confetti" | Built | |
| Volume Quiet / Normal / Loud | Built | |
| Language: English "Used now", العربية "Arabic · comes later" with a "later" chip | Built | |
| Date and time chips "24-hour clock · 14:55", "Dubai time", "Week starts on Monday" | Built | |
| Owner card "Office settings" with the "Owners and admin" lock chip | Built | |
| Eight office shortcuts, each with a live sub-line | Partly | seven; **Desks** is missing from the grid, although it is in the left nav |
| Account row: avatar, "<name> · <title>", "Signed in on this computer · Chrome on Windows · since 08:41" | Partly | shows the name and the email; no title, no device, no time |
| Account row buttons "Security" and "Sign out" | Built | |
| Notifications head "My notifications" + "Choose what reaches you. Each alert opens the exact page when you tap it." | Built | |
| Top card "Notifications are on" + "Phone app and this computer · last test today 09:02" + "Send a test" | Partly | the "last test" time only appears after you press the button in this session |
| The test showing a sample notification on the page | Not built | a toast instead of the design's `ntf-pop` card |
| "Where alerts go": Phone app row, "On · iPhone" chip, "How to install" | Partly | no device chip |
| "This computer" row with its switch | Built | |
| Agent groups MY LEADS (6) / MY DAY (5) / TEAM AND OFFICE (3), each with "Turn all on" | Built | wording matches, bar two sub-lines: "Transfer request for me" drops "· answer by 18:00" and "Check-in reminder" reads "At the start of the shift" |
| "always on" chip on the VIP switch, which refuses to turn off | Built | |
| Owner groups LEADS (6) / TEAM (5) / SYSTEM (4) | Built | |
| An agent never sees the owner's groups, and an owner never sees the agent's | Partly | the agent half is right; an owner is shown all six groups, because `forMe()` in `settings/Notifications.tsx:84` returns true for every agent group |
| Quiet hours Off / 22:00 – 08:00 / 20:00 – 09:00, with the line that changes | Built | |
| VIP exception switch and its note | Built | |
| Closing line "The owner chooses the office rules in Automations…" | Built | |

### 31. import.html — bulk import

| Item | State | Note |
|---|---|---|
| Stepper, six steps: Upload · Columns · Check · Give · Confirm · Done | Built | |
| An agent cannot open the page | Built | fixed on this branch — `/v2/import` is wrapped in `OwnerOnly` in `App.tsx:165` and an agent now gets "Only for owners and admin". **The bundle on 127.0.0.1:5195 is older and still opens the whole wizard for an agent**, which is what the owner saw |
| Step 1 head "Upload your file" + "One row is one lead. The first row holds the column names." | Built | |
| Drop zone, drag or click, `.xlsx .xls .csv` | Built | |
| Chip ".xlsx · .xls · .csv · up to 5,000 rows" | Partly | the row limit is not named |
| File card: name, "240 rows · 7 columns · 48 KB", "Remove" with "Tap again to remove" | Partly | name and size only — no row or column count until step 2 |
| Pressing Next with no file shows "Choose a file first." | Partly | Next is disabled instead, which says nothing |
| "Use the sample file · Nov_batch_C.xlsx" | Not built | |
| "Download the template" | Not built | |
| "A good file" rule: a name and a phone column | Built | |
| "A good file" rule: country codes, "+971 50 555 0101" | Built | |
| "A good file" rule: "Not more than 5,000 rows. Split bigger files in two." | Not built | replaced by a rule about the header row |
| "A good file" rule: every number checked, never added twice without your OK | Built | |
| Foot "Last import: Nov_batch_B.xlsx · 3 Nov · 186 leads" | Not built | |
| Step 2 head "Match the columns" + "We guessed for you." | Built | |
| "Name found" / "Phone found" needs chips | Built | |
| Table: Column in your file / First rows / Goes to | Built | |
| Field list with "Do not import", a field usable once | Built | |
| "Name and Phone are needed. A field can be used once. Columns set to “Do not import” are left out." | Built | |
| Step 3 head "We checked 240 rows" + "Every phone number was compared with the 863 leads in the CRM." | Built | |
| The sum strip 240 = 208 + 18 + 14 | Built | |
| The green / amber / red proportion bar | Built | |
| Duplicates card, "already in the CRM" chip | Built | |
| Duplicate choice Skip them / Fill empty details only / Import them again as new, with the hint that follows it | Built | |
| First three duplicates named with who holds them, then "and 15 more" | Built | |
| Duplicates "Download the list" | Not built | |
| Bad rows card, "not imported" chip, three examples with their reason | Built | |
| "Download the 14 bad rows" on step 3 | Not built | there is one download, on step 6 |
| Step 4 head "Who gets the 208 leads?" | Built | |
| Step 4 sub "Leads that nobody calls in 24 working hours go back to Incoming." | Partly | reads "An imported lead has no countdown. It is a list to work through, not a race." — a deliberate change of the rule, recorded in the build, not in the design |
| "Project" picker beside the head | Built | |
| Three ways: Agents I choose / A desk / Incoming, each with its sub-line | Built | |
| "All 6 in the office" and "None" | Partly | reads "All 3"; the office is not mentioned |
| Agent grid with each agent's open-lead count | Built | |
| Desk chips "Dubai off-plan · 6 agents", "Arabic desk · 2 of 3 working" | Built | |
| Incoming banner + "Open Incoming" link | Built | |
| "Choose at least one agent." | Built | |
| Amber warning when a chosen agent is away or over their maximum | Not built | |
| Step 5 head "Check and import" + "Nothing is in the CRM yet. Read once, then import." | Built | |
| Summary rows File / New leads / Duplicates / Bad rows / Project | Built | |
| Summary row Source "Import (Excel)" | Partly | the row is drawn with nothing in it |
| Summary row "Goes back · to Incoming if not called in 24 working hours" | Partly | replaced by "Countdown · None. An imported lead is not a five-minute lead." |
| "Goes to 6 agents" with a line per agent | Built | |
| "Each agent gets one notification, not one per lead." | Built | |
| Step 6 "208 leads are in the CRM" + "Nov_batch_C.xlsx · 18 duplicates skipped · 14 bad rows left out" | Built | |
| "Import another file" and "Open the leads" | Built | |
| Per-agent result table: Agent / Got / Open leads now / Told | Not built | a three-number summary stands in its place |
| Undo card: 24 hours, the deadline named, "Leads that an agent already called stay in the CRM", two clicks | Built | |
| Bad-rows banner with its own Download | Partly | one button, "Download the rows that did not import" |

### 32. dashboard.html — the full dashboard

| Item | State | Note |
|---|---|---|
| Period segment Today / Week / Month / Year | Built | and it really does move calls, meetings and units only |
| "Live · 14:55" beside it | Built | |
| Hero tag "Homes AI · Morning brief" | Partly | reads whatever the insight endpoint calls itself, falling back to "Counted from your own data" |
| Hero chip "Wed 11 Nov · 08:30" | Partly | shows now, not when the brief was written |
| Brief sentence naming yesterday's numbers and how many things need a decision | Built | |
| Three brief rows, each an icon, a link and its own button | Built | |
| Each row's sub-line explains the row ("Back Thursday · 1 follow-up is already overdue") | Not built | the sub-line repeats the button's own word, so the card reads "Give again / Give again" |
| The design's three rows (an agent on leave with nobody on their leads, an agent over their desk maximum, untouched leads) | Partly | the rows are the six things waiting on an owner instead; "86 leads are not touched yet" appears, the other two do not |
| Totals card head + "Calls, meetings and units: today" | Built | |
| Totals "Download" button | Not built | |
| All leads / "50 lost" / Open / Untouched / New today + delta, each a link | Partly | "Untouched" reads "Never contacted" |
| Four tiles Call clicks / Meetings booked / Units booked / Touched in 2 h | Partly | read "Calls made", "Meetings booked", "Units booked", "Answered in 2 h" |
| "First click 6 min" under the fourth tile | Partly | reads "First answer 6 min" |
| Units tile's sub "Talha · AED 2.9M" | Built | |
| "Touched in 2 h" tooltip explaining the number | Not built | |
| By-stage strip, seven stages with counts and percentages, Lost kept apart | Built | |
| "Click a stage to open its list" | Partly | reads "Open a stage to see its leads" |
| "Open pipeline" link | Built | |
| New leads per day: 14 bars, weekends marked, today marked | Built | |
| Its delta "9% vs the 14 days before" | Partly | a count, not a percentage: "21 vs the 14 days before" |
| By project: a bar per project with won counts, "Manage" link, and the foot note | Partly | a project with no deal shows "—" where the design writes "launching" |
| Sources: a bar per source, each a link, "863 leads" | Built | |
| Team today card + "Attendance" link | Built | |
| Attendance proportion bar, five colours | Built | |
| Legend In office / Late / Outside / Leave / Absent, each a link | Partly | the last reads "Not marked" |
| Legend and bar carry `?show=office|late|outside|leave|absent` | Not built | all five go to `/v2/attendance` with no filter |
| Team table columns Agent / Status / Calls today · 7 days / Meetings / Units / Open / Overdue | Partly | "Status" is headed "Where" |
| The status cell as a coloured attendance chip | Partly | plain text |
| Seven-day sparkline in the calls cell | Built | |
| "Open" cell showing the desk maximum and turning red over it | Not built | a plain number, no maximum |
| Overdue cell red and linking to that agent's overdue list | Partly | red, but it is not a link |
| Head "Calls today · 7 days" following the period | Built | |
| Foot "Most calls first. Calls, meetings and units follow the period switch at the top." + "Best of Homes" link | Built | |
| Going cold: count, "leads with no contact for 7 days. Move them or they are lost.", "All 12" link | Built | |
| The links go to the going-cold list | Partly | they go to `/v2/leads?tab=overdue`, which is a different list |
| Three cold rows with a "Move N" and a "View" | Built | |
| The over-maximum row offers View only, not Move | Not built | every row offers Move |
| "Move leads" dialog: "Move 31 leads from Sultan", "Notes and history go with them. VIP leads stay where they are." | Not built | no dialog; the row's own button asks twice |
| Dialog's three choices: share equally between the agents in the office / one agent (with a picker) / Incoming | Not built | it always goes to Incoming, and the card says so |
| Dialog's "People on leave or absent cannot be chosen." | Not built | |
| Two-click confirm on the move, and a toast with Undo | Partly | two clicks, no undo |
| Shortcuts Team live / Messaging report / Team activity | Partly | the third reads "Who did what" |

#### 32b. `/v2` — the owner's home, which the owner named

*`owner-home.html` is page 4 of the spec and belongs to another slice. Every
item the owner named is checked here because they named it.*

| Item | State | Note |
|---|---|---|
| Black "Needs you now" hero | Partly | the block is there with its six kinds of row, but as an ordinary white card (`d-card d-c-7`), not the design's hero |
| An action button on every row of it | Built | |
| The Homes AI line above it | Not built | `Home.tsx` has the `d-ai-line` component and gives it to the agent's My Day only; the owner's home has no AI line |
| "Calls today" with a bar per hour and a "now" marker | Not built | a flat tile: "Calls today · 31 · 18 WhatsApp · 2 Telegram". The bars and the marker exist on Team live, not here |
| "First contact: 6 min median" and "Best hour 10:00" under those bars | Not built | |
| A pipeline strip | Not built | the `d-pstrip` is built, and given to the agent's "My leads by stage" only |
| Today / Week / Month / Year switch | Not built | |
| "Team right now" with an attendance bar | Partly | the counts are there as four small links; no proportion bar, no "Leave" entry, no `?show=` links |
| Team table with a 7-day trend line per agent | Not built | columns are Who / Today / Open leads / Calls today / Last seen |
| Team table with an open-leads load bar against the desk maximum | Not built | |
| "In" (check-in time) and "Overdue" columns | Not built | |
| The full watch list: Follow-ups overdue, No next step, Transfers today, WhatsApp taps, Going cold | Partly | the first two are tiles; Transfers today, WhatsApp taps and Going cold are missing |

### 33. team-live.html — what the team is doing now

| Item | State | Note |
|---|---|---|
| Segment Activity / Live / Messaging | Built | |
| "Live · 14:55" | Built | |
| Homes AI line with its tag and one sentence | Built | |
| Its button "Move leads →" | Partly | reads "The full report" and goes to the dashboard |
| Hero "Right now · 8 online" with the big number | Built | |
| Hero sub "Of 10 agents · 2 are away" | Partly | reads "Of 4 signed in · 1 idle" — it counts sessions, not the team, and it counts the owner too (`/api/activity/team` has no role filter) |
| Hero chip "Live" | Built | |
| "Right now" list: avatar, name, what they are doing, how long ago, freshest first | Partly | the "doing" line is generic ("Going through leads", "In the CRM") where the design names the lead ("On a call · Aisha Noor") |
| Clicks today card with a Calls / WhatsApp segment and a "Messaging report" link | Built | |
| Trio Call clicks (+ delta) / WhatsApp clicks / Telegram clicks | Built | |
| Bars by hour, best hour marked, future hours empty, a "now" marker | Built | |
| Foot "A click is counted when an agent presses Call, WhatsApp or Telegram on a lead." + "Best hour 10:00" | Built | |
| "Today by agent" table: Agent / Doing now / Calls / WhatsApp / Telegram / By hour / Last click | Built | |
| The sparkline in "By hour" | Built | `HourSpark`, drawn the way the design's `app.js` draws it |
| "Rows flash when a new click comes in" | Partly | reads "Counted again every 30 seconds"; the row does not flash |
| Attendance card with its bar, legend and "Open" link | Partly | the legend's last entry reads "Not marked", not "Absent" |
| Attendance bar and legend carrying `?show=…` | Not built | |
| The two away rows under it, with "See" and "His leads" | Partly | built, but both rows get the same "Their leads" button; nothing offers "See" |
| "Calls marked “not checked in”" with the count and the sentence naming who and when | Built | |

### 34. team-activity.html — who used the CRM

| Item | State | Note |
|---|---|---|
| Segment Activity / Live / Messaging | Built | |
| Tabs Time in CRM / Sign-ins (count) / Unusual (red count) | Built | |
| "Average time in the CRM today · 4 h 38 · per working agent · shift is 5 h 55 min old" | Partly | reads "per person who has worked today · 4 of 5", and the owner is one of those people |
| "Most active · Talha · 5 h 31 min" | Built | |
| "Least active (working) · Shan · 3 h 02 min" | Built | |
| "Not seen today · 2 · Bassam absent · Sultan on leave" | Built | |
| Time table columns Person / Active today / First seen / Last seen / Device / 7 days / Leads opened | Partly | five columns; the 7-day sparkline and "Leads opened" are missing, and nothing records either |
| The hours bar in the "Active today" cell, amber for an agent well under the average | Built | |
| Foot "Time counts only when the CRM is open and used. 5 minutes without a click stops the clock." | Partly | reads "More than two minutes without the page checking in stops the clock" — a different number, matching what the build measures |
| Sign-ins: search box "Search a person or a place" | Built | |
| Sign-ins: chips All / Signed in now / New device | Built | |
| Sign-ins: result count "11 sign-ins today" | Partly | reads "5 sign-ins" — no "today", and the list is the last 200, not today's |
| Sign-ins table Person / Device / Place / Signed in / State / action | Built | |
| Device cell with a laptop or phone icon and a "New device" chip | Built | |
| Place in amber for a new place | Built | |
| State "Signed in now" pip, or "Signed out by you · 14:55" | Partly | shows "Signed out 15:18" from the record; it never says who signed them out |
| "Sign out" with "Tap again to sign out", and "This is you" on your own row | Partly | "This is you" is built; the sign-out opens the review dialog rather than confirming twice in place |
| Unusual: a card per finding, with a heading, a one-line explanation and a state chip | Built | |
| The design's two kinds: "New sign-in" and "4 wrong passwords" | Partly | new device and new country are built; failed passwords are not flagged, although `audit_log` records them |
| Four facts per card, the new ones marked | Built | |
| "Review" and "Phone <name>" buttons | Built | |
| Review dialog "Was this Shan?" with the device, place and time under it | Built | |
| Dialog banner "Ask the agent first if you are not sure…" | Built | |
| "It was them", which clears the finding | Built | |
| "Sign out everywhere and reset the password", with "Tap again · sign out everywhere" | Partly | reads "Sign out everywhere" and no password is reset; the build adds a required "Why", which the design does not ask for |
| "Decide later" | Built | |
| The count on the Unusual tab falling as findings are answered | Built | |
| Owners and admin listed among the agents | Built | correct here — the design's own table lists Emir Dulovic and Abdullah Mahi |

---

## Totals, page by page

| Page | Items | Built | Partly | Not built |
|---|---|---|---|---|
| Every page (the three shared items above) | 3 | 1 | 0 | 2 |
| 23. team-wall | 25 | 12 | 11 | 2 |
| 24. best-of-homes | 26 | 8 | 10 | 8 |
| 25. attendance (agent) | 60 | 16 | 27 | 17 |
| 26. team-attendance (owner) | 32 | 10 | 12 | 10 |
| 27. profile | 35 | 8 | 13 | 14 |
| 28. digital-card | 20 | 16 | 2 | 2 |
| 29. feedback | 24 | 5 | 10 | 9 |
| 30. settings | 25 | 19 | 5 | 1 |
| 31. import | 49 | 33 | 8 | 8 |
| 32. dashboard | 41 | 17 | 16 | 8 |
| 32b. /v2 owner home (named by the owner; page 4) | 12 | 1 | 3 | 8 |
| 33. team-live | 19 | 12 | 6 | 1 |
| 34. team-activity | 28 | 20 | 8 | 0 |

TOTAL: 399 items — 178 Built, 131 Partly, 90 Not built.
