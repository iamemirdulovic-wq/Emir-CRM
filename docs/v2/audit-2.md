# v2 audit, part 2 — pages 12 to 22 of `design/web/research/sage.md`

What this is: an item-by-item check of eleven computer pages against the
design package. Every block, field, button, dialog, rule and piece of wording
`sage.md` and the matching `design/web/*.html` ask for is one line below.

**Built** — there, with the design's layout, fields, buttons and wording.
**Partly** — exists, but something is missing or different; the note says what.
**Not built** — absent.

A page existing does not make it Built. Each line was checked against the
build's markup (`web/src/v2/*.tsx`), against the server where the design asks
for a field or a rule the API must supply (`server/src/`), and in a real
browser at 1440×1000 as owner and as agent.

Method and sources, per page: the spec line in `design/web/research/sage.md`,
the computer design `design/web/<page>.html` (its `<body>` and its `<style>`),
the phone design `design/screens/<Name>.dc.html`, the build, and the server.

Two notes on reading it:

- The preview this was checked in serves `web/src/preview/mock-api.ts`, not
  MySQL, so the sample data is the old demo set, not sage §3. Data is not
  audited here; blocks, fields, buttons, rules and wording are. Where a value
  on screen is a preview artefact rather than a build fault it is said so.
- Where the design asks for something the server cannot supply, the item is
  still **Not built**, and the note names the missing field or endpoint.

---

### 12. pipeline.html — Pipeline

| Item | State | Note |
|---|---|---|
| Six columns New · Called · Interested · Meeting · Offer · Won | Built | design's order and its stage words |
| Count on each column head | Built | from `/api/pipeline/board`, not from the cards on screen |
| Per-column share shown as a % | Built | share of everything on the board |
| Won column head reads "in Nov" instead of a % | Not built | Won carries no label at all |
| Coloured bar under each column head | Built | `d-kb-bar`, per-stage colour |
| Cards open the lead | Built | whole card is a hit target |
| Call button on a card | Partly | present, but also on Won cards; the design prints it only when `s!=='won'` |
| VIP tag on a card | Not built | `kb-card` has no `vip-tag`; all-leads and calling both show one |
| Owner sees the holding agent on the card | Partly | avatar with a `title` tooltip; the design hangs the name off the avatar the same way, so this matches — but two letters is all an owner gets |
| Project · unit sub-line | Built | falls back to budget band when there is no unit type |
| Next-step line, red when late | Partly | the board endpoint sends no `next_step_at`, so the line says "Arrived 14:33" / "Replied 5 min ago" / "Call within N min" instead of the promise ("Site visit Thu 11:00") |
| Five cards a column, then "+ N more" | Built | |
| "+ N more" opens that stage's list | Partly | goes to `/v2/leads?tab=all` with no `stage`; the design sends an owner to `all-leads.html?stage=<stage>` |
| "No leads here" in an empty column | Built | exact wording |
| Search box "Name or project" | Built | |
| Agent filter (owner only) | Built | "Agent: all N", real team list |
| Project filter | Partly | options are the project names found on the cards already fetched (five a column), so a project further down the list cannot be picked |
| Lock note "No drag. A stage changes when you save a call, a meeting, an offer or Won." | Built | word for word |
| No drag, no stage change by click | Built | no drag handlers anywhere on the board |
| Result count "N open leads" / "N found" | Partly | the owner's line says "· every agent" as the design does; when a filter is on the design counts the matches, the build prints the board total |
| Lost strip kept apart, under the board | Built | chip, count, "kept apart · not counted in open leads" |
| Up to two Lost cards in the strip | Built | |
| "See all lost" link | Built | goes to `/v2/leads?tab=lost` |

### 13. calling.html — Calling (power dialler)

| Item | State | Note |
|---|---|---|
| "You are not checked in" amber banner | Partly | present; wording is "the owner sees it", the design says "owners see it" |
| "I'm working outside" in the banner | Built | links to Attendance |
| "Check in now" in the banner | Built | |
| "Lead 1 of 12" | Built | |
| Progress bar | Built | share of the queue with a result |
| Counts: N calls · N WhatsApp · N results saved | Built | |
| "+15 points per call" chip | Partly | reads "+2 points when you reach someone". Deliberate (the wall really pays 2, `server/src/wall/xp.ts`), but it is not the design's wording or number |
| "End session" button | Built | |
| Lead card: name, VIP tag, stage chip | Built | |
| Lead card: phone, largest thing on the card | Built | and it is a `tel:` link |
| Local time of the client | Built | flag, country, time |
| "Speaks …" | Built | |
| "Why" line (VIP / reason this lead is up) | Built | |
| Call · WhatsApp · Open the lead | Built | all three |
| "Every tap is logged" | Built | becomes "Call tap logged…" after a tap |
| Facts: Project · Budget · Wants | Built | |
| Extra fact "Tried" | Built | not in the design; an addition, not a loss |
| "Say:" script box | Not built | replaced by "What you promised", which prints the agent's own last next-step note. Nothing writes a script |
| Outcome card locked until Call or WhatsApp is pressed | Built | with "Click Call or WhatsApp first" |
| Six outcome tiles, design's labels and order | Built | Interested · No answer · Busy · Call back · Wrong number · Not interested |
| Interested → next-step chips, required | Not built | no chips; a sentence says to choose it on the lead page. The design's four ("Send payment plan on WhatsApp", "Book a meeting or site visit", "Call back tomorrow 11:00", "Send brochure + location") and the error "Choose the next step." are both absent |
| No answer → "comes back in 2 hours · 16:55" | Partly | says "in 2 hours"; the clock time is not worked out |
| No answer → "Also open WhatsApp with a short 'I tried to call you' message" | Built | exact wording, and it really opens WhatsApp afterwards |
| Busy → "comes back in 1 hour · 15:55" | Partly | same: no clock time |
| Call back → Day, Time, Why (required) | Built | with "Not in the past." and "Write why in a few words." |
| Wrong number → Flag for owner / I have the new number switch | Not built | only the "flag" half. Nothing takes a replacement number |
| Wrong number → hint text | Partly | "The owner sees 'wrong number' on it"; the design names Emir and George |
| Not interested → reason chips, required | Built | with "Choose a reason. The lead moves to Lost." |
| Not interested → "Try again in 3 months" tick box | Not built | absent |
| Consequence line beside Save ("The stage becomes Interested." etc.) | Built | all six |
| "Save result" button | Built | |
| Saved box with Undo | Built | |
| Previous · Skip · Next lead, Next disabled until a result is saved | Built | "Save a result before Next, or skip this lead." |
| Next becomes "Finish" on the last lead | Built | |
| Queue sidebar "Today's list · VIP first" | Built | numbered rows, VIP first, current row marked |
| Queue row shows result / Skipped / why | Built | |
| End summary: Calls · WhatsApps · Results saved | Built | |
| End summary: "+N points · 18 of 40 calls today" | Not built | a sentence about leads left replaces it |
| End summary: "N of 12 leads have a result" | Built | |
| End summary: Keep calling · Back to My Day | Built | |
| Confetti when the list is finished | Not built | nothing fires |

