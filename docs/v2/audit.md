# /v2 against the design — the honest count

*14 November. Emir tested `/v2` by hand as owner, admin and agent and said
many pages are simpler than the design. They are. This is the count, item
by item, from `design/web/research/sage.md`: every block, field, button,
dialog, rule and piece of wording it names.*

**A page existing does not make it built.** Nothing here was marked Built
because the page loads.

## The totals

| | Items | Built | Partly | Not built |
|---|---|---|---|---|
| Pages 1–11 · login → incoming | 410 | 219 | 63 | 128 |
| Pages 12–22 · pipeline → team | 441 | 231 | 77 | 133 |
| Pages 23–34 · wall → team activity | 399 | 178 | 131 | 90 |
| Pages 35–44 · reports, settings, globals | 433 | 181 | 103 | 121 |
| **Total** | **1,683** | **809** | **374** | **472** |

**48% built as drawn. 846 items — half of the design — are missing or
partial.**

The detail is in `audit-1.md` to `audit-4.md`, one row per item, grouped by
page, each with what is missing and whether the server can even supply it.

## What is close, and what is not

**Closest to the design:** add-lead, notifications, the business card,
settings, import, team activity, the power dialler, desks, manage projects.

**Furthest:** the lead page (47 of 99 items absent), the calendar, all
leads, home banners, the feedback inbox and form, my profile, the agent's
attendance screen, and login — which is the first screen anybody sees and
was last written down as "Done, unchanged".

## The faults that are not "simpler", but wrong

1. **Calls and WhatsApp taps are recorded only in the power dialler.**
   Every other Call and WhatsApp button is a plain link. The server has the
   endpoints and only `Calling.tsx` uses them, so a call made from a lead's
   page does not exist in the dashboard, the messaging report or any
   speed-to-lead figure.
2. **The check-in question is missing from most Call buttons** — the lead
   page, My Day, the leads table, the pipeline. So "called without checking
   in" under-reports by exactly those screens.
3. **Four different rules for "how many agents"**, in four files: the
   dashboards count agents and managers; attendance counts everybody but
   the owner, so admin is an agent; Best of Homes and the wall count
   everybody, so owners are ranked as agents. That is the 14 / 11 / 12 / 17.
4. **Best of Homes contradicts itself on one screen** — the table's points
   are thirty days, the "You are 1st" chip is all time.
5. **The project filter** is filled without de-duplication from a table
   whose names are not unique, then matched as exact text against free text
   on the lead. Hence "Sei Saadiyat" twice, and a filter that can return
   nothing while leads on that project exist.
6. **The transfer form reads the wrong column** — `users.locale`, the
   language of the interface, where the design means `users.languages`.
7. **An owner opening All leads gets the agent's screen.** The tick boxes
   and the "Move N leads" panel exist only in the phone layout, so on a
   computer they cannot be reached at all.
8. **Three owner endpoints were readable by an agent** — the team
   structure, the automation switches, the take-back rules. Shut, with a
   test.
9. **Every page has lost its sub-line on the computer** — the grey line
   under the title that the design gives all 44.
10. **The Won form records no money**: no price, no amount paid, no
    receipt. And winning a deal awards the agent nothing.
