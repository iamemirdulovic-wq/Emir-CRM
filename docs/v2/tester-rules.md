# Tester rules — what four brokers found, and what we must build because of it

Source: the four reports in `design/web/test-reports/` — **Rocky Khan** (agent:
my-day, my-leads, lead, calling, add-lead, incoming, pipeline, transfers),
**Yuliia** (agent, the wider set: calendar, tasks, attendance, projects, team,
best-of-homes, notifications, profile, digital card, feedback, search, Homes AI,
install guide), **Emir** (owner: login, owner-home, dashboard, all-leads,
import, team-attendance/live/activity, messaging report, feedback inbox) and
**Abdullah** (office admin: every settings page, manage-projects, home-banners,
sales-offers, and the shell — app.js / ui.css, scripted across 49 pages).

They were testing the clickable design prototype, not the v1 server. Most items
below are marked FIXED in the prototype; that is exactly why they belong here —
the v2 build must not re-introduce them.

**110 distinct findings.** Lines that bundle several instances of one cause say
so. Tester names in brackets.

---

## 1. What broke for them

### Leads and navigation — the link did not carry the record

1. Every link to a lead opened the same person, **Marco Bellini** — from my-day, my-leads, pipeline cards, calling, Add lead, calendar, tasks, project, search and notifications. Rocky filed it as the only Blocker: "a broker expects the lead he clicked". [Rocky, Yuliia, Emir]
2. Every project result in search opened **The Archive**, whichever project was clicked. [Yuliia]
3. Dashboard numbers opened the whole 863-lead list instead of the set behind the number — "27 New leads", "809 Open", "Bassam's 44 leads". [Emir]
4. Attendance numbers ("1 Late", "1 Absent") opened attendance **unfiltered**. [Emir]
5. Overdue lead counts linked to the owner's *own* follow-ups tab instead of the 9 overdue leads. [Emir]
6. Install-guide rows opened something other than what their own text said — "How did it go?" opened the plain calendar, "VIP lead from Emir" opened Marco's lead page. [Yuliia]
7. Hash navigation did nothing (going to `#hot` on my-leads), and row-menu and side-panel links opened the wrong lead. [Rocky]
8. Bell items pointed at a page rather than the exact tab or dialog they named. [Abdullah, Yuliia]

### Calling — the thing an agent does all day

9. **Call was a dead `tel:` link** on follow-ups and on the project page: "on a computer nothing visible happens, no check-in question, nothing logged". [Yuliia, twice]
10. A lead with no phone (Tom Becker) still opened a Call dialog with an **empty number**. [Rocky]
11. "Start calling" was usable when not checked in, though the spec locks it behind check-in. [Rocky]
12. "No answer" + "also open WhatsApp with *I tried to call you*" opened the **general hello text** instead. [Rocky]
13. "No answer" said the attempt was "counted as a call" when only WhatsApp had been opened. [Rocky]
14. The post-call "What happened?" dialog offered **message** answers ("Sent…", "Didn't send") after a phone call. [Rocky]
15. Undo on an older toast wiped the result of whichever lead was **on screen**, not the lead named in the toast. [Rocky]
16. Accepting a VIP lead and calling it changed nothing on the card — still "call now", still "back to Incoming". [Rocky]
17. "Interested · Book a meeting" did not open the meeting form at all. [Rocky, left open]

### Memory — the CRM forgot what you just did

18. "The CRM forgot what I did when I changed page" — calls clicked, WhatsApp opened and logged results all vanished on the next screen. [Rocky]
19. The top-bar pill said "In office · 08:55" after a check-in at **14:55**, and the countdown stayed blank until a redraw. [Rocky, Yuliia, Abdullah]
20. The "Auto" theme was known only to the Settings page and forgotten elsewhere; the dark switch in the profile menu did not end Auto. [Abdullah]
21. "Mark all read" on the bell came back **unread** on the next page. [Abdullah]
22. Sidebar badges and the bell never moved when a page acted on their contents (Incoming 3, Attendance 2, bell 5). [Emir, Abdullah, Yuliia]
23. Badge and page disagreed outright: agent badge "Incoming 3" vs page "2 free leads"; owner bell 5 vs 6 "Needs you now" items; tasks badge "Follow-ups 9" vs page "Overdue 1". [Abdullah, Emir]
24. Personal settings and quiet hours reset on reload (prototype limit, left open). [Abdullah]