### 14. all-leads.html — All leads (owner)

| Item | State | Note |
|---|---|---|
| Page opens on the owner's book | Not built | `/v2/leads` opens an owner on the **agent's** My leads screen (Today tab, "Start calling", "Free leads", "Pipeline"). Everything below marked owner-only appears only after clicking the **All** tab |
| Sub-line "863 leads · every agent" | Not built | the top bar says "All leads" and nothing else |
| Tab: All, with count | Built | |
| Tab: Going cold · 12 | Not built | no such tab, and no such tab on the server (`server/src/leads/tabs.ts` has no cold tab) |
| Tab: Overdue · 9, red count | Built | |
| Tab: No next step · 31 | Built | |
| Tab: VIP · 5 | Built | |
| Tab: Lost · 50 | Built | |
| Tabs the design does not have: Today, New | Partly | the agent's tabs are left on the owner's page, and Today is the one it opens on |
| Search "Search in this list" | Built | exact placeholder |
| Agent filter | Partly | there, but only on the All tab; on the tab the page opens on there is none |
| Stage filter | Built | |
| Project filter | Partly | options come from the `projects` library table, not from the projects the leads carry. The filter then matches `o.project_name = ?` exactly (`server/src/http/routes/my-leads.ts:77`). `/api/projects` has no `DISTINCT` and `projects.name` has no unique key (only `slug`), so the same project name listed twice is the library's own duplicate rows showing through — **this is the "Sei Saadiyat, twice" the owner saw** |
| Source filter | Built | |
| "Added: any time / Today / This week / This month" filter | Not built | no control, and `listSchema` takes no date parameter |
| Result count "863 leads" / "N of 863 leads" | Partly | prints "50 of 124 leads" — the page size, not the match count the design shows |
| Export button | Not built | no button. `/api/contacts/export` exists on the server, so only the button is missing |
| Filter chips with × and "Clear all" | Built | |
| Tick box column | Not built | on the computer. `AllLeadRow` has one, but it is inside the phone branch only |
| "Select all on this page" in the header | Not built | |
| Select-all-across-pages bar | Not built | |
| Column: Lead | Built | |
| Column: Phone | Built | |
| Column: Project | Built | |
| Column: Stage | Built | |
| Column: Agent | Built | avatar + name, "Incoming" pill when unowned |
| Column: Last contact | Built | |
| Column: Attention · next step, red when late | Built | |
| VIP tag in the lead cell | Built | |
| Row actions: Call | Built | |
| Row actions: WhatsApp | Built | |
| Row actions: "⋯" menu | Not built | no menu button on a row |
| Row menu: Open full page / Give to another agent / Move to Incoming | Not built | |
| Row click opens the 480px lead side panel | Not built | a row click navigates to the full lead page instead |
| Side panel: phone, stage, "with X", attention banner | Not built | no panel |
| Side panel: Call · WhatsApp · Telegram | Not built | |
| Side panel: Project, Budget, Agent, Last contact, Source, Lead # | Not built | |
| Side panel: "Latest on the timeline" | Not built | |
| Side panel: "Give to another agent" in the foot | Not built | |
| Dark bulk bar "N selected" | Not built | |
| Bulk "Move to agent" | Not built | |
| Bulk "Move to Incoming" | Not built | |
| "Move N leads" panel | Not built | on the computer. A simplified move dialog exists in the phone branch only |
| Move panel: the chosen leads as chips, "+ N more" | Not built | |
| Move panel: "Notes and history go with them. The new agent gets one notification." | Not built | |
| Move panel: list of agents, fewest open leads first, Incoming at the top | Not built | |
| Move panel: on-leave / absent agents not selectable | Not built | |
| Move panel: two clicks ("Tap again · move 3 leads to X") | Not built | |
| Sortable columns (Lead, Project, Stage, Agent, Last contact) | Not built | the design's `data-sort` headers are plain `<th>` here |
| Table foot "1–50 of 863 · 50 per page" | Partly | prints "1–50 of 124"; the "· 50 per page" note is missing |
| Previous / Next pagination | Partly | one "Show 50 more" button instead of two page buttons |
| Empty state "No lead fits these filters" + "Clear all filters" | Partly | the empty state is there with different wording ("Nothing matches. Clear the filters, or try another name.") and an "Add a new lead" button rather than "Clear all filters" |

