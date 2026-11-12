# Build plan — homes.me CRM, new version

Phase 0 of the master prompt (version 3, 12 November 2026).
Written 12 November 2026. **Nothing has been built yet. This is for Emir to approve.**

---

## 0. Read this first — one thing is urgent

**Right now, every change I commit goes live to crm.homes.me in about 75 seconds.**

Hostinger watches the branch I work on and deploys it automatically. There is no
staging and no approval step. That is how the last two weeks of work reached your
team, and it is fine for small fixes.

It is **not** fine for this build. The new version takes weeks and will be broken,
half-drawn and wrong for most of that time. The master prompt says production must
not be touched — but as the hosting is wired today, I cannot touch anything
*without* touching production.

So **before I write a single line of feature code**, one of these has to happen:

| Option | What it means | My recommendation |
|---|---|---|
| **A. Point the auto-deploy at the new address** | In the hosting panel, the second site (`new.crm.homes.me`) watches branch `v2`, and `crm.homes.me` keeps watching the branch it watches now. Two sites, two branches, neither can touch the other. | **Recommended.** It is the only arrangement where a mistake of mine cannot reach your agents. |
| **B. Turn the auto-deploy off entirely** | Nothing deploys without you pressing a button. Safe, but then I cannot show you anything without asking you to press it each time. | Workable, slower for both of us. |
| **C. Change nothing** | I build on the live branch. Your ten agents see every half-finished screen. | **Do not do this.** |

Section 7 below is the exact click-by-click list for option A. Until it is done I
will keep working on the plan and the design study, and I will not start Phase 2.

---

## 1. What exists today

A working CRM, used daily by about ten people, at **crm.homes.me**.

**Shape.** One repository, two parts:

- `server/` — Express + TypeScript, MySQL 8 through `mysql2`, every endpoint
  validated with Zod. 38 route files.
- `web/` — React 18 + Vite. 31 screens, 37 URLs.
- **35 migrations, 89 tables.**

**How it runs.** One Node process. The background worker (follow-ups, imports,
reminders, timers) runs *inside* that process, polling a `jobs` table — there is no
cron job to install. Hostinger deploys it from GitHub automatically.

**Who can sign in.** Email and password, sessions stored in MySQL. Five roles:
`owner`, `admin`, `manager`, `agent`, `automation`. Permissions are checked on the
server, not just hidden in the screen.

**What it already does well** (all of this gets a new coat of paint, not a rebuild):

| Already built | Where |
|---|---|
| Login, roles, sessions, audit log | `auth.ts`, `audit_log` |
| Leads: list, lead page, notes, files, tags, timeline | `my-leads.ts`, `contacts.ts`, `notes.ts` |
| Add lead, with duplicate-number check | `add-lead.ts` |
| Incoming (free leads) and a shared pool with claims | `incoming.ts`, `lead_pool_claims` |
| Pipeline board | `pipeline.ts` |
| Excel / CSV import, 100k rows, background, undo for 24h | `imports.ts`, `imports`, `import_rows` |
| Tasks, and "next step" per lead | `tasks.ts` |
| Calling queue (the dialler) | `/campaigns/:id/dial` |
| Projects library, units, prices, payment plans, documents | `library.ts`, `projects` + 12 tables |
| Sales offers, client page, tracking | `offers.ts`, `offers` + 6 tables |
| Office attendance, Wi-Fi gated, week and month grid | `attendance.ts`, `attendance` |
| Team wall, kudos, badges, XP | `wall.ts`, `xp_events`, `user_badges` |
| Team activity, sign-in history | `activity.ts`, `session_log` |
| Business card tool | `/tools/business-card` |
| Notifications: in-app list, bell, push plumbing | `notifications.ts`, `push_tokens`, `messaging/push.ts` |
| Service worker, installable app, push + notification-click | `web/public/sw.js` |
| Homes AI (Gemini), ask-anything, lead scoring | `ai.ts`, `ai_*` tables |
| Search and Ctrl-K command palette | `search.ts`, `CommandPalette.tsx` |
| Settings, automations, company details | `settings`, `automations.ts` |
| Email campaigns, templates, inbox | `email.ts`, `inbox.ts`, `templates.ts` |

