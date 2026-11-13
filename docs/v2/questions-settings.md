# The owner's settings screens — what was rebuilt, what could not be, and what needs a decision

*Written while rebuilding eight screens of `/v2` from their design files,
13 November 2026.*

The eight, with the audit section each was worked from:

| Screen | Design file | Address | Audit |
|---|---|---|---|
| Team and roles | `design/web/settings-team.html` | `/v2/settings/team` | `audit-4.md` §37 |
| Company | `design/web/company.html` | `/v2/settings/company` | §41 |
| Feedback inbox | `design/web/feedback-inbox.html` | `/v2/settings/feedback` | §36 |
| System health | `design/web/system-health.html` | `/v2/settings/health` | §43 |
| Attendance rules | `design/web/settings-attendance.html` | `/v2/settings/attendance` | §38 |
| Home banners | `design/web/home-banners.html` | `/v2/settings/banners` | `audit-2.md` §21 |
| Homes AI | `design/web/ai-settings.html` | `/v2/settings/ai` | §42 |
| Automations | `design/web/automations.html` | `/v2/settings/automations` | §40 |

The rule for this rebuild was Emir's own: **build the design, and where the
design cannot be built, write it down rather than quietly make something
smaller.** The written-down half is `docs/decisions-to-confirm.md` §48–58.
This file is the engineering half — what is now behind each screen, what is
still missing a layer away, and what belongs to somebody else's slice.

---

## 1. What was already done before this pass

The audit's counts were from the morning of 13 Nov. Three of its findings had
been fixed by somebody else before this work started, and are listed here so
nobody counts them twice:

- **The owner block on every page.** `web/src/v2/OwnerOnly.tsx` exists and
  all ten routes in `App.tsx` are wrapped in it. The audit has seven of these
  pages as "an agent sees the page"; they do not any more. Checked in a real
  browser as an agent at 1440px: every one gives the block.
- **"Emir AI" on the server.** `server/src/ai/name.ts` and `ai/name.test.ts`
  were already in place, and no file the server runs says the old name.
- **The page CSS.** All eight design files were already in `PAGES` in
  `scripts/port-design-css.mjs`. Running the script again produced no change,
  so `v2-ui.css` and `v2-home.css` were already current.

---

## 2. What is now behind these screens that was not before

Nine of the audit's items were not screen work at all — there was nothing in
the database or on the server for the screen to show.

### Migration `0039_owner_settings.sql`

| Table | What was added | Which screen needed it |
|---|---|---|
| `feedback_tickets` | `ref` (the `#1042` an owner quotes), `title`, `urgency`, `screenshot_path`, `voice_path`, `voice_seconds`; `kind` widened to the design's four types | Feedback inbox: the first two columns, the Urgency column, the two panel blocks |
| `feedback_replies` | A reply thread | The panel's "Replies" list, which the single `reply` column could not hold — the second answer overwrote the first |
| `banners` | `label`, `button_text`, `opens`, `audience`, `desk_id` | The whole right-hand form on Home banners |
| `banner_views` | One row per person per banner | "seen by 9 of 10" |
| `service_checks` | One row per service per check | The thirty-day bars, the uptime percentages and the incident list on System health |

Every column is added with a default that matches what the CRM already did, so
a row written before the migration reads the same afterwards.

### New work on the server

- `server/src/v2/health-checks.ts` — six measurements and the job that runs
  them every five minutes (`health.check`, in `jobs/cron.ts`). Nothing in it
  calls another company: a check that depends on Google being up reports
  Google's weather, 288 times a day.
- `server/src/v2/team-roles.ts` — `GET /api/v2/team/roles`, the owner's
  administrative roster, plus "Remind" and "Sign out everywhere".
- `server/src/attendance/report.ts` — the monthly file, with late **minutes**
  worked out from the saved shift rather than the stored boolean.
- Feedback: a `ref`, a reply thread, the CSV export, and attachment upload and
  serving.
- Banners: audience filtering (applied in `v2/home.ts`, not only offered on
  the form), view counting, and picture upload.
- Company: `addressLine2`, `companyLastChange()`, and the logo file's name and
  size.

### Rules that had no enforcement anywhere

Each of these was in the design, in the spec, or both, and was refused by
nothing before today. All four are in
`server/src/http/routes/owner-settings.integration.test.ts`.

1. **An owner can never be deactivated** (§4.13). `PATCH /api/users/:id` with
   `isActive:false` used to end an owner's sessions and empty their leads into
   Incoming. On a one-owner installation that locks everybody out of their own
   CRM with no way back in.