### Numbers — the single largest class of complaint

25. Clicking a number landed on a list that reported a **different** number: click "New 456", get "6 of 863", because only the drawn rows were counted. [Emir]
26. owner-home and dashboard gave "two different truths" for the same period — calls 612 vs 1,306, meetings 14 vs 23, units 1 vs 3. [Emir]
27. Header totals disagreed with the per-agent table in the messaging report (612 / 2,480 vs 660 / 2,508). [Emir]
28. Summary cards did not follow the table they summarised: a cancelled invite still read "14 people · 1 invite waiting"; role changes and a deactivation never moved "2 owners · 1 admin · 10 agents". [Abdullah]
29. Deleting a desk left "10 agents on a desk · Rocky sits on 2". [Abdullah]
30. Clearing items on owner-home left the rest of the page saying "3 wait in Incoming", "1 Absent", "1 waits for your approval". [Emir]
31. Filter, then act: team-attendance "Absent" → Mark as leave emptied the table while the counters stayed at 1 absent / 1 leave. [Emir]
32. Undoing an import moved the headline to "3 leads" but left +38 on every table row. [Emir]
33. One count rendered three ways on one screen — 20 calls in the call list, 18 in two cards. [Rocky]
34. Follow-up counts did not follow the list: "0 Overdue" still red, tile still "1 overdue"; a finished follow-up still listed as overdue. [Rocky, Yuliia]
35. The free-lead count included a VIP lead nobody was allowed to take ("3 free leads"); refusing a VIP left "To call today 12". [Rocky]
36. Project pages showed the **Archive's** number: "Your leads here" counted up to 24 while the line under it said 17% of 52 and the table held 2 rows. [Yuliia]
37. Leaderboard arithmetic did not close: "10,500 points given" against a ranking summing to 10,200; "vs last week" arrows contradicted the two lists; switching period left "You are 2nd" and the chip "Live · 4 days left". [Yuliia]
38. The same fact differed by screen — reply time 31 vs 21 min for seven agents; an agent's phone different on Profile, business card and Team; a counter flashing "5 new" then 4; ticket #1043 vs the #1042 everything else referred to; "3 screenshots is the most" with 2 attached; two leads sharing one "own" brochure code "-4821". [Yuliia]
39. Sample data contradicted itself across pages — Aisha Noor Won with Rocky but Meeting with Talha, Elena both Rocky's Offer and Yuliia's VIP, Lina "with Shan" and free in Incoming. [Rocky]
40. The data set never reconciles: Won = 4 all time against 27 units booked this month and 190 this year; open leads per agent sum to 234 against 809 open; 259 of 863 by project. Emir logged it as needing "a data decision from the leader". [Emir]
41. Totals ignored rows that moved: team-live's Telegram total never moved while the agent rows did; dashboard "Going cold" did not drop after 31 leads were moved. [Emir]

### Calendar, tasks and follow-ups

42. A meeting result that set a next step produced **only a toast** — "nothing appeared in the calendar, so I was not sure the next step was saved". [Yuliia]
43. "Booked a meeting" said "it is in your Calendar" and nothing appeared anywhere. [Yuliia]
44. Ticking an overdue follow-up marked it Done with no question, and the two lists then disagreed about Sara Nunes. [Yuliia]
45. "New plan" opened **already clashing** — the default 15:00 hit a 15:20 VIP call, so the amber "This time is taken" and "Save anyway" were on screen before any choice was made. [Yuliia]
46. An agent could not change or delete a **Team** plan he had made himself — only "Hide for me". [Yuliia]
47. A next step could be saved with no time. [Yuliia]
48. A follow-up picked for 14 Nov displayed as "Today 16:00". [Rocky]
49. "Coming up" was ordered by when items were added, not by time; "Next plan" still showed a VIP call that was done; undo of a saved result did not return the row to the waiting list. [Rocky, left open]
50. Two plans side by side in week view showed only "15:20 Call" with no way to read the rest. [Yuliia]

