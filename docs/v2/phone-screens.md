# The 59 phone screens

*13 November 2026. Every screen in `design/screens/` (the 59 phone
prototypes; `Web_*` and `Dark_*` are not phone screens) against what is now
built, at 390 × 844.*

**33 Done · 25 Partly · 1 Not done.**

"Done" means the layout, the order, the wording and the buttons match the
prototype. "Partly" means the screen is built and usable and something the
prototype draws is missing — in nearly every case because **no field in the
database holds it**, and the rule of this repository is to leave a blank
rather than write a number that reads true. Each one says what is missing
and what it would need.

Colour is not a difference: the prototypes are in the retired green palette
and the build is orange, which is the master prompt's §1.1 mapping.

The side-by-side pictures are in `docs/v2/phone-proof/` — one per screen,
the prototype on the left, the build in the middle, the build in dark on the
right.

---

## Home and leads

| Phone screen | Address | State | What is missing |
|---|---|---|---|
| `Main.dc.html` | `/v2` agent | **Partly** | The check-in pill is in now. Still missing: the quick-actions, colleagues and projects strips, the stage donut, the notification card, the "are you back in the office?" interrupt and the VIP two-tap refuse. |
| `OwnerHome.dc.html` | `/v2` owner | **Partly** | "Team today" read `2In office1Late1Outside1Not marked` as one line and is a 2×2 grid now. The consequence line under each "Needs you now" row needs the endpoint to send it. |
| `OwnerDashboard.dc.html` | `/v2/dashboard` | **Partly** | The "Team today" table ended 282px off the right edge and now fits. Missing: the stage donut, the attendance card, the four period tiles. |
| `Leads.dc.html` | `/v2/leads` agent | **Done** | — |
| `AllLeads.dc.html` | `/v2/leads` owner | **Done** | "Incoming" as a move target is left out: no endpoint un-assigns chosen leads. |
| `Lead.dc.html` | `/v2/leads/:id` | **Partly** | The number is 36px and the biggest text on the screen. Missing: the seven "What they want" rows as edit sheets, and Purpose / Timeline / Payment — nothing writes those columns and the endpoint does not send them. |
| `Notes.dc.html` | the lead's Notes tab | **Partly** | It said "not built yet · phase 4" while `/api/notes` was complete. Now real: type chips, quick phrases, pin, edit, reminders, attachments, voice notes. Missing: transcripts, "Emir AI found these", the four named folders — nothing stores any of them. |
| `AddLead.dc.html` | `/v2/leads/new` | **Done** | Two chips (**Other** source, the owner's **Old client**) need new source values on the server. |
| `Incoming.dc.html` | `/v2/incoming` | **Done** | — |
| `OwnerAssign.dc.html` | `/v2/vip` | **Partly** | Had no address at all; built from the stub. No endpoint lists VIP hand-offs, so "given 14:20", "accepted in 2 min" and "24 min left of 30" are absent rather than invented. |
| `Pipeline.dc.html` | `/v2/pipeline` | **Done** | Was a sideways kanban showing one and a half of seven columns. |
| `TransferLead.dc.html` | sheet on the lead | **Done** | A VIP lead now shows the reason and Close: the server refuses a VIP transfer, so the form could only ever have failed. |

## Calling, the plan, attendance, messages

| Phone screen | Address | State | What is missing |
|---|---|---|---|
| `Dialer.dc.html` | `/v2/calling` | **Partly** | Two headers fixed; the number is 34px and the biggest text; the five outcomes are one bottom sheet. Missing: a replacement number on "Wrong number", and the seven-mode meeting result (receipt, unit, price). |
| `Calendar.dc.html` | `/v2/calendar` | **Partly** | The grid computed to **26 pixels wide** and the week was a 640px hour grid dragged sideways. Both fixed, and the three dead "new" buttons now open a working New plan sheet. Missing: the lead picker, the clash warning, multi-day and remind-me. |
| `Tasks.dc.html` | `/v2/tasks` | **Partly** | The row menu, edit sheet and two-step delete are in. Missing: the design's task categories, which the table has no column for. |
| `FollowUps.dc.html` | `/v2/tasks?tab=follow-ups` | **Partly** | It pushed the whole document to **803px** and carried the floating bar off the screen; it is cards now and the four period tabs, which computed to width 0, are back. |
| `Attendance.dc.html` | `/v2/attendance` agent | **Partly** | Missing: the office Wi-Fi name and the shift end (not stored), Share-my-location, and the leave allowance. Still three tabs where the prototype is one column — a rewrite of a 1,600-line screen, written down rather than done quietly. |
| `TeamAttendance.dc.html` | `/v2/attendance` owner | **Partly** | The last-eight-days grid was 110px off-screen and fits now. |
| `WorkOutside.dc.html` | sheet on Attendance | **Partly** | Missing: the with-who picker and "Are you back in the office?" — neither is stored. |
| `LeaveRequest.dc.html` | sheet on Attendance | **Done** | The allowance line ("14 annual left") is blank: nothing holds an allowance. |
| `LeaveApprovals.dc.html` | owner tab | **Done** | — |
| `Transfers.dc.html` | `/v2/transfers` | **Done** | "Remind" has no endpoint. |
| `Search.dc.html` | `/v2/search` | **Done** | — |
| `Notifications.dc.html` | `/v2/notifications` | **Partly** | Missing: the verb line and the deep-link state, which the row does not carry. |
| `Inbox.dc.html` | `/v2/inbox` | **Done** | — |
| `Chat.dc.html` | a thread in the inbox | **Done** | Had two headers; the shell now draws none on a screen that takes the whole attention. |
| `Email.dc.html` | `/v2/email` | **Not done** | **Needs a decision.** The phone design is a rendered email to a VIP lead, the computer design is a mailbox, and the build is a library of outbound emails. Three different screens under one name. |
| `Templates.dc.html` | `/v2/templates` | **Partly** | Missing: Meta's approval state per template, which we do not sync yet. |

## Projects, the team, the person

| Phone screen | Address | State | What is missing |
|---|---|---|---|
| `LiveProjects.dc.html` | `/v2/projects` | **Done** | — |
| `ProjectDetail.dc.html` | `/v2/projects/:id` | **Partly** | No **Video** send option: the endpoint returns no media, so there is no URL. |
| `ManageProjects.dc.html` | `/v2/projects/manage` | **Done** | An agent now gets the design's "Only for owners and admin" card with a way out, instead of a red line. |
| `TeamDirectory.dc.html` | `/v2/team` | **Done** | — |
| `Colleague.dc.html` | `/v2/team/:id` | **Done** | It had neither a phone nor a WhatsApp button. |
| `TeamWall.dc.html` | `/v2/wall` | **Done** | — |
| `Leaderboard.dc.html` | `/v2/best` | **Partly** | The nudge line is back, computed from the real point rules. No **Show on office TV** (no TV mode exists) and the period is 30 days where both designs say a week. |
| `Profile.dc.html` | `/v2/profile` | **Done** | The design's hub of nine rows, on the phone only; the computer page is untouched. |
| `PersonalInfo.dc.html` | `/v2/me` | **Done** | Had no address. Full name is read-only for an agent because the server refuses it, and the screen says why. |
| `Security.dc.html` | `/v2/settings/security` | **Done** | Had no address. The device list, "sign out all others" and two-step are **stated as not available** rather than drawn and dead. |
| `DigitalCard.dc.html` | `/v2/card` | **Done** | The 420px artboard did not fit a 390px screen. |
| `Feedback.dc.html` | `/v2/feedback` | **Partly** | The screen had no name at all on a phone. No ticket number and no +15 points: neither exists. |
| `AskAI.dc.html` | `/v2/ai` | **Done** | The composer sat under the floating bar. |
| `Settings.dc.html` | `/v2/settings` | **Done** | Rebuilt as the design's list of sections. The 216px side nav left 142px for the panel at 390px. |
| `SettingsNotifications.dc.html` | `/v2/settings/notifications` | **Done** | — |

## The owner's tools, the menu, sign-in

| Phone screen | Address | State | What is missing |
|---|---|---|---|
| `OwnerLive.dc.html` | `/v2/team-live` | **Partly** | The six-column table is cards. Missing: TV mode, "Meetings booked" as the third tile, the stacked hourly chart. |
| `TeamActivity.dc.html` | `/v2/activity` | **Done** | — |
| `OwnerMessaging.dc.html` | `/v2/messaging` | **Done** | The page was **697px wide and scrolled sideways**. |
| `OwnerFeedback.dc.html` | `/v2/settings/feedback` | **Partly** | An urgent report's title was squeezed to 52px and ran eighteen lines, one word each. Missing: Plan it / Mark fixed, the Bug/Idea chip, the export. |
| `Import.dc.html` | `/v2/import` | **Done** | Steps 2, 3 and 5 are CSS-only: the preview has no import to run. |
| `Automations.dc.html` | `/v2/automations` | **Done** | The closing line *"The CRM never sends WhatsApp by itself"* is **not printed** — see the question below. |
| `Desks.dc.html` | `/v2/settings/desks` | **Done** | — |
| `SettingsTeam.dc.html` | `/v2/settings/team` | **Partly** | The third card sat off the right edge, unreachable. Missing: the person sheet and the invite sheet — the server only offers a role change. |
| `SettingsAttendance.dc.html` | `/v2/settings/attendance` | **Done** | The save bar's note computed to 37 × 199 pixels. |
| `AISettings.dc.html` | `/v2/settings/ai` | **Done** | No key value is shown anywhere. |
| `Company.dc.html` | `/v2/settings/company` | **Partly** | No logo upload: no endpoint. |
| `Health.dc.html` | `/v2/settings/health` | **Done** | Shows connected / not set up, never a credential. |
| `OwnerBanners.dc.html` | `/v2/settings/banners` | **Partly** | Four controls squeezed each headline to 90px. Missing: images, label chips, dates, audience, drag-to-reorder — the table has none of those columns. |
| `InstallGuide.dc.html` | `/v2/settings/phone-app` | **Partly** | The design's closing "tap a notification, it opens…" table is in, read out of the link each alert really stores. Missing: the drawn Safari/Chrome mock-ups and the lock screen. |
| `Menu.dc.html` | `/v2/more` | **Done** | Three tiles across in the design's three blocks. It was two across grouped by topic and 2,256px tall. |
| `Login.dc.html` | `/login` | **Partly** | The language switch and "no app to download" are in — both designs have them and the build had neither. The page is still in the old green palette, and the computer design's six-digit second step is not built: both are questions 16–18 in `docs/decisions-to-confirm.md`. |

---

## What I need from you

The full list is in `docs/v2/phone-questions-{a,b,c,d}.md`. The ones that
block a screen rather than polish it:

1. **`/v2/email` is three different screens under one name.** Which one do
   you want?
2. **Automations' closing line.** The design prints *"The CRM never sends
   WhatsApp by itself."* The master prompt's Workflow A sends the welcome
   template automatically. Which is true?
3. **Best of Homes is monthly; both designs say weekly.** Change the
   period, or change the design?
4. **The owner's "All leads" menu row opens Today, not the whole book.**
   One line fixes it, and it changes the computer too.
5. **Four small server jobs would finish four screens:** project media (the
   Video send option), your own sessions (the device list), a weekly period
   for the leaderboard, and a VIP hand-off list (the times on `/v2/vip`).