2. **An admin cannot change, deactivate or sign out an owner**, and cannot
   make anybody an owner. The design says so in its own footnote.
3. **The Homes AI budget is owner and admin, not manager.** `/api/ai/usage`,
   `/knowledge`, `/models` and `/diagnose` were `requireManager`, so a manager
   read the company's monthly AI bill. `web/src/pages/Settings.tsx` no longer
   offers a manager the tab either, so nobody is given a page that 403s.
4. **An agent cannot reach the owner's roster.** `GET /api/users` stays open
   — half the CRM needs a colleague's name, and it already trims an agent's
   view — and the administrative view is a separate, guarded endpoint.

One guard was **loosened**, deliberately: `PUT /api/attendance/settings` was
owner-only, so an admin got the whole form and a Save button that answered
403. `sage.md` §1 says an admin does what an owner does on these screens.

---

## 3. Still missing a layer away

Each of these is a line in a design that nothing in the CRM can fill. None of
them is a bug in the screens.

| The design shows | Where | What it would need |
|---|---|---|
| **"last backup today 03:00"** | System health, Database row | Nothing tells the CRM when the hosting last took a backup. The row carries the lead count instead. |
| **"6.2 of 50 GB"** | System health, File storage row | The 6.2 is real and measured; the 50 is the hosting plan's quota, which the CRM is not told. The row says "6.2 GB used". |
| **"1.4 s"** beside Homes AI | System health | Every other service is timed by doing its own work. Timing the AI means spending a real model call, 288 times a day. The row carries the month's spend instead, which is the number an owner actually acts on. |
| **"Blocked in phone settings" / "Switched off"** | Team and roles, alerts tab | The phone's own notification permission, which no phone reports to a server. Three states, not four — see `decisions-to-confirm.md` §55. |
| **"Invite waiting" · "Send again" · "Cancel invite"** | Team and roles | There is no outgoing mail server, so there is no pending-invite state. See §54. |
| **"0 invites waiting"** | Team and roles, People card | Same cause. The card counts people who have never signed in. |
| **"Dubai · active now"** on a device | — | Out of this slice, already in `decisions-to-confirm.md` §47. |

---

## 4. Belongs to another slice

These are real and worth doing, and each one is in a file this pass did not
own.

### 4.1 Time and date fields follow the reader's browser, not the page

The shift fields on Attendance rules were reading "7:00 PM", in a CRM whose
own rule is 24-hour everywhere.

**`lang` does not fix it.** That was the obvious first answer and it is wrong:
Chromium draws `<input type="time">` in the *browser UI's* locale and ignores
`lang` entirely. Proved directly in this container — an input with
`lang="en-GB"`, the same input inside a `<div lang="en-GB">`, and a bare one
all rendered `07:00 PM`, under three different context locales. Do not
re-try it.

The design already knew. `design/web/app.js`:

```js
/* 24-hour time boxes (Abdullah): a native time field shows AM/PM on some computers */
function time24(root) {
  $$('input[type=time]', root || D).forEach(function (i) {
    var v = i.value, T = /^([01]?\d|2[0-3]):[0-5]\d$/;
    i.type = 'text'; ...
```

`Attendance.tsx`'s `Time` component is that, in React: `type="text"`,
`inputMode="numeric"`, `maxLength={5}`, `placeholder="HH:MM"`, `0930` ->
`09:30` while typing, `9` -> `09:00` on blur, and anything that is not a time
falls back to the last value that was. **Any future time field in v2 should
use that component rather than a native time input.**

**Three screens outside this slice still use the browser's picker** and read
"7:00 PM" the same way: `web/src/v2/Calling.tsx`, and the two older settings
screens `web/src/components/RoutingSettings.tsx` and
`web/src/components/AttendanceSettings.tsx`. Each is one component swap; all
three are in another slice this week, so they were left alone.

**The date fields are still the browser's.** `type="date"` has the same
problem — day/month order follows the reader's browser — and no equivalent
trick, because a date picker is genuinely better than three typed boxes for
a date somebody picks off a calendar. The value posted is always ISO, so
nothing is mis-saved; only the reading differs. Eleven date fields across v2
are in this position (`Calendar.tsx` x5, `Tasks.tsx`, `Calling.tsx`,
`Offers.tsx`, `Attendance.tsx` x2, `Banners.tsx` x2). The cheap fix is one
browser setting per office laptop, not one attribute per field — see
`decisions-to-confirm.md` §58.

