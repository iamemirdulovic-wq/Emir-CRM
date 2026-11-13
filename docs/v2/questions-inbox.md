# The inbox, an agent's attendance, and my profile

*13 Nov 2026. Three computer screens rebuilt against their design files —
`design/web/inbox.html`, `design/web/attendance.html`,
`design/web/profile.html` — working the lists in `docs/v2/audit-3.md` §25,
§27 and `docs/v2/audit-4.md` §44. What was built, what was already there,
what could not be and why. The owner-facing half of each decision is in
`docs/decisions-to-confirm.md` §39–47, in plain English.*

The method was the one the repository insists on: read the design file's
`<body>` and its `<style>`, build the markup against the ported `d-` classes,
and prove it with `scripts/computer-proof.mjs` — the design beside the build,
whole page, at 1440px. The three pictures are in `docs/v2/proof/`.

---

## Inbox · `/v2/inbox`

### Built

| What | Note |
|---|---|
| The **LATER PHASE banner**, in the design's words | with its own button: the messaging report for an owner, My leads for an agent |
| The design's **foot line** — "In this later phase messages go out from the company WhatsApp number. Today the agent presses send on the phone." | under the line that explains Meta's 24-hour window, which the design has no state for |
| **Telegram** in the channel filter | see §40: it finds nothing, and the empty state says why |
| The chat header's **channel word** — "WhatsApp · +971…" | it was the phone and the agent's name |
| **"Open the lead"** in the chat header | the design's one button up there; it had moved to the foot of the side panel, which a narrow window does not show |
| The client's **local time** beside the stage chip | the design's "Milan 11:55". From the dialling code and the zone it names — see below |
| A **ready message fills the composer** | it copied to the clipboard and asked you to paste |
| **"All 12 templates"** | the real count, as the design counts its own |

The page's own line under the title ("WhatsApp and Telegram chats in one
place · later phase") and 24-hour times were both put right earlier the same
day, by the commits behind `subs.ts` and `web/src/lib/format.ts`. They were on
the audit's list and are already done.

### Not built, and why

- **The inert composer.** The design's message box does nothing: every press
  toasts "Later phase. For now open the lead and tap WhatsApp". The build's
  sends. Taking a working reply box away from ten people is the owner's call,
  not a rebuild's — `docs/decisions-to-confirm.md` §39. Today the banner is
  true anyway: WhatsApp and email send nothing without their keys, and a
  message that could not go out is recorded as *not sent*.
- **The design's three ready messages** (Hello · Brochure · Payment plan).
  Its payment-plan text quotes a plan nobody set. §41.
- **A city for the client's clock.** The design writes "Milan"; the CRM knows
  the dialling code, so it writes the country, or the city whose clock it is
  where a country spans zones ("Moscow", "New York"). A town it does not know
  is not one it will invent.
- **The sidebar's "Inbox · later" marker.** The design greys that row out,
  which also makes it unclickable; it is the row the screen is reached by,
  and `web/src/v2/Shell.tsx` — where the greying lives — is another agent's
  file this week. §47.
- **The call button is still not wired to the recorder.** Unchanged and
  deliberate: a conversation's payload carries no opportunity id and a
  contact can hold several inquiries, so filing a call against the newest
  would move the wrong lead's stage. `docs/v2/questions-calls.md`. The
  check-in gate is still asked before the phone opens.

---

## An agent's attendance · `/v2/attendance`

### Built

| What | Note |
|---|---|
| **Confetti** on a check-in, and the toast naming the server's time | `celebrate()` already does nothing for anybody who has asked their device to stop animating |
| The hero's **late warning** — "Shift 09:00 – 18:00. It is 14:55 now, so this check-in counts as late." | worked out from the shift and the grace, both new on this endpoint |
| The hero's **facts strip**: worked today · shift ends · the office Wi-Fi's name | "worked today" counts from the morning's tap |
| The **network's name** in the eyebrow, the facts and the "Where" row | from the owner's attendance rules — the names only, never the addresses |
| **"Week 46"** on the week card | |
| The **check-in time in every cell** of the week strip and the month grid, "off" on a day the office is shut | `/api/v2/attendance/me` returned no time at all; the column has always been there |
| The **six-colour guide**, including Absent and "Day off or not yet" | |
| The **four tiles**, each reaching the tab that explains it: On time in November · Late (with the day and the minutes) · Working outside (with the day and the reason) · Annual leave |
| The timeline's **"Shift ends · 18:00"** row | |
| **"How check-in works"**: Shift "09:00 – 18:00, Monday to Friday" · Late "Check-in after 09:10" · Where "Only on the office Wi-Fi “homes.me-Office”" | all three were missing their numbers |
| The month's **six totals**, Absent among them | a day the office was shut can finally be told from a day nobody came in |
| The **day detail**: check-in with the minutes late, where, the note | |
| The leave tab's **three cards**, with the last sick day and who answers, by name | "Emir or George answers", from the real owners |
| **"Request leave"**, the design's word | it read "Ask for days off" |
| The waiting row's **asked time**, two-click **cancel**, and an **Undo** | undo asks for the same days again, since a cancelled request cannot be un-cancelled |
| The history table's **Asked** column | |
| The request panel's **chips**, the **working-day count** against the days the office is shut, the **overlap** warning ("You already asked for these days."), and a **weekend refusal** that names the day | |
| The outside panel's **Back by** (now required), its **Note**, and **"With who"** as a list of your own leads | |

### Not built, and why

