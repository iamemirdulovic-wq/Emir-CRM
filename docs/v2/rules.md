# v2 web rules — shell, interactions, dashboards

Build-ready restatement of every rule in the two design research files:

| Source | Covers |
|---|---|
| `design/web/research/nova.md` | Sidebar, top bar, 10 interaction rules, lead page, all-leads table, avoid list |
| `design/web/research/atlas.md` | 11 dashboard rules, owner dashboard layout, agent "My Day" layout, wow ideas, avoid list |

Every rule below has a stable ID so a reviewer can cite it (`S-12`, `I-4`, `D-6`). **118 rules.**
Provenance is given per block. Where the two files disagree, the rule is stated as written and the
disagreement is listed in **[Conflicts](#conflicts)** at the end — do not resolve those silently.

## Why (the reasoning the files give)

- **Nova's verdict.** The rejected sidebar was 17 equal items in one flat list with "NEW" pills.
  One trial (style5) hid six tools under "More"; another (style3) was still ungrouped. The fix:
  four quiet groups, counts only where action is needed, settings and account pinned at the bottom.
- **Atlas's verdict.** Four of the five dashboard trials opened with 8 equal number tiles, so nothing
  leads and it "reads as old". Style 3 — bento, a big "Needs you now", calls by hour — is the base.
  Style 5's "vs yesterday" deltas and pipeline strip are added to it. Style 2's dark becomes a theme
  rather than the default.

---

# 1. Shell

## 1.1 Sidebar frame and geometry (nova §1)

- **S-1** The sidebar is **248 px** wide.
- **S-2** Rows are **36 px** tall.
- **S-3** Every row is **icon + label**. No icon-only rows in the expanded sidebar.
- **S-4** Group labels are **small, grey** text.
- **S-5** Groups are **always open**. No collapse control on a group, no accordion, no sub-menus
  that open and close.
- **S-6** Only the middle (the groups) scrolls on short screens. The logo at the top and the pinned
  bottom block stay fixed.
- **S-7** There are exactly **four labelled groups** — LEADS, PLAN, PROJECTS, TEAM — plus one
  **unlabelled top group** and a **pinned bottom block**.
- **S-8** Nothing is hidden behind a "More" entry. Every destination the role can reach is visible
  in the list.

## 1.2 Groups and order — Owner / Admin (nova §1)

Items are listed in the order they must appear.

- **S-9** Unlabelled top group: **Dashboard · Incoming**.
- **S-10** **LEADS**: All leads · Follow-ups · Pipeline · Transfers · Import.
- **S-11** **PLAN**: Calendar · Tasks.
- **S-12** **PROJECTS**: Projects · Sales offers.
- **S-13** **TEAM**: Team · Team wall · Attendance · Activity.
- **S-14** **Pinned bottom**: Ask AI · Automations · Settings · profile row.

## 1.3 Groups and order — Agent (nova §1)

- **S-15** Unlabelled top group: **My Day · Incoming**. (Agents get My Day where owner gets Dashboard.)
- **S-16** **LEADS**: My leads · Follow-ups · Pipeline · Transfers. **No Import.**
- **S-17** **PLAN**: Calendar · Tasks.
- **S-18** **PROJECTS**: Projects · Sales offers.
- **S-19** **TEAM**: Team · Team wall · Attendance. **No Activity.**
- **S-20** **Pinned bottom**: Ask AI · Settings · profile row. **No Automations.**

## 1.4 Badges (nova §1)

- **S-21** A badge is a **plain number**. No "NEW" pills, no decorative badges, no colour on items
  that need no action.
- **S-22** **Red only for "late or waiting on you."** Every other badge is grey.
- **S-23** Owner/admin badge sources: Incoming = leads waiting (**red**) · Follow-ups = overdue
  (**red**) · Transfers = waiting for approval · Tasks = overdue (**red**) · Attendance = leave requests.
- **S-24** Agent badge sources: Incoming = free leads · Follow-ups = overdue (**red**) · Transfers =
  requests to answer · Tasks = overdue (**red**). Attendance carries no badge for an agent.
- **S-25** Projects, Sales offers, Team, Team wall, Ask AI, Automations and Settings carry **no badge**.

## 1.5 Active item (nova §1)

- **S-26** The active item shows **all four** markers at once: a soft green filled pill, a dark-green
  bold label, a filled (not outline) icon, and a **3 px green bar on the left edge**.

## 1.6 Folded rail (nova §1)

- **S-27** The collapse control is a **button beside the logo**; keyboard shortcut **`[`**.
- **S-28** Folded, the sidebar is a **68 px icon rail**.
- **S-29** In the rail: labels become **tooltips**, group labels become **lines**, badges become
  **dots**, and the active pill **stays**.
- **S-30** The folded/expanded choice is **remembered** between visits.
- **S-31** The sidebar **auto-collapses below 1200 px** viewport width.

## 1.7 What the ambiguous items are (nova §1)

- **S-32** **Attendance is one nav item with tabs.** Owner tabs: Team today · Leave requests ·
  My attendance · Rules. Agent tabs: Today · Month · Leave.
- **S-33** **Team** is the "Meet the team" screen, and **Best of Homes is a tab inside it** — not its
  own nav item.
- **S-34** **Activity** is "Team activity" with **Live** and **Messaging** tabs (owner/admin only).
- **S-35** The **profile row** shows photo, name and role. Its menu: My profile · Business card ·
  Security · Appearance · Feedback · Sign out.
- **S-36** **Notifications live in the top-bar bell only.** There is no notifications item in the sidebar.

## 1.8 Top bar (nova §2)

- **S-37** Order, left to right: **page title → search → + Add lead → check-in pill (agents) → bell → avatar.**
- **S-38** **Page title.** On a lead record the title becomes a back affordance: **"← All leads"**.
- **S-39** **Search box is always visible**, about **480 px**, placeholder
  `Search leads, phone, project…  Ctrl K`.
- **S-40** **Before typing**, search shows **recent leads and common actions** (never an empty box).
- **S-41** **While typing**, results are grouped: **Leads · People · Projects · Screens · Actions.**
- **S-42** **No result** offers two outs: **"Add as a new lead"** or **"Ask AI"**.
- **S-43** **"+ Add lead" is the only filled button in the top bar.**
- **S-44** Add lead carries a **small arrow** for: Task · Follow-up · Meeting · **Import (owner only)**.
- **S-45** **Check-in pill, agents only**, three states: amber **"Check in"** → green
  **"In office · 08:52"** → blue **"Outside · back 15:00"**. *(See Conflicts C-5.)*
- **S-46** **Bell** shows a red count and opens a **right panel**; **each item opens its exact page**,
  not a generic list.
- **S-47** The **avatar menu is identical** to the profile-row menu (S-35).
- **S-48** **No floating AI pill**, anywhere — it covers table rows. AI is reached from the sidebar
  (Ask AI) and from search. *(See Conflicts C-7.)*

## 1.9 Behaviour at different widths

The files give exactly three width rules; there is no tablet or phone spec in either.

- At/above the design width (**1440 px**, nova §4 and §5; **1440×900**, atlas): sidebar expanded at
  S-1 width, dashboard content on 12 columns, no scrolling in the primary zone (**D-9**).
- **Below 1200 px**: the sidebar auto-collapses to the 68 px rail (**S-31**). Everything else is
  unspecified.
- The folded state is a remembered user preference (**S-30**), so a wide screen may still show the
  rail if the user chose it.

---

# 2. The interaction rules (nova §3 — all ten)

Each is stated so a developer can implement it and a reviewer can check it.

- **I-1 Lists open a right panel, not a new page.** The panel is **480 px**, the list stays visible
  behind it, and **"Open full page"** sits at the top of the panel. **Every lead keeps its own link** —
  a panel must be addressable, so the full page and the panel show the same record from the same URL
  scheme.
- **I-2 Dialogs only for short decisions** — confirm, Lost reason, Won form. **Long work gets a full
  page** (Import, Settings). Reviewer check: no multi-step work inside a modal.
- **I-3 One filled green button per screen.** Everything else is outline, text or icon. Reviewer
  check: count the filled buttons on any screen; the answer is 1.
- **I-4 Risky actions ask twice**, the confirmation **names the consequence** in the user's words
  ("Move 12 leads to Rocky?"), and the action is followed by a **toast with Undo**.
- **I-5 Filters sit in one row above the table.** Active filters become **removable chips** with
  **"Clear all"** and a **result count**.
- **I-6 Bulk select:** a checkbox per row; the header checkbox selects **the current page**, then
  offers **"Select all 863"** for the whole result set. A **dark bar slides up from the bottom**
  carrying the count and the actions.
- **I-7 Row actions appear on hover**, at the right of the row: **Call, WhatsApp, More.**
- **I-8 Toasts** are **bottom-left**, last **5 seconds**, are **one sentence**, and carry **Undo**
  where an undo exists. **Errors stay until closed.**
- **I-9 Shortcuts, and they are shown in tooltips:** **Ctrl K** search · **N** new lead · **`[`**
  sidebar · **Esc** close · **↑↓** move between rows · **Enter** open. *(See Conflicts C-2.)*
- **I-10 Never a blank screen.** **Grey skeleton rows** while loading. An empty state is **one
  sentence and one button** — "No follow-ups today. Add one".

## 2.1 Nova's avoid list — review checks (nova §6)

- **A-1** Never a flat list of 15+ nav items, and never hide tools under "More".
- **A-2** No collapsible groups or sub-menus that open and close.
- **A-3** No decorative badges ("NEW"), and no colour on every item.
- **A-4** No dialog on top of a dialog, and no panel as wide as the screen.
- **A-5** No icon-only buttons without labels, and **no action reachable only by shortcut or
  right-click** — every action has a visible path.

---

# 3. Dashboards

## 3.1 The 11 layout rules (atlas)

- **D-1 Grid.** **12 columns, 16 px gaps, 24 px card padding, one corner radius (22).**
- **D-2 Bento, not tile rows.** **6–8 cards per screen**, sized by importance. **One hero card is at
  least twice the size of any other.** *(See Conflicts C-9.)*
- **D-3 Top-left is the action,** not a statistic. It answers "what do I do now?".
- **D-4 Three number sizes only:** hero **64–72 px**, card **32–40 px**, table **14–15 px**. Labels
  **13 px, muted**.
- **D-5 No bare numbers.** Every number carries either a **delta** ("▲ 4 vs yesterday") or a
  **state** ("3 waiting").
- **D-6 Charts.** Bars for calls by hour; **one segmented bar** for pipeline and for attendance;
  **sparklines inside table rows**. **No pies, no donuts, no gauges, no 3D, no dual axes.**
  **Maximum 3 charts per screen.** *(See Conflicts C-10.)*
- **D-7 Colour means status only.** Neutral surfaces; **one accent**, used for the main button and
  the hero. **Red = late/overdue, amber = warning, green = good** — and **always with a word or an
  icon** beside the colour. *(See Conflicts C-6.)*
- **D-8 Everything is clickable.** **Every number opens its own filtered list.** **Every alert row
  has one button with one verb** — Give, Approve, Answer.
- **D-9 No scrolling at 1440×900.** Secondary lists sit below the fold.
- **D-10 Empty space is deliberate.** **32 px between zones**, **no divider lines inside cards**,
  **44 px table rows** (**36 px** in the team table).
- **D-11 Motion carries meaning.** **Count-up on load (400 ms)**, **150 ms hover**, a **soft pulse on
  a row that changed**, **live countdowns**. **Skeletons, not spinners.**

## 3.2 Owner dashboard — 1440×900 (atlas)

- **OD-1** Sidebar **232 px**; content on **12 columns**. *(See Conflicts C-1.)*
- **OD-2** Top bar: **search · period switch (Today / Week / Month / Year) · "Live · 14:55" · bell ·
  Add lead.** *(See Conflicts C-3.)*
- **OD-3** **Row 1 is 300 px tall.**
- **OD-4** **Cols 1–5 — "Needs you now" (the hero, a dark card).** A giant count plus
  **"oldest waits 42 min"**.
- **OD-5** The hero holds **up to 5 rows in this fixed order**: VIP not called → transfer approvals →
  leads waiting in Incoming → leave requests → absent agent. **One button on each row.**
- **OD-6** **Cols 6–9 — "Calls today".** The number at **72 px with a delta**; a **bar chart of calls
  per hour with the current hour highlighted**; footer = **speed of first contact (median minutes)**.
- **OD-7** **Cols 10–12 — two stacked tiles:** "New leads 27 · 3 in Incoming" and
  "Meetings 5 · Units booked 1 (Talha)".
- **OD-8** **Row 2 is 104 px; cols 1–12 are the pipeline strip** — **one segmented horizontal bar**
  over **New, Called, Interested, Meeting, Offer, Won**, with **Lost set apart in grey**. **Count and
  % per stage**, and **clicking a stage opens the filtered list**. *(See Conflicts C-8.)*
- **OD-9** **Row 3 is 348 px tall.**
- **OD-10** **Cols 1–8 — "Team right now" table**, with **one attendance bar above it** (in office /
  late / outside / leave / absent). Columns: **agent · status · check-in time · calls today (7-day
  sparkline) · open leads (bar, red above the desk maximum) · overdue follow-ups**. **Problem rows
  sort first.**
- **OD-11** **Cols 9–12 — "Watch list".** Four rows, numbers at **32 px**: follow-ups overdue (9) ·
  no next step (31) · transfers today (2, 1 waiting for approval) · WhatsApp taps (104, unanswered
  "what happened?").
- **OD-12** **Below the fold:** latest leads table · "VIP leads I gave" · Import shortcut.

## 3.3 Agent "My Day" — 1440×900 (atlas)

- **AD-1** Top bar: **greeting ("Good morning, Rocky") · check-in pill · bell · Add lead.** The pill
  reads green "In office 08:55" / amber "Outside · back by 15:00" / **red "Not checked in"**.
  *(See Conflicts C-3, C-5.)*
- **AD-2** **Row 1 is 260 px tall.**
- **AD-3** **Cols 1–8 — the hero, with three mutually exclusive states:**
  - **(a) Not checked in** → a large **"Check in"** card.
  - **(b) A VIP lead is waiting** → **phone number largest**, then name, project, the owner's note, a
    **countdown ring ("18:42 left") that turns amber at 10 minutes**, and buttons **Accept and call** /
    **I can't take it** (the latter is **two taps, with Undo** — cf. I-4).
  - **(c) Otherwise** → **"Start calling · 14 leads today"** with the next lead's name.
- **AD-4** **Cols 9–12 — "Next plan":** time at **40 px**, plan type, lead, place, **"in 35 min"**;
  beneath it, **meetings waiting for "how did it go?"**.
- **AD-5** **Row 2 is 96 px: four tiles, 3 columns each — My leads · To call today · Hot · Meetings.**
- **AD-6** **Row 3 is 396 px tall.**
- **AD-7** **Cols 1–5 — Call list.** Today's queue, **VIP first**; each row: name · project · stage
  chip · **client's local time** · Call button. Footer shows **"6 of 14 done" as a progress bar**.
- **AD-8** **Cols 6–9 — Today's plan.** A **vertical timeline 09:00–19:00 on a 24-hour clock** with a
  **"now" line**; meetings, site visits and tasks render as blocks.
- **AD-9** **Cols 10–12 — two stacked cards.** **"Follow-ups":** Overdue (**red count**), Today, and
  the **next three each with a Done button that asks what happened**. **"Transfers":** incoming to
  accept, outgoing waiting, plus **"messages waiting for your update"**.
- **AD-10** **Below the fold:** leads by stage · colleagues strip · live projects · AI tip ·
  owner banners.

## 3.4 The five "wow" ideas, kept because they are useful (atlas)

- **W-1** A **VIP countdown ring that changes colour** as take-back time nears (cf. AD-3b).
- **W-2** A **"now" line that moves** across both the calls-by-hour chart and the agent timeline, all day.
- **W-3** **Alert rows slide out when solved**, and the hero count **ticks down to "All clear"**.
- **W-4** A **command bar (press `/`)** that finds any lead, person or screen. *(See Conflicts C-2.)*
- **W-5** **One written sentence at the top from the AI**: "Today is slower than Tuesday: 3 VIP leads
  are not called." *(See Conflicts C-4.)*

## 3.5 Atlas's avoid list — review checks

- **DA-1** No row of 8 equal number tiles.
- **DA-2** No pies, no donuts with many slices, no gauges, no 3D.
- **DA-3** No colour as decoration: no gradients, no rainbow chips, no different colour per card.
- **DA-4** No dense table as the first thing on the page.
- **DA-5** No number without a comparison and without a click (the positive form is D-5 + D-8).

---

# 4. Anything else the two files specify

## 4.1 Lead page — 1440 px, three columns (nova §4)

- **L-1** Three columns at 1440 px: **300 px sticky left · flexible middle · 320 px right**.
- **L-2** **Left column**, sticky: **phone number largest**, then name, **"with {agent}"**, tags, and
  **client local time plus best time to call**.
- **L-3** Left-column buttons in order: **Call (the filled one) · WhatsApp · Telegram**, then
  **Follow-up · Meeting · Won · Lost**.
- **L-4** Below those: **"Transfer this lead"**; for an owner the same control reads
  **"Give to another agent"**.
- **L-5** **Middle column:** a **Next step card**, then **"In short"**, then the **add-note box**, then
  tabs **Timeline · Notes · Files**, **newest first**.
- **L-6** **Right column:** **Details, where clicking any line edits it** (project, budget, purpose,
  languages, source); then **upcoming plans and tasks**; then **Info**.

## 4.2 All leads table (nova §5)

- **T-1** Columns in order: **☐ · Name (+VIP tag) · Phone · Project · Stage (colour chip) · Agent ·
  Next step (red if overdue) · Last contact · Source.**
- **T-2** **Sticky header, 50 rows per page, sortable columns.** (Pagination, not infinite scroll.)
- **T-3** **Quick tabs, each with a count:** All · Going cold · Overdue · No next step · VIP · Lost.
- **T-4** **Filter row:** search-in-list · Agent · Stage · Project · Source · Date · **Export (owner,
  far right)**.
- **T-5** **Bulk bar** reads: **"12 selected · Move to agent · Move to Incoming · Cancel"** (the
  dark bottom bar of I-6).
- **T-6** **Agent "My leads"** is the same table **without the Agent column** and **without Export or
  bulk move**; its tabs are **Today · New · Overdue · No next step · VIP · Lost · All**; it adds a
  **"Start calling"** button.

## 4.3 Vocabulary the files fix

Both files assume these names on screen; changing them is a design decision, not a rename.

- **Incoming** — the pool of unassigned/free leads. **Transfers** — handing a lead between agents,
  with an approval step. **"Give to another agent"** is the owner's wording for a transfer (L-4).
- **Team wall · Best of Homes · Team activity (Live / Messaging) · Attendance · Automations.**
- Agent-facing counters: **Going cold · Overdue · No next step · VIP · Hot · desk maximum**
  (the open-leads ceiling that turns the bar red, OD-10).
- Example people used in the specs: **Rocky** and **Talha** (agents). **AI** is called
  **"Ask AI"** in nova and **"Homes AI"** in atlas (C-4).
- Clock format is **24-hour** throughout (AD-8, and the pill times in S-45).

## 4.4 Research sources cited by the files

- **nova**: saasui.design on sidebar navigation, command palettes, data tables and slide-over panels;
  HubSpot's default record layout; uxmovement on grouping sidebar items.
- **atlas**: lazarev.agency on CRM dashboard design; saasframe on bento grids; Smashing Magazine on
  real-time dashboard UX; saasui.design on KPI cards; basedash on choosing a chart; idreesworks on a
  real-estate pipeline redesign; visdum on what reps see vs what admins see.

---

# Conflicts

Where the two files disagree. **Each needs a decision; none should be resolved silently in code.**

- **C-1 Sidebar width: 248 px or 232 px.** Nova §1 says the sidebar is **248 px** (S-1). Atlas's owner
  dashboard says **"Sidebar 232 px; content 12 columns"** (OD-1). The 16 px difference matters because
  Atlas sizes the 12-column grid against it.
- **C-2 Command/search key: `Ctrl K` or `/`.** Nova rule 9 binds search to **Ctrl K** and shows it in
  the search placeholder (I-9, S-39). Atlas's wow idea 4 wants **"a command bar (press `/`)"** (W-4).
  Two different keys for what is described as the same finder. `/` also collides with typing in any
  text field unless guarded.
- **C-3 Top-bar contents and order.** Nova fixes six slots in order — page title, search, + Add lead,
  check-in pill, bell, avatar (S-37). Atlas's owner top bar is **search, period switch, "Live · 14:55",
  bell, Add lead** (OD-2) and the agent's is **greeting, check-in pill, bell, Add lead** (AD-1).
  Three specific disagreements: (a) Atlas has **no page title**, replacing it with a **greeting** on
  My Day; (b) Atlas adds a **period switch** and a **live clock** that Nova never mentions and leaves
  no room for in a 480 px search bar plus title; (c) Atlas puts **Add lead after the bell**, Nova puts
  it **before**. Atlas also shows **no avatar**.
- **C-4 The assistant's name: "Ask AI" or "Homes AI".** Nova labels the sidebar item and the
  no-results action **"Ask AI"** (S-14, S-42). Atlas calls the dashboard sentence
  **"Homes AI"** (W-5). One name must win. *(Note for the owner: the project brief in `CLAUDE.md`
  specifies the assistant is called **Emir AI** everywhere — so all three names are currently in play.)*
- **C-5 Check-in pill colours.** Nova: **amber "Check in"** (not yet checked in) → green "In office"
  → **blue "Outside · back 15:00"** (S-45). Atlas: green "In office" / **amber "Outside · back by"** /
  **red "Not checked in"** (AD-1). The same three states are given three different colour mappings,
  and amber means "not checked in" in one file and "outside" in the other.
- **C-6 Blue is not in the status palette.** Atlas rule 7 allows **neutral + one accent + red/amber/
  green only**, each with a word or icon (D-7). Nova's **blue** "Outside" pill (S-45) is a fifth
  colour with no meaning defined in Atlas's scheme.
- **C-7 Colour-only badge dots in the folded rail.** Nova turns badges into **dots** in the 68 px rail
  (S-29). Atlas rule 7 requires colour to be **"always with a word or icon"** (D-7). A bare red dot
  carries status by colour alone and also loses the count.
- **C-8 Pipeline stage names.** Atlas's pipeline strip is **New, Called, Interested, Meeting, Offer,
  Won + Lost** (OD-8). Nova never names the stages, so there is no nova/atlas conflict — but these
  are **not** the stages in the project brief (`CLAUDE.md`: New Lead → Attempted Contact →
  Engaged/Qualified → Appointment Scheduled → Deal Sent → Won / Lost). Flagged here because the
  dashboard cannot be built without choosing.
- **C-9 "6–8 cards per screen" vs the specified layouts.** Atlas rule 2 caps a screen at **6–8 cards**
  (D-2). Its own **My Day** layout lists hero + Next plan + **four** tiles + Call list + Today's plan
  + two stacked cards = **nine or ten** (AD-3…AD-9). Either the four small tiles and the stacked pairs
  count as one card each, or the cap is advisory.
- **C-10 "Max 3 charts per screen" vs the owner dashboard.** Atlas rule 6 caps charts at **3** (D-6).
  The owner dashboard specifies the calls-per-hour bars, the pipeline segmented bar, the attendance
  segmented bar, a 7-day sparkline in every team row, and an open-leads bar in every team row (OD-6,
  OD-8, OD-10) — more than three unless segmented bars and in-row sparklines are excluded from the
  count. Rule 6 itself blesses both of those shapes, which suggests they are excluded; say so
  explicitly before review.
- **C-11 "No scroll at 1440×900" vs "below the fold".** Atlas rule 9 says the dashboard must not
  scroll at 1440×900 (D-9), and both dashboards then specify a **"below the fold"** set of secondary
  lists (OD-12, AD-10). Read together: the three primary rows must fit in 900 px without scrolling,
  and the secondary lists are reached by scrolling past them. Worth writing down, because "no scroll"
  read literally forbids OD-12 and AD-10.
- **C-12 Row heights.** Nova sets **sidebar** rows at 36 px (S-2) and says nothing about table rows;
  Atlas sets **table** rows at 44 px and the team table at 36 px (D-10). These do not conflict — they
  are different surfaces — but the 36 px figure appears in both for different things, so do not
  propagate one into the other.
