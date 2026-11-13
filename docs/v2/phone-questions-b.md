# Phone build — group B's questions

*The sixteen screens of the calling, planning, attendance, transfer, search and
messaging group, built 13 Nov 2026 from `design/screens/*.dc.html` at 390 × 844.
One line per case: what the phone design says, what the computer design says,
what I did. The owner reads this; nothing below has been guessed at in the
code.*

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

**The calendar's legend.** The phone adds two explainers under the five dots
("3+ plans · tap the day", "runs several days"); `design/web/calendar.html` has
the plain five-dot legend. Kept the five dots, and put them back on the phone —
they had been switched off, and a 51px-wide day cell holds nothing but dots.

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

**Templates.** The phone has no tabs and one compact list; the computer groups
by purpose (Hello · Meeting · Brochure…); the build uses Meta's own categories.
On a phone the message body is now hidden so the list is compact as the phone
draws it, but the tabs are still Meta's.

**Email has no screen.** `Email.dc.html` is a 600 × 1040 board that draws **one
rendered email** — the "Emir just handed you a VIP lead" message — not a page of
the CRM. `design/web/email.html` draws a mailbox. `/v2/email` is a third thing:
the library of emails the CRM sends. **This needs your decision**, and it is not
a phone question.

---

## 2. What the server cannot supply, so it is blank

Nothing below was invented. Each is a field the design draws and the database
does not hold.

| Screen | What the design shows | Why it is not there |
|---|---|---|
| Attendance | "OFFICE WI-FI FOUND / **homes.me-Office**" and "Shift 09:00 – **18:00** · Business Bay office" | `/attendance/me` knows when a shift starts. It does not store the network's name, the office's name or the end of the shift. |
| Attendance | "**14** Annual left" | There is no leave allowance anywhere in the database. The screen shows days taken, which is true. |
| Working outside | **Share my location**, the four-row "with who" picker, the note, the confirmed "You're marked outside" state, and the "Are you back in the office?" card | Nothing stores a location, and there is no record of being outside to come back to. The sheet asks why, where and back-by, which the server does take. |
| Transfers | **Remind** on a transfer you sent | There is no endpoint. Cancel is the only other thing a sender can do. |
| Calendar · new plan | the lead picker, the clash warning, "runs for several days", and "remind me" | `POST /api/v2/meetings` takes a kind, a title, a start, an end and a place. The sheet asks for exactly those five. |
| Calendar · how did it go | the seven-mode flow — a forced next step after "showed up", the prepared WhatsApp after a no-show, and project / unit / price / receipt after "booked a unit" | `PATCH /meetings/:id/result` takes the result, a note and an interest level. The rest has nowhere to go. |
| Calling | "I have the new number" under **Wrong number** | Nothing takes a replacement number, so the box would throw it away. (This was already the build's decision; it stands.) |
| Calling | "+15 points per call" | The wall pays two points for reaching somebody and has no per-call rule. The chip says the true figure. |
| Chat | the five quick-send chips — Payment plan · Brochure · Location · Video · **AI reply** | A payment plan and a video are figures and files the CRM does not hold for every project, and there is no AI reply. The chips are the server's own openings, written from the project the lead asked about. |
| Notifications | the verb line on every row ("Accept and call ›") and the deep link into a filtered state | The server sends a path and nothing else. |

---

## 3. Things that need a shared file changed, so I did not change them

Each of these is in `Shell.tsx` or `phone.tsx`, which this group must not
touch.

1. **A chat has two headers.** `Chat.dc.html` *replaces* the screen: a back
   button, the name, a call button, and nothing else. The shell draws its own
   header on every screen, so an open thread shows "← Inbox 🔍 🔔" and then the
   thread's own header under it — about 110px of the screen. The bottom bar
   correctly goes away; the header cannot. Fixing it needs either a way for a
   screen to say "draw no header", or the thread to live at its own address so
   the shell's back button works.
2. **The calling screen is the same case.** `Dialer.dc.html` has a close arrow,
   a two-line title and a "+15 points" pill, and no search or bell. The title
   and the sub-line are now the shell's (`Lead 1 of 12` over `Power dialler ·
   11 left after this`), which is as close as this group can get.
3. **The header's shape.** Several of these prototypes — Follow-ups, Inbox —
   centre a 17px title with the sub under it; the shell draws a left-aligned
   30px one. Not a phone-build decision; it is the shell's pattern B.
4. **The check-in gate on the round dial button.** The design makes every call
   affordance ask it. It now asks on the dialler, on each follow-up row and in
   the chat header. The floating dial button in the bottom bar is still a plain
   link, and that button is the shell's.

---

## 4. Smaller departures, written down so they are decisions

- **The week strip on Tasks** shows Monday to Friday on a phone, as
  `Tasks.dc.html` does, with both arrows side by side on the left rather than
  one at each end. Seven cards do not fit at 390px.
- **"New task" inside the day card is hidden on a phone.** The round + in the
  header is the design's one action, and two of the same button in one thumb's
  reach was also what pushed it past the card's edge.
- **"Mark read" is hidden on a notification row on a phone.** Opening the row
  already marks it read, and the design has one target per row, not two.
- **The owner's last-eight-days grid drops the summary column** ("1 late · 1
  absent") and each person's avatar on a phone. Both are the build's own
  additions; the eight days are the design's and they now fit.
- **Attendance is still three tabs** (Today · Month · Leave) where
  `Attendance.dc.html` is one scrolling column — state card, legend, this week,
  this month, day detail, footer. Changing that is a rewrite of a 1,600-line
  screen rather than a phone layout, so it is listed here rather than done
  quietly. The same goes for the owner's three tabs.
- **"Month PDF"** on Attendance and **"Request leave"** as a footer link on the
  main screen are both still missing; the leave form is reached through the
  Leave tab.
