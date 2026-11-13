# Phone build — group B's questions

*The sixteen screens of the calling, planning, attendance, transfer, search and
messaging group, built 13 Nov 2026 from `design/screens/*.dc.html` at 390 × 844
and corrected the same day against the owner's own pictures in
`design/phone-shots/`. One line per case: what the phone design says, what the
computer design says, what I did. The owner reads this; nothing below has been
guessed at in the code.*

---

## 1. Where the two designs disagree

**Follow-ups: one screen or two?** `Tasks.dc.html` and `FollowUps.dc.html` are
two separate files with two different back buttons (Tasks → My Day,
Follow-ups → More). `design/web/tasks.html` makes them two tabs of one page.
The computer design wins, so they stay two tabs of `/v2/tasks`. **Note that
`/v2/follow-ups` is a different screen again** — it renders the leads list
filtered to Overdue, which is somebody else's file, so the follow-ups design
lives at `/v2/tasks?tab=follow-ups`.

**The calling screen's phone number.** `Dialer.dc.html` draws the name at
24px/800 and the number at 14px/400 in grey. `design/web/calling.html` draws
the number at 50px. The computer design is the one that matches what you asked
for — the number is the biggest thing on the screen — so it is 34px here,
which is the largest a sixteen-character UAE number fits in at 390px.

**The calendar's Day · Week · Month switch.** The phone draws it Day first with
Month selected at the right; `design/web/calendar.html` draws Month · Week ·
Day. The computer design wins, so the order is Month · Week · Day. Everything
else about that bar now follows the phone: the switch across the full width,
then `‹ November 2026 › Today` under it, then the grid, then the key.

**The calendar's sub-line.** `Calendar.dc.html` writes the whole date of the
day being looked at — "Wed, 11 November 2026". `design/web/calendar.html` has
no sub-line at all. The phone's is used; it replaced "2 plans today", which was
the build's own.

**The calendar's legend.** The phone adds two explainers under the five dots
("3+ plans · tap the day", "runs several days"); `design/web/calendar.html` has
the plain five-dot legend. Kept the five dots, and moved them **under the grid**
where the phone draws them — a 51px-wide day cell holds nothing but dots, so
the key is the only thing that says what one means.

**The task row.** `Tasks.dc.html` draws a checkbox, then the kind as a small
coloured line over the title over "time · lead · project", then a ⋯.
`design/web/tasks.html` draws time · channel chip · title · Open · ⋯ on one
line, which at 390px put the ⋯ on a line of its own. The phone design wins at
phone width only; the computer row is untouched.

**The task week strip.** The phone writes "0 left" on an empty day;
`design/web/tasks.html` writes "No tasks", or "Day off" on Saturday and Sunday,
or "All done", and writes "Today" in place of the weekday on today. The
computer design wins. The build said "Nothing", which was neither.

**Working outside — the six reasons.** `WorkOutside.dc.html` says Viewing with
client · Developer sales centre · Client meeting · Event / roadshow · Bank /
paperwork · Other. `design/web/attendance.html` says Viewing with a client ·
Site visit · Meeting at the developer · Event or expo · Bank or papers · Other.
The computer design wins, so four of the six keep the build's words — but the
last chip was "Something else" in the build and is **"Other"** now, which both
designs say. Both designs also ask **With who before Where exactly**; the build
had them the other way round, and they are now in the designs' order.

**Leave — the words on the sheet.** Both designs call it **"Request leave"**,
not "Ask for days off", so the sheet's heading is that now. The button is
"Send the request" (`attendance.html`); `LeaveRequest.dc.html` says "Send
request", and the computer wins. The last type chip is "Other" in both designs
and was "Something else". From and To are side by side, as both designs draw
them.

**Notification type chips.** `Notifications.dc.html` has `All · Leads ·
Meetings · Tasks · Team` for an agent and `All · Leads · Team · System` for an
owner. `design/web/notifications.html` has no chips at all. Left as the build
has it — the chips it shows are the ones the day's notifications actually fall
into — but **the two designs name different categories and neither matches the
build's, so somebody has to choose.**

