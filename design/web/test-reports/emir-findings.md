# Findings · tester "emir" (owner, Founder & CEO) · Wed 11 Nov 2026 14:55

Pages: login/index, owner-home, dashboard, all-leads, import, team-attendance, team-live, team-activity, messaging-report, feedback-inbox.
Jobs done by clicking (playwright, 1440x900): sign in with wrong input, two-step, agent sign-in · clear "Needs you now" · every number → its list · period switch · no-next-step → move 12 from Sultan to Tej (asks twice, Undo) · side panel · filters + clear · import 6 steps, all 3 duplicate options, undo · late / absent / outside actions · leave approve / refuse with reason / change answer · Team live · Team activity (sign out device, review) · messaging report · feedback inbox (plan, fix, reply) · owner page as agent.

Format: severity · page · what I did · what happened · what a broker expects · status

## Blocker
(none)

## Major
1. Major · all-leads · clicked "Sultan 31 / Move 31", "New 456", "Bassam 44", "The Archive 115", "Import (Excel) 498" on the dashboards · the list said "6 of 863", "7 of 863"… (only the drawn rows were counted) · the same number I clicked · FIXED (totals per agent, stage, project, source, added date; foot says the demo draws the first N).
2. Major · all-leads · job "move 12 no-next-step leads from one agent" · no agent had 12; "Select all" only took the 5 drawn rows; after the move the rows stayed under the "Agent: Sultan" filter and counts did not change · Select all 12 → Move 12 leads → list and counts follow, Undo puts them back · FIXED (No next step by agent = 31: Sultan 12, Bassam 9, Shan 6, Rocky 2, Yuliia 1, Nelson 1; agent you move from cannot be picked as target).
3. Major · owner-home vs dashboard · switched period to Week / Month / Year · two different truths (calls 612 vs 1,306 · 2,140 vs 5,380 · 24,860 vs 50,900; meetings 14/23, 62/67, 540/572; units 1/3, 4/27, 38/190) · one number · FIXED (owner-home uses the dashboard values, which add up in its team table).
4. Major · owner-home · "Needs you now" · the spec's 6th item "blocking bug → Open" was missing · see the bug that stops an agent · FIXED (row added, opens feedback inbox; count 6; rows made slimmer so all fit).
5. Major · owner-home · cleared items (gave Incoming leads, marked Bassam on leave, approved transfer) · the rest of the page still said "3 wait in Incoming", "1 Absent", "1 waits for your approval"; after giving the VIP the Incoming row still listed Omar Khan · page follows my action · FIXED (badges, legend, Bassam's row, Incoming row and Give dialog update; Undo restores).
6. Major · owner-home · leave dialog → Refuse · no reason asked (team-attendance asks one) · refuse always with a reason · FIXED (3 reasons, Save stays off until chosen, reason in the toast).
7. Major · owner-home / dashboard · clicked "27 New leads", "809 Open", "Bassam's 44 leads" (Homes AI line) · opened the full 863 list · the filtered list · FIXED (?added=today, ?tab=open, ?agent=bassam; new filters in all-leads).
8. Major · import · undo the import · headline said "3 leads" but the table still showed +38 each and old open counts · table follows · FIXED.
9. Major · messaging-report · Week / Month · header totals (612 / 2,480 taps) did not match the per-agent table (660 / 2,508) · same numbers · FIXED.
10. Major · team-attendance · filter "Absent" → Mark as leave · counters stayed 1 absent / 1 leave and the table went empty · counters follow, list comes back · FIXED.

## Minor
11. Minor · all-leads · searched phone 0505550101 (local format) · nothing found (same bug as feedback #1035) · finds +971 50 555 0101 · FIXED.
12. Minor · owner-home, dashboard, team-live · clicked "1 Late", "1 Absent"… · opened attendance unfiltered · that group · FIXED (team-attendance.html?show=late etc.).
13. Minor · owner-home, dashboard · overdue numbers went to tasks.html#follow-ups (another owner's page, own follow-ups) · the 9 overdue leads · FIXED (all-leads?tab=overdue, per agent too).
14. Minor · owner-home · Year selected · "104 WhatsApp · 28 Telegram" and hourly bars still today, label "Unit booked" for 190 · clear labels · FIXED ("Today:" prefix, "Bars: today by hour", plural).
15. Minor · owner-home, dashboard · column "Calls · 7 days" shows today's number · FIXED ("Calls today · 7 days", follows the period on dashboard).
16. Minor · owner-home · absent panel · status chip stretched and clipped · FIXED.
17. Minor · owner-home · leave dialog · "Shan 14 Nov · 1 working day" but 14 Nov is Saturday (day off in My attendance) · FIXED wording ("Sat 14 Nov · 1 day"). The request itself on a day off stays (sage data).
18. Minor · dashboard · Going cold rows cut "5 going c…"; number 12 did not drop after "Move 31" · FIXED.
19. Minor · import · project default was "The Archive for all" although the file has a project column; Arabic desk said "3 agents" (1 on leave) and showed Rocky as "Dubai off-plan" · FIXED (default "Keep the project from the file", "2 of 3 working").
20. Minor · team-attendance · Answered list text cut ("Annual · Wed 18 – Fri …") · FIXED (shorter text).
21. Minor · team-activity · "1 sign-ins today"; "It was them" could not be taken back · FIXED (plural, Undo in toast).
22. Minor · team-live · Telegram total never moved while agent rows did · FIXED.
23. Minor · login · no "Forgot password?" · FIXED (link, tells who sends the reset link). index.html = login.html.
24. Minor · owner-home · Give dialog for "3 waiting leads" gives all to one agent with no word about it · FIXED (hint + points to Incoming for sharing).

## Open (not fixed)
- Major · app.js (shared) · agent signs in, then opens dashboard.html without ?as=agent · full owner page shows and the saved role flips to owner · agent must see "Only for owners and admin" · logged in shared-issues.md (I do not own app.js). With ?as=agent all 9 owner pages show the block.
- Minor · app.js · sidebar badges and bell (Incoming 3, Attendance 2, bell 5) do not change after I act on a page · shared-issues.md.
- Minor · data (sage.md) · Won stage = 4 all time, but units booked = 27 this month / 190 this year; open leads per agent sum 234 vs 809 open; by project 259 of 863. Kept as the brief orders ("be consistent inside one page"); needs a data decision from the leader.
- Minor · all-leads · only 46 rows are drawn; "Next" is a demo toast; "Open full page" always opens the same lead.html.
- Minor · owner-home · the bug row has no "done" action here (Open goes to the feedback inbox).

## Not tested
Arabic / RTL, real file parsing, keyboard-only use, screen widths other than 1440, the phone/tel links, pages owned by others (incoming, transfers, tasks, calendar, lead) beyond checking that my links point at them.