### Attendance

51. Checking in at 14:55 reported "Checked in · **on time** · In office since 08:55 · 6 h 00 min worked" in the hero, the log, the week strip and the pill. [Yuliia]
52. The same leave days could be requested **twice**, and "annual days left" ignored days already asked for. [Yuliia]
53. A new leave request did not stripe Month or Week, cancelling cleared the wrong dates, and the tile "3 days asked" never moved. [Yuliia]
54. After checking out, the day's detail still said "Check out: Not yet". [Yuliia]
55. "Late after 08:30" against a 09:00 start: no error while typing, and "Save rules" then "did nothing at all, no message". [Abdullah]
56. The Ends-before-Starts error appeared under the wrong field — under "Late after" instead of "Ends". [Abdullah]
57. Native time fields showed "09:00 AM / 05:30 PM" on an English-US computer; "the CRM is 24-hour everywhere". [Abdullah]

### Roles and privacy

58. **Opening a page changed your role.** An agent who opened an owner page "became owner for the whole site"; an owner who opened attendance.html became an agent. [Abdullah, Emir, Yuliia]
59. An agent could browse a colleague's client list by filtering search by project — "Fatima Al Zaabi · This lead is with Yuliia". [Yuliia]
60. Taking **Owner** away from a user happened on one click with no question — "taking Owner away is as risky as giving it". [Abdullah]
61. Agent-only copy showed to the owner: "Your agent: Emir", hint "Only your open leads". [Abdullah]

### Risky actions, confirmation and undo

62. One click on "Hidden" hid a project with **115 leads** from every agent. [Abdullah]
63. Declining a colleague's transfer was one click — no confirm, no undo. [Rocky]
64. Refusing leave from owner-home asked for **no reason**, though team-attendance asks for one. [Emir]
65. A Won lead could still be marked Lost, and undoing Lost left "No next step". [Rocky]
66. "One open request per lead" was not enforced — Omar Khalil could be sent to two people. [Rocky]
67. Undo restored the row but not its guards: after undoing a deactivation, the role select no longer asked twice for Owner. [Abdullah]
68. Bulk give-outs were silent and irreversible-ish: the Give dialog handed all 3 waiting leads to one agent "with no word about it"; VIP timer choice stuck to the next lead; a "15 min" VIP showed a 30:00 clock; every re-draw restarted the clocks; "Give to another agent" had no Undo. [Emir, Rocky]

### Search

69. **Phone search missed the formats people actually type** — 0505550101, 00971505550101, 050.555.0101 all gave "Nothing found · It is a new number", so "I would add a duplicate". [Abdullah, Emir, Yuliia]
70. A project name opened a lead instead of the project ("archive" + Enter → Khalid), and screens, settings and actions were not findable at all: "banner", "manage projects", "wifi", "inbox", "templates", "leave", "sign out". [Abdullah]
71. A colleague's name gave "Nothing found · Add as a new lead". [Abdullah, Yuliia]
72. The top-bar palette (Ctrl K) still failed on phone formats while its own footer promised "Any phone format works". [Yuliia, logged unfixed]

### Bulk work, lists and import

73. "Select all" selected only the **drawn** rows — 5 of the 12 the job needed — and after the move the rows stayed under the filter they had left while the counts did not follow. [Emir]
74. Only 46 rows were ever drawn and "Next" was a toast: the rest of the list was unreachable. [Emir]
75. Import defaulted every lead to "The Archive for all" although the file had a project column. [Emir]
76. Assignment ignored who was actually working — "Arabic desk 3 agents" with one on leave — and showed the wrong desk for an agent. [Emir]
77. No warning when the only transfer target was over their desk maximum (Shan 57 / 50). [Rocky]

