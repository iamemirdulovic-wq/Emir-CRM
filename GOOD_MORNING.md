# Good morning, Emir

Written at the end of the night of 12 November. Everything below is on the
`v2` branch. **Nothing has gone to crm.homes.me.** The CRM your ten people
used yesterday is exactly as they left it.

## Where to start

Say one word — *push it* — and all of this lands on **crm.homes.me/v2** about
75 seconds later. `crm.homes.me` stays the old CRM, untouched, at the same
address, for everybody.

Until then I can show you any screen as a picture, and there is a clickable
preview I can start on request.

## What is built and working

The whole of an agent's day, and most of yours.

| Screen | What it does |
|---|---|
| **My Day** | Greeting, the VIP card with a live countdown, start calling, the four tiles, the call list, best time to ring, follow-ups, transfers, what you are owed an update on, leads by stage, your banners |
| **Your Dashboard** | *Needs you now*, team today, today in numbers, team right now |
| **Calling** | One lead at a time. Call or WhatsApp, then say what happened. The check-in question |
| **My leads / All leads** | Seven tabs, paging, the client's local clock on every row |
| **The lead** | The phone number is the biggest thing on the screen. Eight actions, the where-they-are card, timeline, notes, info, files, "From the sheet" |
| **Add a lead** | Nothing filled in for you. Live duplicate check. You can hand it over as VIP with a clock on it |
| **Incoming** | Free leads. Agents take one; you give them out or share them equally |
| **Pipeline** | Six columns, drag to move. Lost asks why, Won asks if you are sure |
| **Follow-ups** | The leads list opened on what is late |
| **Transfers** | Pass a lead to a colleague, approve the ones that need you |
| **Calendar** | Tasks and meetings in one month grid. A meeting that has been asks how it went |
| **Tasks** | Late / today / open / done, tick them off, add one |
| **Attendance** | Check in, working outside, your last sixty days, ask for days off, answer the team's |
| **The team** | Who everybody is, who is in today, what they speak. Agents are not shown each other's lead counts |
| **A person** | Their page, bio, languages, badges — the same profile the old CRM builds |
| **Projects** | The library, with filters. Nothing quoted that is not in the projects table |
| **Everywhere** | Search (Ctrl-K, any phone format), the bell, real numbers on the menu, the phone's More screen |

## What is not built yet

Sales offers, import, the team wall, your settings, Homes AI, automations and
the activity report. Each one has a page that says so plainly rather than
pretending — *"Not built yet. It arrives in phase 11."* Nothing is a dead
link, and the old screens for all of them still work at their old addresses.

The three the design marks **later** — Inbox, Email, Templates — are drawn
greyed, as drawn, and the old screens still work at their old addresses.

## Three things I decided on my own

You said not to ask, so I decided and wrote each one down in `DECISIONS.md`.

1. **The design shows "+240 points today".** There is no points table in the
   database, so I show kudos received instead. A number nobody set is a number
   somebody trusts.
2. **It shows "14 annual days left".** There is no allowance anywhere either.
   Attendance shows days *taken*. Tell me the allowance and it goes in.
3. **"18 of 40 calls"** — the 40, the 20 and the 2 are your own numbers from
   the design package, so I kept them, but they come from the server and
   become a setting the moment you want to change them.

## What I need from you

- **One word to push it to crm.homes.me/v2.**
- The daily targets, if 40 calls / 20 WhatsApp / 2 meetings is not right.
- The annual leave allowance per agent.
- Whether an agent should be capped on how many free leads they can take at
  once (I have not added a cap — a silent limit mid-morning is worse than
  none).

## How I know it works

- **2,741 tests on the server**, in 146 files, against a real database.
  Nothing skipped. All green.
- **471 tests in the browser code.** All green.
- **180 screens walked by a real browser** — 45 pages, phone and computer,
  light and dark. Nothing overflows, nothing is cut off, no errors in the
  console.
- Every screen in the table above I opened and used myself: taking a lead,
  saving a call result, dragging a card, sharing leads out, booking a
  meeting, asking for days off.

## Still to do, in the order I would do it

Sales offers → import → your settings → the team wall → activity and
reports → Homes AI → automations.

---

*Is this right, or do you want changes?*