### 15. transfers.html — Transfers

| Item | State | Note |
|---|---|---|
| **Agent** · sub-line "Give a lead to a colleague who fits better. It stays with you until they accept." | Built | word for word |
| "Transfer a lead" button opening the form | Not built | the button reads "Pick a lead to transfer" and navigates to My leads. The form's own "Which lead?" select is therefore also gone |
| FOR YOU section with badge | Built | |
| For-you row: avatar, lead name as a link, stage chip | Built | |
| For-you row sub-line "The Archive · 1BR · speaks Arabic · Dubai 14:55" | Partly | shows project · stage only; no language, no local time |
| For-you row: who → you, reason, time sent | Built | and the note, which the design does not show |
| Deadline block "18:00 / Answer by · 3 h left" | Built | the preview shows 22:00 because `mock-api.ts` writes 18:00 **local** and the screen adds Dubai's +4; the real server stores 18:00 Dubai (`server/src/v2/transfers.ts:84`) |
| Accept | Built | |
| "No, thanks" | Partly | present; the design's two-click confirm ("Tap again to say no") is not |
| Empty state "Nothing to answer" + "When a colleague wants to give you a lead, it shows here." | Built | word for word |
| YOU SENT section with badge | Built | |
| Sent table: Lead / To · reason / Sent / Status | Built | |
| Status chips Waiting · Owner must approve · Refused · Accepted · Ended 18:00 · Cancelled | Built | all six |
| Sent row: "Remind" | Not built | no button, and no endpoint behind one |
| Sent row: "Cancel" | Partly | present; the design's two-click confirm is not |
| Sent row: "Send to someone else" on a refused request | Not built | |
| Rules card, 5 rules | Partly | four match word for word; the fifth says "Agents on leave cannot be chosen" where the design says "on leave **or absent**" |
| "This month · You gave 2 · You got 1" card | Not built | replaced with "Open right now · You sent / Waiting on you". Nothing sends an agent their own month |
| **Owner** · NEEDS YOUR APPROVAL with badge | Built | |
| "Move leads yourself" link | Built | |
| Approval row: avatar, lead, stage chip, from → to, reason, sent | Built | |
| Approve | Built | |
| Refuse | Partly | present; the design's two-click confirm is not |
| Empty state "Nothing to approve" + "Transfers in stage Meeting or Offer come here first." | Built | |
| "ALL TRANSFERS · LAST 7 DAYS" | Built | |
| Segments All · Open · Finished with counts | Built | |
| Table: Lead / From → to · reason / When / Status | Built | |
| "THIS MONTH · WHO GIVES AND WHO GETS" | Partly | titled "Who gives and who gets" and counted over seven days, not a month |
| Red flag banner ("Shan gave away 6 leads and got 0. He has 57 open, desk maximum 50.") | Not built | nothing computes or shows it, although `desks.max_open_leads` exists |
| Gave/got bars per agent | Built | |
| Card foot "10 transfers in November · 9 accepted · 1 refused" | Partly | same figures over seven days: "2 transfers in seven days · 1 accepted · 1 refused" |
| "How transfers work" card, 3 rules | Built | word for word |
| **Form** · Language filter chips (All, Arabic, Russian, Hindi, Urdu, Portuguese, Serbian) | Not built | the chips are built from `whoCouldTakeIt`, which selects `u.locale AS language` (`server/src/v2/transfers.ts:370`) — the CRM's UI language, not the languages a person speaks. `users.languages` (JSON) is the real column and is the one the profile page writes. With one locale in the office the list has one entry and the chips are hidden entirely (`languagesIn(all).length > 1`). **This is the "no language filter, agent languages not real" the owner saw** |
| Agent cards: photo with status dot | Built | |
| Agent cards: status chip (In office / Late · 24 min / Outside until 16:00) | Not built | one line of text, and only when no language is set |
| Agent cards: languages | Partly | prints `locale` ("en"), see above |
| Agent cards: open leads | Built | "N open" |
| Agent cards: deals this month | Not built | |
| Agent cards: reply time | Not built | |
| Agent cards: "Profile" link | Not built | |
| "Best match" chip on the first agent | Not built | the first row carries "Fewest leads" instead |
| Order: can take it now first, then fewest open leads | Built | the SQL orders exactly that way |
| On-leave agents shown but not selectable | Built | |
| Hint "· free now first, then fewest open leads" | Built | word for word |
| Over-maximum hint ("X has 57 open leads, above the desk maximum of 50. X may say no.") | Not built | nothing compares to the desk maximum |
| "No agent speaks X · Choose 'All' to see everyone." empty state | Not built | a plain "Nobody is free to take it right now." |
| Reason chips, 6, required | Built | all six, with "Choose a reason." |
| Note required ≥ 5 letters when the reason is Other | Built | with "Write at least 5 letters." |
| Rules list: stays with you / ends 18:00 / notes and history go with it | Built | word for word |
| VIP lead blocked, with "Send back to Emir" | Partly | the block and its banner are built; the way out is "Go to My Day" rather than a send-back button on the panel |
| Owner-approval banner for stage Meeting / Offer | Not built | the panel does not warn before sending; the answer comes back from the server afterwards |
| "This lead already has an open request" banner | Not built | |
| Send button text changes to "Send request to X" | Built | |