**The inbox's filters.** The phone filters by whose chat it is (Mine · Unread ·
Unassigned · All); the computer filters by channel (All · WhatsApp · Telegram ·
Unread). The build has both, as two rows. Left alone. The computer's third
channel is Telegram and the CRM has no Telegram channel.

**Templates.** `Templates.dc.html` titles the screen "WhatsApp templates" over
"Messages agents send in one tap"; `design/web/templates.html` titles it
"Templates" with the sub "16 WhatsApp templates · later phase". Took the
phone's title and sub, because "later phase" is a note to you and not a line to
show an agent, and put the count back in the design's own "12 TEMPLATES"
header above the list. The phone has no tabs and one compact list; the build
keeps Meta's categories as tabs and hides the message body, so the list is as
compact as the phone draws it. The green rule the phone opens with —
"Templates with a green tag are approved by Meta…" — is now at the top on a
phone, where the build only had it at the foot.

**Email has no screen.** `Email.dc.html` is a 600 × 1040 board that draws **one
rendered email** — the "Emir just handed you a VIP lead" message — not a page of
the CRM. `design/web/email.html` draws a mailbox. `/v2/email` is a third thing:
the library of emails the CRM sends. **This still needs your decision**, and it
is not a phone question. Nothing on that screen was changed.

---

## 2. What the server cannot supply, so it is blank

Nothing below was invented. Each is a field the design draws and the database
does not hold.

| Screen | What the design shows | Why it is not there |
|---|---|---|
| Attendance | "OFFICE WI-FI FOUND / **homes.me-Office**" and "Shift 09:00 – **18:00** · Business Bay office" | `/attendance/me` knows when a shift starts. It does not store the network's name, the office's name or the end of the shift. |
| Attendance | "**14** Annual left" | There is no leave allowance anywhere in the database. The screen shows days taken, which is true. |
| Attendance | "Month PDF" in the footer | There is no endpoint that makes one. |
| Working outside | **Share my location**, the four-row "with who" picker, the note, the confirmed "You're marked outside" state, and the "Are you back in the office?" card | Nothing stores a location, and there is no record of being outside to come back to. The sheet asks why, with who, where and back-by, which the server does take. |
| Leave | **Personal**, **Half day** and **Work from home** | `LEAVE_KINDS` in `server/src/v2/leave.ts` is annual, sick, unpaid, emergency, other. Both designs offer six; the server stores five. |
| Leave | "3 working days · your leads stay with you" | The office decides which days it is shut, so the working-day count is the server's to make. The sheet counts the days chosen and says the shut ones are not counted. |
| Transfers | **Remind** on a transfer you sent | There is no endpoint. Cancel is the only other thing a sender can do. |
| Search | the **Tasks** chip, fifth of the design's five kinds | `http/routes/search.ts` searches leads and projects; the screens are the client's own list. There is nothing to put behind a Tasks chip. |
| Calendar · new plan | the lead picker, the clash warning, "runs for several days", and "remind me" | `POST /api/v2/meetings` takes a kind, a title, a start, an end and a place. The sheet asks for exactly those five. |
| Calendar · how did it go | the seven-mode flow — a forced next step after "showed up", the prepared WhatsApp after a no-show, and project / unit / price / receipt after "booked a unit" | `PATCH /meetings/:id/result` takes the result, a note and an interest level. The rest has nowhere to go. |
| Calling | "I have the new number" under **Wrong number** | Nothing takes a replacement number, so the box would throw it away. |
| Calling | "+15 points per call" | The wall pays two points for reaching somebody and has no per-call rule. The chip says the true figure. |
| Chat | the five quick-send chips — Payment plan · Brochure · Location · Video · **AI reply** | A payment plan and a video are figures and files the CRM does not hold for every project, and there is no AI reply. The chips are the server's own openings, written from the project the lead asked about. |
| Notifications | the verb line on every row ("Accept and call ›") and the deep link into a filtered state | The server sends a path and nothing else. |
| Team attendance | "Phone Bassam" / "Mark as leave" / "See shared location" on a person's row | No endpoint marks somebody else's leave, and nothing stores a shared location. |

