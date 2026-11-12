# Findings · tester Yuliia (agent) · pages: calendar, tasks, attendance, projects, project, team, team-wall, best-of-homes, notifications, profile, digital-card, feedback, search, homes-ai, install-guide

Format: severity · page · what I did · what happened · what a broker expects · status

## attendance.html
1. Major · attendance · state "Not checked in", clicked "Check in" at 14:55 · hero said "Checked in · on time · In office since 08:55 · 6 h 00 min worked" · the real time (14:55, late, 0 h worked) in hero, log, week strip and top pill · FIXED
2. Major · attendance · asked leave 24–26 Nov twice · two identical requests were saved, "annual days left" ignored days already asked · second request refused with "You already asked for these days", days left count pending days · FIXED
3. Minor · attendance · sent a new leave request, opened Month · new days were not striped "Leave asked"; cancel only cleared 18–20 Nov; tile "3 days asked" never changed · month, week and tile follow the waiting list · FIXED
4. Minor · attendance · checked out, opened Month → today · detail still said "Check out: Not yet" · shows 14:55 · FIXED

## calendar.html
5. Major · calendar · gave result "Showed up → Send the offer, Fri 13 Nov 11:00" and "No-show → try again Tomorrow 12:00" · toast only; nothing appeared in the calendar, so I was not sure the next step was saved · the next step / the new meeting is a real plan on that day (and Undo removes it) · FIXED
6. Minor · calendar · clicked "New plan" on today · dialog opened already showing the amber "This time is taken" and button "Save anyway" (default 15:00 clashes with the 15:20 VIP call) · it opens on the first free time; the warning shows only when I pick a taken time · FIXED
7. Minor · calendar · as agent made a "Team" plan, opened it · only "Hide for me", no change / delete of my own plan · the person who made the plan can change and delete it · FIXED
8. Minor · calendar week view · two plans side by side show only "15:20 Call" / "15:30 Send" · full title on hover · FIXED (title tooltip)
9. Minor · calendar · showed-up form let me save a next step with no time · asks "Choose a time for the next step." · FIXED
Checked OK: past day and past time refused with clear text, clash warning + "Save anyway", move plan, delete in two clicks with Undo, all five results validate (paid ≤ price, receipt needed, who cancelled, who asked), team plan as agent = Hide for me, as owner = Change / Delete, Month / Week / Day, dark theme.

## tasks.html (Tasks + Follow-ups)
10. Major · tasks · ticked the task "Follow up Sara Nunes" (overdue) · it went to Done with no question; Follow-ups tab still showed Sara as overdue · the same "What happened with Sara?" dialog, and both lists agree afterwards · FIXED (also for "Send payment plan to Marco")
11. Major · follow-ups · clicked "Call" on a row · plain tel: link: on a computer nothing visible happens, no check-in question, nothing logged · the normal Call dialog (number + QR, logged, check-in question when not checked in); WhatsApp follow-ups get a WhatsApp button with the ready-message flow · FIXED (page now loads lead-kit.js)
12. Minor · follow-ups · "Booked a meeting" · toast said "it is in your Calendar" but nothing new appeared anywhere · the meeting is added to Tasks on that day; text says "in your tasks and calendar" · FIXED on this page (calendar.html keeps its own demo data)
13. Minor · tasks · after finishing Sara's follow-up the right card still said "Follow-ups overdue 1 · Sara Nunes" · count follows the list, link opens the Overdue tab · FIXED
Checked OK: new task validation (empty text, past day, past time, meeting needs time), Change, Move one day later (skips the weekend), Delete in two clicks + Undo, meeting task asks the result only after its time, Done / To do switch, week strip counts, all four follow-up answers with required next step / reason, owner sees the "whose tasks" picker.

## projects.html / project.html
14. Major · project (Damac Islands, Shahrukhz, Valia; also owner view) · opened any project that is not The Archive · big number "Your leads here" counted up to 24 (the Archive number) while the line under it said 17% of 52 and the table showed 2 leads; owner saw "Team leads 24" · the right number per project (9 / 11 / 6, owner 115 / 64 / 52 / 28) · FIXED
15. Major · project Damac Islands · read the facts row · "Unit types" was cut off at the card edge ("Townhouse 4BR · Villa 5BR · Vil") · full text on two lines · FIXED
16. Major · project · clicked "Call" in "Your leads in this project" · plain tel: link, no number/QR dialog, no check-in question, nothing logged · same Call dialog as everywhere · FIXED (page loads lead-kit.js)
17. Minor · project · sent the brochure to Sara, then to Elena · both got the same link code "-4821" although the page says each lead gets an own link · code comes from the lead · FIXED
Checked OK: search by developer / area, empty state + "Show all", Launching soon filter, Hidden only for the owner, send without a lead refused, Send button in a lead row picks the lead, WhatsApp / Telegram wording ("opened … you press send"), "What happened?" needs an answer and a Lost reason, dark theme.

