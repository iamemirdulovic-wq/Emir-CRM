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