### Forms

78. **One error per click**: name empty, BRN "12", phone "12345" — only the BRN turned red, so each Save revealed the next problem. [Yuliia]
79. Reopened forms kept the last answer or contradicted their own hint — invite role stuck on Admin with Agent hint text; a new offer reset the project but kept "Valia starts from AED 1.4M"; feedback kept urgency "Blocking my work" for the next small idea; Add lead kept the last country code. [Abdullah, Rocky]
80. A file box kept the previous file, so choosing the same brochure again "saved" nothing — toast said saved, the row still said "Upload". [Abdullah]
81. Nonsense passed validation: starting price "cheap" accepted; a name containing `< >` rendered as code; an empty Area printed "Nakheel · –". [Abdullah]
82. Adding a chip added it **twice** and threw a JS error; removing a chip had no undo. [Rocky]
83. Error banners never cleared — two "Fix the red fields first" messages stayed for ever and covered the Back button. [Yuliia]
84. An empty result was a blank white table with a small "Nobody found" off to the side and nothing to click. [Abdullah]
85. A lead that had been saved could still be edited in the form behind it. [Rocky]

### Layout and truncation

86. Text was cut exactly where the meaning is — notification deadlines "answer by 18…", "…goes back to In…", link "homes.me/p/archi…" — while the row had free space held by a hidden "Mark read" button. [Yuliia]
87. Pipeline cards cut the name, the budget and the next step ("Khalid Al Ma…", "AE…"); my-leads cut the next step and hid Call behind hover. [Rocky]
88. Project facts cut at the card edge ("Townhouse 4BR · Villa 5BR · Vil"); the my-day project card cut to "24 …". [Yuliia, Rocky]
89. At **1280 px** wide tables were cut on the right with no scroll on five pages (manage-projects, all-leads, my-leads, sales-offers, team-attendance), and the top bar was wider than the window on owner-home and team-activity. [Abdullah]
90. Chips and blocks clipped: the absent-panel status chip, the 3rd-place podium block in the dark card, install-guide sample alerts, answered-leave text, "Going cold" rows. [Emir, Yuliia]
91. The business card's "Show safe area" guide cut through the name, the company name and the QR code, "as if the card was wrong". [Yuliia]

### Dark theme and toasts

92. Dark theme used **#55535A on black — contrast 2.4–2.6** for sidebar group labels, the Later row, settings labels, calendar grey days and placeholder text; toasts were the same colour as the cards; white text sat on the green button. [Abdullah, Yuliia]
93. Toasts piled **three high** over the buttons, bottom-left. [Yuliia, Rocky]
94. In dark theme the chosen day in the week strip looked like every other day. [Yuliia]

### Collapsed sidebar and small windows

95. Collapsed, the rail was icons with **no label on hover** — the CSS tooltip was clipped by the scrolling list. [Abdullah]
96. Collapsed, and in every window under 1200 px, Inbox / Email / Templates were **not there at all**. [Abdullah]
97. Under about 860 px high the menu scrolled with no hint and the active item could sit off-screen. [Abdullah]

### Wording and labels

98. Help text did not follow the choice — picking "Imported lead 4 hours" still explained "goes back tomorrow 09:00". [Abdullah]
99. The assistant was called "AI" in headings; the name is **Homes AI** everywhere. [Abdullah]
100. Toasts promised what was not true — setting "Selling now" said agents "can send the brochure" for a project with no brochure. [Abdullah]
101. Labels contradicted the chosen period — Year selected but "104 WhatsApp · 28 Telegram" and the hourly bars were today's; a column headed "Calls · 7 days" showed today's number. [Emir]
102. Dates and plurals wrong — "Shan 14 Nov · 1 working day" for a Saturday; "1 sign-ins today". [Emir]
103. Drafts and panel copy read wrong — "I confirm our show flat on…"; a new-desk panel saying "Also on Dubai off-plan" for someone not on that desk yet. [Rocky, Abdullah]

