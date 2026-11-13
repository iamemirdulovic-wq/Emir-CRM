# Phone build — group D questions

*The owner's tools and the install guide, 13 Nov 2026. Fourteen screens, from
`docs/v2/phone-audit-4.md` and `-5.md`. One line each: what the phone design
says, what the computer design says, what I did.*

Everything below was found while making these screens fit a 390px phone. The
phone layout itself is done; this is what I would not decide on my own.

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

**`.d-mini-list` is only defined under `.p-import`.** On **System health**
("The website form") and on **Team and roles** it therefore styles nothing,
and the rows render as *"ConnectedYes"*, *"Leads in the last 7 days23"*. That
is true on a computer as well as on a phone.

A phone stylesheet may only hold rules under `@media (max-width: 767px)`, so I
have patched it for the phone and **the computer still shows it**. The fix is
three lines in `v2-shell.css`, which is not a file this group may touch.

## 3. What the design draws that the server has no field for

Left out rather than guessed, as the brief says. None of these is a phone
layout problem; each is a piece of work with a server side.

**Team and roles** — the whole **person sheet**: *"Send a password reset
link"*, *"Sign out of every phone"*, *Deactivate* with *"Tap again: deactivate
and move leads to Incoming"*, *"See profile and results ›"*, and the refusal
*"An owner cannot be deactivated here."* Also the **invite sheet** (name,
email, Agent/Admin, *"the link works for 48 hours"*) and the **two taps to make
somebody an Owner**. `/api/users/:id` changes a role and nothing else, so the
build's one role menu is all the server offers.

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

**Feedback inbox** — **Plan it** and **Mark fixed** on each card, the
**Bug / Idea** chip, the status words the design uses (New · Planned · Fixed),
*"Send all open items to the developer (file)"*, and the computer design's
**+15 points** rule and screenshot / voice-note attachments.

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
ours is text. Also the **QR code** the computer design puts at the top, and
the **`crm.homes.me` address** printed in step 1 — the build says "the same
address you use here" and never writes it down.

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