### 16. calendar.html — Calendar

| Item | State | Note |
|---|---|---|
| Month / Week / Day switch | Built | in the design's order |
| Earlier / Later arrows | Built | |
| "Today" button | Built | |
| Title ("November 2026") | Built | |
| Legend: Meeting · Site visit · Call · Follow-up · Team | Built | all five, design's colours |
| Owner's "Whose plans" picker (Rocky Khan, Everyone, and all ten agents) | Partly | a Mine / Everyone segmented control; one agent cannot be picked |
| "New plan" button | Built | |
| Month grid, Monday start | Built | |
| Up to 3 plans a day, then "+ N more" | Built | |
| Multi-day band across the month cells | Partly | an all-day plan prints as a plain chip in the month, and as a band only in the week's all-day row; nothing can create one anyway (see below) |
| Week grid with an hour column | Built | 07:00–22:00 |
| Overlapping plans split side by side in the week | Not built | they stack on top of each other |
| "Now" line in the week and day | Built | not asked for, but harmless |
| Day view | Built | |
| Side card "How did it go?" with the orange "Answer before 21:00" chip | Built | word for word, shown only when something is waiting |
| Side card: the chosen day, "Today" chip | Built | |
| Busy-day hint | Partly | fires at 5+ as the design does, but says "N plans on one day. That is a lot." instead of "Busy day: N plans." plus the free gap |
| Day list | Built | |
| "Add a plan on this day" | Built | |
| **New plan** · Type chips (Meeting · Site visit · Call · Follow-up · Team) | Partly | all five, under the heading "What is it?" rather than "Type" |
| New plan: dialog sub-line "It shows in your calendar and on My Day. You get a reminder." | Not built | |
| New plan: lead chosen from a list, required | Not built | no control at all. `POST /api/v2/meetings` already accepts `opportunityId` and `contactId`, so only the UI is missing. The build's own comment names this as left out |
| New plan: "Pick from the list. A team plan has no lead." hint | Not built | |
| New plan: Title, required | Partly | the field is there, labelled "Title or note · optional"; the design makes it required with "Write a short title." |
| New plan: title filled in from type + lead ("Site visit with Lucas Martin") | Not built | |
| New plan: Day | Partly | the field is there; see the past-date row below |
| New plan: Time | Partly | an `<input type=time>`; the design uses a 15-minute slot list, 07:00–21:00 |
| New plan: time defaults to the next free slot | Not built | hard-coded "10:00", and nothing looks for a clash to step over |
| **Past dates refused** | Not built | no `min` on the date input and no check in `save()`. A plan can be saved yesterday. **Confirmed: the calendar accepts a plan in the past** |
| New plan: clash warning ("This time is taken. You already have …") | Not built | nothing checks. **Confirmed** |
| New plan: Save button becomes "Save anyway" on a clash | Not built | |
| New plan: "Runs for several days" switch, 2–5 days | Not built | no control, and no `allDay` / multi-day field on `POST /api/v2/meetings` |
| New plan: How long — 15 min / 30 min / 1 h / 2 h | Built | 1 h default, as the design has it |
| New plan: length default changes with the type (15 min for a call) | Not built | always 1 h |
| New plan: "Remind me before" — 15 min / 1 h / 2 h | Not built | no control, and no reminder column on `meetings` |
| New plan: Place — Office / Sales centre / Client's place / Online / Zoom | Partly | all four chips, under "Where? · optional" rather than "Place" |
| New plan: place default changes with the type | Not built | |
| New plan: "Save the plan" | Partly | reads "Add · Fri 13 Nov · 10:00" |
| **Open plan** · panel title is the plan's type ("Site visit plan") | Partly | the panel is titled with the plan's own title |
| Open plan: time range "16:30 – 17:30" | Partly | start time only |
| Open plan: full date line | Built | |
| Open plan: chips (type, VIP, done, "Overdue since 11:00", "Result needed", "From Emir") | Not built | no chip row on the panel |
| Open plan: "How did it go? Answer before 21:00" banner with an Answer button | Partly | the result tiles appear inline when a plan has finished; there is no banner and no 21:00 line on the panel |
| Open plan: facts list (Lead, Phone, Wants, Place, Length, Reminder, Who) | Partly | place only |
| Open plan: "Open the lead" | Built | |
| Open plan: "Change day or time" | Not built | no control, and no endpoint — `v2.ts` has `POST /meetings` and `PATCH /meetings/:id/result` and nothing else |
| Open plan: clash and past-date check when changing the time | Not built | follows from the above |
| Open plan: "Delete" with two clicks | Not built | no button and no DELETE endpoint, although `meetings.deleted_at` exists. **Confirmed: a plan cannot be edited or deleted** |
| Team plan: owners change it, agents "Hide for me" | Not built | neither |
| Team plan: "This is a team plan from Emir…" note | Not built | |
| **How did it go?** · five results | Partly | all five exist but every label is reworded: "They came" (Showed up), "They did not come" (No-show), "Moved it" (Rescheduled), "They booked" (Booked a unit), "Cancelled" |
| Result tiles carry a sub-line ("The meeting took place", "+300 points", …) | Not built | label only |
| "Choose one result first." when nothing is picked | Not built | the Save button is simply disabled |
| Showed up → next-step chips (Send the offer / Second meeting / Site visit / Follow up in 2 days), required | Not built | |
| Showed up → day and time for that next step, written into the calendar | Not built | |
| Showed up → interest Hot / Warm / Cold, required | Not built | the field is missing although `PATCH /meetings/:id/result` accepts `interest` |
| Showed up → note | Not built | the endpoint accepts `note`; nothing asks for one |
| No-show → counter banner, red flag after 2 | Not built | nothing counts no-shows |
| No-show → ready-made message + Open WhatsApp / Telegram / Copy | Not built | |
| No-show → "Try again" chips (Tomorrow 12:00 / In 2 days / Next week / Pick / Do not plan now) | Not built | |
| Rescheduled → new day and time, required | Not built | saving "Moved it" moves nothing |
| Rescheduled → "Who asked to move it?" The client / Me | Not built | |
| Booked a unit → project, unit, price, paid now, receipt required | Not built | |
| Booked a unit → "+300 points, posted on the Team wall", lead moves to Won | Not built | the result is recorded on the meeting only; the lead does not move |
| Cancelled → who cancelled (Client / Me / Developer), required | Not built | |
| Cancelled → "A cancelled meeting is not counted as a no-show." | Not built | |
| A cancelled plan is told apart from a finished one | Not built | `toPlans()` sets `done: Boolean(meeting.result)`, so Cancelled, No-show and Showed up all render with the same `d-is-done` class and no chip. **Confirmed: a cancelled plan still looks like a normal plan** |
| Panel foot "Later · Before 21:00 · Save the result" | Partly | "Save" only |
| Undo on the toast after saving a result | Not built | |

