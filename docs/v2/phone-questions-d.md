# Phone build — group D questions

*The owner's tools and the install guide, 13 Nov 2026. Fourteen screens, from
`docs/v2/phone-audit-4.md` and `-5.md`. One line each: what the phone design
says, what the computer design says, what I did.*

Everything below was found while making these screens fit a 390px phone. The
phone layout itself is done; this is what I would not decide on my own.

---

## 0. The second pass, against your pictures (13 Nov, later)

The 59 phone pictures made it possible to compare properly for the first
time. What follows is what that comparison changed, and two things in §3
below that I had written down as impossible and that are not.

**Put right on the phone, from the pictures:**

| Screen | What the picture showed | What I did |
|---|---|---|
| Team live | The design opens with the three numbers and the hourly chart; the build opened with "Right now" and buried them a screen and a half down | The clicks card comes first on a phone. Its own heading was being drawn across the numbers, because the computer's 372px row height landed on whichever card was first — that is fixed too |
| Team live | "+12% vs yesterday" wrapped to two lines in a 99px tile and pushed "Call clicks" below the other two labels | The short form, "+12%", at phone width only. The design has no comparison on those tiles at all |
| Import | The design names all six steps — Upload · Columns · Check · Give · Confirm · Done. The build showed only the one you were on | Six columns, the name under its circle, the joining lines gone. A wizard that cannot say how far it has to go is not a wizard |
| Automations | The four times fit one row in the design; the build wrapped them three and one, which reads as though the fourth were different | Four equal columns |
| Desks | The design's one button is the round `+` in the header; the build had a bar across the page | Moved to the header. The computer keeps its button |
| Team and roles | **Both** designs have "Invite a person" and the build had no way to add anybody at all | Built — see §3 |
| Attendance rules | Starts and Ends side by side in the design; one field per screen-width in the build | Side by side. "Late after" takes the second line, because three time fields at 390px is 95px each and the input clips its own AM/PM |
| Company details | ORN beside TRN, phone beside email; the build had one field a line, eleven screens of mostly white | The pairs are back. The long fields still take the width |
| System health | The state pill on the right of each row in the design; the build stacked it underneath and doubled the card's height | On the right. A row that is not set up puts its "Set it up" button on a second line, so the name keeps its width |
| Feedback inbox | The design's chips are New · Planned · Fixed · All; the build had five of its own words. The design puts Plan it · Mark fixed · Reply on each card; the build had one "Answer" that opened a box | The design's four words and order, every chip with its count, and the two quick buttons on the card at phone width. "Answer" is now "Reply", which is what both designs call it |
| Feedback inbox | The design shows a Bug / Idea chip; the build had only an icon | The word is there |
| Team activity, Messaging | The computer design gives all three owner reports the Activity · Live · Messaging row. Activity had none and Messaging was missing Live | All three have all three |
| Phone app | The design prints `crm.homes.me` in step 1; the build said "the same address you use here" and never wrote it down | It prints the address the page is open at, which is by definition the one that works |

**Six changes above 768px**, all because the *computer* design asks for them
and the build did not have them. Nothing else on a computer moved:

1. Team and roles: an "Invite a person" button beside the heading, and the
   dialog behind it.
2. Team activity: the Activity · Live · Messaging row at the top.
3. Messaging: "Live" added to that row.
4. Feedback inbox: the four chips renamed and reordered, each with a count.
5. Feedback inbox: "Answer" renamed "Reply".
6. Phone app: the address written out.

**Left alone, and why:**

- **Messaging's four numbers** are one row of small tiles in the design and
  two rows of two in the build. The build's labels are sentences —
  "Confirmed · the agent answered" — not one word, and four of those across
  390px is one word a line. Two across.
- **Import's drop zone.** The phone design says *"Choose an Excel or CSV
  file · From your phone, computer or Google Drive"*; `design/web/import.html`
  says *"Drop your Excel or CSV file here · or click to choose a file from
  this computer"*, which is what the build says. Computer wins, so I left
  it — but "this computer" is wrong on a phone and I would change both.
- **Homes AI** and **Home banners** put their cards in a different order on
  the phone than on the computer. The build follows the computer in both.
- **Team activity's summary cards** (average time, most active, least
  active, not seen) are in the computer design and not in the phone one.
  Kept. So is the underline tab row, which the phone draws as pills.

---

## 1. Where the two designs disagree, or the design and the build

