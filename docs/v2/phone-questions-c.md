# Phone build — group C's questions

*Projects, the team, the person, Homes AI, Settings and Feedback. Written
13 Nov 2026 while building the phone versions of fifteen screens from
`design/screens/*.dc.html`.*

Three kinds of thing are in here, and nothing else: where the phone design and
the computer design disagree and I had to pick one; where a prototype shows a
number or a feature the server has no field for, so the slot is **blank rather
than guessed**; and where something is reachable on a computer and is not on a
phone. Emir reads this; none of it is urgent, and none of it blocks the build.

---

## 1. Where the two designs disagree

The rule is that `design/web/` wins, because it is newer. These are the cases
where it mattered.

| Screen | Phone says | Computer says | What I built |
|---|---|---|---|
| **Live projects** | Four fixed cards, no filters, no search; each card carries a pitch quote and "Your leads 24 · Team 115" | Chips (All · Dubai · Abu Dhabi · …), a search box and a project count | The computer's. So the pitch quote and the per-project lead counts are gone from the card; the pitch is still on the project page |
| **Live projects** | Status pills read "Campaign live" and "New cluster" | "Selling now", "Launching soon", "Hidden" | The computer's wording |
| **Notifications** | The sub-line is "Owner alerts · this phone" for an owner and "How the CRM reaches you" for everybody else | One line for everybody: "Choose what reaches you. Each alert opens the exact page when you tap it." | The computer's, so an owner no longer gets a line of their own |
| **Notifications** | An owner's three groups *replace* an agent's three | An owner's groups are *added after* an agent's, so an owner sees six | The computer's — which is what the build already did |
| **Personal information** | Languages is a free-text field; BRN hint is "5-digit number on your broker card" | Languages is a chip picker with "Choose at least one language."; BRN hint is "Broker registration number · 4 to 6 digits" | The computer's, both |
| **Feedback** | Six "where" chips (Calendar · Lead page · My Leads · Dialer · Attendance · Other) | A dropdown of every screen in the CRM | The computer's dropdown |
| **Feedback** | The send button reads "Send to Emir & George" | "Send report" | "Send report". **Question for Emir:** should the button name you and George? It is friendlier, and it is the only place in the CRM that names a person in a button |
| **Settings** | *Live projects*, *WhatsApp templates* and *Report a bug or suggest* are rows in Settings | None of the three are in the computer's settings nav | **I kept all three on the phone.** Without "Report a bug or suggest" there is no way to reach the feedback form from Settings at all, which the audit flagged. If you would rather the phone matched the computer exactly, say so and I will take them out |
| **Business card** | Signature is "Orange front, black back"; printer advice is 400gsm, soft-touch, colour proof | Signature is "Black with orange"; printer advice is 350g matt, ask for a test card | Untouched — the build already follows the phone's wording for the design names and the computer's for the printer note. **One of the two is wrong on screen today and somebody has to say which.** This is not new; it was in the audit |

---

## 2. What the design draws and the server cannot fill

Every one of these is left **blank or left out**, never guessed.

**Live projects**
- The **pitch quote** on a card ("Best seller this month, investors love it.")
  is per-project copy that only exists in the prototype. The project page has
  a real "How to pitch it" from `projects.description`; the card does not.
- **"Your leads 24 · Team 115"** per project. `opportunities.project_name` is
  free text, so nothing counts leads by project id reliably enough to print a
  number next to a project's name. The project page's own lead count is a
  name match and is honest about it.
- **"New leads to · RK TA NE"** — which agents a project's leads route to.
  There is no routing rule per project in the database.

**One project**
- **Video** as a fourth thing to send. `design/web/project.html` has
  "Video (1 min 20)", and `project_media` has a `video` kind — but
  `GET /api/library/:id` returns `{ project, units, plans, location }` and no
  media, so there is no URL to send. **This one is small and worth doing: one
  more query in `server/src/http/routes/library.ts`.**
- **"The link is tracked. You get an alert when the client opens it."** and
  the follow-up sheet after WhatsApp opens. The tap is recorded
  (`POST /api/v2/taps`) but nothing tracks an open of a brochure link.

**Best of Homes**
- The design is **weekly** — "Week 46 · ends Sunday 23:59" on the phone, a
  Week/Last week/November switcher on the computer. `/api/wall/sidebar`
  counts points over **thirty days** and takes no period. The screen says
  "Points over the last 30 days" so that nobody reads a monthly number as a
  weekly one. Changing it is a server job.
