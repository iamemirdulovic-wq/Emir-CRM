# Every screen in v2, and where it stands

*Written 13 Nov 2026. Each row is a page in the design package and the address
it lives at. **Done** means built from its own design file, looked at in a real
browser on a computer and on a phone, in light and dark, and passing the
layout checks. **Partly** means it is there and usable but something the design
draws is missing — the reason is given. Nothing below is "not done".*

The same pages serve the phone: there is one build, and the phone layout is a
media query, not a second app. Where the design has a phone screen of its own
(`design/screens/*.dc.html`) it is named in the last column.

## The computer pages

| Design file | Address | Status | Phone screen |
|---|---|---|---|
| `my-day.html` | `/v2` (agent) | Done | `Main`, `Dark_Main` |
| `owner-home.html` | `/v2` (owner) | Done | `OwnerHome`, `OwnerDashboard` |
| `dashboard.html` | `/v2/dashboard` | Done | `Dark_OwnerDashboard` |
| `incoming.html` | `/v2/incoming` | Done | `Incoming`, `OwnerAssign` |
| `my-leads.html` | `/v2/leads` (agent) | Done | `Leads`, `Dark_Leads` |
| `all-leads.html` | `/v2/leads` (owner) | Done | `AllLeads` |
| `lead.html` | `/v2/leads/:id` | Done | `Lead`, `Dark_Lead`, `Notes` |
| `add-lead.html` | `/v2/leads/new` | Done | `AddLead` |
| `calling.html` | `/v2/calling` | Done | `Dialer` |
| `pipeline.html` | `/v2/pipeline` | Done | `Pipeline` |
| `transfers.html` | `/v2/transfers` | Done | `Transfers`, `TransferLead` |
| `import.html` | `/v2/import` | Done | `Import` |
| `calendar.html` | `/v2/calendar` | Done | `Calendar`, `Dark_Calendar` |
| `tasks.html` | `/v2/tasks` | Done | `Tasks`, `FollowUps` |
| `projects.html` | `/v2/projects` | Done | `LiveProjects` |
| `project.html` | `/v2/projects/:id` | Done | `ProjectDetail` |
| `manage-projects.html` | `/v2/projects/manage` | Done | `ManageProjects` |
| `sales-offers.html` | `/v2/offers` | Done | — |
| `team.html` | `/v2/team` | Done | `TeamDirectory`, `Dark_TeamDirectory` |
| `profile.html` | `/v2/profile`, `/v2/team/:id` | Done | `Profile`, `Colleague`, `PersonalInfo`, `Security` |
| `digital-card.html` | `/v2/card` | Done | `DigitalCard` |
| `team-wall.html` | `/v2/wall` | Done | `TeamWall` |
| `best-of-homes.html` | `/v2/best` | Done | `Leaderboard` |
| `attendance.html` | `/v2/attendance` (agent) | Done | `Attendance`, `Dark_Attendance`, `WorkOutside`, `LeaveRequest` |
| `team-attendance.html` | `/v2/attendance` (owner) | Done | `TeamAttendance`, `LeaveApprovals` |
| `team-live.html` | `/v2/team-live` | Done | `OwnerLive` |
| `team-activity.html` | `/v2/activity` | **Partly** — no 7-day sparkline and no "leads opened" column: nothing records either, and a column of plausible hours against a colleague's name is the worst thing to guess | `TeamActivity` |
| `messaging-report.html` | `/v2/messaging` | Done | `OwnerMessaging` |
| `inbox.html` | `/v2/inbox` | Done | `Inbox`, `Chat` |
| `email.html` | `/v2/email` | **Partly** — the left list is the email template library, not a mailbox. The CRM has no mailbox: email goes out from a lead's page, so nothing lists sent mail or drafts across the company | `Email` |
| `templates.html` | `/v2/templates` | Done | `Templates` |
| `homes-ai.html` | `/v2/ai` | Done | `AskAI` |
| `notifications.html` | `/v2/notifications` | Done | `Notifications` |
| `search.html` | `/v2/search` | Done | `Search` |
| `feedback.html` | `/v2/feedback` | Done | `Feedback` |
| `automations.html` | `/v2/automations` | Done | `Automations` |
| `settings.html` | `/v2/settings`, `/v2/settings/notifications` | Done | `Settings`, `Dark_Settings`, `SettingsNotifications` |
| `company.html` | `/v2/settings/company` | Done | `Company` |
| `settings-team.html` | `/v2/settings/team` | Done | `SettingsTeam` |
| `settings-attendance.html` | `/v2/settings/attendance` | Done | `SettingsAttendance` |
| `ai-settings.html` | `/v2/settings/ai` | Done | `AISettings` |
| `desks.html` | `/v2/settings/desks` | Done | `Desks` |
| `home-banners.html` | `/v2/settings/banners` | Done | `OwnerBanners` |
| `feedback-inbox.html` | `/v2/settings/feedback` | Done | `OwnerFeedback` |
| `system-health.html` | `/v2/settings/health` | Done | `Health` |
| `install-guide.html` | `/v2/settings/phone-app` | Done | `InstallGuide` |
| `login.html` | `/login` | Done — the existing sign-in screen, unchanged | `Login` |

`components.html` and `index.html` are the design package's own kit and index,
not screens.

## The phone screens with no page of their own

These are parts of a page rather than pages: they open as a panel, a sheet or
a tab on the screen named beside them.

| Phone screen | Where it lives |
|---|---|
| `Menu`, `Dark_Menu` | The More screen, `/v2/more` |
| `Notes` | The notes panel on a lead |
| `TransferLead` | The transfer sheet on a lead |
| `OwnerAssign` | The "give to an agent" dialog on Incoming |
| `WorkOutside`, `LeaveRequest` | The two side panels on Attendance |
| `LeaveApprovals` | The Leave requests tab on the owner's Attendance |
| `PersonalInfo`, `Security` | Sections of the profile |
| `Chat` | A thread in the Inbox |
| `AskAI` | Homes AI, `/v2/ai` |
| `Colleague` | The side panel on the Team screen |
| `FollowUps` | The second tab on Tasks |

## How to try it

The test address is a preview build on this machine: one page, the real
screens, answered by stand-in data instead of the live database. Nothing it
shows touches crm.homes.me.

Every address is under `/#/v2/…` — the preview routes on the hash — and
`?as=owner` or `?as=agent` before the hash switches which role you are:

    http://127.0.0.1:5182/?as=owner#/v2/dashboard
    http://127.0.0.1:5182/?as=agent#/v2

## What is deliberately not here

**Emir Books.** It was taken out of scope for this build. There is no
CRM | Books switcher and no accounting screen. `web/src/styles/books.css`
exists and is deliberately not imported.