## team.html / team-wall.html / best-of-homes.html
18. Minor · best-of-homes · read "vs last week" against the Last week tab · arrows did not match the two lists (Talha "+2" but was 2nd, Yuliia "−2" but fell from 1st to 4th, Nelson / Olga / Tej "same" but each moved up one) · arrows match the lists · FIXED
19. Minor · best-of-homes · switched to "Last week" and "November" · right card still said "You are 2nd" and the podium chip "Live · 4 days left"; column still "vs last week" · "You were 3rd last week" / "You are 3rd in November", chip "Finished" / "19 days left", column "vs week 44" / "vs October" · FIXED
20. Minor · best-of-homes (owner) · "10,500 points given" · the ranking adds up to 10,200 · FIXED
21. Minor · best-of-homes · 3rd place block on the podium was cut at the bottom of the dark card · card is a little taller · FIXED
22. Minor · team · opened Shan · "Average reply 31 min"; the transfer form (lead-kit) says 21 min; same kind of difference for 6 more agents · same numbers as the transfer form · FIXED on team.html
23. Minor · team wall · read the posts · Yuliia's question (11:05) was shown above Abdullah's answer (11:20) in a newest-first list · newest first · FIXED
Checked OK: search "arabic" → 4 colleagues, profile panel (status, languages, sells, 4 stats, 6-month bars, badges), Phone / WhatsApp are plain links with "Nothing is logged", away colleague cannot take a lead, own card opens My profile, owner sees "See leads / Attendance"; wall: empty post refused, 500 counter, post + Undo, reactions, delete own post in two clicks, cannot delete other people's posts, owner news pinned; dark theme on all three.

## notifications.html
24. Major · notifications · read the new rows · the second line was cut exactly where the deadline is ("…goes back to In…", "answer by 18…", "answer before 2…", link "homes.me/p/archi…") although the row had free space (a hidden "Mark read" button kept the space) · the full line is readable · FIXED
25. Minor · notifications · first paint showed "5 new" for a moment, then 4 · FIXED
Checked OK: all 14 agent rows and all 14 owner rows open the right page and the right tab / dialog (leave tab, follow-ups tab, "How did it go?" panel, Unusual tab), Mark read + Undo, Mark all read, bell number follows, tabs with counts, "Only new", empty state, bell panel, dark theme.

## profile.html
26. Major · profile · emptied the name, typed BRN "12" and phone "12345", clicked Save · only the BRN turned red; name and phone looked fine, so I fixed the BRN, saved again and got the next error (one error per click) · every wrong field is red at once, with a short "Not saved yet. Check the red fields." · FIXED
27. Minor · profile / team · my phone was +971 50 123 4567 on Profile and on the business card but +971 50 555 0112 on the Team page; reply time 6 min vs 5 min; Emir's phone differed between Team and his card · one number everywhere · FIXED (team.html + profile.html)
Checked OK: BRN 4–6 digits only, at least one language, "WhatsApp is the same number" switch, completion bar says what is missing, remove photo in two clicks, password rules (old needed, ≥ 8, the two must match, must be different), sign out one device in two clicks, sign out all others, owner two-step switch asks twice, dark theme.

## digital-card.html
28. Minor · business card · made mistakes in Details, clicked Next twice, then fixed the fields · two red "Fix the red fields first" messages stayed on the screen for ever (also on the Download step) and covered the "Back" button · the message goes away by itself · FIXED
29. Minor · business card · switched on "Show safe area" · the blue "keep text inside" line cut through my name, the company name and the QR code, as if the card was wrong · the line sits just outside the text · FIXED
Checked OK: three designs, Compare, flip (button and click), all detail fields update the card live, validation (name, BRN, phone, email), cannot jump to Download with wrong details, long name and long email still fit, WhatsApp second number adds a line, switches (tagline, QR, corners, company), mm / inch size, 4 downloads + "Download all 4", public link switch + copy, owner gets his own details, address "Floor 16, Office 12" and "Emigeo Homes Real Estate LLC".

## feedback.html
30. Minor · feedback · sent my first report · got ticket #1043, but the spec and the owner's notification ("Bug report · #1042 · Rocky: the call button does nothing") speak about #1042, which was not in "My reports" · the new report is #1042 · FIXED
31. Minor · feedback · sent a "Blocking my work" report, clicked "Write another" · urgency was still "Blocking my work" (the next small idea would alert the owners at once) · urgency goes back to Normal · FIXED
32. Minor · feedback · removed one of 3 screenshots, tried to add another · "3 screenshots is the most" although only 2 were attached; names repeated · counter follows the list · FIXED
Checked OK: title and text required with clear messages, type changes the question, screenshot (button and paste), voice note record / stop, voice can replace the text, urgency note, thank-you state with +15 points, new row on top of My reports, owner sees the inbox link, dark theme.