### Homes AI

104. A saved question, "What is the payment plan of Valia?", returned a **WhatsApp draft for Marco about The Archive** — any question containing the word "payment" did this; other saved questions answered "This is a demo…". [Yuliia]
105. When it did not know, it said "Try one from the list under the chat" — but the list was hidden after the first question. [Yuliia]
106. "When is my next meeting?" was not understood. [Yuliia]

### Missing pieces and prototype limits

107. owner-home's "Needs you now" was missing the spec's 6th item, the blocking bug that stops an agent. [Emir]
108. The login page had **no "Forgot password?"** at all. [Emir]
109. Native date boxes follow the computer's region — "11/11/2026 (month first)" on an English-US machine, "Dubai reads day first"; lead.html still had a datetime-local that can show AM/PM. Left open: "the real build should use its own date picker". [Abdullah]
110. The owner's pipeline agent filter showed only 1–2 sample cards per colleague, so the screen could not be judged. [Rocky]

---

## 2. Rules to build by

Each rule is phrased so it can be checked — by a test, a lint, or one minute of
clicking. The finding numbers it answers are in brackets.

### Identity and navigation

- **R1.** Every link to a record carries that record's id, and the target page reads it. No screen has a hard-coded "demo" record. A link with no id is a build error, not a fallback. [1, 2, 7]
- **R2.** **Every number on a dashboard opens the list behind it**, pre-filtered to exactly that set, and the list's own header then shows the same number. [3, 25]
- **R3.** A link's target matches its own words: "1 Late" opens attendance filtered to late, "How did the meeting go?" opens the result dialog, not the page that contains it. Deep links name the tab, the dialog and the anchor. [4, 5, 6, 8]
- **R4.** Changing a filter, a tab or a hash re-renders the list; no in-page navigation is a no-op. [7]

### Calling and messaging

- **R5.** Call, WhatsApp and Telegram are **disabled when the contact has no number**, with a reason on hover, and never open an empty dialog. [10]
- **R6.** Every Call goes through one shared call flow — number, QR for desktop, log the attempt, ask for the outcome — on every screen that offers a call. A bare `tel:` link anywhere is a bug. [9, 16]
- **R7.** An attempt is logged as what actually happened: opening WhatsApp is not "counted as a call". [13]
- **R8.** The outcome dialog offers the answers for the channel used — call answers after a call, message answers after a message. [14]
- **R9.** Every prepared message matches the action that prepared it (a "no answer" follow-up says *I tried to call you*; a meeting confirmation reads as a visit to the show flat) and is editable before sending. [12, 103]
- **R10.** An action that promises a next screen opens it: "Interested · Book a meeting" opens the meeting form. [17]
- **R11.** Undo belongs to the item that raised it, not to whatever is on screen when it is clicked. [15]

### State and memory

- **R12.** Anything a user did survives a page change: last contact per lead, the call result, check-in state and time, theme, read-state of notifications. The server is the source, not the page. [18, 19, 20, 21, 24]
- **R13.** **Badges, bells and counters are recomputed from the same query as the page that changed them**, and update when a page acts — no page may be allowed to leave its own badge stale. [22, 23]
- **R14.** Time shown is the time that happened. A check-in at 14:55 reads 14:55, "late", 0 h worked, in every place it appears. [19, 51]

### Numbers, counts and totals

