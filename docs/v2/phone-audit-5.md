## Group 5 — the menu, settings and login

*Audited 13 Nov 2026 against `design/screens/*.dc.html` at 390 × 844 and the
preview build at `127.0.0.1:5182`, both in Chromium. Colour is not in scope;
the prototypes are still in the retired green.*

**Two things to know before the rows.**

1. **The prototypes' runtime does not run from `file://`.** `support.js` never
   resolves the `{{…}}` bindings, so both halves of every `sc-if` render at
   once and `sc-for` shows its template row. Everything below about what an
   agent sees and what an owner sees is therefore read out of the source —
   the `sc-if` value and the `_rv()` block — not off the screenshot.
2. **A rebuild was already in flight in this working tree while I audited.**
   `web/src/v2/Shell.tsx` is modified but not committed, and the change
   rewrites `V2More` from rows to tiles fed by `extraScreensFor`. It is not in
   the preview and not in `HEAD`. **This audit describes `HEAD` and the
   running preview, which agree with each other.** Where that uncommitted work
   already answers a finding, I say so.

| Phone screen | Address in the build | Layout | Why |
|---|---|---|---|
| `Menu.dc.html` | `/v2/more` | **Different** | Design is a 3-across tile grid under three role-named headings, opening with a profile card and a search field and closing with Sign out. Build is a one-column list of rows under the computer sidebar's own group names, with a sticky app bar and no sign-out. |
| `Settings.dc.html` | `/v2/settings` | **Different** | Design is three grouped cards of tappable rows on one scrolling page. Build is the computer's two-column settings shell with the left section nav reflowed into a horizontal scroller 1845px wide inside a 358px window, above one long panel. |
| `SettingsNotifications.dc.html` | `/v2/settings/notifications` | **Same** | Permission card → grouped switch lists → quiet hours, in that order. The design's separate "Install on your phone" card moves up into the build's "Where alerts go" block. |
| `SettingsTeam.dc.html` | `/v2/settings/team` as owner | **Different** | Design is a count strip over a plain people list, and tapping a person opens a bottom sheet holding every action. Build is a desktop table with an inline role `<select>` per row and no sheet, so none of the actions exist. |
| `SettingsAttendance.dc.html` | `/v2/settings/attendance` as owner | **Different** | Design's first block is a list of **office Wi-Fi network names** with Remove and "+ Add the Wi-Fi I am on now". Build's first block is a list of **IP addresses**. (Deliberate and documented — see the row.) |
| `AISettings.dc.html` | `/v2/settings/ai` as owner | **Same** | Budget bar → "AI can" switch list → "What AI should know about us" + Save. Same blocks, same order; the build adds to each. |
| `Company.dc.html` | `/v2/settings/company` as owner | **Same** | Logo row → the same fields in the same order → Save. The build groups them under sub-headings and adds a preview column underneath. |
| `Health.dc.html` | `/v2/settings/health` as owner | **Different** | Design opens with a full-width near-black hero card ("All systems OK / 1 thing to look at") and puts "Run a check now" **below** the service list. Build has a plain status line, the button **above** the list, and a different set of services. |
| `OwnerBanners.dc.html` | `/v2/settings/banners` as owner | **Different** | Design is image-first: a live picture preview, an image drop zone, label chips, dates and an audience picker, then a drag-to-reorder list with live/scheduled/ended pills. Build has a text-only preview, a three-field form, no images and up/down arrows instead of dragging. |
| `InstallGuide.dc.html` | `/v2/settings/phone-app` | **Different** | Design draws each step — the Safari toolbar, the Share menu, the home-screen grid, the permission dialog — and draws a real lock screen with five notifications. Build's steps are text, and the lock screen is three plain rows. |
| `Login.dc.html` | `/login` (the v1 screen, not a v2 one) | **Different** | Design is one column with no image: lockup, two-line headline, the form, a language switch, an install card. Build is the v1 card with a team photograph banded across the top, no language switch, no install card, and two extra sign-in affordances. |

---

# `Menu.dc.html` → `/v2/more`

This is how everything that is not one of the five bar items is reached on a
phone, so it gets the long section.

## What the prototype actually is

**Top to bottom, before the groups:**

1. A row with **one round 44px white back button** (chevron-left) on the left
   and nothing on the right. It goes to `Main.dc.html` — hard-coded, not
   history.
2. `<h1>` **"More"** (30px/800), and under it, 13px muted:
   **"Everything in the CRM"**.
3. A **profile card** — a white 22px-radius card, 18px padding: a 52px round
   avatar with the person's initials, then their **name** (17px/700) and
   **their role underneath** (13px muted — `"Property Consultant · Level 7"`
   for the agent, `"Owner"` for Emir), then a chevron. It links to `Profile`.
4. A **full-width search field** — 54px tall, 18px radius, magnifier icon, the
   placeholder **"Search leads, projects, screens"**. It is a link to the
   `Search` screen, drawn as a field.

**Then three groups. All three are tile grids, three across**
(`grid-template-columns: repeat(3, minmax(0,1fr))`, 8px gap). Each tile is a
white card, 20px radius, `min-height: 96px`, holding a 42px round pastel icon
chip above a centred 13px/600 label that wraps to two lines. A count is a red
(`#B42318`) 20px pill pinned to the tile's **top-right corner**.

The group headings are 12px/700, letter-spaced, muted, above each grid.

### Group 1 — **OWNER & ADMIN** (16 tiles)

Wrapped in `<sc-if value="{{isOwner}}">`. The heading names owner *and* admin;
the prototype's `isOwner` is strictly `hmRole === 'owner'` only because its
demo has two roles. (Its sibling helper `ownerSee`, used on `Settings`, is
`hmRole !== 'agent'`.) **An agent does not see this group at all.**

