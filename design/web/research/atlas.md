# Atlas — what goes where on the web dashboards

**Verdict on the five trials:** four open with 8 equal number tiles, so nothing leads; that reads as "old". Style 3 (bento, big "Needs you now", calls by hour) is the right base. Add Style 5's "vs yesterday" deltas and pipeline strip. Style 2's dark becomes a theme.

## 11 rules

1. **12-column grid, 16 px gaps, 24 px card padding, one radius (22).**
2. **Bento, not tile rows.** 6–8 cards per screen, sized by importance. One hero card is at least 2x any other.
3. **Top-left = the action.** It answers "what do I do now?", not a statistic.
4. **Three number sizes only:** hero 64–72 px, card 32–40 px, table 14–15 px. Labels 13 px muted.
5. **No bare numbers.** Each has a delta ("▲ 4 vs yesterday") or a state ("3 waiting").
6. **Charts:** bars for calls by hour, one segmented bar for pipeline and attendance, sparklines in table rows. No pies, gauges, 3D, dual axes. Max 3 charts per screen.
7. **Colour means status only.** Neutral surfaces, one accent for the main button and hero. Red = late/overdue, amber = warning, green = good, always with a word or icon.
8. **Everything is clickable.** Each number opens its filtered list; each alert row has one button with one verb (Give, Approve, Answer).
9. **No scroll at 1440x900**; secondary lists sit below the fold.
10. **Empty space is deliberate:** 32 px between zones, no divider lines inside cards, 44 px table rows (36 px in the team table).
11. **Motion carries meaning:** count-up on load (400 ms), 150 ms hover, a soft pulse on a row that changed, live countdowns. Skeletons, not spinners.

## Owner Dashboard — 1440x900

Sidebar 232 px; content 12 columns. Top bar: search, period switch (Today / Week / Month / Year), "Live · 14:55", bell, Add lead.

**Row 1 (300 px)**
- **Cols 1–5: "Needs you now" (hero, dark card).** Giant count, "oldest waits 42 min". Up to 5 rows in this fixed order: VIP not called, transfer approvals, leads waiting in Incoming, leave requests, absent agent. One button each.
- **Cols 6–9: "Calls today".** Number 72 px with delta. Bar chart of calls per hour, current hour highlighted. Footer: speed of first contact (median minutes).
- **Cols 10–12: two stacked tiles.** "New leads 27 · 3 in Incoming" and "Meetings 5 · Units booked 1 (Talha)".

**Row 2 (104 px)**
- **Cols 1–12: Pipeline strip.** One segmented horizontal bar: New, Called, Interested, Meeting, Offer, Won, with Lost set apart in grey. Count and % per stage; click opens the filtered list.

**Row 3 (348 px)**
- **Cols 1–8: "Team right now" table.** Above it one attendance bar (in office / late / outside / leave / absent). Columns: agent, status, check-in time, calls today (7-day sparkline), open leads (bar, red above the desk maximum), overdue follow-ups. Problems sorted first.
- **Cols 9–12: "Watch list".** Four rows with numbers at 32 px: follow-ups overdue 9, no next step 31, transfers today 2 (1 waits for approval), WhatsApp taps 104 (unanswered "what happened?").

**Below the fold:** latest leads table, "VIP leads I gave", Import shortcut.

## Agent "My Day" — 1440x900

Top bar: "Good morning, Rocky", check-in pill (green "In office 08:55" / amber "Outside · back by 15:00" / red "Not checked in"), bell, Add lead.

**Row 1 (260 px)**
- **Cols 1–8: hero, three states.** (a) Not checked in: a large "Check in" card. (b) VIP lead waiting: phone number largest, name, project, owner's note, a countdown ring ("18:42 left", turning amber at 10 minutes), buttons Accept and call / I can't take it (two taps, Undo). (c) Otherwise: "Start calling · 14 leads today" with the next lead's name.
- **Cols 9–12: "Next plan".** Time in 40 px, plan type, lead, place, "in 35 min"; under it, meetings waiting for "how did it go?".

**Row 2 (96 px)**
- **Four tiles, 3 cols each:** My leads, To call today, Hot, Meetings.

**Row 3 (396 px)**
- **Cols 1–5: Call list.** Today's queue, VIP first: name, project, stage chip, client's local time, Call button. Footer shows "6 of 14 done" as a progress bar.
- **Cols 6–9: Today's plan.** Vertical timeline 09:00–19:00 (24-hour clock) with a "now" line; meetings, site visits and tasks as blocks.
- **Cols 10–12: two stacked cards.** "Follow-ups": Overdue (red count), Today, and the next three with a Done button (asks what happened). "Transfers": incoming to accept, outgoing waiting, plus "messages waiting for your update".

**Below the fold:** leads by stage, colleagues strip, live projects, AI tip, owner banners.

## 5 wow ideas that are useful

1. A VIP countdown ring that changes colour as take-back time nears.
2. A "now" line that moves across the calls-by-hour chart and the agent timeline all day.
3. Alert rows that slide out when solved, with the hero count ticking down to "All clear".
4. A command bar (press /) that finds any lead, person or screen.
5. One written sentence at the top from Homes AI: "Today is slower than Tuesday: 3 VIP leads are not called."

## 5 things to avoid

1. A row of 8 equal number tiles.
2. Pies, donuts with many slices, gauges, 3D.
3. Colour as decoration: gradients, rainbow chips, a different colour per card.
4. Dense tables as the first thing on the page.
5. Numbers with no comparison and no click.

## Sources

- https://www.lazarev.agency/articles/crm-dashboard-design
- https://www.saasframe.io/blog/designing-bento-grids-that-actually-work-a-2026-practical-guide
- https://smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/
- https://www.saasui.design/blog/saas-metric-kpi-card-ux-patterns
- https://www.basedash.com/blog/how-to-choose-the-right-chart-for-a-dashboard
- https://www.idreesworks.tech/blog/crm-dashboard-redesign-real-estate-pipeline
- https://www.visdum.com/blog/what-reps-see-vs-what-admins-see