| # | The case | What I did |
|---|---|---|
| 1 | **Messaging is called three things.** `OwnerMessaging.dc.html` titles it **"WhatsApp & Telegram"** and `Menu.dc.html` names the tile the same. `design/web/messaging-report.html` has no title at all. The build's menu says **"Messaging"**. | The phone header now reads **WhatsApp & Telegram**, because that is the only name either design actually writes. The sidebar on a computer still says Messaging. Say if you want one word everywhere. |
| 2 | **Its subtitle.** The design's is *"Owner · today · no API needed"* — and the second half is the point of the screen. But the build has a **Today / Week / Month** switch, so "today" is not always true. | The subtitle reads *"Owner · taps, replies and links opened · no API needed"*. |
| 3 | **"Updated 10 sec ago" on Team live.** `OwnerLive.dc.html` says ten seconds. The build asks the server again every **30** seconds. | The subtitle says 30 seconds, because it is what happens. Shorten the interval if ten is what you want. |
| 4 | **Team activity is called "Activity"** in the build's menu; the prototype calls it **"Team activity"**. | The phone header says **Team activity** — on a phone "Activity" on its own does not say whose. |
| 5 | **Desks: the 40 / 50 / 60 / 80 limit sits on the desk card.** `Desks.dc.html` keeps it **inside the edit sheet**. On a phone a thumb scrolling the list past that row can change a desk's limit by accident — there is no confirmation. | **Left as it is, and I would move it.** It is a working control, so it is your call. |
| 6 | **The limit is said to do three different things.** `design/web/desks.html`: *"an agent over the limit gets no new leads from Share equally and from imports."* `Desks.dc.html`: silent. The build's own footer: *"Nothing is blocked by this number yet."* | Untouched — this is a rule, not a layout. The build's sentence is the honest one today. Does the limit start skipping agents, or stay a gauge? |
| 7 | **Automations' closing line.** The design prints *"The CRM never sends WhatsApp by itself. It prepares the message; the agent presses send on his own phone."* But `CLAUDE.md` Workflow A sends `lead_welcome_{lang}` automatically, and Workflow B sends the follow-ups. | **Not added.** Adding it would print something that is not true of this build. Which is it — does the CRM send, or only prepare? |

## 2. One real bug I could not fix from a phone stylesheet

**Fixed by you on 13 Nov, in `v2-shell.css`.** `.d-mini-list` and
`.d-mini-stats` are now defined for every page rather than only under
`.p-import`, so System health and Team and roles no longer read
*"ConnectedYes"*. My own phone copy of those rules is still in
`v2-phone-d.css` and is now redundant; it is harmless and three lines, and I
have left it rather than touch a shared file's behaviour on the way past.

## 3. What the design draws that the server has no field for

Left out rather than guessed, as the brief says. None of these is a phone
layout problem; each is a piece of work with a server side.

**Team and roles** — ~~the invite sheet~~ **I had this wrong and it is now
built.** I wrote that `/api/users/:id` changes a role and nothing else. The
server also has `POST /api/users` (name, email, role) and `POST
/api/users/invite` (several emails at once), both owner/admin only, both
audited. So the design's `+` and its sheet are real, and both designs ask for
them, and there is now a sheet with Full name · Work email · Agent/Admin.

**One thing in it does not match the design and cannot.** The design's sheet
says *"They get an email with a link to set a password"*. `POST /api/users`
sends nothing: it returns a one-time password, once, for whoever made the
account to hand over, and the new account must change it at first sign-in. So
the sheet says that instead, and shows the password with "copy" after it is
made. **Do you want the invite emailed instead?** The server can
(`/api/users/invite` with `sendEmail`), but it takes only an email address and
makes the name up from the part before the @, so the design's "Full name"
field would go.