- **Checking out**, and everything that hangs off it: the "Day finished"
  hero, "I'm back in the office", "Change", the week's hours and the month's
  "Hours in the office". One new column and three decisions — §43.
- **The allowance** — "Annual leave left · 14 of 22 days" and its bar. No
  allowance is stored anywhere. §42.
- **Personal, Half day and Work from home** as leave types, and the "which
  half" switch. The column holds five values. §44.
- **Sharing a location** when working outside, and the **sick note** upload.
  Nothing stores a place or a file. §45.
- **"Month PDF"** for an agent's own month. §47.
- **The demo state switcher.** A way to flip the drawing between its four
  states; the real screen shows the one that is true.

### What changed on the server

- **The same days cannot be asked for twice**, enforced where the data is
  rather than only in the form. Yuliia found the hole on the prototype
  (`docs/v2/tester-rules.md` §52, rule R31): two identical requests were both
  taken. The screen shows the clash as a red banner before the button is
  pressed; `askForLeave` now refuses it as well.
- `dayState` now carries `endsAt`, `lateAfter`, the week's `shift`, and the
  **name** of the office network the caller is on. The addresses stay on the
  owner's settings endpoint, and `shift-facts.integration.test.ts` holds that
  line: an agent's answer never contains one.
- `/api/v2/attendance/me` now sends `marked_at` for every day, and the first
  names of the people who answer a leave request.
- Neither is a new table or a new column. Nothing was migrated.

---

## My profile · `/v2/profile` and `/v2/me`

The design's page is **one screen inside the settings shell**: the hero, three
shortcuts, and a card with two tabs. The build had it as three addresses, none
of them inside that shell. It is one page now, at both `/v2/profile` and
`/v2/me` on a computer.

**Only on a computer.** Under 768px the phone package has its own three
screens — `Profile.dc.html` is a hub of menu rows, `PersonalInfo.dc.html` and
`Security.dc.html` are the two halves of the form — and all three were already
built, so a phone is handed those rather than this page made narrower.
`/v2/settings/security` still answers, which is where the phone's Security
screen lives.

### Built

| What | Note |
|---|---|
| The **settings shell** around the page, with the section list down the left | |
| The hero: photo, name, "<title> · homes.me", and the design's **two chips** | the first is the role and what they sell — no desk is stored against a person |
| **Deals · Viewings · Avg reply**, each a link, with the unit small beside the number | an owner sees the team's month, from the dashboard's own figures |
| **"Best of Homes · rank 2 · 1,740 points"** | the real rank and the real points, from the board Best of Homes ranks on; an owner, who is not ranked among their agents, gets the design's owner line |
| **Personal info / Security** as tabs on the page | |
| The completion bar with **"Missing: …"** | |
| **"Change photo"** and **Remove** (two taps, with an undo) | |
| The design's **validation**: "Write your full name.", "A BRN has 4 to 6 digits.", "Digits only, at least 9.", "Choose at least one language.", and **"Not saved yet. Check the red fields."** | |
| The **password meter**, three bars, with its changing hint | |
| **"The new password must be different."** and **"The two passwords are not the same."** | kept apart, as the design has them |
| **Signed-in devices** — the real ones | a row per live session, "This device", per-device Sign out (two taps), "Sign out all others" (two taps), "Sign out here" |

### Not built, and why

- **Two-step sign-in.** There is no second factor in this build, and
  `CLAUDE.md` says email and password only, "no OTP". A switch reading "On ·
  code from your phone app" would tell an owner their account is protected by
  something that does not exist. Both roles get the block that says what is
  true. Already §38.
- **"Performance this month · 86%"** against a monthly target. §46.
- **Full name as a field for an agent.** `PATCH /api/users/:id` is
  admin-only, so an agent sees their name as a fact with the reason beside
  it. An owner and an admin get the design's input.
- **The Email field read-only.** The design's is the sign-in address. Making
  it read-only would leave an agent no way to put an email on their own
  business card, so the field edits the card's address and names the sign-in
  one beside it.
- **The city a device signed in from, and the "new place" chip.** A session
  records an address, not a town. §47.
- **"Last changed 24 Sep 2026"** under the password. Nothing records it. §47.

### What changed on the server

Three endpoints, all scoped to the caller's own sessions by construction:

```
GET    /api/auth/sessions        my live sessions, with the device named
DELETE /api/auth/sessions/:id    sign one of mine out (never this one)
DELETE /api/auth/sessions        sign out all the others
```

Both deletes write to `audit_log`. `listSessionsForUser()` had existed since
the first migration with nothing serving it.

---

## Checking

- `web`: 50 new tests in three new files — `attendance-screen.test.ts` (24),
  `profile-screen.test.ts` (13), `inbox-screen.test.ts` (13). The suite was
  742 when this work started.
- `server`: `devices.test.ts` (4), `sessions.integration.test.ts` (7),
  `shift-facts.integration.test.ts` (5), and one more in
  `leave.integration.test.ts` — the same days cannot be asked for twice, now
  enforced on the data as well as in the form (`docs/v2/tester-rules.md` §52,
  rule R31). The integration ones need a database — `TEST_DB_HOST=127.0.0.1
  TEST_DB_PORT=3306 TEST_DB_USER=crm TEST_DB_PASSWORD=crmtest`.
- Both workspaces typecheck.
- `docs/v2/proof/inbox.jpg`, `attendance.jpg`, `profile.jpg` — the design
  beside the build, 1440px, light.
- All three were opened in a real browser at 1440px and 390px, and every tab
  and both side panels were walked through.
