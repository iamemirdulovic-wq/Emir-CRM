# Nova — Navigation and ease of use (computer)

**Verdict.** The rejected sidebar is 17 equal items in one flat list with "NEW" pills. style5 hides six tools under "More"; style3 is still ungrouped. Fix: four quiet groups, counts only where action is needed, settings and account pinned at the bottom.

## 1. Sidebar

248 px wide, rows 36 px, icon + label, small grey group labels. Groups are always open. Middle scrolls on short screens; logo and bottom block stay fixed.

**Owner / Admin**

| Group | Items (in order) | Badge |
|---|---|---|
| (no label) | Dashboard · Incoming | Incoming: waiting leads (red) |
| LEADS | All leads · Follow-ups · Pipeline · Transfers · Import | Follow-ups: overdue (red) · Transfers: waiting for approval |
| PLAN | Calendar · Tasks | Tasks: overdue (red) |
| PROJECTS | Projects · Sales offers | — |
| TEAM | Team · Team wall · Attendance · Activity | Attendance: leave requests |
| Pinned bottom | Ask AI · Automations · Settings · profile row | — |

**Agent**

| Group | Items | Badge |
|---|---|---|
| (no label) | My Day · Incoming | Incoming: free leads |
| LEADS | My leads · Follow-ups · Pipeline · Transfers | Follow-ups: overdue (red) · Transfers: requests to answer |
| PLAN | Calendar · Tasks | Tasks: overdue (red) |
| PROJECTS | Projects · Sales offers | — |
| TEAM | Team · Team wall · Attendance | — |
| Pinned bottom | Ask AI · Settings · profile row | — |

- **Attendance** is one item with tabs. Owner: Team today · Leave requests · My attendance · Rules. Agent: Today · Month · Leave.
- **Team** = Meet the team, with Best of Homes as a tab. **Activity** = Team activity with Live and Messaging tabs.
- **Profile row** (photo, name, role): menu with My profile, Business card, Security, Appearance, Feedback, Sign out.
- **Notifications:** top-bar bell only.
- **Badges:** plain numbers. Red only for "late or waiting on you"; others grey. No "NEW" pills.
- **Active item:** soft green filled pill, dark-green bold label, filled icon, 3 px green bar on the left edge.
- **Collapsed:** a button beside the logo (shortcut `[`) shrinks it to a 68 px icon rail. Tooltips for labels, lines for groups, dots for badges, active pill stays. Remembered; auto-collapses under 1200 px.

## 2. Top bar (left to right)

1. **Page title** (on a lead: "← All leads").
2. **Search box**, always visible, about 480 px: "Search leads, phone, project…  Ctrl K". Before typing: recent leads and common actions. While typing: Leads · People · Projects · Screens · Actions. No result → "Add as a new lead" or "Ask AI".
3. **+ Add lead** — the only filled button in the bar; small arrow for Task, Follow-up, Meeting, Import (owner).
4. **Check-in pill** (agents only): amber "Check in" → green "In office · 08:52" → blue "Outside · back 15:00".
5. **Bell** with red count → right panel, each item opens its exact page.
6. **Avatar** → same menu as the profile row.

Remove the floating AI pill (it covers table rows); AI lives in the sidebar and the search.

## 3. Ten interaction rules

1. **Lists open a right panel** (480 px), list stays visible; "Open full page" at the top. Every lead keeps its own link.
2. **Dialogs only for short decisions** (confirm, Lost reason, Won form). Long work (Import, Settings) gets a full page.
3. **One filled green button per screen.**
4. **Risky actions ask twice**, name the consequence ("Move 12 leads to Rocky?"), then show a toast with Undo.
5. **Filters sit in one row above the table**; active ones are removable chips with "Clear all" and a result count.
6. **Bulk select:** checkbox per row; header box selects the page, then "Select all 863". A dark bar slides up at the bottom with the count and actions.
7. **Row actions appear on hover** at the right (Call, WhatsApp, More).
8. **Toasts** bottom-left, 5 seconds, one sentence, Undo where possible. Errors stay until closed.
9. **Shortcuts, shown in tooltips:** Ctrl K search, N new lead, `[` sidebar, Esc close, ↑↓ rows, Enter open.
10. **Never a blank screen:** grey skeleton rows while loading; empty states have one sentence and one button ("No follow-ups today. Add one").

## 4. Lead page (1440 px)

- **Left, 300 px, sticky:** phone number largest, name, "with Rocky", tags, client local time and best time to call. Buttons: Call (filled) · WhatsApp · Telegram; then Follow-up · Meeting · Won · Lost. Below: "Transfer this lead" (owner: "Give to another agent").
- **Middle, flexible:** Next step card; "In short"; add-note box; tabs Timeline · Notes · Files, newest first.
- **Right, 320 px:** Details, click any line to edit (project, budget, purpose, languages, source); upcoming plans and tasks; Info.

## 5. All leads table

- **Columns:** ☐ · Name (+VIP tag) · Phone · Project · Stage (colour chip) · Agent · Next step (red if overdue) · Last contact · Source. Sticky header, 50 per page, sortable.
- **Quick tabs:** All · Going cold · Overdue · No next step · VIP · Lost, each with a count.
- **Filter row:** search in list · Agent · Stage · Project · Source · Date · Export (owner, right).
- **Bulk bar:** "12 selected · Move to agent · Move to Incoming · Cancel".
- Agent "My leads": same table, no Agent column, Export or bulk move; tabs Today · New · Overdue · No next step · VIP · Lost · All; "Start calling" button.

## 6. Avoid

1. A flat list of 15+ items, or hiding tools under "More".
2. Collapsible groups or sub-menus that open and close.
3. Decorative badges ("NEW") and colour on every item.
4. Dialog on top of dialog; panels as wide as the screen.
5. Icon-only buttons without labels, and actions reachable only by shortcut or right-click.

## Sources

- https://www.saasui.design/blog/saas-sidebar-navigation-ux-patterns
- https://www.saasui.design/blog/saas-search-command-palette-ux-patterns
- https://www.saasui.design/blog/saas-data-table-ui-patterns
- https://www.saasui.design/blog/saas-slide-over-drawer-panel-ux-patterns
- https://knowledge.hubspot.com/records/understand-the-default-record-layout
- https://uxmovement.substack.com/p/how-to-group-your-sidebar-items-for (intro only)