**What is already wired but switched off:** Firebase push. The seven environment
values it needs (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`,
`FCM_WEB_API_KEY`, `FCM_WEB_APP_ID`, `FCM_MESSAGING_SENDER_ID`, `FCM_VAPID_KEY`)
are not set, so nothing is sent. Section 7 says where to paste them.

---

## 2. What is genuinely new

Fifteen of the tables the new version needs **do not exist at all**. I checked each
one:

`lead_transfers` · `meetings` · `call_logs` · `message_taps` · `tracking_links` ·
`link_opens` · `outside_trips` · `leave_requests` · `office_networks` ·
`vip_handoffs` · `desks` · `live_projects` · `banners` · `feedback_tickets` ·
`telegram_links` · `notification_prefs`

That is the honest size of this job: it is not a re-skin. Roughly **half the
features in section 6 of your prompt have no server behind them yet**.

The biggest new pieces, in order of how much work they are:

1. **Calendar and meetings** — there is no calendar in the CRM at all today. Month,
   week, day views; plans; the "how did it go?" question; the Won form.
2. **Lead transfer between agents** — nothing exists. Needs the request flow,
   approvals, the language filter and the full history.
3. **Call logging and the check-in rule** — calls are not recorded as calls today.
4. **WhatsApp / Telegram tap tracking** — ready message, log the tap, ask "what
   happened?", owner report.
5. **Attendance: outside trips and leave** — check-in exists; working outside and
   leave requests do not.
6. **The phone layout** — the CRM is responsive but has no phone shell: no bottom
   bar, no dial button, no bottom sheets.
7. **The whole look** — the orange design system replaces the teal one everywhere.

---

## 3. Feature parity table

The master prompt asks for this for every feature in section 6. "Computer" means it
works on a wide screen today; "Phone" means a phone-shaped layout exists today.

**Reading it:** `yes` = built, `part` = something exists but not what the design
asks for, `no` = nothing.

### Start and home

| Feature | Computer | Phone | To build |
|---|---|---|---|
| Login (email + password) | yes | part | restyle; add two-step for owner/admin |
| Install guide | part | no | both |
| My Day (agent home) | part (Dashboard) | no | both — new content |
| Owner home ("needs you now") | no | no | both |
| More / menu of tools | part (sidebar) | no | phone shell |
| Search | yes | part | restyle both |
| Notifications list | yes | part | split owner/agent lists, deep links |
| Homes AI | yes | part | restyle both |
| Owner banners on My Day | no | no | both |

### Leads

| Feature | Computer | Phone | To build |
|---|---|---|---|
| My Leads with tabs | yes | part | retab (Today/New/Overdue/No next step/VIP/Lost/All) |
| Lead page | yes | part | restyle; phone number largest; client local time |
| Add lead | yes | part | add owner mode, VIP, "must call within" |
| Duplicate-number check | yes | yes | keep |
| Incoming | yes | part | add "share equally", reasons, waiting time |
| VIP leads I gave | no | no | both |
| All leads (owner) with filters + move | part | no | both |
| Follow-ups screen | part (tabs) | no | both |
| Pipeline | yes | part | restyle; remove stage change by tap |
| Dialler / calling queue | part | no | both — rebuild to the design |
| **Lead transfer** | no | no | both — all of it |
| Take-back rule (VIP 30 min, imports 24h) | part | — | rebuild (see §5) |

### Calendar, tasks, projects

| Feature | Computer | Phone | To build |
|---|---|---|---|
| **Calendar** (month/week/day, plans, results) | no | no | both — all of it |
| Tasks | yes | part | restyle, add week view |
| Live projects | part (Library) | no | both |
| Project detail + send to client | part | no | both |
| Manage projects (owner) | yes | no | restyle + phone |

### Team, attendance, me

| Feature | Computer | Phone | To build |
|---|---|---|---|
| Meet the team | part (profiles) | no | both |
| Colleague page | yes | part | restyle |
| Team wall | yes | part | restyle |
| Best of Homes (leaderboard) | part | no | both |
| Attendance check-in | yes | part | restyle |
| **Working outside** | no | no | both |
| **Leave requests + approvals** | no | no | both |
| Team attendance (owner) | part | no | both |
| Profile / personal info / security | yes | part | restyle, add BRN + languages |
| Digital business card | yes | — | reuse as is |
| Settings + notification switches | yes | part | rebuild switches per alert |
| **Feedback (report a bug)** | no | no | both |

### Owner tools

| Feature | Computer | Phone | To build |
|---|---|---|---|
| Import (6 steps) | yes (4 steps) | no | extend + phone |
| Owner dashboard with period filter | part | part | rebuild |
| Who is doing what now | part | no | both |
| Team activity / sign-ins | yes | no | restyle + phone |
| Messaging report | no | no | both |
| Feedback inbox | no | no | both |
| Team and roles | yes | no | restyle + phone |
| **Desks** | part (`teams`) | no | both |
| Automations | yes | part | rewire to new rules |
| Company / AI settings / health | yes | part | restyle |
| Sales offers | yes | part | restyle, keep working |

**Score:** of roughly 60 features, **9 can be kept almost as they are**, about 20
need restyling and extending, and **over 30 are new on at least one of the two
layouts.**

---

## 4. Database changes

**Rule I will follow: migrations only add.** New tables, and new columns that are
allowed to be empty. Nothing is renamed, nothing is dropped. That is what makes the
switch reversible — the old build could still run against the new database.

Sixteen new tables (section 2), plus new columns on `opportunities`:
`is_vip`, `source_detail`, `telegram`, `whatsapp_number`, `wants`, `lost_reason`,
`no_show_count`, and a new `stage` column *beside* the existing `stage_key`.

**The stage problem — this one needs your decision.** The live CRM's stages are:

> New Lead → Attempted Contact → Engaged/Qualified → Appointment Scheduled → Deal Sent → Won / Lost

The new design's stages are:

> New → Called → Interested → Meeting → Offer → Won, and Lost separately

They line up almost one to one, which is lucky. But renaming the live ones in place
would break the old build and make the switch irreversible. My proposal: add the new
stage names alongside, map the old to the new on read, and only retire the old names
months after the switch. I will show you the mapping before I write it.

---

## 5. Things in the new prompt that contradict what is live

I would rather raise these now than guess. Each one changes what I build.

1. **WhatsApp.** The new prompt says "no WhatsApp API — each agent uses his own
   number, the agent presses send." The live CRM has the WhatsApp Cloud API built in
   (templates, 24-hour window, delivery ticks, an inbox). *Do I switch the API off
   and move everyone to "open WhatsApp on your own phone", or keep both?*
2. **Where leads come from.** The new prompt says only three ways: owner hand-off,
   Excel import, agents add their own. The live CRM also takes Meta Lead Ads, website
   forms, Google and inbound WhatsApp. *Do I switch those off, or leave them running?*
3. **Inbox, Email, Templates.** The new design marks these "LATER" and says to grey
   them out — but they are **built and working today**, and the same prompt says
   nothing the live CRM does may be lost. *Grey them out, or keep them working with
   the new look?*
4. **The `manager` role.** The new prompt has three roles: Owner, Admin, Agent. The
   live CRM has a fourth, `manager`, with its own permissions. *Does manager stay,
   become Admin, or become Agent?*
5. **The five-minute rule.** You switched it off yesterday. The new "take-back rule"
   (VIP 30 minutes, imports 24 hours, clock stops outside work hours) replaces it
   properly. I will build the new one and leave the old one off — say if you want it
   back on in the meantime.

---

## 6. Risks, said plainly

| Risk | How likely | What I will do |
|---|---|---|
| A commit of mine reaches your agents mid-build | **Certain, as wired today** | Section 0 — fix the deploy wiring first |
| The build is bigger than it looks and runs long | High | 16 phases, each one shown to you working before the next starts |
| The two versions drift apart (a fix on live, missing on v2) | Medium | Every production fix is merged into `v2` the same day |
| A heavy query takes the site down — it happened twice on 10 Nov | Medium | Every new list query bounded and tested against 100,000 rows before it is pushed |
| The switch goes wrong | Low, but it is the dangerous moment | Backup first, one-click rollback kept for 14 days, `docs/cutover.md` written before the pilot |
| The design is a prototype and its demo data is invented | Certain | Real data everywhere; I list any screen where the design's numbers cannot be produced |

---

## 7. What only you can do (hosting)

Written for a non-programmer. None of this needs code.

### 7.1 The second address — about 15 minutes

1. **hPanel → Domains → DNS.** Add a record: type `CNAME`, name `new.crm`, pointing
   at the same place `crm` points at. (If `crm` is an `A` record pointing at an IP,
   make `new.crm` an `A` record with the same IP.)
2. **hPanel → Websites → Add website** — or "Add application" if the panel offers it
   — for `new.crm.homes.me`. Same Node.js version as the live one.
3. In that new site's **Git / Deployments** settings, connect the same GitHub
   repository but set the branch to **`v2`**.
4. **Check the live site is still on its own branch.** Open `crm.homes.me` →
   Deployments and confirm the branch there is unchanged. This is the step that keeps
   your team safe; please do not skip it.
5. Send me a screenshot of both Deployments pages and I will confirm they are
   separate before I build anything.

### 7.2 A copy of the database — about 10 minutes

1. **hPanel → Databases → MySQL.** Create a new empty database, e.g.
   `homesme_crm_v2`, with its own user and password.
2. On the live database, press **Export** (or let me give you one command over SSH).
3. **Import** that file into the new database.
4. Give the new site's environment the new database name, user and password. **Do not
   point the new site at the live database** — that is the one mistake that would let
   test work touch real leads.
5. I will add `scripts/refresh-v2-db` so a fresh copy is one command from then on.

### 7.3 Firebase, for notifications — about 20 minutes

The CRM already has the code; it needs seven values. In the Firebase console, create
(or open) the project, then **Project settings → General** and **Cloud Messaging**:

| Paste into the hosting panel as | Where to find it in Firebase |
|---|---|
| `FCM_PROJECT_ID` | Project settings → General → Project ID |
| `FCM_WEB_API_KEY` | Project settings → General → Web API Key |
| `FCM_WEB_APP_ID` | Project settings → General → Your apps → App ID |
| `FCM_MESSAGING_SENDER_ID` | Project settings → Cloud Messaging → Sender ID |
| `FCM_VAPID_KEY` | Cloud Messaging → Web Push certificates → Key pair |
| `FCM_CLIENT_EMAIL` | Service accounts → Generate new private key → `client_email` in the file |
| `FCM_PRIVATE_KEY` | the same file → `private_key` |

**Set these on the new site first**, not on the live one — so a test notification
cannot reach an agent's phone. The last two come from a file that is a password:
send it to me only if you want me to paste it, and never put it in a chat message.

### 7.4 Decisions I need from you

These are section 12 of your prompt. I have put my recommendation first where I have
one, but they are your calls:

1. **Address of the new version** — `new.crm.homes.me`, or another name?
2. **Office number on the business card** — 16 or 12? (The live card says 16; your
   latest note says Floor 16, Office 12.)
3. **Company name on the card** — "Emigeo" or "EMIGEO"?
4. **Do owners check in before calling?** (I will assume no.)
5. **Take-back times** — VIP 30 minutes, imports 24 hours. Confirm or change.
6. **Lead transfer approvals** — only Meeting and Offer need owner approval, or all
   transfers, or none?
7. **Owner tools for the admin too?** (I will assume yes.)
8. **Telegram backup alerts** — now or later? (I suggest later; Firebase first.)
9. The four contradictions in section 5 above.

---

## 8. What I will do next, once you approve

Phase 1, and nothing before it: create the `v2` branch, get `new.crm.homes.me`
online with its own copy of the data, put the "TEST VERSION" banner on it, and make
sure no real message, email or notification can leave it. Then I show you the empty
new site working, and we start Phase 2 — the design system.

**Is this right, or do you want changes?**