## search.html
33. Major · search · searched "valia", pressed Enter on the project (also clicked "The Archive", "Damac Islands") · every project result opened The Archive · each result opens its own project · FIXED
34. Minor · search · typed Khalid's number as 050.555.0101 · "Nothing found · It is a new number" → I would add a duplicate · dots work like spaces and dashes (all other forms already worked: +971…, 050…, 00971…, 971…, with spaces, dashes, brackets, last 7 digits) · FIXED
35. Minor · search · typed "valia" as agent · list showed "Fatima Al Zaabi · This lead is with Yuliia": another agent's client list can be browsed by project · other agents' leads are found only by name or by the full phone number (to stop duplicates), still shown as "with Yuliia" only · FIXED
36. Minor · search · typed a colleague's name ("Talha") · "Nothing found · Add as a new lead" · colleague shows as a result and opens the Team page · FIXED
37. Major (shared, NOT fixed, app.js) · top-bar search (Ctrl K) · typed 0505550101 · "Nothing found · Add as a new lead" although it is Khalid's number and the footer says "Any phone format works" · logged in shared-issues.md
Checked OK: chips with counts, Recent, highlighted match, VIP tag, "Free in Incoming", empty state with "Add as a new lead" (carries the phone) and "Ask Homes AI", ?q= link, Enter opens the first result, owner sees every lead with the agent name.

## homes-ai.html
38. Major · Homes AI · clicked "What is the payment plan of Valia?" under "You asked before", pressed Ask · got a WhatsApp draft for Marco about The Archive (wrong answer, any question with the word "payment" did this); the other two old questions and all three owner ones gave "This is a demo…" · each old question has its own right answer with links (Valia 80 / 20, Ahmed in Riyadh 19:00, Elena summary; owner: 27 units by agent, Talha vs Rocky, leads by project) and one click asks it · FIXED
39. Minor · Homes AI · asked something it does not know · "Try one from the list under the chat" but the list was hidden after the first question · the list comes back · FIXED
40. Minor · Homes AI · "When is my next meeting?" was not understood · answers with today's plans · FIXED
Checked OK: empty question error, 5 "Try asking" chips per role, answers carry links to the right pages, draft text says "I did not send anything … press send yourself", Copy, New chat, scope line (own leads / whole team), dark theme.

## install-guide.html
41. Minor · install guide · clicked the rows of "Tap a notification, it opens…" · "How did it go?" opened the plain calendar (not the result dialog), "VIP lead from Emir" opened Marco's lead page instead of the VIP card, owner "VIP lead not called" opened the Waiting tab, "Client opened your link" opened Notes · each row opens what its text says (calendar.html#result, my-day.html, incoming.html#vip, lead.html#timeline) · FIXED
42. Minor · install guide · the sample phone alerts were cut ("call wit…", "planned f…") · full text on two lines · FIXED
Checked OK: iPhone 5 steps (iOS 16.4+, Safari only) / Android 4 steps switch, QR, "Turn on notifications" → "Notifications are on · test sent" → "Send another test", link to alert settings, owner sees "9 of 13 people have notifications on".

## all pages
43. Minor · tasks (dark theme) · the chosen day in the week strip looked like every other day · orange ring on the chosen day · FIXED
44. Minor (shared, NOT fixed) · every page · toasts pile up bottom-left and in dark theme have the colour of the cards · shared-issues.md
45. Minor (shared, NOT fixed) · sidebar badge "Follow-ups 1" and the top pill text do not follow what I do on the page · shared-issues.md
46. Major (shared, NOT fixed, lead.html is another tester's page) · "Open the lead" from calendar, tasks, project, search, notifications always opens Marco Bellini · shared-issues.md

## Not tested
- Real file upload, real clipboard paste of a screenshot, real microphone, real PDF / PNG download, real tel: / wa.me hand-off (the demo only shows toasts).
- Keyboard-only use and screen readers; Arabic / RTL; screens narrower than 1440 px (sidebar rail).
- Homes AI with free questions beyond the demo list.
- Date pickers were filled by script, not by clicking the browser's own calendar popup.
- Owner view was checked on every shared page for layout and owner-only parts; owner jobs were not played end to end.

## Totals
Blocker 0 · Major 14 (12 fixed, 2 in shared files / lead.html, logged) · Minor 32 (30 fixed, 2 shared, logged).