Still missing on that screen, and still needing a server side: the **person
sheet** — *"Send a password reset link"*, *"Sign out of every phone"*,
*Deactivate* with *"Tap again: deactivate and move leads to Incoming"*, *"See
profile and results ›"*, the refusal *"An owner cannot be deactivated here"* —
and the **two taps to make somebody an Owner**. (`POST
/api/users/:id/reset-password` and the `isActive` flag on `PATCH
/api/users/:id` both exist, so most of that sheet is a screen's work, not a
server's. Say the word.)

**Home banners** — the design's banner **is a picture**: upload, "use project
photo", thumbnails in the list, a live image preview. Also **label chips**
(From Emir · Office · Project · Best of Homes · Training), **button text** and
a **"Opens"** chooser instead of the raw path the build asks for, **Show from
/ Until** dates (so **Scheduled** and **Ended** states), **who sees it**
(Everyone / Agents / one desk), **"seen by 9 of 10"**, and **drag to
reorder**. The table has none of those columns.

**Company details** — the **logo row** ("Logo · tap to change"). No upload
endpoint for it.

**System health** — three of the design's six rows: **Imports** ("Last import
09:12 · 240 rows"), **Background jobs** ("the 5-minute rule ran 31 times") and
**WhatsApp templates** waiting on Meta review. Also every throughput line
("sent 412 today · 0 failed", "answering in 1.8 s"). Nothing records history,
which the screen already says. **Background jobs is the one I would build
first**: the worker runs inside the API process and nothing anywhere says
whether it ran this morning.

**Team live** — **"Meetings booked"** as the third KPI (the build counts
Telegram clicks instead; meetings booked is the only one of the three that is
an outcome rather than a click), the **stacked two-colour hourly chart**, and
per-agent presence as *"On a call · 3 min"* / *"Power hour"* / *"Idle 34
min"*. **"Open TV mode"** exists only in the phone prototype, where it is a
toast stub; the computer design has no such button, so I left it out.

**Feedback inbox** — ~~Plan it, Mark fixed, the Bug / Idea chip and the
status words~~ **also wrong, also now built.** The server has had
`new · planned · fixed · declined` all along (`server/src/v2/feedback.ts`);
the build only reached them through the reply box. They are on the card now
and the chips use the designs' own words.

Still missing: *"Send all open items to the developer (file)"* — nothing
exports these — and the computer design's **+15 points** for sending a report
and its **screenshot / voice-note** attachments.

**Import** — **"Download the empty template"**, the **"Up to 5,000 rows"**
limit, the design's **column-mapping bottom sheet** (the build uses a native
`<select>`, which is fine with a thumb), the **per-agent warnings** on step 4
(*"57 open now · already busy"*, *"on leave today"*, *"absent today"* — an
owner cannot see who is on leave before giving them seventy leads), the
**per-agent result list** on step 6, and the **undo confirmation sheet**.

**Install guide** — every **drawn mock-up**: the Safari toolbar, the Share
sheet with "Add to Home Screen" picked out, the Chrome ⋮ menu, the home-screen
grid, both permission dialogs, and the **lock screen**. On a guide whose job
is "find this button on your phone", the picture *is* the instruction, and
ours is text. Also the **QR code** the computer design puts at the top.

*The address is printed now.* It is read from the browser
(`window.location.host`), so on the live site it says `crm.homes.me` and in a
preview it says the preview's address. Nothing is stored or guessed.

*I did add the design's closing table, **"Tap a notification, it opens…"**,
because it needs no server and it is the reason to install at all. Every row
in it was read out of the link the server really stores
(`v2/vip.ts`, `incoming.ts`, `transfers.ts`, `leave.ts`, `workflow-a.ts`,
`workflow-c.ts`). The design's other rows — meeting reminders, "How did it
go?", a leave request landing on Team attendance — are not in that list yet,
so they are not claimed.*

## 4. The sign-in page — looked at, not touched

`Login.dc.html` is outside the v2 shell, so none of the phone rules reach it
and nothing here was changed. What it needs, shortest first:

1. **A link to the install guide.** Both designs put a card on sign-in:
   *"No app to download. Open crm.homes.me in Safari or Chrome, tap Share ›
   Add to Home Screen."* with **"Show me how ›"**. An agent signing in on a
   new phone is exactly the person who needs it, and sign-in is the only
   screen they can see before they are in. The build has no route to
   `/v2/settings/phone-app` from there at all.
2. **The team photograph takes the first ~200px of a 390px screen** before the
   form starts. The phone design is one column with no image.
3. **The English / العربية switch.** Both designs have it; the build has
   neither.
4. Small wording: *"Let's close deals."* as the second headline line,
   *"Keep me signed in **on this phone**"*, the placeholders `you@homes.me`
   and `••••••••`.
5. **Two things the computer design asks for and nobody has built**: a
   *Forgot password?* link with a **Show** toggle on the password field, and
   a **second step for owners and admin** ("write the 6 digits from your code
   app"). Both are decisions, not layout.

The dashed **"DESIGN DEMO ONLY · CHOOSE WHO SIGNS IN"** box in the prototype
is its own scaffolding and must not be built.

## 5. One thing I changed that another group depends on

`web/src/v2/settings/Shell.tsx` — `SettingsTitle` now hands its title and note
to `usePhoneHead`, and `v2-phone-d.css` hides the panel's own copy under
768px. Without it every settings screen read **"Settings"** in the shell
header and then drew a second `<h1>` under it, because `titleFor()` only knows
the first part of an address. **The computer layout is unchanged.** It applies
to all thirteen settings panels, including the two group C owns.

**Second pass, 13 Nov:** `SettingsTitle` takes one more thing, an optional
`action`, which it passes to `usePhoneHead` so a panel's one button becomes
the round `+` in the phone header — which is where `Desks.dc.html` and
`SettingsTeam.dc.html` both draw it. A panel that passes `action` has its own
title row hidden on a phone entirely, since the button has moved; a panel that
passes only `children`, as before, keeps the row with the button in it. Both
are optional and nothing that does not pass `action` behaves differently, on
a phone or on a computer. Sign out is still the `<button>` calling
`signOut()`, untouched.