### 17. tasks.html — Tasks and Follow-ups

| Item | State | Note |
|---|---|---|
| Top tabs Tasks / Follow-ups with counts, Follow-ups count red | Partly | both tabs and both counts; the overdue count is not red |
| Owner's "Whose tasks" picker (Rocky Khan, My own tasks, ten agents) | Partly | a Mine / The team segmented control; one agent cannot be picked |
| Week strip, each day with "N left" | Built | and "No tasks", "All done", "Day off" |
| Week before / next week arrows | Built | |
| List head: "Today · Wed 11 Nov" | Built | |
| List head: "Today" button | Built | |
| To do / Done segmented control with counts | Built | |
| "New task" button | Built | |
| Row: checkbox | Built | |
| Row: type chip (Call / WhatsApp / Meeting / Other) | Partly | four of the design's six; "Overdue" and "From Emir" are not types here |
| Row: title and time | Built | |
| Row: lead and project under the title | Built | |
| Row: "⋯" menu | Built | |
| Row menu: Change | Built | opens the same panel in edit mode |
| Row menu: "Move one day later" | Built | word for word |
| Row menu: Delete, two clicks | Built | "Tap again to delete" |
| Summary card "Left today · N of M tasks" with a bar | Built | |
| Summary card "Next: 15:20 · Call the VIP lead Khalid" | Built | |
| Watch row: "Follow-ups overdue" | Built | with the name and "since 11:00" |
| Watch row: "Meeting result needed · answer before 21:00" | Not built | the design's middle row is missing entirely |
| Watch row: "Plans today · Next: 16:30 site visit · Lucas Martin" | Partly | there, but the sub-line reads "Meetings, site visits and calls" — no next plan, no count |
| **New task** · "What do you need to do?", required | Built | with the design's placeholder |
| New task: sub-line "A task is for you. It shows on My Day on its day." | Built | word for word |
| New task: Type chips | Built | all four |
| New task: Day, required, no past day | Partly | the field is there; no `min` on the input, and the refusal is wrong — see below |
| New task: Time | Partly | an `<input type=time>` where the design has a 15-minute slot list whose first option is "No time" |
| New task: time defaults to the next free slot | Not built | hard-coded "10:00". **Confirmed** |
| New task: refusal wording | Not built | a past *time* on today produces "This day is in the past. Pick today or later." The design puts "This time has passed. It is 14:55 now." on the **Time** field and keeps the day message for the day. The build also prints the message under the title field, not under Day or Time. **Confirmed: the error blames the day rather than the time** |
| New task: "A meeting needs a time." | Not built | |
| New task: Lead select ("· you can leave it empty") | Not built | no control. `POST /api/tasks` already accepts `contactId` and `opportunityId` |
| New task: "Save the task" | Partly | reads "Add the task" |
| Meeting task asks its result after its time | Not built | no dialog |
| Meeting result: Client showed up / No-show / Cancelled | Not built | |
| Meeting result: link across to the Calendar for the rest | Not built | |
| **Follow-ups** · tabs Overdue / Today / Tomorrow / This week with counts | Built | all four, red count on Overdue |
| Count line "1 follow-up · overdue" | Partly | "2 follow-ups"; the group word is dropped |
| "Call these N one by one" | Built | and "Call this one now" is not needed at N=1 — the build keeps the plural form |
| Table column: Lead | Built | |
| Table column: Phone | Built | |
| Table column: Stage | Not built | no stage chip in the follow-up table |
| Table column: What about | Built | |
| Table column: How | Built | |
| Table column: When, red when late | Built | |
| Row action: Call (or WhatsApp when that is the way) | Not built | only "Done" |
| Row action: Done | Built | |
| Row action: "⋯" menu | Not built | |
| Row menu: Move to tomorrow / Move one day later / Open the lead | Not built | "move one day later" exists on a Tasks row but not here |
| "What happened with X?" dialog on Done | Built | title and sub-line |
| Answer: "Spoke · all done" | Built | |
| Answer: "No answer · try again tomorrow" | Built | and it really moves the task |
| Answer: "Booked a meeting" | Partly | the answer is there; the design's meeting day and time fields are not, so nothing is booked — the toast says to open the lead |
| Answer: "Not interested" | Partly | same: no Lost reason select, no "Try again in 3 months", so the lead is not marked Lost |
| Dialog: "Next step for this lead" select | Not built | |
| Dialog: Note | Not built | |
| Dialog: Cancel / Save | Not built | each answer saves on click |
| Empty state "No follow-ups here" | Built | |
| Footnote "'Done' asks what happened, so the lead always has a next step. A follow-up not done by the end of the day moves to Overdue." | Partly | the second sentence is there, reworded; the first is gone |