- **R15.** **One fact, one query.** A number that appears on two screens comes from one shared function; a mismatch between two screens is a failing test, not a styling choice. [26, 27, 38]
- **R16.** Totals are computed over the whole set, never over the rows that happen to be rendered. [25, 73]
- **R17.** Every summary card, chip, legend and tile re-reads after any change to what it summarises — add, edit, delete, deactivate, undo, filter-then-act. [28, 29, 30, 31, 32, 33, 34, 41]
- **R18.** A count excludes what the user cannot act on, and says so: "2 free leads to take · 1 VIP lead waits for an owner". [35]
- **R19.** A per-record page shows that record's numbers; percentages, denominators and tables on it agree with the headline. [36]
- **R20.** Derived figures must close: a breakdown sums to its total, ranks match the list they describe, period labels change with the period. [37, 101]
- **R21.** Sample and seed data is internally consistent — one owner, one stage, one phone per person across every screen. [38, 39]
- **R22.** Cross-screen reconciliation is decided once and written down (see §3): Won deals, units booked and open leads per agent must tie to the same totals. [40]

### Calendar, tasks and follow-ups

- **R23.** **A toast is not a record.** Anything the toast claims was saved is visible on the screen that owns it — in the calendar, in the task list, on the lead — before the toast is shown, and Undo removes it from there too. [42, 43]
- **R24.** Completing a follow-up asks for the outcome, and every list that showed it agrees immediately afterwards. [44, 34]
- **R25.** A new plan opens on the **first free slot**; a clash warning appears only after the user picks a taken time. [45]
- **R26.** A next step cannot be saved without a date and a time, and it renders on the day chosen, not today. [47, 48]
- **R27.** Lists that say "coming up" or "next" are sorted by time and drop what is done. [49]
- **R28.** Whoever created an item can change and delete it, whatever its audience. [46]

### Attendance and settings

- **R29.** Validation across two fields shows the error under the field the user must change, while typing, and nothing clears it behind the user's back. [55, 56]
- **R30.** **Save either saves or says why.** A Save that fails validation shows the message and never returns silently. [55, 78, 80]
- **R31.** Leave and shift rules are enforced on the data, not just in the form: the same days cannot be booked twice, pending days count against the balance, and every view (month, week, tile, log) reflects the request. [52, 53, 54]
- **R32.** Times are 24-hour everywhere, dates are day-first, and both use the CRM's own controls rather than the browser's locale-dependent ones. [57, 109]

### Roles, privacy and permissions

- **R33.** **Role comes from the session on the server and nothing else.** Opening a URL never changes it; a page a role may not see returns the "Only for owners and admin" block, not the page. [58]
- **R34.** Agents cannot browse another agent's book. Another agent's lead is reachable only by exact name or full phone number — enough to stop a duplicate, not enough to work the lead — and always shown as "with <agent>". [59]
- **R35.** Copy follows the role: no agent-only hints or "your agent" wording on an owner's screen. [61]
- **R36.** Granting **and removing** owner or admin both confirm twice. [60]

### Risky actions and undo

- **R37.** Anything that affects other people's work confirms a second time and names the blast radius: "hide The Archive… its 115 leads stay". [62, 68]
- **R38.** Declining, refusing or rejecting someone else's request takes two clicks, offers Undo, and asks for a reason wherever any other screen asks for one. [63, 64]
- **R39.** A closed lead stays closed: after Won or Lost the other outcome is unavailable, and Undo restores the stage **and** the next step. [65]
- **R40.** Business rules are enforced in the data layer, not in one panel — "one open transfer request per lead" holds however the request is made. [66]
- **R41.** Undo restores the guards with the row: an undone deactivation is a fully guarded row again. [67]
- **R42.** A timer or allowance chosen for one item does not leak into the next one, and a re-render never restarts a running clock. [68]

### Search

- **R43.** **Phone search normalises before it matches** — +971…, 971…, 00971…, 050…, with spaces, dashes, dots, brackets, and the last 7 digits — in the page search and in the Ctrl-K palette alike. A phone miss is a duplicate contact, which is the one thing the brief forbids. [69, 72]
- **R44.** Search returns the kind of thing the user named — projects, colleagues, screens, settings and actions, grouped, best group first, with "See all results". [70, 71]
- **R45.** No feature claims a capability it does not have ("Any phone format works"). [72, 100]

### Bulk work, lists and import