In the prototype's order:

| # | Label | Badge | Goes to |
|---|---|---|---|
| 1 | Owner home | — | `OwnerHome` |
| 2 | Dashboard | — | `OwnerDashboard` |
| 3 | Add / hand VIP lead | — | `AddLead` |
| 4 | Lead transfers | **1** | `Transfers` |
| 5 | All leads | — | `AllLeads` |
| 6 | Import leads | — | `Import` |
| 7 | Incoming | **3** | `Incoming` |
| 8 | Team attendance | — | `TeamAttendance` |
| 9 | Leave requests | **2** | `LeaveApprovals` |
| 10 | Team live | — | `OwnerLive` |
| 11 | Team activity | — | `TeamActivity` |
| 12 | WhatsApp & Telegram | — | `OwnerMessaging` |
| 13 | Manage projects | — | `ManageProjects` |
| 14 | Home banners | — | `OwnerBanners` |
| 15 | Desks | — | `Desks` |
| 16 | Feedback inbox | **6** | `OwnerFeedback` |

### Group 2 — **MY WORK** (9 tiles, 8 distinct)

Everybody sees it.

| # | Label | Badge | Goes to |
|---|---|---|---|
| 1 | Follow-ups | **5** | `FollowUps` |
| 2 | Lead transfers | **1** | `Transfers` |
| 3 | Pipeline | — | `Pipeline` |
| 4 | **Inbox · later** | — | `Inbox` |
| 5 | Calendar | — | `Calendar` |
| 6 | Live projects | — | `LiveProjects` |
| 7 | Add lead | — | `AddLead` |
| 8 | Homes AI | — | `AskAI` |
| 9 | Power dialer | — | `Dialer` |

"Power dialer" is in the markup **twice**, which is why it reads twice in a
raw dump: an `<a href="Dialer">` under `sc-if gateFree` and an identical
`<button onClick="{{openGate}}">` under `sc-if gateLocked`. It is the
check-in gate (`phone-shell.md` §5.1), not a duplicate tile.

### Group 3 — **TEAM** (7 tiles)

Everybody sees it.

| # | Label | Goes to |
|---|---|---|
| 1 | Meet the team | `TeamDirectory` |
| 2 | Team wall | `TeamWall` |
| 3 | Best of Homes | `Leaderboard` |
| 4 | Attendance | `Attendance` |
| 5 | Report / suggest | `Feedback` |
| 6 | Notifications | `Notifications` |
| 7 | Settings | `Settings` |

**At the foot:** one **full-width 52px outlined row, radius 16, red text
(`#B42318`), log-out icon, "Sign out"**, linking to `Login`. Nothing after it
— **no version line on this screen** (the version line lives on `Settings`).

Then the standard floating bar with **More** lit, and the dial button.

## What `/v2/more` is

A one-column list of `v2-more-row`s — icon, label, optional badge,
chevron — generated from `groupsFor(role)` in `web/src/v2/nav.ts`, which is
the **computer sidebar's** list, plus `pinnedFor(role)`, a profile row and a
`MESSAGES` group. For an owner that is 22 rows in 7 groups: *(unlabelled)*
Dashboard · Incoming; **LEADS** All leads · Follow-ups · Pipeline · Transfers
· Import; **PLAN** Calendar · Tasks; **PROJECTS** Projects · Sales offers;
**TEAM** Team · Team wall · Attendance · Activity; *(unlabelled)* Homes AI ·
Automations · Settings · *name*; **MESSAGES** Inbox · Email · Templates.

Above it sits a **sticky app bar** (`position: sticky; top: 0` with a bottom
border) carrying the title "More", a round search button, the bell and an
orange **+**. The phone design has no persistent app bar anywhere — every
header scrolls away.

## Every tool the phone design offers that a phone user of the build cannot reach

`/v2/more` is built from the sidebar list only. `EXTRA_SCREENS` — the
24 screens `nav.ts` itself says the sidebar deliberately leaves out — is read
by `Find` (the command palette) and by nothing else on a phone. So:

**Not on `/v2/more`, and nowhere else a thumb will find it:**