`web/src/lib/format.ts` already passes `hour12:false` for *printed* times and
dates, so everything the CRM writes out is already right; this is only about
the boxes people type into.

### 4.2 "Emir AI" in the old settings screens

`server/src/ai/name.ts` and its test cover the server. The **v1 React
screens** still say the old name in three files —
`web/src/components/AskEmirAi.tsx` (the floating chat, which an agent sees on
every screen) and `web/src/components/Developers.tsx` (six strings). The v1
Settings tab was renamed in this pass because its endpoints moved; the rest
were left alone because they are live screens in another slice.

The name test only reads `server/src`. It would be worth widening to
`web/src`, which would fail today on those two files.

### 4.3 The feedback inbox on a phone

`design/screens/OwnerFeedback.dc.html` draws this list as cards and adds
"Send all open items to the developer (file)".

The table now becomes a card list under 768px (`v2-d-cards`, the convention
`Messaging.tsx` and `Live.tsx` already use), and each card carries the two
buttons an owner presses ninety times in a hundred. The "send to the
developer" action is not built — there is nobody to send it to.

### 4.4 Dead CSS this pass orphaned

`v2-hb-prev`, `v2-hb-lab`, `v2-hb-cta`, `v2-hb-row`, `v2-hb-off` and
`v2-fb-row` in `v2-shell.css` were written for the hand-drawn banner preview
and the feedback card list, both of which are now the design's own markup.
They are scoped and harmless; somebody tidying that file should take them out.

---

## 5. Things worth knowing if you touch these screens next

- **Two of these pages are not in the Settings shell.** Feedback inbox and
  Home banners are standalone, because the design draws them that way and
  because the feedback table does not fit beside the Settings nav. Their
  addresses have not changed and they are still in the Settings menu.
- **The health job writes 6 rows every 5 minutes** — about 1,700 a day. It is
  never pruned. `maintenance.cleanup` would be the place; thirty days is all
  the page reads.
- **`measureAll()` is safe to call on demand** and the "Run a check now"
  button does exactly that, recording a sample like any other. The page and
  the button cannot show different numbers, because they come from the same
  rows.
- **`server/src/v2/banners.ts` now decides who sees a banner**, and
  `v2/home.ts` applies it. If a banner is ever drawn anywhere else — a phone
  home screen, an email — that query has to carry the same filter, or the
  Arabic desk's banner ends up in front of the whole office.
- **The feedback `ref` is `MAX(ref)+1` under a unique key**, with three
  retries. A ten-person office will never race it; a bulk import of old
  tickets would, and should take the numbers in one transaction instead.
- **`scripts/computer-proof.mjs` was shooting some pages mid-load**, and the
  picture of a spinner looks exactly like a page nobody built. Two causes,
  both now fixed, and both affect every page in the proof set, not only these
  eight. First, it shot a fixed 900ms after `networkidle`, which is before a
  screen with two fetches has anything on it; `settled()` now waits for the
  page to be quiet and *stay* quiet, and a page that never settles is listed
  under "problems" instead of passing silently. Second, every build page
  shared one browser, so the preview's idea of who was signed in carried from
  screen to screen: `company.jpg` came out right when shot alone and came out
  as "Loading" when shot in a run of eight, repeatably. Each build page now
  gets its own browser context, which is what a person opening the CRM fresh
  actually gets.
- **Every screen in this slice is checked by reading its source**
  (`web/src/v2/settings/owner-settings.test.ts`, 73 assertions). Most of what
  was missing was a block, a field or a sentence, and no behavioural test
  would have noticed. If one of those fails, the design file is the authority,
  not the test.

---

## 6. What Emir has to decide

Everything in `docs/decisions-to-confirm.md` §48–58, and in particular these
four, because each one costs something either way:

1. **Real .xlsx exports** instead of CSV (§49) — needs a library on the server.
2. **An email server** (§54) — turns the invite dialog into the design's flow
   and lets overdue and reminder emails leave the building at all.
3. **Project cover photos on banners** (§53) — the five styles become the real
   projects' pictures once he says which projects.
4. **Whether the office network's address stays visible** (§48). I would keep
   it: when the internet provider changes it, nobody can check in, and that
   row is the only place anybody would look.
5. **Whether the office laptops are set to UK English** (§58). It is not a
   code change — it is one setting per laptop — and it decides whether the
   banner dates read 14/03/2027 or 03/14/2027 for the person looking at them.
   The shift times no longer depend on it.
