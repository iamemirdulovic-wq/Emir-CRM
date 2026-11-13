# The computer pages, before and after the phone build

*You asked: after the phone work, check all 48 computer pages again at
1440px, light and dark, and show you any that changed.*

**How it was checked.** Not by eye and not by screenshot. `scripts/desktop-layout.mjs`
records the box of every element on every page — 102 screens counting both
themes, about 30,000 boxes — from the commit *before* any phone work, and
again now, and compares them. A screenshot would not do: this CRM draws a
live clock and counters that count up, so the same code photographed twice
differs on a third of the pages.

**One real break, found and fixed.** Three fixes I wrote *for the computer*
landed inside `@media (max-width:767px)`, because the bottom half of that
stylesheet is one. They did nothing at any width above 767px, silently,
with every test passing. The worst was Sign out in the settings list: it had
to become a button (it pointed at `/logout`, which is not a page), and
without the rules it sat 61 pixels out of place on all thirteen settings
pages. Fixed, and checked in a browser at 1440px.

Everything else below is a change I can explain. **Say the word on any of
it and I will put it back.**

## Changed and you would not see it

| Page | What |
|---|---|
| All 13 settings pages | Sign out is a button instead of a link, because it has to be. Same size, same colour, same place. |
| Calendar, Tasks | Three buttons that pointed at a web address nobody read now do their job. |
| Messaging | A class was added to a table. It does nothing above 768px. |

## Changed on purpose

| Page | What | Why |
|---|---|---|
| The full dashboard | The title at the top read **homes.me**; it reads **The full dashboard**. | "homes.me" is what the CRM shows when it has no name for a page. |
| My profile | The link at the foot reads **Edit my personal information** and opens the new screen. | That screen did not exist before this week. |
| My personal info, Sign-in and security | New pages. | Both are in your design and neither had an address. |
| Follow-ups | The old web address showed the **leads** list; it now opens the follow-ups tab of Tasks. | Both your designs put follow-ups in Tasks, and the menu already pointed there. A second list of the same rows is a second chance to disagree with itself. |
| More | Rebuilt from your `Menu.dc.html`. | It is the phone's menu. On a computer the sidebar does its job, and this page is a back road to the same places. |
| Owner home, System health | Two blocks were drawn unstyled — *"2In office1Late1Outside"*, *"ConnectedYes"* — at **every** width, including yours. | Your design's stylesheet defines them for one page only. They are defined for all pages now. |

## Something new appears on the page

Each of these is in your design and was missing from the computer as well as
the phone, so it was added once, in one place, and shows on both.

| Page | What was added |
|---|---|
| Best of Homes | The line telling an agent what would put them first: *"N calls or M booked viewings…"*, worked out from the real points. |
| Team | The closing sentence about what colleagues can and cannot see. |
| Notifications | *"VIP leads still ring in quiet hours if you allow it above."* |
| Report a problem | The **Where in the CRM?** picker, so a report says which screen it is about. |
| Homes AI | Two more example questions. |
| Import | The small label under each step circle. |
| Phone app | The closing table: tap this alert, it opens that screen. |
| Manage projects | The numbers on each row now say what they count. |

## Not a change at all

**My leads** looked like the biggest change of the lot — 743 elements
moved. It is the demonstration data, not the page. The stand-in data the
preview uses gained two fields the real CRM has always sent: whether a lead
is **VIP**, and whether it **came back to you**. So the VIP tag and the
"Came back to you" line appear in the preview now. On the real CRM they
always did.

---

# A second round, after Emir sent pictures of the designs

*Rendering the prototypes drew every state stacked, so small differences
were invisible. With the owner's own pictures as the left panel, the four
groups went through all 59 again. Seven more changes reach the computer,
each because the **computer** design asks for it.*

| Page | What changed above 768px | Why |
|---|---|---|
| Team and roles | **"Invite a person"** — a button and a form. There was no way to add anybody to the CRM from inside it. | Both designs draw it, and `POST /api/users` has existed all along. |
| Team activity | A **Activity · Live · Messaging** row. | It was the only one of the three reports with no way out of it. The computer design has the row. |
| Messaging report | The same row gained its missing **Live** link. | Same. |
| Feedback inbox | The filter words are **New · Planned · Fixed · All**, each with its count, and each card has **Plan it** and **Mark fixed**. | Both designs say those words. The build had invented five of its own, and the only way to change a report's state was through the reply box. |
| Feedback inbox | **"Answer"** is now **"Reply"**. | Both designs. |
| Phone app | Step 1 prints the real address — **crm.homes.me** — instead of "the same address you use here". | The design prints it, and an agent setting up a new phone needs to read it. |
| Team | The second tab is **Best of Homes**, not "Team wall", and goes there. | `design/web/team.html` draws that pair, and Best of Homes already drew the same row the other way round. The two disagreed. |

Everything else the groups changed is inside `@media (max-width: 767px)`.