- **"Report / suggest"** → `/v2/feedback`. For an **agent** this is the only
  way to report a bug, and on a phone there is none: it is not on `/v2/more`,
  not in Settings (the build's settings has no "Report a bug or suggest" row),
  and the one in-app link to it is a button at the foot of **System health**,
  which an agent may not open. Only the search box reaches it.
- **"Best of Homes"** → `/v2/best`. Only through Team wall, or search.
- **"Feedback inbox" with its badge of 6** → `/v2/settings/feedback`. The
  screen is reachable through the settings section strip, but `nav.ts` has no
  `BadgeSource` for it at all, so the count the design puts on the tile cannot
  be shown anywhere.
- **"Leave requests" with its badge of 2** → it is a tab on the owner's
  Attendance, not a row; the Attendance row carries the `leave` badge instead.
  Acceptable, but the design's own tile is gone.
- **"Dashboard"** (the owner's full numbers screen) → `/v2/dashboard`. Only
  from a tile on `/v2`, or search.
- **"Team live"** → `/v2/team-live`. Only from a tile on `/v2`, or search.
- **"WhatsApp & Telegram"** → `/v2/messaging`. Only from `/v2/dashboard` or
  `/v2/team-live`, i.e. two taps behind a screen that is itself not listed.
- **"Manage projects"** → `/v2/projects/manage`. Only from a button on
  `/v2/projects`.
- **"Home banners"**, **"Desks"** → only through the Settings section strip.
- **"Owner home"** vs **"Dashboard"** — the design offers both as separate
  tiles. The build's More has one row, "Dashboard" → `/v2`, and no second one.

**On the phone top bar rather than in the menu** (reachable, but not where the
design puts it): **Notifications** (the bell), **Add lead / Add · hand VIP
lead** (the orange +), **Power dialer** (the orange dial button beside the
bar), **Search** (a 38px round button, not the design's full-width field).

**Missing from the build:**

- The whole **tile grid**. Three across, 96px tall, icon-over-label. The build
  shows one row per screen, which on a 390 × 844 phone fits about a third as
  many tools above the fold.
- The **three group names** the design uses — `OWNER & ADMIN`, `MY WORK`,
  `TEAM` — and with them the single clearest signal on the screen: which
  tools belong to the owner. The build uses the computer sidebar's names
  (`LEADS`, `PLAN`, `PROJECTS`, `TEAM`, `MESSAGES`), which do not separate
  owner tools from everyone's.
- The `<h1>` **"More"** and the line **"Everything in the CRM"** as part of
  the scrolling page. The build has "More" in a sticky bar and no subtitle.
- The **profile card**: 52px avatar + name + **role line** + chevron, at the
  top. The build has a profile row with an avatar and a name, no role, and it
  sits in the middle of the page between "Automations" and "Inbox".
- The **full-width search field** reading "Search leads, projects, screens".
- **"Sign out"** — the design's last control on this screen. There is none on
  `/v2/more`. The only sign-outs are at the far right of the settings
  section strip (1,487px of sideways scrolling away) and at the foot of the
  Settings → General panel.
- The **red corner badges** on the tiles. The build's badges are grey or red
  pills on the row, which is fine, but Feedback inbox has none at all.
- **"Inbox · later"**. The design marks Inbox as not-yet-built in the label
  itself. The build lists Inbox, Email and Templates as three live rows.
- The **check-in gate** on the Power dialer entry — in the design this tile is
  a button that opens the check-in sheet when the agent is not checked in.
  There is no Power dialer entry on `/v2/more` at all.
- The **back button to `Main`**. The build's sticky bar has a history back.

**Extra in the build:** *Sales offers* (`/v2/offers` — the phone design has no
offers screen at all), *Automations*, *Tasks*, *My Day / Dashboard*, *Email*
and *Templates* as separate rows, and a `MESSAGES` heading. The build also
repeats all five bottom-bar destinations as rows; the design repeats only
Calendar and All leads.

> The uncommitted `Shell.tsx` in this tree already turns this into tiles and
> already folds `extraScreensFor(role)` into an "Everything else" block, which
> closes most of the unreachable list above. It still has no profile card, no
> search field and no Sign out, and it keeps the sidebar's group names.

---

# `Settings.dc.html` → `/v2/settings`

**Design:** back button → `Menu`, then a **centred** title "Settings" with
`{{meName}} · {{meRole}}` under it — not the 30px left-aligned `<h1>` the rest
of the app uses. Then three white cards of rows:

- **YOU** — *My profile* ("Photo, BRN, card") → `Profile`; **Language**
  ("English · العربية") which is a **read-only row** showing a pill reading
  "English", not a link; **Appearance** (`{{themeLabel}}`) with a three-button
  segmented pill **Light · Dark · Auto**; *Notifications* ("Push, email, quiet
  hours") → `SettingsNotifications`.
- **TEAM & OFFICE · OWNER, ADMIN** *(wrapped in `sc-if ownerSee`)* — *Team &
  roles* ("13 people · invite, reset, deactivate"); *Attendance & office
  Wi-Fi* ("Shift, Wi-Fi, outside work rules"); *Desks* ("Groups that share a
  batch of leads"); *Live projects* ("Which projects we sell now") →
  `ManageProjects`; *Home banners* ("Slides at the top of My Day").
- **COMPANY & SYSTEM** *(also `sc-if ownerSee`)* — *Company details* ("Name,
  ORN, TRN, logo, address"); *WhatsApp templates* ("16 to send to Meta") →
  `Templates`; *Homes AI* ("Key, budget, what AI knows about us");
  *Automations* ("Lead assign, take-back rule, chasing"); *System health*
  ("Push, email, background jobs"); *Feedback inbox* ("Bugs and ideas from the
  team"); *Report a bug or suggest* ("Send to the owners") → `Feedback`.

Then **"Sign out"** and the footer line **"homes.me CRM · web version for
phone and desktop"**.

**An agent therefore sees exactly six things here:** My profile, Language,
Appearance, Notifications, Sign out, version.

**Build:** the computer's `SettingsShell` — a left section nav and a panel —
with the nav reflowed into a horizontal scroller. Measured: the strip is
358px wide and 1,845px long, 14 items, with the "Mine"/"Office" labels
hidden and no arrow or fade to say it scrolls. The General panel then runs:
Appearance (three large picture cards) · Reduce the glass effect · Sounds ·
Volume · Language · Date and time · Office settings (7 rows) · a profile card
with Security and Sign out.

**Missing from the build:**

- The design's **grouped-card shape**. Everything a phone user needs is one
  tap from the design's page; in the build eleven of the fourteen sections are
  behind a sideways scroll with no affordance.
- **"Live projects · Which projects we sell now"** as a settings row. There is
  no route to `/v2/projects/manage` anywhere in the build's settings.
- **"WhatsApp templates · 16 to send to Meta"** as a settings row, and with it
  the count of templates waiting to go to Meta.
- **"Report a bug or suggest · Send to the owners"**. Absent from the build's
  settings entirely.
- The **version line** "homes.me CRM · web version for phone and desktop". It
  appears nowhere in `web/src`.
- The subtitle **`{{meName}} · {{meRole}}`** under the title.
- The design's **"Attendance & office Wi-Fi"** wording and its sub-line
  "Shift, Wi-Fi, outside work rules" (build: "Attendance rules").

**Extra in the build:** Reduce the glass effect · the whole Sounds block (Play
sounds, Test sound, two per-event switches, a Quiet/Normal/Loud volume) · Date
and time (24-hour clock, Dubai time, week starts Monday) · a live status line
on every Office row ("1 detail still missing", "$38.40 of $100.00 used this
month", "4 of 5 services are set up") · a **Security** button · a Phone app
section. All of it right; none of it in the phone prototype.

`DISAGREEMENT:` the phone design puts *Live projects*, *WhatsApp templates*
and *Report a bug or suggest* in Settings; `design/web/settings.html`'s nav
has none of the three. The computer design wins, which is what the build does
— but then *Report a bug or suggest* has no phone home at all (see the Menu
section).

`DISAGREEMENT:` the phone design's **Language** is a read-only row with a
pill. The computer design makes it a two-card chooser — "EN English · Used
now" and "ع العربية · Arabic · comes later" with a `later` chip. Computer
wins; the build does this.

---

# `SettingsNotifications.dc.html` → `/v2/settings/notifications`

**Design:** back · "Notifications" · a sub that is `"Owner alerts · this
phone"` for an owner and `"How the CRM reaches you"` for everyone else. Then:

1. A permission card whose title is one of two exact strings —
   **"Phone alerts are on for this phone"**, or, when the person skipped the
   prompt, **"Phone alerts are off on this phone · open Install to turn them
   on"** — the line *"Tap an alert and the CRM opens on that page."*, and a
   **Test** button (plays `success`, toasts *"Test alert sent to this phone ·
   tap it to open My Day"*).
2. Grouped switch rows. **The agent's three groups and the owner's three
   groups are alternatives, not additions** — `const G = owner ? OW : AG`.
   - Agent: **MY LEADS** (New lead for me · VIP lead from the owner · VIP ring
     in quiet hours *(default off)* · Lead will be taken back soon · Lead was
     taken back), **MY DAY** (Follow-up due · Meeting reminder · Meeting result
     needed · "What happened?" after WhatsApp), **TEAM AND OFFICE** (Leave
     answer · Late or not checked in · "Are you back?" · Team wall and
     bookings *(default off)*).
   - Owner: **LEADS**, **TEAM**, **SYSTEM**.
3. A row **"Install on your phone / Add to Home Screen · iPhone and Android ·
   no app store"**.
4. **Quiet hours** — three buttons, `Off · 22:00 – 08:00 · 20:00 – 09:00` —
   and under them *"VIP leads still ring in quiet hours if you allow it
   above."*

**Missing from the build:**

- The two exact permission-card strings. The build says "Notifications are on
  / Phone app and this computer".
- Five agent switches by name: **"Lead will be taken back soon"** ("10 min
  before (VIP) · 2 h before (import)") is in the build as "Lead goes back
  soon"; **"Lead was taken back"** ("With the reason") is not in the build at
  all; **"VIP ring in quiet hours"** survives only as the build's "VIP
  exception" block; **"Late or not checked in · Reminder at 09:10"** is in the
  build as "Check-in reminder" without the time; **"Are you back?" · When
  office Wi-Fi is seen** is gone (the build's attendance rules carry the rule,
  but there is no switch for the alert).
- The sub-lines that name a time: "Reminder at 09:10", "Daily summary at
  18:00", "Meeting result missing · At 21:00", "Daily summary email · Every
  day 08:30", "Absent at 10:00". The build's equivalents are wordier and drop
  the clock times, except "answer before 21:00".
- The owner switch **"Daily summary email · Every day 08:30"** — nothing in
  the build offers it.
- The line **"VIP leads still ring in quiet hours if you allow it above."**

**Extra in the build:** a "Where alerts go" block with separate Phone app and
This computer rows and a "How to install" link; "Turn all on / Turn all off"
per group; a live sentence under quiet hours ("Quiet from 22:00 to 08:00. Now
it is 12:46, so alerts reach you."); the closing note "The owner chooses the
office rules in Automations. Here you only choose what you want to hear
about."

`DISAGREEMENT:` the phone design **replaces** an agent's list with the
owner's. `design/web/settings.html` **appends** the owner's three groups after
the agent's three, so an owner sees six groups. The computer design wins and
the build does this.

---

# `SettingsTeam.dc.html` → `/v2/settings/team` as owner

**Design:** back · **"Team & roles"** · *"Owner · who can see and do what"* ·
a round filled **+** at the top right that opens the invite sheet. Then:

1. A **count strip** — four chips: `Owners N · Admins N · Agents N · Off N`.
2. A **people list**, one row each: coloured 40px initials avatar (dimmed to
   40% when deactivated), name, a sub-line that is their title or email — or,
   when deactivated, the exact string **"Deactivated · cannot sign in · leads
   moved to Incoming"**, or, for a pending invite, **"… · invite sent, not
   joined yet"** — and a right-aligned role badge (`Owner` warm, `Admin` blue,
   `Agent` green, `Off` grey). 13 people in the fixture.
3. A card **"WHAT EACH ROLE CAN DO"** with three rows: *Owner* — "Everything ·
   give VIP leads · see all leads · approve leave"; *Admin* — "Team, import,
   settings, all leads · no deleting owners"; *Agent* — "Own leads only ·
   cannot export · cannot see other agents' leads".
4. The owner-only block: **"Only for owners and admin / You are signed in as
   an agent. This page is not in your menu and you cannot open it. / Go to My
   Day"**.

**Tapping a person opens a bottom sheet** holding: their name and sub-line;
for yourself, **"This is you. You cannot change your own role or deactivate
yourself."**; otherwise a **Role** segmented control (Agent · Admin · Owner)
where choosing Owner needs **two taps** and says *"Owner sees everything and
can change everyone. Tap Owner again to confirm."*; **"Send a password reset
link"**; **"Sign out of every phone"**; a destructive button that reads
**"Deactivate this person"** then, on first tap, **"Tap again: deactivate and
move leads to Incoming"**; and **"See profile and results ›"** → `Colleague`.
Deactivating an Owner refuses with *"An owner cannot be deactivated here.
Change the role first."*

**The invite sheet:** "Invite a person", a Full name field, an Email field, a
role pair (Agent · Admin), **"Send the invite"**, with three inline errors —
*"Write the name."*, *"Write a real email address."*, *"This person is already
in the team."* — and the toast *"Invite sent to {email} · the link works for
48 hours"*.

**Missing from the build:**

- **The whole person sheet.** The build's row has one control, a role
  `<select>`. So: no **"Send a password reset link"**, no **"Sign out of every
  phone"**, no **Deactivate / Activate again**, no **"See profile and results
  ›"** link, no "This is you…" line.
- **Invite a person.** There is no + button, no invite sheet and no invite
  path anywhere on the screen. `CAN` in `Team.tsx` even *lists* "Invite people
  and change roles" as a thing an owner may do, and then does not offer it.
- The **two-tap confirmation on promoting somebody to Owner**, and its
  sentence. The build's `<select>` makes somebody an owner in one gesture.
- The deactivation consequence sentence **"Tap again: deactivate and move
  leads to Incoming"**, and the deactivated sub-line **"Deactivated · cannot
  sign in · leads moved to Incoming"**.
- The refusal **"An owner cannot be deactivated here. Change the role first."**
- The **"WHAT EACH ROLE CAN DO"** card as three plain rows. The build has the
  same information as a 4-column table behind a third tab ("What each role can
  do"), which at 390px is the wrong shape for it.
- The count strip's **"Off N"** chip — the build counts People, Roles and
  Notifications on, and never says how many are deactivated.
- The **"Only for owners and admin … Go to My Day"** block. The server does
  guard these endpoints (`requireRole('owner','admin')`), so the data will not
  arrive, but the design's own explanation does not exist.

**Extra in the build:** a "Who has notifications on" tab, which is the one
thing on this screen that catches a VIP lead handed to somebody whose phone
will never ring. Keep it.

**A layout defect, not a missing item:** the build's three KPI cards overflow
their row (`scrollWidth 371` in a `clientWidth 358` box with
`overflow-x: visible`), so **"▼ 2 get no alerts"** on the third card is cut
off by the right edge of a 390px screen and cannot be scrolled to. The role
counts row does the same (`144` in `68`).

---

# `SettingsAttendance.dc.html` → `/v2/settings/attendance` as owner

**Design:** back · **"Attendance rules"** · *"Owner & admin only"*. Then:

1. **OFFICE WI-FI · CHECK-IN WORKS ONLY ON THESE** — a list of network names
   (`homes.me-Office`, `homes.me-Office-5G`), each with a sub-line
   ("Floor 16 · added by Emir") and a **Remove** that becomes **"Tap again"**.
   Removing the last one refuses: *"Keep at least one office Wi-Fi, or nobody
   can check in."*
2. **"+ Add the Wi-Fi I am on now"**.
3. **SHIFT** — three native time inputs: **Starts**, **Ends**, **Late after**,
   plus **Days off** as seven square toggles `Mo Tu We Th Fr Sa Su`. Validation:
   *"The shift must end after it starts."* and *"'Late after' must be inside
   the shift."* The save button reads **"Save the shift"** and flips to
   **"Shift saved"**; the toast is *"Saved · shift 09:00 – 18:00 · late after
   09:10 · used from tomorrow"*.
4. **WORKING OUTSIDE** switches — *Ask to share location* ("Once when going
   outside, once when coming back") · *Must say who they are with* ("Lead,
   developer or event") · *Must write the place* ("Where exactly") · *Tell
   owners* ("Notification when someone goes outside").
5. **CALLS** switches — *Ask to check in before a call* ("In work hours only ·
   owners and admin are not asked") · *Allow "Call anyway"* ("The call is
   marked 'not checked in' for owners").
6. **"Download the October report (Excel)"**, toasting *"October report
   downloaded · one row per agent per day"*.
7. The owner-only block.

**Missing from the build:**

- **Wi-Fi network names.** The build asks for an **IP address** instead. This
  is deliberate and the reason is written at the head of
  `web/src/v2/settings/Attendance.tsx`: no browser on any platform exposes the
  SSID, so what the server can actually check is the address the office line
  is seen from. Both design files ask for the network name and both are
  wrong. **I am recording it as a difference, not a defect.** It does mean the
  design's "+ Add the Wi-Fi I am on now" becomes "use this address — only if
  you are sitting in the office", and the sub-line "Floor 16 · added by Emir"
  (who added a network, and when) has no equivalent.
- The refusal **"Keep at least one office Wi-Fi, or nobody can check in."**
  The build says "Check-in works only from here. Keep at least one." as a
  standing note, which is not the same as refusing the last removal.
- **"Must say who they are with"** and **"Must write the place"** — two of the
  design's four Working-outside switches have no build equivalent. The build
  has *Agents can work outside*, *Ask for the location once*, *Ask "Are you
  back in the office?"*, *Tell owners when someone starts*.
- The two shift validation messages, and the button that reads **"Save the
  shift" / "Shift saved"** (build: "Save rules" / "Undo changes").
- **"Download the October report (Excel)"**. The build links to the team
  attendance screen ("Open team attendance") instead of exporting anything.
- The subtitle **"Owner & admin only"**.
- The owner-only block.

**Extra in the build:** a Saturday short-day pair of times; grace minutes as a
number with a derived "Late from 10:10"; a sentence naming the working days;
an "Ask people to check in" master switch that is disabled until an address is
saved; "Changes start tomorrow morning. Today's check-ins stay as they are."

`DISAGREEMENT:` the phone design's shift is one Starts/Ends/Late-after triple
and a day picker. `design/web/settings-attendance.html` adds the separate
Saturday hours and the grace-minutes field. Computer wins; the build does
this.

---

# `AISettings.dc.html` → `/v2/settings/ai` as owner

**Design:** back · **"Homes AI settings"** · *"What the AI can see and do"*.

1. **"This month's AI budget"** with **"$38 of $100"** and a progress bar,
   under it *"AI pauses at the limit · owners get an email at 80%"*.
2. **AI CAN** — five switch rows: *Answer from CRM data* ("Leads, notes,
   calls, projects") · *Write WhatsApp drafts* ("Agent always presses send") ·
   *Read project brochures* ("Fills Live projects from a PDF") · *Turn voice
   notes into text* ("Arabic and English") · *Agents see only their own leads*
   ("Same rules as the CRM").
3. **"What AI should know about us"** — a textarea pre-filled with *"We sell
   Dubai off-plan. Be short and friendly. Never promise prices or returns.
   Reply in the client's language."* — and **Save**.
4. The owner-only block.

**Missing from the build:**

- **"Read project brochures · Fills Live projects from a PDF"** — the build's
  five switches are *Write "In short" on each lead*, *Suggest the best time to
  call*, *Turn voice notes into text*, *Write the morning brief for owners*,
  *Answer questions in Homes AI chat*. Reading a brochure to fill the project
  library is not among them.
- **"Write WhatsApp drafts · Agent always presses send"** — no switch.
- **"Agents see only their own leads · Same rules as the CRM"** as a *switch*.
  The build states it as a standing sentence at the foot ("Homes AI reads only
  what the person may see…"), which is better — a permission should not be a
  toggle — but the design's row is gone.
- The default "about us" text. The build ships an empty-ish field with a
  character count.
- The owner-only block.

**Extra in the build:** a monthly-limit chooser ($50 / $100 / $200); "Day 13
of 30 · At this speed: about $89 by the end of the month"; a spend breakdown
by feature (In short $14.10, Voice notes $9.20, Chat $8.30, Morning brief
$4.10, Best time to call $2.70); "Owners are told at 80% and at 100%"; a
"5 of 5 on" counter; an "Open Homes AI" link.

---

# `Company.dc.html` → `/v2/settings/company` as owner

**Design:** back · **"Company details"** · *"Shown on offers, emails and
cards"*. A logo card ("homes.me / Logo · tap to change"), then fields in this
order — **Legal name**, **Brand name**, **ORN** and **TRN** side by side,
**Office address**, **Main phone** and **Email** side by side, **Website** —
then **Save**, then the owner-only block.

**Missing from the build:**

- The **logo row** ("Logo · tap to change"). The build has no logo upload on
  this screen at all; it renders the wordmark in the preview and never offers
  to change it.
- The subtitle **"Shown on offers, emails and cards"** (build: "These details
  show on business cards, sales offers and the sign-in page" — a rewrite, not
  a loss).
- The owner-only block.

**Extra in the build:** a "1 detail to check" warning naming the missing TRN
and why it matters; sub-headings (Names / Licence numbers / Address /
Contact); **Trade licence** and **Licence expires** fields; a **WhatsApp**
field; required markers; a "WHERE IT SHOWS" preview of the business-card back
and the sales-offer footer; Undo changes.

---

# `Health.dc.html` → `/v2/settings/health` as owner

**Design:** back · **"System health"** · *"Everything is running · checked 2
min ago"*. Then a **full-width near-black hero card** reading **"All systems
OK / 1 thing to look at"** with a lime tick. Then one card of six rows, each
an icon, a name, a sub-line and a right-aligned pill:

| Row | Sub-line | Pill |
|---|---|---|
| Push notifications | Sent 412 today · 0 failed | OK |
| Email | Sent 96 today · 0 bounced | OK |
| WhatsApp templates | 1 waiting for Meta review | **Check** |
| Imports | Last import 09:12 · 240 rows | OK |
| Homes AI | Answering in 1.8 s | OK |
| Background jobs | 5-minute rule ran 31 times | OK |

Then **"Run a check now"**, then the owner-only block.

**Missing from the build:**

- The **hero status card**. The build has a plain line, "4 of 5 services are
  set up".
- The **"checked 2 min ago"** subtitle.
- Three of the six rows: **Imports** ("Last import 09:12 · 240 rows"),
  **Background jobs** ("5-minute rule ran 31 times") and **WhatsApp
  templates** with its amber **"Check"** action for a template waiting on Meta
  review. Background jobs is the one that matters: the worker runs inside the
  API process, and nothing on this screen says whether it ran.
- The **throughput sub-lines** — "Sent 412 today · 0 failed", "Sent 96 today ·
  0 bounced", "Answering in 1.8 s". The build's rows say only whether a
  service is *configured* and what breaks if it is not ("Client emails will
  not send.", "Follow-ups outside 24 hours will not send.").
- The **"Run a check now"** button's position — the design puts it below the
  list, the build above it.
- The owner-only block.

**Extra in the build:** "Office check-in" as a service; a "Who will not hear
an alert" block naming the two people with no phone registered; a "The website
form" block with a 7-day lead count; and an honest note that nothing records
history yet, so there are no uptime bars.

`DISAGREEMENT:` the two designs list different services.
`design/web/system-health.html` has **CRM website and sign-in · Database ·
Notifications · Tracked links · File storage · Homes AI**, with 30-day bars, a
"What to do" paragraph and a list of past problems. The phone design has the
six above. The computer design wins — and the build matches neither.

---

# `OwnerBanners.dc.html` → `/v2/settings/banners` as owner

**Design:** back · **"Home banners"** · *"What agents see at the top of My
Day"*. Then:

1. **PREVIEW** — a real 168px banner card with a cover image behind it, a
   label chip, the headline, the body line and a **"{{cta}} →"** button, all
   updating live as the form is typed.
2. **New banner** — **Upload image** and **Use project photo** drop zones;
   **Label** chips (`From Emir · Office · Project · Best of Homes ·
   Training`); **Title**; **Short text**; **Button text** beside **Opens**
   (`Project page · Best of Homes · Team wall · A web link`); **Show from**
   and **Until** dates; **Who sees it** (`Everyone · Agents · One desk`);
   **Publish banner**; then the confirmation strip **"Live now on everyone's
   My Day · push sent"**.
3. **All banners** — *"drag to reorder"* — five rows, each with a thumbnail,
   title, date range, a status pill (**Live** / **Scheduled** / **Ended**), a
   **"seen by 9 of 10"** count and an on/off switch.
4. The note **"Best size: 1200 × 500 px. Up to 5 banners slide every 4.5
   seconds."**
5. The owner-only block.

**Missing from the build:**

- **Images.** No upload, no "Use project photo", no thumbnails in the list,
  and the preview is a text card on a dark background. This is the single
  biggest gap on the screen: the design's banner is a picture.
- The **Label** chips, and with them the eyebrow text on the banner. The build
  hard-codes "FROM THE OWNER" in the preview.
- **Button text** and the **Opens** dropdown. The build asks for a raw path
  ("Where it goes when tapped", pre-filled `/v2/projects`), which is a
  developer's field on a screen an owner uses.
- **Show from / Until** dates — so no **Scheduled** state and no **Ended**
  state. The build has only on/off.
- **Who sees it** (Everyone / Agents / One desk).
- **"seen by N of 10"** per banner.
- **Drag to reorder.** The build uses an up and a down arrow per row.
- The confirmation strip **"Live now on everyone's My Day · push sent"** — and
  with it the statement that publishing sends a push.
- The note **"Best size: 1200 × 500 px. Up to 5 banners slide every 4.5
  seconds."** The build says "Up to five, and they take turns" without the
  interval or the image size.
- The owner-only block.

**Extra in the build:** a "2 of 5 showing" counter and a "Change" button per
row.

---

# `InstallGuide.dc.html` → `/v2/settings/phone-app`

**Design:** back · **"Install on your phone"** · *"2 minutes · no App
Store"*. Then a card **"homes.me CRM on your Home Screen / Opens like an app.
Notifications on your lock screen. Tap one and it opens the right page."**, an
**iPhone / Android** segmented control, and then — and this is the screen's
whole point — **every step is drawn**:

*iPhone, 5 steps:* ① "Open the CRM in Safari" with a drawn address bar reading
`crm.homes.me`; ② "Tap the Share button" with a drawn Safari toolbar and the
Share icon highlighted; ③ "Tap 'Add to Home Screen'" with a drawn Share sheet
listing *Copy · Add to Favourites · **Add to Home Screen** · Print*; ④ "Open
homes.me from the icon" with a drawn home-screen grid and the homes.me icon
picked out; ⑤ "Tap 'Turn on notifications' › Allow" with a drawn iOS
permission dialog (*"homes.me" would like to send you notifications / Alerts,
sounds and icon badges / Don't Allow · Allow*). Then an amber note: **"Needs
iOS 16.4 or newer. Check: Settings › General › About."**

*Android, 4 steps:* the same shape, with a drawn Chrome ⋮ menu (*New tab ·
Bookmarks · **Install app** · Settings*) and the Android permission dialog,
then the note **"On Android, notifications can also show a photo and buttons
like Call and WhatsApp."**

Then **"What you will see"** — a drawn lock screen, "Wednesday 11 November /
9:41", with five notification cards, each tagged with where it lands:

| Notification | Body | Tag |
|---|---|---|
| New lead: Khalid A. | The Archive · 2BR · AED 2M · from Emir, with **Call** and **WhatsApp** buttons | TAP › LEAD PAGE |
| Meeting in 30 min | Sara Nunes · Office · Room 2 | TAP › CALENDAR |
| Marco opened your brochure | Good moment to call · opened 3 times | TAP › MARCO'S LEAD |
| Task due: payment plan to Priya | Due 12:00 today | TAP › TASKS |
| 3 messages waiting for your update | WhatsApp · Telegram | TAP › MY DAY |

Then **"TAP A NOTIFICATION, IT OPENS…"**, a seven-row table: *New lead · VIP
lead → Lead page ›* · *Meeting soon · meeting result due → Calendar ›* · *Task
due → Tasks ›* · *Follow-up overdue → Follow-ups ›* · *Client opened your link
→ That lead ›* · *Messages waiting for update → My Day ›* · *Absent alert
(owners) → Attendance ›*.

Finally a **"Turn on notifications"** button that becomes **"Notifications are
on / A test notification was sent to this phone"**, and **"Choose which alerts
you get ›"**.

**Missing from the build:**

- **Every drawn mock-up.** The Safari toolbar, the Share sheet with "Add to
  Home Screen" picked out, the Chrome ⋮ menu with "Install app" picked out,
  the home-screen icon grid, both permission dialogs. The build's steps are
  text only. On a guide whose job is "find this button on your phone", the
  picture *is* the instruction.
- The **`crm.homes.me` address chip** in step 1. The build says "Type the same
  address you use here into your phone's browser" and never prints the
  address. (`design/web/install-guide.html` goes further and puts a **QR code
  to scan with the phone camera** at the top; the build has neither.)
- The **lock-screen mock-up**, and with it the **Call** and **WhatsApp**
  action buttons on a notification. The build shows three plain rows.
- The **"TAP A NOTIFICATION, IT OPENS…" table**. Not in the build in any form,
  on either design's wording. This is the table that tells an agent that every
  alert deep-links, which is the reason to install at all.
- **"Needs iOS 16.4 or newer. Check: Settings › General › About."** The build
  says "An older iPhone? Open Settings → General → Software Update first.",
  which is the computer design's wording and does not name the version.
- **"On Android, notifications can also show a photo and buttons like Call and
  WhatsApp."**
- The **"Turn on notifications"** button's **success state** — "Notifications
  are on / A test notification was sent to this phone". The build has "Turn on
  alerts here" for the computer only, and on this machine it renders as
  "Blocked in this browser."
- The link **"Choose which alerts you get ›"** reads "Choose my alerts" in the
  build — same job, different words.

**Extra in the build:** an "Alerts are blocked on this computer / Your phone is
the one that matters" state, and an "Alerts on this computer · Optional" block.

`DISAGREEMENT:` the two designs' deep-link tables differ in both length and
destination. The phone design has 7 rows and sends *New lead · VIP lead* to
the **Lead page**; `design/web/install-guide.html` has 11 and sends *VIP lead
from Emir* to **"My Day, with the countdown and 'Accept VIP lead'"**, adding
*How did it go? → the meeting result dialog*, *Transfer request → Transfers,
under "For you"*, *Leave request answered → Attendance, on the Leave tab*,
*VIP lead not called → Incoming, on "VIP leads I gave"*, *Leave request → Team
attendance*, *Transfer needs approval → Transfers* and *Agent absent → Team
attendance*. The computer design wins.

---

# `Login.dc.html` → `/login`

The build's sign-in is the **v1 screen**, `web/src/pages/Login.tsx`. It was
never redrawn, and `docs/v2/screens.md` says so. **Note also:** the preview
build signs you in automatically, so `/login` bounces; to look at it you must
set `localStorage['emir.previewSignedOut'] = '1'` first. I did.

**The phone design, top to bottom:** a 56px rounded-square brand mark beside
**"homes.me"**; a two-line headline **"Welcome back." / "Let's close
deals."**; the line *"Use the email and password your admin gave you."*;
**Email** (`type="email"`, placeholder `you@homes.me`); **Password**
(`type="password"`, placeholder `••••••••`); a **ticked** checkbox **"Keep me
signed in on this phone"**; a wide near-black **"Sign in ›"**; a dashed box
labelled **"DESIGN DEMO ONLY · CHOOSE WHO SIGNS IN"** holding *Agent · Rocky*
and *Owner · Emir*; an **English / العربية** pill pair; and a green card:
**"No app to download.** Open crm.homes.me in Safari or Chrome, tap Share ›
Add to Home Screen. It opens full-screen like an app. **Show me how ›"** —
that last link going to `InstallGuide`.

**There is no bottom bar and no dial button** (`grep -c "<nav"` = 0), as
`phone-shell.md` §1.2 says for all four full-attention screens.

**The dashed demo box is the prototype's own scaffolding and must not be
built.** The **English / العربية** switch below it is *not* inside that box and
is a real control.

**What the phone design has that the build's login does not:**

- The **second headline line, "Let's close deals."** The build has "Welcome
  back" alone.
- The **English / العربية** switch. `design/web/login.html` has it too, so
  both designs agree and the build has neither.
- The **"No app to download…" card and its "Show me how ›" link** to the
  install guide. Both designs have it (the computer design words it "Put
  homes.me on your phone · install guide"); the build has no route from the
  sign-in screen to `/v2/settings/phone-app`. An agent signing in on a new
  phone is exactly the person who needs it, and this is the only screen they
  can see before signing in.
- **"on this phone"** in the remember-me label. The build says "Keep me signed
  in".
- The **placeholders** `you@homes.me` and `••••••••`.
- The **chevron** on "Sign in ›".
- A **single-column, image-free layout**. The build bands a photograph of the
  team across the top of the card, which on a 390px screen takes the first
  ~200px before the form starts.

**Extra in the build:** the team photograph and its overlay headline; an
**"or"** divider and an **"Email me a sign-in link"** button (a magic-link
flow that is in neither design); the hint **"Forgot your password? Ask your
admin to reset it."**; and a redirect to `/setup` when the CRM has no accounts
yet.

`DISAGREEMENT:` the sub-line. Phone design: *"Use the email and password your
admin gave you."* Computer design: *"Use your work email and your password."*
with a **"Forgot password?"** link and a **Show** toggle on the password
field. Computer wins; the build uses the phone wording and has neither
control.

`DISAGREEMENT:` `design/web/login.html` draws a **two-step sign-in for owners
and admin** — "Owners and admin need a second step. Write the 6 digits from
your code app." The phone design has no second step, and neither does the
build. Computer wins, so this is an unbuilt requirement, not a phone one.
Flagging it here because this is the row where it lands.