- **R46.** Select-all selects the whole filtered set, states how many, and acts on all of them; after a bulk action the list and every count follow, with one Undo for the batch. [73]
- **R47.** Lists page through the real data; "Next" is navigation, not a message. [74]
- **R48.** Import defaults to keeping what is in the file (project, source, owner) rather than overwriting it with one value. [75]
- **R49.** Assignment counts only people who can actually work — excluding leave and inactive — shows each target's open load, and warns before pushing anyone over a desk maximum. [76, 77]

### Forms

- **R50.** **One Save marks every invalid field at once**, with a summary line ("Not saved yet. Check the red fields."). [78]
- **R51.** A form reopened is a form reset — every field, file input, counter and hint, including hints about the previously chosen record. [79, 80, 82, 85]
- **R52.** Validation rejects nonsense as well as emptiness: prices are numbers, text is escaped on output, and a missing value renders as nothing rather than a stray separator. [81]
- **R53.** Messages clear themselves — on the next valid action, on close, or after a timeout — and never cover a control. [83, 93]
- **R54.** Every empty state says what happened and offers one button out ("Show everyone"). [84]

### Layout, theme and the shell

- **R55.** No label, name, number, deadline or link is truncated where the meaning lives; long values wrap to a second line rather than clipping. Hidden controls do not reserve space. [86, 87, 88, 90, 91]
- **R56.** Every layout is checked at **1280 px** as well as 1440: wide tables scroll inside their own wrapper, the top bar never exceeds the window, and any column dropped at a width is dropped on purpose. [89]
- **R57.** Row buttons an agent needs — Call, WhatsApp — are always visible, never hover-only. [87]
- **R58.** Every text and control meets contrast in both themes; the dark palette is checked, not assumed; selection states stay visible in dark. [92, 94]
- **R59.** At most two toasts are shown at once, offset from the controls beneath them, and a toast carrying an Undo is never pushed out. [93]
- **R60.** The collapsed rail shows a label (and its count) on hover, and **every** nav item exists at every width — nothing silently disappears under 1200 px. [95, 96]
- **R61.** Short windows are handled: the menu shows it scrolls and scrolls the active item into view. [97]

### Wording

- **R62.** Help text, hints and toasts are generated from the current choice, never written for one option. [98, 101]
- **R63.** The assistant is called **Homes AI** in every heading, label and message. [99]
- **R64.** A confirmation says what will really happen, including what is missing ("there is no brochure yet"). [100]
- **R65.** Dates, working days and plurals are formatted by one shared helper — a Saturday is never "1 working day", and "1 sign-ins" never ships. [102]

### Homes AI

- **R66.** A question returns an answer to **that** question; keyword matching that can route "payment plan of Valia" to a WhatsApp draft about another project is not shipped. If it cannot answer, it says so. [104, 106]
- **R67.** The help it points at stays reachable ("try one from the list" requires the list to be on screen). [105]
- **R68.** Saved and suggested questions each have a real, grounded answer with links to the records they mention. [104]

### Completeness

- **R69.** A screen built from a spec is checked against that spec item by item before it is called done — the missing 6th "Needs you now" row was in the spec. [107]
- **R70.** Login carries everything the brief gives it, including the password-reset path and who performs it. [108]
- **R71.** Demo and seed data covers every agent and filter, or the screen is marked as a sample rather than quietly looking empty. [110]

---

## 3. Disagreements — these are owner decisions