### 18. projects.html — Projects

| Item | State | Note |
|---|---|---|
| Owner message card with avatar, "From Emir · Mon 9 Nov" and the message | Built | |
| "Read on the team wall" button | Built | |
| Filter: All, with count | Built | |
| Filter: Selling now, with count | Partly | the chip is there; the design prints the count in it, the build does not |
| Filter: Launching soon, with count | Partly | same |
| Filter: Hidden (owner only), with count | Not built | an owner cannot narrow to the hidden ones from here |
| Extra filters: Dubai, Abu Dhabi, Our picks | Partly | not in this design (they are the master prompt's library filters); additions, not losses |
| Search "Search project, developer or area" | Built | exact placeholder |
| Result count "4 projects" | Built | |
| "Home banners" button (owner) | Built | |
| "Manage projects" button (owner) | Built | |
| Card: cover photo | Built | gradient fallback when there is none |
| Card: status pill | Built | plus a "Sold out" state the design does not have |
| Card: "Starting from" + price | Built | |
| Card: project name | Built | |
| Card: developer · area | Built | |
| Card: the pitch line | Not built | no pitch anywhere on the card |
| Card: Payment plan and Handover facts | Built | |
| Card: "Your leads 24 · Team 115" + bar | Not built | replaced by "Available 24 · of 120 units" and a stock bar. The project **page** counts leads by `project_name`, so the card could too |
| Card: "New leads go to: Dubai off-plan desk" | Not built | replaced by "Prices checked 3 days ago" |
| Card: "Send to a client" button | Built | |
| Card: "Open" button | Built | |
| Hidden project card: greyed, "Open in Manage" instead of the two buttons | Not built | a hidden project shows the normal buttons |
| Empty state "No project found" + "Show all" | Built | |

### 19. project.html — One project

| Item | State | Note |
|---|---|---|
| Back to Projects | Built | |
| Owner's "Edit project" button | Built | |
| Hero photo with status chip and name / developer · area | Built | |
| Facts: Starting from | Built | |
| Facts: Payment plan | Built | |
| Facts: Handover | Built | |
| Facts: Unit types | Built | |
| "The pitch in 3 lines" | Partly | the three lines are there, titled "How to pitch it" |
| Pitch "Copy" button | Not built | |
| Leads card: "Your leads here" / "Team leads here" | Built | both, by role |
| Leads card: the number links to the filtered list | Built | |
| Leads card: share bar | Not built | |
| Leads card: "Team has 115 · you have 21%" | Not built | the foot says "Asked about {project}" |
| Leads card: "New leads go to: {desk}" | Not built | replaced by "Built N% so far" |
| "Your leads in this project" table: Name, Phone, Stage, Next step | Built | |
| Lead row: Call button | Built | |
| "See all N" link | Built | |
| **Send to a client** card, "3 steps" chip | Built | |
| Step 1 "What do you send?" | Built | |
| Choice: Brochure | Built | shown only when the project has one |
| Choice: Payment plan | Built | |
| Choice: Location | Built | |
| Choice: Video | Not built | no video field on `projects` and no option |
| Step 2 "To which lead?" select, with "Choose a lead first." | Built | |
| Step 3 "Open the chat. You press send." | Built | |
| Message preview box | Built | |
| "The link is tracked. You get an alert when the client opens it." | Not built | the line is absent |
| Open WhatsApp / Open Telegram / Copy the link | Built | all three; the tap is recorded through `/api/v2/taps` |
| "WhatsApp opened · waiting for your update" banner | Not built | a toast appears and nothing stays on the page |
| "What happened?" dialog | Not built | none of it: the six answers, the Lost reason select, the note with voice, Later / Save the update |

### 20. manage-projects.html — Manage projects (owner)

| Item | State | Note |
|---|---|---|
| Sub-line "Agents see only projects that are 'Selling now' or 'Launching soon'." | Partly | reworded: "Agents see Selling now and Launching soon on their Projects page. Hidden is only for owners." |
| "See as an agent" | Built | |
| "Home banners" | Built | |
| "Add project" | Built | |
| Tile: Selling now + "Agents can send brochures" | Built | word for word |
| Tile: Launching soon + "Shown with a 'soon' tag" | Built | word for word |
| Tile: Hidden + "Only owners and admin see it" | Built | word for word |
| Table column: Project (photo, name, developer · area) | Built | |
| Table column: Starting from (+ plan · handover under it) | Built | |
| Table column: Brochure (PDF chip with size, or an Upload button) | Built | and the row uploads in place |
| Table column: Leads, linking to the filtered list | Built | |
| Table column: Status · who sees it, as a 3-way segment | Built | |
| Hiding a project with leads asks twice | Built | the button reads "Again?" and the toast explains |
| Status change toast, with Undo | Built | |
| Row action: Edit | Built | |
| Row action: View ("See as an agent") | Built | |
| Panel: Project name, required | Built | with "Write the project name." |
| Panel: Developer, required | Built | |
| Panel: Area | Built | |
| Panel: Starting price | Built | |
| Panel: price must contain a number ("Write a number, like AED 1.6M.") | Partly | the field takes a plain number and rejects a non-number, but not in the design's words |
| Panel: unique name ("There is already a project with this name.") | Partly | checked in the browser against the loaded rows only; `POST /api/library` does not check, and `projects.name` has no unique key |
| Panel: Brochure upload, PDF only | Built | "Only a PDF file can be a brochure." |
| Panel: brochure up to 30 MB | Built | |
| Panel: Status segment Selling now / Launching soon / Hidden | Built | |
| Panel: "A new project starts Hidden…" hint, on Add only | Built | word for word |
| Panel: Delete, two clicks | Not built | no button. `DELETE /api/library/:id` exists and asks for the typed name, so only the UI is missing |
| Panel: "X has N leads. Set it to Hidden; a project with leads cannot be deleted." | Not built | |
| Panel: Cancel / Save project | Built | |
| Extra field: Emirate select | Partly | not in this design; an addition |

### 21. home-banners.html — Home banners (owner)

| Item | State | Note |
|---|---|---|
| Reached from Projects / Manage projects | Built | both link to it |
| Sub-line "The banners at the top of every agent's My Day. Up to 5 · they change every 4.5 seconds." | Partly | "Up to five, and they take turns" — the 4.5 seconds is dropped |
| "4 of 5 used" chip | Partly | reads "2 of 5 showing" |
| "New banner" button | Partly | the form is always open at the bottom; there is no button that starts a new one |
| Preview card | Partly | shows a label, headline and line; no picture, no button chip |
| Preview note "How agents see it · 1200 × 500 px" | Partly | "How an agent sees it"; the pixel size is gone |
| "Your banners" list | Built | |
| "Drag to change the order" | Not built | two arrow buttons move a banner up or down instead |
| List row: Live / Scheduled / Ended state | Not built | a show/hide tick box instead |
| List row: "seen by 9 of 10" | Not built | nothing counts who has seen one |
| Form: Picture — five project photos + Upload | Not built | no control. `banners.image_path` exists on the server and in the schema |
| Form: "Use a project photo or upload your own · 1200 × 500 px" hint | Not built | |
| Form: Label chips (From Emir / Office / Project / Best of Homes / Training) | Not built | the preview is always labelled "FROM THE OWNER" |
| Form: Title, required, max 48 | Partly | there, labelled "Headline", required; no length cap |
| Form: Short text, max 90 | Partly | there, labelled "A line underneath"; no length cap |
| Form: Button text, max 22 | Not built | |
| Form: "Opens" select (Project page / Best of Homes / Team wall / A web link) | Not built | a free-text path box, "Where it goes when tapped" |
| Form: Web link field when "A web link" is chosen | Not built | |
| Form: "Show from" date | Not built | `banners.starts_at` exists on the server |
| Form: "Until" date | Not built | `banners.ends_at` exists on the server |
| Form: "Who sees it" — Everyone / Agents / One desk | Not built | no control, and no audience column on `banners` |
| Form: desk select when "One desk" is chosen | Not built | |
| Form: "Remove", two clicks | Built | "Tap again to remove" |
| Form: "Publish" | Partly | reads "Add the banner" / saves in place |
| Maximum of five enforced | Built | and the server enforces it too |

### 22. team.html — Meet the team

| Item | State | Note |
|---|---|---|
| Sub-line "10 agents · 6 in office now" | Partly | "5 people · 2 in the office now" — counts everybody, not agents |
| Tabs "Meet the team" / "Best of Homes" | Built | |
| Search "Search a name or a language" | Built | exact placeholder, and it really searches languages |
| Filter: All, with count | Built | |
| Filter: In office now, with count | Built | |
| Filter: Dubai off-plan / Arabic desk / Abu Dhabi, with counts | Not built | the pills are built from each person's `specialities` (so they read "Damac", "Emaar"). Desks exist — `desks` and `desk_members`, migration 0036, and the Desks settings page writes them — but `/api/v2/team` does not send them. The build's own comment ("There are no desks in this database") is out of date |
| Result count "10 agents" | Built | |
| "Team and roles" button (owner) | Built | |
| Card: avatar with a status dot | Built | |
| Card: name | Built | |
| Card: "Agent · Dubai off-plan" | Partly | prints the person's title ("Property consultant"); no desk |
| Card: status chip (In office / Late · 24 min / Outside until 16:00 / On leave / Absent) | Built | all five states |
| Card: languages | Built | |
| Card: mini stats — deals · meetings · open leads | Not built | the whole row is missing. The build's comment says `/api/v2/team` sends no monthly pair |
| Card: "You" chip on your own card | Built | |
| Empty state "Nobody found" + "Show everyone" | Built | |
| "Owners and office" section | Built | |
| Owner row: avatar, name, "Founder & CEO · Owner · English, Serbian", Phone | Partly | avatar, name, "Founder · English, Arabic" and Phone; the role word ("Owner") is not repeated |
| **Colleague panel** · heading "Colleague" | Built | |
| Panel: avatar, name, "Agent · desk" | Partly | title instead of desk, as on the card |
| Panel: status chip | Built | |
| Panel: the detail line ("In office since 08:52", "Outside until 16:00 · viewing with Omar K. · Valia sales centre") | Not built | the slot carries the person's headline instead |
| Panel: Phone and WhatsApp buttons, plain links | Built | real `tel:` and `wa.me` links |
| Panel: the number shown beside them | Built | |
| Panel: "A call or message to a colleague is private. Nothing is logged." | Partly | "Opens your own phone or WhatsApp. Nothing is logged and no check-in is asked." — same promise, different words |
| No check-in gate on a colleague's call | Built | |
| Panel: "Speaks" chips | Built | |
| Panel: "Sells" chips linking to Projects | Partly | built, but the chips are developers ("Emaar", "Damac"), not projects |
| Panel: four stats — Deals this month, Meetings this month, Open leads, Average reply | Partly | three: "Deals won" (all time), "Viewings booked", "Usual reply". Open leads is withheld from agents by design, but it is missing for the owner too |
| Panel: "Deals · last 6 months" bar chart | Not built | nothing draws it; `profileStats` has no monthly series |
| Panel: Badges | Built | |
| Panel foot (agent): "Transfer a lead to X" | Partly | the button is there but goes to My leads, not to the transfer form |
| Panel foot (agent): "Ranking" | Not built | a "Team wall" link sits in its place |
| Panel foot (agent): "X is away today and cannot take a lead." | Built | shown for someone on leave |
| Panel foot (owner): "See X's leads" | Built | |
| Panel foot (owner): "Attendance" | Built | |
| Panel foot (yourself): "Open my profile" | Built | |

---

## Per page

| Page | Items | Built | Partly | Not built |
|---|---|---|---|---|
| 12. pipeline | 23 | 15 | 6 | 2 |
| 13. calling | 41 | 30 | 5 | 6 |
| 14. all-leads | 52 | 19 | 7 | 26 |
| 15. transfers | 53 | 29 | 9 | 15 |
| 16. calendar | 69 | 18 | 15 | 36 |
| 17. tasks | 57 | 31 | 11 | 15 |
| 18. projects | 24 | 16 | 3 | 5 |
| 19. project | 30 | 21 | 1 | 8 |
| 20. manage-projects | 30 | 24 | 4 | 2 |
| 21. home-banners | 25 | 4 | 8 | 13 |
| 22. team | 37 | 24 | 8 | 5 |

## Where the design asks for something the server cannot supply

Each of these is marked **Not built** above; this is the list of what has to be
added behind the screen before the screen can be finished.

| Page | What is missing | Where |
|---|---|---|
| Calendar | No endpoint changes a meeting's day or time | `server/src/http/routes/v2.ts` has `POST /meetings` and `PATCH /meetings/:id/result` only |
| Calendar | No endpoint deletes a meeting, although `meetings.deleted_at` exists | same |
| Calendar | No reminder field, no multi-day / all-day field on create | `meetingSchema`, `v2.ts` |
| Calendar | No no-show counter, so "red flag after 2" cannot be computed | `meetings` has `result` but nothing aggregates it per contact |
| Transfers | Agent languages are read from `users.locale`, not `users.languages` | `server/src/v2/transfers.ts:370` |
| Transfers | No deals-this-month or reply-time per agent on `/transfers/who` | same |
| Transfers | No "Remind" action | no route |
| Transfers | Nothing compares an agent's open leads to their desk maximum | `desks.max_open_leads` is written but never read here |
| All leads | No "added" date filter | `listSchema`, `server/src/http/routes/my-leads.ts` |
| All leads | No "going cold" tab | `server/src/leads/tabs.ts` |
| All leads | No bulk reassign endpoint (one lead at a time) | `my-leads.ts` |
| Team | `/api/v2/team` sends no desk, no monthly deals/meetings pair, and no six-month series | `server/src/http/routes/v2.ts:648` |
| Projects | `opportunities.project_name` is free text, so a project card cannot count its leads by id | `projects` / `opportunities` |
| Projects | No video field on a project | `projects` table |
| Home banners | No label, button text, or audience column on `banners` | `server/src/v2/banners.ts`, migration |
| Manage projects | `projects.name` has no unique key, so two rows can share a name — which is what the duplicated project filter is | `server/migrations/0002_ingestion_messaging.sql:187` |

## The faults the owner named

| What the owner said | Confirmed | Where it is in this file |
|---|---|---|
| The calendar accepts a plan in the past | Yes | §16, "Past dates refused" — no `min`, no check in `save()` |
| A plan cannot be edited or deleted | Yes | §16, "Change day or time" and "Delete" — no control and no endpoint |
| A cancelled plan still looks like a normal plan | Yes | §16, last row — `done: Boolean(meeting.result)` treats all five results alike |
| A new task's default time is not the next free time | Yes | §17 — hard-coded "10:00" |
| The error message blames the day rather than the time | Yes | §17 — "This day is in the past." for a past time, printed under the title field |
| Project filters show only "Sei Saadiyat", twice | Yes | §14, "Project filter" — the list is the `projects` library table, undeduplicated, not the projects the leads carry |
| Transfers: no language filter | Yes | §15, "Language filter chips" — hidden unless two locales exist |
| Transfers: no "Best match" | Yes | §15 — the first row says "Fewest leads" |
| Transfers: agent languages not real | Yes | §15 — `u.locale AS language` |
| All leads: no agent filter | Partly | §14 — there is one, but only on the All tab, and the page opens on Today |
| All leads: no tick boxes | Yes | §14 — phone branch only |
| All leads: no "Move N leads" panel | Yes | §14 — phone branch only, and simplified there |
| All leads: no row-click side panel | Yes | §14 — a row click opens the full lead page |

TOTAL: 441 items — 231 Built, 77 Partly, 133 Not built.