---

## 3. Things that need a shared file changed

1. **`compact: true` does not make the title small — and I have patched it
   from my own stylesheet.** This is the one thing in this list that needs
   somebody else's hand. `v2-phone.css` has
   `.v2.v2-phone .v2-ptop .v2-title { font-size: 30px }` — four classes — and
   two rules below it `.v2.v2-phone .v2-ptitle-compact { font-size: 17px }` —
   three. The small one loses, so every screen that asked for the §1.4
   pattern-A header got the 30px one: Follow-ups, the inbox, Notifications,
   Transfers, Templates, Attendance, Search. The code reads correctly. I could
   not edit `v2-phone.css`, so there is an override of equal specificity at the
   top of `v2-phone-b.css`, where source order settles it. **It belongs in
   `v2-phone.css` beside the rule it corrects**, and it should move there
   before another group writes the same patch.
2. **A chat no longer has two headers** — `useFullAttention` now takes the
   shell's header away as well as the bar, which is what the last note asked
   for. One thing followed from it: the thread's card was still sized
   `100dvh - 118px`, which left 84px of nothing under the composer. It is
   `100dvh - 34px` while the bar is hidden, keyed on the shell's own
   `v2-has-bar` class.
3. **The calling screen still has the shell's header.** `Dialer.dc.html` has a
   close arrow, a two-line title and a "+15 points" pill, and no search or
   bell. The title and the sub-line are the shell's (`Lead 1 of 12` over
   `Power dialler · 11 left after this`), which is as close as this group can
   get without touching `Shell.tsx`.
4. **The check-in gate on the round dial button.** The design makes every call
   affordance ask it. It asks on the dialler, on each follow-up row and in the
   chat header. The floating dial button in the bottom bar is still a plain
   link, and that button is the shell's.

---

## 4. Smaller departures, written down so they are decisions

- **Attendance is still three tabs** (Today · Month · Leave) where
  `Attendance.dc.html` is one scrolling column — state card, legend, this week,
  this month, day detail, footer. The same goes for the owner's three. Changing
  that is a rewrite of a 1,600-line screen rather than a phone layout.
- **"What the colours mean" is at the foot of the week card**, not its own card
  above it as the design has. Same six colours, same words.
- **The agent's four month counts are two to a row** rather than the design's
  single row of five small ones; at 390px five numbers with their labels do not
  fit on one line. The owner's five **are** one row of five now, as the design
  draws them, because they are numbers with one word each.
- **The owner's last-eight-days grid drops the summary column** ("1 late · 1
  absent") and each person's avatar. Both are the build's own additions; the
  eight days are the design's and they fit.
- **Transfers keeps the "Pick a lead to transfer" button.** `Transfers.dc.html`
  has no such button — it says to open a lead and tap "Transfer this lead" —
  but taking a working way in away seemed worse than an extra button. The
  intro sentence beside it is hidden on a phone, because the header already
  says "Leads you give and leads you get".
- **Notifications keeps the "Only new" switch**, which the design does not
  have. "Mark read" on a row is gone: the design has one target per row and
  opening a row already marks it read.
- **Follow-ups keeps the "N follow-ups · See them as leads" row**, which the
  design does not have, and opens on **Overdue** where the design opens on
  **Today**. Say the word and it opens on Today.
- **The inbox keeps its "Search chats" field**, which the phone design does not
  draw.
- **"New task" and "New plan" inside a card are hidden on a phone.** The round
  + in the header is the design's one action, and two of the same button in one
  thumb's reach was also what pushed them past the card's edge.
- **The week strip on Tasks shows Monday to Friday**, as `Tasks.dc.html` does,
  with one arrow at each end as the design draws it. Seven cards do not fit at
  390px.