1. **How many toasts at once.** Yuliia and Rocky both wanted the pile-up stopped ("toasts piled up… over buttons"). Abdullah set the cap at two and argued against one: "not 1: an Undo must stay reachable". Decision: cap at 1 (cleanest) or 2 (keeps Undo reachable).
2. **Check-in: hard lock or prompt?** Rocky took the spec's line — "Start calling" is **locked** with "Check in to start calling" until you check in [11]. Yuliia wanted the softer version: the call dialog opens and asks "the check-in question when not checked in" [9]. One blocks work, the other nags. Decision needed, because both were "fixed" in different directions.
3. **Density vs full text.** Emir fixed a missing row on owner-home by making the **rows slimmer so all fit** [107]. Rocky and Yuliia fixed truncation by **wrapping to two lines and widening columns** [87, 88]. On a crowded owner screen these pull against each other; decide which wins where.
4. **How much of a colleague's book an agent may see.** Yuliia wants browsing closed off — another agent's leads findable "only by name or by the full phone number (to stop duplicates)" [59]. Emir, as owner, wants "every lead with the agent name". Duplicate prevention and agent privacy conflict directly; the owner sets the line.
5. **Who may change a plan that touches the whole team.** Yuliia's fix: "the person who made the plan can change and delete it" [46]. The screen as designed gave an agent only "Hide for me". This is a policy call about an agent deleting something off the team calendar.
6. **Consistent per page, or consistent everywhere.** Emir kept the contradictory totals "as the brief orders ('be consistent inside one page')" but flagged that Won = 4 vs 27 units booked, and 234 vs 809 open leads, "needs a data decision from the leader" [40]. Until that is decided, R15 and R22 cannot both be satisfied. This is the one finding that blocks other rules.
7. **Native controls or our own.** Abdullah replaced native time inputs with 24-hour boxes [57] but left date inputs native, noting they follow the computer's region and "the real build should use its own date picker" [109]. Building our own picker is real work; confirm it is wanted before it is built.

---

## 4. Highest priority

Seven findings that, ignored, make the CRM unusable for a real agent. The test
of "unusable" here is: an agent could not do a day's work, or would create bad
data by doing it.

1. **Links must carry the record — #1 (and #2, #7).** Every route to a lead opened Marco Bellini. This is the only item any tester called a Blocker. An agent who cannot trust that a click opens the person he clicked cannot use any list, card or notification on any screen; nothing else on this page matters until it holds.
2. **Call must work, log, and refuse when there is no number — #9, #10, #13.** Calling is the agent's job. A plain `tel:` link where "nothing visible happens… nothing logged" means the day's work leaves no trace, speed-to-lead cannot be measured, and the 5-minute rule has nothing to measure. An empty Call dialog on a lead with no phone wastes the attempt.
3. **Phone search must match every format people type — #69, #72.** "Nothing found · It is a new number" for 0505550101 leads straight to "I would add a duplicate". The brief's first priority is "never lose or duplicate a lead"; this finding is that priority failing at the one screen where duplicates are caught.
4. **Role must come from the session, never from the URL — #58.** An agent who opened an owner page "became owner for the whole site". That is a privacy and commission-data breach in a system holding salaries, commissions and other agents' clients, and it was hit by three testers independently.
5. **A toast is not a record — #42, #43, #80, #55.** "Toast said saved" while nothing attached; "nothing appeared in the calendar, so I was not sure the next step was saved"; "Save rules then did nothing at all, no message". An agent who cannot tell what was saved will either re-do the work or lose the follow-up. Trust in the CRM dies here faster than anywhere else.
6. **The CRM must remember what you just did — #18, #19, #22.** Results, calls, WhatsApp opens and even the check-in time reset on the next page, and badges never followed. An agent working a call list across My Day, My Leads and the lead page has no idea where he is.
7. **Numbers must be real and must agree, and clicking one must open exactly that set — #25, #26, #73.** Click 456, get "6 of 863"; owner-home and dashboard giving "two different truths"; "Select all" taking 5 of 12. This is the owner's side rather than the agent's, but it is what the morning review runs on, and a manager acting on numbers that disagree reassigns the wrong leads to the wrong people — which lands on the agent.

Deliberately *not* in this list, though they are real and must be fixed:
truncation and 1280 px layout [86–90], dark-theme contrast [92], wording and
plurals [98–103], the collapsed rail [95, 96] and the Homes AI misrouting
[104]. They make the CRM look unfinished and annoy people daily; they do not
stop a day's work or corrupt data.