- **"Show on office TV"**, the round action the design puts in the header.
  There is no TV mode anywhere in this build, so there is no button. (The
  same thing is missing from Team live, which is another group's screen.)
- **"52 calls · 3 meetings"** under each name in the ranking: nothing counts
  calls and meetings per agent per week.

**A colleague**
- The **six-month bar chart** of deals. Nothing serves a per-month series.
- **"Meetings this month"** and **"Calls this week"** as two of the four
  stats. The four shown are the four the profile endpoint has.

**Profile**
- **"My performance this month · Excellent · 86%"**. There is no monthly
  target in the database, so the ring shows badges earned, which is real.
- **"opened 38 times"** on the digital-card row. Nothing counts how often a
  public card is opened; `Card.tsx` already says so on the card screen.
- **"6 of 7 working days this month"** on the attendance row. The month
  figure is on the attendance screen; this answer does not carry it.

**Security**
- **The signed-in device list.** `listSessionsForUser()` exists in
  `server/src/auth/sessions.ts` and **no endpoint serves it to the person
  whose sessions they are**. `/api/activity/sessions` is the owner's
  team-wide sign-in log and needs `reports:team`. So the screen says what is
  true — "the CRM does not yet show you your other devices" — rather than
  drawing three invented rows. **A small endpoint would finish this screen.**
- **"Sign out of all other devices"** as a button. There is no endpoint.
  Changing the password does exactly that, and the screen says so.
- **Two-step sign-in.** There is no second factor in this build at all —
  CLAUDE.md's LOGIN section is email and password only — so the block states
  that instead of offering a switch that would do nothing.

**Feedback**
- **A ticket number** ("#1042"). A report's id is a random string, not a
  number anybody could read out over the phone. The thank-you screen does
  not pretend otherwise.
- **"+15 points for each report."** Both designs promise it; nothing awards
  a point for a report. **Question for Emir: do you want reports to earn
  points?** It is a small change to the points table.
- **A "Short title" field**, **screenshot and voice-note attachments**, and
  the **Low** urgency level. The server stores kind, body, screen and a
  blocking flag, so the form asks for those four and nothing else.
- Four type tiles become three: `feedback_tickets.kind` is
  `bug | question | idea`, and the design's "New feature" and "Idea" are both
  "idea".

**Personal information**
- **Full name** is `users.name`, and the server refuses an agent changing it
  ("everything else is admin-only"). So an agent sees their name as a fact
  with the reason beside it; an owner or admin can edit it. The v1 editor at
  `/profile` does the same.
- The design's single **"Work email"** is the one shown on the card
  (`agent_profiles.public_email`). The sign-in email is a different thing and
  only an owner changes it, which the field's hint says.
- **"What I sell"** is on the Profile menu row's sub-line but is not a field
  on the design's own form, so it is not on this screen. It is still editable
  at `/profile`.

---

## 3. Things I could not change from inside my own screens

- **`titleFor()` in `Shell.tsx`** has no entry for `/v2/feedback`, so without
  `usePhoneHead` that screen's phone header reads "homes.me". Every screen of
  mine now sets its own title, so this does not show — but the next screen
  that forgets will have the same problem.
- **The settings nav's "Sign out" is `<Link to="/logout">`**, and `/logout` is
  not a route. It is in `web/src/v2/settings/Shell.tsx`, which group D owns.
  The phone Settings screen signs out properly (it calls `signOut()` then goes
  to `/login`), and so does the Profile screen, so a phone has two working ways
  out — but that link is still dead on a computer.
- **`web/src/v2/Calling.tsx` uses `.d-gap-12`**, which is in no stylesheet, so
  `design-classes.test.ts` fails. Not my file; flagging it so it is not lost.

---

## 4. One thing I added that the design does not draw

The two **Homes AI "try asking" chips** the audit asked for — "write me a
message in the client's language" and "read a payment plan out of the project
library" — are on the screen. The prototype names a lead and a project in them
("Write a WhatsApp to Marco in Italian", "What is the payment plan of The
Archive?") because it is a demo; mine ask the same two questions without
naming either, so nothing invented reaches the model's prompt.

---

# Second pass · 13 Nov · against the owner's pictures

*The first clean pictures of all 59 phone designs arrived
(`design/phone-shots/`), and with them `docs/v2/phone-proof/<key>.jpg` —
design, build and build-in-dark side by side. Everything below came out of
reading those fifteen pictures. The first half of this file still stands;
this is what the comparison added.*

## 4. What I changed

| Screen | What the picture showed | What I did |
|---|---|---|
| **All fifteen** | Every one of my designs draws the §1.4 **pattern A** header — a 17px title centred between the back button and one round action. The build drew the 30px title on its own line, with the search and the bell beside it | `usePhoneHead({ compact: true })` on all fifteen. The search and the bell are gone from these fifteen screens, as the design has them: they are still on My Leads, the pipeline and the rest, and in More |
| **Meet the team** | The design is five people on a screen: avatar, **name and attendance pill on one line**, desk and languages under it, chevron. The build stacked name, role, pill and languages on four lines of their own — 245px a card, two and a half people on a phone | One row per person, name and pill on the first line, the role and languages under, and the design's chevron on the right |
| **Meet the team** | The design marks nobody's row as their own | The **"You"** badge is hidden at phone width. Pinned to the corner it sat on top of the attendance pill, and there is no room on the line for both. Your own row still carries your own photo. **If you want the badge back, say so and the pill moves to the second line instead** |
| **A colleague** | The design draws **Phone and WhatsApp side by side**. The build had WhatsApp alone | The Phone button was conditional on a *public* number, which most people never set. It now falls back to the sign-in number, which `loadProfile` already sends and the business card already prefers in the same order. This also puts the button back on the computer |
| **One project** | The design orders it hero → pitch → **Send to a client** → the leads. The build had the send card last, under fifty-five leads | Ordered on the phone. On a computer the send card is the right-hand column and the question does not arise |
| **My digital card** | The design opens with the public link — switch, address, Copy link — and only then the printed card. The build had it at the foot of the page, under the whole three-step builder | Ordered to the top on the phone. Unchanged on a computer, where the design puts it in the right-hand column |
| **Best of Homes** | "You are in first place. Keep it." was **cut in half** by the bottom edge of the podium card | The card keeps 14px under the podium on a phone. The same clipping is there at computer width, in the generated `v2-home.css`, which is not mine to edit — **worth a look on the computer** |
| **Personal information** | The completeness bar carries its own grey panel, and inside a white card that reads as a box in a box with 20px of nothing round it | Flattened on the phone: one card, the title, the bar, what is missing |
| **My notifications** | On the one row that carries an "always on" chip, the switch — the only control on the row — dropped to a line of its own under the text | The chip gives way instead, so every switch is on the right where the design has it. Scoped to this screen only, so no other settings panel moves |
| **My notifications** | The top card squeezed "Notifications are on" into two words beside the test button | The button takes its own full-width line under the heading |
| **Homes AI** | The design draws the suggestions as full-width rows, one question each. The build had pills that wrapped where they liked | Full-width rows |
| **The team wall** | "Post to the team" is the width of the box above it in the design | Full width |

## 5. What I did not change, and why

- **"Edit" and "View" on Manage live projects.** The phone design says *Edit
  details* and *See as an agent*. The computer design has no row buttons at
  all, so there is nothing to lose a disagreement to — but the labels are
  shared markup and longer words would re-flow that column on the computer,
  which I was told not to touch. **Say the word and I will rename them.**
- **"Public card link" on the business card.** The phone design says *Share my
  card publicly* and puts a WhatsApp button beside Copy link.
  `design/web/digital-card.html` says *Public card link · Anyone with the link
  sees your card · Copy link*, which is what is built. The computer design is
  the newer one, so it wins, and there is no WhatsApp share button.
- **"Recommended" on the Signature card design.** Only the phone prototype has
  that pill; the computer design does not.
- **Security's order.** The phone design is password → two-step → devices. The
  build is password → devices → two-step, because our two-step block is a
  sentence saying there is no second factor, and a sentence does not belong
  above the list of devices somebody came to read.
- **Settings' order inside YOU.** The phone design has four rows (profile,
  language, appearance, notifications); the build has seven, because Security,
  the phone app and the glass setting are real screens now. Same rows, more of
  them.
- **The attendance pill on a colleague's page.** The design shows "In office"
  under the name. `/api/profiles/:id` does not carry where somebody is today —
  `/api/v2/team` does, and the page does not read it. A second request for one
  pill, so I left it. Small server or screen job if you want it.
- **Feedback's order** is the computer design's exactly (what · where · what
  happened · how urgent · send). The phone design puts a short title second,
  and there is no field for one.

## 6. Not mine, and still true

- `web/src/v2/settings/Team.tsx` uses `.d-gap-12`, which is in no stylesheet,
  so `design-classes.test.ts` fails on it. It was `Calling.tsx` last time;
  same class, different screen. Not my file either time.

## 7. Two more on Meet the team · asked for after the second pass

- **The "Meet the team / Best of Homes" tab row.** `TeamDirectory.dc.html`
  draws no tabs at all — header, then the search box.
  `design/web/team.html` **does** draw them, so the computer design wins and
  the tabs stay at phone width. Writing it down as the rule asks.
  While checking it I found the pair was broken: this screen's second tab
  said *Team wall* — a leftover from when the leaderboard was not built —
  while `/v2/best` draws *Meet the team · Best of Homes*. So the two screens
  that share a tab row disagreed, and from the team you could not reach the
  screen it is paired with. The second tab is now **Best of Homes**, as the
  computer design has it. The team wall is still in More, on the Profile
  menu, and at the foot of a colleague's sheet. **This changes the computer
  too** — one label and where it goes, towards what `team.html` draws.
- **"7 deals this month · 14 meetings"**, the bold third line on every person
  in the phone design. **Not built, not invented.** `/api/v2/team` sends
  name, role, languages, what somebody covers, where they are today and — for
  owners only — their open leads. There is no deals or meetings figure on it.
  The nearest thing is `profileStats`, which counts **won deals for all time**
  and **meetings over the last 365 days**, and is one request per person, so
  it cannot fill a list of ten. **A server job:** two monthly counts added to
  the team query — deals won this month, and `activities` of type
  `meeting_booked` this month — and the line appears. Say the word and I will
  write it.
