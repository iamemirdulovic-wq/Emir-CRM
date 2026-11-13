# Decisions I made without asking — please confirm

Emir asked me to keep working rather than stop for each decision, and to take
the option the master prompt calls "assumed" where there is one. Everything I
chose that way is listed here, newest last. Each one is cheap to change.

Nothing here touches the live CRM. All of it is on the `v2` branch.

---

## 1 · The test address is a preview, not a second website

**Superseded 13 Nov** — you asked for a real one. `docs/TEST_SITE.md` is the
step-by-step for new.crm.homes.me with its own copy of the database.

**The decision.** `crm.homes.me/v2` is not online. You told me not to change
the live site, and putting v2 on that host — even on its own path — means
changing what the live server serves. So what you can try right now is a
**preview running inside this session**, which the Claude app shows you in a
panel beside the chat.

**What it is.** The whole v2 build, every screen, with made-up data instead of
your real leads. Nothing you press in it reaches a real client, a real number
or the real database.

**What it is not.** It is not reachable from your phone over the internet, and
it stops when this session ends.

**What I need from you.** Whether to put v2 on a real second address. That is
a change to the live hosting, so I have not done it.

---

## 2 · Sales offers are the small design, not the big brief

**The decision.** The original master prompt describes a large offer builder:
multi-section presentation page, gallery, payment timeline, a separate
developer sheet, folders, templates, tracking per section. Your new design
file (`design/web/sales-offers.html`) describes something much smaller and
says so in its own words: *"A sales offer is a one-page price sheet for one
unit."*

**I built the design file's version.** Where the two disagree, you told me the
design package wins.

**What this means.** No folders, no section builder, no developer sheet, no
per-section tracking. One unit, one price, one link, and the CRM tells you
when the client opens it. The big builder's database tables are still there
and untouched, so nothing is lost if you want it later.

---

## 3 · The office network is an address, not a Wi-Fi name

**The decision.** `design/web/settings-attendance.html` asks for the office
Wi-Fi network name, "exactly as on the phone". **No browser can read the
Wi-Fi name** — not Chrome, not Safari, not on a phone, and no permission
unlocks it. The screen asks for the office's internet address instead, which
is what the live CRM already checks, and it shows you the address your
computer is being seen from so you can save it in one tap while sitting in
the office.

**The limit, plainly.** Somebody on a VPN into the office defeats it. That was
already true before this screen existed.

---

## 4 · "Accepted" on an offer is a date, not a status

**The decision.** Adding "accepted" to the offer's status column would mean
rewriting that column on a live table, which the safety check refuses and is
right to. It is stored as the date the client said yes instead.

**What this means for you.** Nothing on screen. It is the same three states.

---

## 5 · The automations page is the office's rules, not the message machinery

**The decision.** `design/web/automations.html` lists about a dozen switches.
Three of them already existed as "workflows" (assign and welcome, chase for
four days, route a reply). The rest did not exist at all. I made the page the
design's — the office's rules — and left the three workflows where they were.

**What I need from you.** The take-back defaults. I set **30 minutes for a VIP
lead** and **24 working hours for an imported lead**, which is what the design
file shows. Change them on the page itself if they are wrong.

---

## 6 · Three settings pages have nothing behind them yet

**Out of date 13 Nov** — all four are built now: Team and roles, System
health, the Phone app guide and the Feedback inbox. Nothing to decide.

**Team and roles**, **System health** and the **Phone app** guide are in your
design and have no CRM behind them. Rather than link to an empty page, each
says plainly that it is not built and points at the older screen that does the
same job. They are on the list to build.

**Feedback inbox** is in your design nav. There is no feedback system in the
CRM at all, so I left the link out rather than pointing at nothing.

---

## 7 · System health has no uptime bars

**The decision.** `design/web/system-health.html` draws a thirty-day bar per
service and a list of past problems. **Nothing in the CRM records uptime
history**, so those bars would be decoration — drawn green because nobody is
counting, which is worse than not drawing them.

**What the page shows instead** is what is true right now, checked when you
open it: which services are connected, who has no phone registered for alerts,
and whether the website form has gone quiet. The page says plainly that there
is no history yet.

**What I need from you.** Whether recording uptime is worth building. It means
a check running every few minutes and a table to keep the results in.

---

## 8 · Feedback keeps a report's screen, and "it stops me working" sorts first

**The decision.** When somebody reports a bug, the page they were on is saved
automatically rather than asked for. It is the first question anybody would
ask back, and an agent who has to answer it before they can report usually
does not report.

**And the urgency is two choices, not three.** "Normal" and "It stops me
working". A blocking report sorts above everything else in your inbox
whatever its date — an agent who cannot do their job today buried under last
week's ideas is the thing this ordering exists to prevent.

---

## 9 · Five home banners, enforced on the server

**The decision.** The design says up to five. That is checked on the server,
not just by greying out the button — six banners rotating is not five plus
one, it is a carousel nobody waits through, and the sixth is the one nobody
ever sees. Switching an old one back on counts against the five too.

## 10 · The morning brief says where its words came from

The design's dashboard has a black hero card headed **"Homes AI · Morning
brief"** over a sentence that reads as if a person wrote it.

What the CRM actually has is `/api/activity/insight`, which counts your own
numbers and labels itself, in its own answer, **"Counted from your own
data"**. That is the label the card carries, and those are the lines it shows.

Nothing is invented and no counted fact is dressed up as a machine's opinion.
If you would rather the card said "Homes AI" and had Gemini write the sentence
from those same numbers, say so — it is a small change, and it needs the
Gemini key.

## 11 · The full dashboard is owner and admin only

`docs/v2/pages.md` marks `dashboard.html` **O/Ad**, so that is how it is built:
a manager gets "The full dashboard is for the owner and admins."

The reason to agree with it: the page shows every agent's calls, meetings and
deals side by side, and the whole company's totals. A manager has their team
on `/v2/team` and the same numbers for their own people.

If you want managers in, it is a one-word change on the server and one in the
screen — but then a manager sees everybody, not only their desk.

## 12 · "Move 31" sends that agent's leads back to Incoming

The Going cold card has the design's **Move N** button. It takes every *open*
lead off that person and puts it in Incoming, where you give it out. It does
not choose the next agent — the same rule the five-minute bounce follows, and
for the same reason: you chose that agent once, and the CRM should not choose
the next one for you.

Three things about it:

- It asks first. The button becomes **"Yes, move 31"** and only the second tap
  does anything.
- Won and Lost leads stay where they are. They are not anybody's work.
- It is written to `audit_log`, with who did it and how many moved.

Owner and admin only.

## 13 · Follow-ups is a tab on Tasks, not a page of its own

The sidebar's **Follow-ups** row used to open a list of overdue leads. The
design points it at the Tasks page's second tab (`tasks.html#follow-ups`), so
that is where it goes now.

Nothing is lost: the old overdue-leads list still answers at `/v2/follow-ups`,
and the follow-ups tab has a **"See them as leads"** button that opens it.

The reason the design is right: a task is something you have to do, a
follow-up is a promise you made to a client. They belong on the same screen
because they are both "what I owe today", and being late with one is a
different kind of late.

## 14 · The unit number is asked for, not demanded

`lead.html` puts a red star beside **Unit** in the Won box, which means the
screen will not let you mark a deal Won without it.

It was optional before and it is optional again, because a unit number is not
always in the agent's hand at the moment a client says yes — and a Won that
cannot be recorded is the most expensive thing on that screen. The field is
still there, still asked for, and the deal can be saved without it.

Say the word and the star goes back.

## 15 · The phone is your phone shell, with the computer pages inside it

**What I did.** The frame around every screen — the floating bottom bar, its
five items in your order, and the round orange dial button beside it — is
built from the 68 phone screens in `design/screens/`. I read them properly
first; `docs/v2/phone-shell.md` is that reading, down to the 66px bar height
and the 108px gap underneath.

**What I did not do.** The *contents* of each screen are the computer design
reflowed to 390px, not the phone screen's own layout. Three things follow
from that, and they are real:

1. **Dialogs are centred boxes, not sheets rising from the bottom.** Your
   phone screens use a bottom sheet everywhere — the check-in, "give to an
   agent", transfer a lead, log an outcome. Mine open in the middle.
2. **The bottom bar shows everywhere.** Your design hides it on four screens
   on purpose — the dialler, a chat, email and login — because those are jobs
   you finish before you leave. Mine keeps the bar on all of them.
3. **No screen-load animation.** Your phone screens lift their cards in on a
   stagger. Mine appear.

**Why it went that way.** You stopped the build on 12 Nov because screens were
being invented instead of built from `design/web/`. Every screen since has
been built from its computer design file, which is what you asked for — and
those files have no phone version, so the phone layout is mine.

**What I would do about it, if you want it.** Roughly in order of what you
would feel on a phone:

- **Bottom sheets** — about a day. Every dialog and panel slides up from the
  bottom at phone width. This is the one that makes it feel like an app.
- **Hide the bar on the four full-attention screens** — about an hour.
- **The stagger-in** — about an hour.

Say which of the three you want and I will do them. Say none and the phone
works as it is; it is clean, it fits, and nothing is cut off.

---

## 16. The sign-in page is still green

**What I found.** The sign-in page is the one screen shared between the CRM
you use today and the new one. Everything behind it is now orange; the
sign-in page is still the old green — the Sign in button, the tick box. On a
phone it is the first thing anybody sees.

**Why I left it.** Changing it is a cutover decision, not a phone-layout
bug. The layout at 390px is already right: the team photo on top, the brand,
the form, nothing cut off, nothing sideways.

**A) Make it orange at the same time as everything else** (recommended — one
look, one day). **B) Leave it green.** Which one?

## 17. Two things on the sign-in page that the designs disagree about

1. **Two-step sign-in.** `design/web/login.html` draws a second step for
   owners and admins: six digits from a code app. Your master prompt says the
   opposite — *"simple built-in email + password login only. No OTP."* I
   followed the master prompt and built nothing. Do you want the six-digit
   step for owners and admins, or not?
2. **"Email me a sign-in link."** The build has this button; neither design
   file draws it. It sends a one-time link to your work email. Keep it, or
   take it out?

## 18. Where "Sign-in and security" lives

The phone design has a screen for it — change your password, see which
phones and computers you are signed in on, sign one out. Nothing in the CRM
reached it. There is now an address for it and the screen is being built,
but nothing links to it yet except the settings list. Is Settings the right
place for it, or do you want it on your profile page as well?

## 19. How a new person gets their password

There is now an **Invite a person** button on Team and roles — your design
has one and the CRM never had any way to add somebody.

Your design's form says *"They get an email with a link to set a
password."* What the CRM actually does is different: it makes the account
and shows you a **one-time password once**, for you to send them yourself.
The form says that, with a copy button.

There is a second way in the system that really does send an email, but it
only takes an address and makes the name up from the part before the @ —
so "Full name" would have to go.

**A) Keep it as it is** (recommended — you hand the password over on
WhatsApp, which is what happens today anyway, and the name is right).
**B) Send the email instead**, and lose the name field.
**C) Build the proper one**: an email with a link, and the name kept. Half
a day of server work.

## 20. "From your phone, computer or Google Drive"

Your phone design says that under the import box. Your computer design says
*"or click to choose a file from this computer"*, and the computer wins, so
that is what is built. But "this computer" is wrong when somebody is
standing in a lift with their phone.

**A) Change both to "from your phone, computer or Google Drive"**
(recommended). **B) Leave it.**

## 21. Alerts on a locked phone — are the Firebase keys set?

My Day now has the **"Turn on notifications"** card your design draws, and
it asks the phone properly. But a message only reaches a phone that is
locked and in a pocket if the push keys are set on the server, and I cannot
see from here whether they are on crm.homes.me.

Right now the card says exactly that and nothing more: *"This phone will
show alerts. Leads on the lock screen need one more switch from the
office."*

**A) Set the keys** (recommended — it is the difference between an agent
seeing a VIP lead in thirty seconds and seeing it when they next open the
CRM). `SETUP_NEEDED.md` lists which ones. **B) Hide the card** until they
are set, so nobody is promised something that does not happen.

## 22. Should Notes be its own screen?

Your phone design draws **Notes** as a screen of its own. In the build it
is a tab on the lead, two screenfuls down — tapping it now scrolls it to
the top so it fills the phone, which is most of the way there.

**A) Leave it as a tab** (recommended — one less screen to go back from).
**B) Give it its own address**, exactly as the design has it.

## 23. An agent can no longer read the take-back rules

Three things an agent could read by typing the address are shut now: the
office's **team structure**, your **automation switches**, and the
**take-back rules** behind the Automations page. You asked for every owner
page shut on the server as well as on the screen, and these were the three
that really were open.

One of them has a cost worth naming. The take-back rules used to be
readable by everyone, on purpose, with this reason written beside the code:
*"an agent whose lead went back deserves to know the rule that took it."*
That is fair, and the message an agent gets when a lead goes back still
says what happened — but they can no longer look up the rule itself.

**A) Keep it shut** (recommended — it is your switch panel, and the
take-back message already explains itself). **B) Let agents read the rules
but not change them**, as it was.

## 24. "Going cold" has no list of its own to open

The design's owner home and full dashboard both have a **Going cold** row —
open leads nobody has contacted for seven days — and both of them open
`all-leads.html?tab=going-cold`. The leads list has no such tab: it offers
Today, New, Overdue, No next step, VIP, Lost and All.

So the count beside the row is the real seven-day figure, and tapping it opens
the **Overdue** list, which is the nearest true thing rather than an error
page. "Overdue" is a different question, though — it means a promise whose
time has passed, and a lead can be going cold with no promise on it at all.

**A) Add a "Going cold" tab to the leads list** (recommended — it is one
clause on one query, and it is the list the owner is being sent to look at).
**B) Leave it pointing at Overdue** and change the row's wording to match.

## 25. Three dialogs on the owner's home open a screen instead

`owner-home.html` answers three of its six rows inside a dialog: **Give** a
lead to an agent, **Answer** two leave requests, and a side panel for an agent
who is **absent**. Each of those three jobs already has a built screen —
Incoming, Attendance, and Attendance again — so the rows open those instead,
and the work gets done in one place rather than two.

The cost is a page change where the design has a panel: three taps rather than
one, and you lose your place on the home screen.

**A) Leave it as links** (recommended for now — one copy of each job, and the
screens behind them are fuller than the dialogs were). **B) Build the three
dialogs as well**, and keep both in step.

## 26. The owner's home has no greeting on the computer

The phone design opens with "Good afternoon, Emir" over the date. The computer
design does not: the shared top bar carries the name and the date, and the page
starts straight on the Today / Week / Month / Year switch.

The build now matches both — greeting on a phone, no greeting on a computer.
But the shared top bar has **lost its grey sub-line** on every page (the
"Wednesday, 11 November 2026 · shift 09:00 – 18:00" the design gives all 44),
so on a computer the date is now nowhere on the owner's home except inside
"Live · 14:55".

**A) Put the sub-line back in the top bar** (recommended — it fixes all 44
pages at once, and it is what the design draws). **B) Give the owner's home
its own greeting on the computer too**, which is one page fixed and 43 still
missing it.

## 27. A task with "no time" cannot be stored

The tasks design opens the Time box with **"No time"** at the top of the list:
a task that belongs to a day and not to an hour. The build cannot store one.
`tasks.due_at` is a date *and* a time and has been since the first migration,
so a task with no time has to be given one anyway — and whatever hour we
picked would be a number nobody typed, showing up in the list as if the agent
had chosen it.

So the new-task form asks for a time. It opens at the **next free time** on
that day, which is what the design does for every other case, and the list is
the design's own quarter-hour list, 07:00 to 21:00, 24-hour.

**A) Leave it as it is** (recommended — a task with a time shows up on My Day
in the right order, and "no time" quietly means "end of the day" to a database
either way). **B) Add a "no time" flag to the task**, which is one new column
and a change to every screen that reads a task's hour: My Day, the week strip,
the calendar and the reminder job.

## 28. A no-show's "red flag" has nowhere to live

The meeting result panel says, word for word: *"After 2 no-shows the lead gets
a red flag."* The count is real now — the calendar counts every no-show on
that lead, over the whole book, and the second one says *"The lead gets a red
flag. The owner sees it."*

**But there is no red flag.** No column on the lead holds it, nothing on the
pipeline card draws it, and no screen lists the leads that have one. The
sentence is the design's and it is on screen, so the promise is being made.

**A) Build the flag** (recommended — a column on the opportunity, a red dot on
the lead card, and a line on the owner's dashboard; it is the thing that makes
counting no-shows worth doing). **B) Soften the sentence** to say only what is
true: "This is the second time they have not come."

## 29. The result panel has no Telegram button

The design's no-show form offers **Open WhatsApp · Open Telegram · Copy**. Two
of the three are built. Telegram is not: there is no Telegram anywhere else in
the CRM, and Telegram has no way to open a chat with somebody from their phone
number the way `wa.me` does — it needs their username, which we do not hold.

**A) Leave it out** (recommended). **B) Ask every agent to collect Telegram
usernames**, add a field to the contact, and build it from there.

## 30. The design wants a lead on a Follow-up plan too; this build does not

`design/web/calendar.html` requires a lead for every plan except a Team one —
a Follow-up included. The brief for this change named three kinds: a meeting,
a site visit and a call. Those three are required, on the screen and on the
server. A Follow-up can still be planned without a lead.

**A) Leave it** (recommended — "follow up on the Emaar price list" is a real
plan with no lead on it). **B) Require a lead on a Follow-up as well**, which
is one word in `LEAD_REQUIRED` on each side.

## 31. "Booked a unit" writes the project down but does not change the lead's

The booking form asks which project they booked in, and the answer is stored
on the meeting. It is **not** copied onto the lead: a lead that asked about
Valia and reserved in The Archive keeps Valia as the thing it asked about,
because that is what the first-touch rule in the master prompt says a lead's
project is.

**A) Keep both** (recommended — the question "what do they ask about" and the
question "what did they buy" are different questions, and the reports want
both). **B) Move the lead onto the project they booked**, which rewrites the
history of every report that groups by project.

## 32. The Won form now says "posted on the Team wall", not "+300 points"

`design/web/lead.html`'s Won dialog promises **"It is posted on the Team wall ·
+300 points."** The first half is true — `postDealWon()` writes the wall post.
The second half is not: `recordAchievement` pays XP for reaching a lead and for
booking a meeting, and pays nothing at all for a Won. So the screen now says
only the half that happens.

**A) Pay the points** (recommended — a Won is the most valuable thing an agent
does and it is the one action on the board that scores nothing; it is one rule
in `wall/wall.ts`, which another pair of hands holds this week). **B) Leave the
wording as it is** and drop the number from the design.

## 33. Purpose, Timeline and Payment are a menu, not a free-text line

The design's "What the client wants" shows **Purpose: Investment**, **Timeline:
Q1 2027**, **Payment: 60 / 40 plan** and says *click a line to edit*. Two of
those three are free text in the prototype, and the columns behind them are
not: `purpose`, `timeline` and `payment_method` are ENUMs written in January,
and MySQL here refuses a word outside the list rather than storing an
approximation of it. So those three lines open as a short menu —
Investment / To live in / Not said yet, and so on — and the other four
(Project, Unit, Budget, Language) open as a text box, as drawn.

**A) Keep the menus** (recommended — the three are reported on, and "Q1 2027"
typed by one agent and "Q1 '27" by another cannot be counted together).
**B) Add free-text columns beside the three ENUMs** so an agent can write
"Q1 2027" and the reports keep the coarse answer as well.

## 34. "Select all 863" selects the first 200

The owner's book is 863 leads and the design's select-all bar offers the whole
list. One press of Move may carry **200**, which is generous for a day's work
and small enough that the request cannot turn into a background job halfway
through somebody's afternoon. Pressing "Select all" on a longer list selects
the first 200 and says so in a toast.

**A) Keep 200** (recommended). **B) Make a real background job of it**, with a
progress bar and a report at the end, which is a day's work and the same shape
as the bulk import.

## 35. The owner's book has no Export button yet

`design/web/all-leads.html` puts **Export** at the end of the filter row.
`/api/contacts/export/csv` exists and is owner/admin only, but it exports
*every* contact in the CRM rather than the list on screen, and a button that
ignores the filters above it is a button that lies. It is left off until the
endpoint can take the same filters as the list.

**A) Leave it off** (recommended). **B) Put it on now** and label it "Export
every lead", which is what it would do.

## 36. The sign-in page's three preview cards showed real clients and real numbers

`design/web/login.html` draws three little cards on the dark panel beside the
sign-in form, and fills them in: **"Khalid Al Mansoori"** with a countdown,
**"Follow-up overdue · Sara Nunes"**, **"16:30 Site visit · Lucas Martin"**,
**"Calls today 214"** with a week of bars, and **"In office now · 6 of 10 · 1
late · 1 outside · 1 leave · 1 absent"**.

This is the one page in the CRM where **nobody has signed in**. Anyone who
opens crm.homes.me — a competitor, somebody a link was forwarded to, a search
engine — would read your clients' names, how many calls your team made today
and who is late this morning. That is a data leak, not a design detail.

**What I built.** The three cards keep their exact shape, size, colour and
titles — "Needs you now", "Calls today", and the orange "In office now" — and
each says in one plain line what it does once you are inside ("The calls that
are late, and the ones with a timer running"). No names, no counts, no bars.
The page reads nothing from the database before a password: the only request
it makes is the one the live sign-in page already makes, which asks whether
this CRM has any accounts yet and is a yes/no about the installation.

**A) Leave it as it is** (recommended — a sign-in page cannot show work data to
somebody who has not signed in). **B) Put fake numbers in the cards** so the
panel looks busier, clearly marked as a sample. **C) Empty the cards out** and
let the panel be the headline alone.

While I was there: the live `/login` has a button the design does not —
**"Email me a sign-in link"**. The v2 screen does not have it, because the
design file has no such button. `/login` keeps it, so for now the two screens
differ on this one point. Say the word and I will either add it to the new
screen or take it off the old one.

## 37. The design's "open as Agent / Owner" buttons are a way in without a password

Under the sign-in button the design has **"Demo only · open as — Agent ·
Rocky / Owner · Emir"**, and the prototype's own code opens the dashboard when
you press one. It is there so that you can click through the design without
typing anything.

In the real CRM those two buttons are a door with no lock on it: anyone who
reaches the address is inside, as an agent or as you.

**What I built.** Nothing. The buttons do not exist on the v2 screen, and a
test fails if they ever come back — the only way in is the email-and-password
form.

**A) Leave them out** (recommended). **B) Build a demo mode** for showing the
CRM to someone, as a separate address with made-up data and no real leads in
it, never on the real sign-in page.

## 38. The design has a 6-digit code step; your brief says email and password only

The design file carries a second screen behind the form: **"Two-step sign-in —
Owners and admin need a second step. Write the 6 digits from your code app."**
`CLAUDE.md` says the opposite, in your words: *"simple built-in email +
password login only. No OTP."*

The two disagree, so I did not pick a winner.

**What I built.** The screen is drawn and wired into the markup, so it is
ready — but it cannot be reached. Our server never asks anyone for a code, and
nothing in the page can switch the form into that step. It is hidden from the
keyboard and from screen readers as well as from the eye.

Turning it on is not a change to this screen. It needs your yes, and then work
on the server: storing a secret per user, the "scan this square" setup screen,
backup codes for the day somebody loses their phone, and a way for you to
switch it off for a person who is locked out.

**A) Leave it off** (recommended for now — it is the brief, and a second step
that nobody can reset is worse than none). **B) Turn it on for owner and admin
only**, which is about a day's work on the server plus the setup screen. It is
a real protection: a password alone is all that stands between a leaked laptop
and every lead in the company.

---

## 39. The inbox says "later phase" at the top, and the reply box still works

`design/web/inbox.html` is the one page in the whole design package that
marks itself as **not in the first build**. It draws a striped banner across
the top — *"Not in the first build. For now WhatsApp and Telegram open on the
agent's phone and every tap is logged"* — and its message box does nothing at
all: every press pops up a note telling the agent to send from their phone.

The build had no banner and a box that really sends.

**What I built.** The banner, in the design's own words, with its button
(the messaging report for you, My leads for an agent) and its line at the
foot of the thread. **I did not take the reply box away.** Turning off a box
that ten people may be typing into is not something a rebuild should do
quietly, and today it is honest anyway: WhatsApp and email send nothing until
their keys are set, and a message that could not go out is recorded as *not
sent* rather than shown as sent.

This is the same question `docs/v2/decisions.md` §3.3 has been holding open
since the start of the rebuild — *"Inbox, Email, Templates: grey them out, or
keep them working in the new look?"* — so it is yours either way.

**A) Leave it as it is** (recommended) — the banner tells everyone where we
are, and the box starts working the day the WhatsApp number is connected.
**B) Make the box inert**, exactly as drawn: every press shows the design's
note and nothing is ever sent from the CRM.

---

## 40. There is no Telegram chat in the CRM, and the design's filter finds nothing

The design's chat filter is **All · WhatsApp · Telegram · Unread**. The CRM
stores a message as WhatsApp, email, SMS or an internal note — there is no
Telegram chat anywhere in it. Telegram in this CRM is a *tap*: the agent
presses the Telegram button on a lead, it opens on their phone, and the tap
is counted on the messaging report.

**What I built.** The Telegram filter, because the design draws it. It finds
nothing, and instead of an empty box it says why: *"No Telegram chat is in
the CRM. On Telegram the agent writes from their own phone, and every tap is
counted on the messaging report."*

**A) Leave it** (recommended — it answers the question an agent would
otherwise ask you). **B) Take the filter out** until Telegram is really
connected. **C) Connect Telegram properly**, which is a bot, a number and
about a week's work.

---

## 41. The three "ready messages" are not the design's words

The design's three buttons are **Hello · Brochure · Payment plan**, and its
payment-plan message says *"60% during construction, 40% on handover"*.

That is a payment plan nobody set. `CLAUDE.md` is flat about it: never invent
a price, a plan or a handover date. So the buttons are the ones the server
writes, from the project the lead actually asked about, with no figure in
them that is not in the project library.

**What I built.** The server's openings, in the design's place, filling the
message box when you press one (the design's behaviour — the build used to
copy to the clipboard and ask you to paste). The link under them now counts
the real templates: "All 12 templates".

**A) Keep it** (recommended). **B) Use the design's three labels** — Hello,
Brochure, Payment plan — and have the payment-plan one read the plan out of
the project library, which only works for a project that has one saved.

---

## 42. "Annual leave left · 14 of 22 days" — nobody has told the CRM the 22

The attendance screen draws three places where the allowance appears: a tile
("Annual leave left · 14 · 3 days asked"), a card with a bar ("14 of 22 days
this year"), and a chip in the request panel ("14 annual days left").

**There is no allowance anywhere in this database.** Not in the attendance
rules, not on a person. A number on that bar that nobody set is a number
somebody books a flight around.

**What I built.** The same three places, counting what is true: **annual
leave taken** this year, the days already asked for, the sick days used and
the last one. Everything else is the design's.

**What I need from you.** The yearly allowance — one number for everybody, or
a number per person (a lot of UAE contracts differ by length of service). Say
the word and it becomes a field on the attendance rules page, and these three
read "left" exactly as drawn.

---

## 43. Nobody checks out, so there are no hours

The design has four states for the hero: not checked in, in office, outside,
and **checked out** ("Day finished · in 08:55 · out 18:06 · 9 h 11 min"). It
also writes "24 h 14 min so far" on the week, "Hours in the office: 60 h 12
min" on the month, and gives the outside state an **"I'm back in the office"**
button.

All of that needs the CRM to record when somebody *leaves*. It records when
they arrive and nothing else: one row a day, the first tap wins.

**What I built.** Everything that can be worked out from the arrival —
"worked today" counts from the morning's tap, the shift's end is shown, the
timeline has its "Shift ends · 18:00" row, and the month totals now tell a
day the office was shut from a day nobody came in. The hours, the "Day
finished" state and the "I'm back" button are not there.

**What this would cost.** One new column on the attendance table, and three
decisions from you: may somebody check out and then check in again; does the
day close by itself at the end of the shift; and is the hours figure
something you want agents compared on. I did not add a column without asking,
because `CLAUDE.md` says to ask before adding a field.

**A) Leave it** (recommended for now — "one tap a day" is a simpler promise
and it is what the screen says). **B) Add checking out**, about half a day's
work once you answer the three questions.

---

## 44. Three of the design's six leave types cannot be stored

The request panel offers **Annual · Sick · Personal · Half day · Work from
home · Other**. The database column holds five values: annual, sick, unpaid,
emergency, other. Personal, Half day and Work from home are not among them,
and "Half day" also needs a morning-or-afternoon answer and a half-day count.

**What I built.** The five that can be stored, with the design's wording
where the two agree. The "which half" switch is not drawn, because a half day
that is saved as a whole day is worse than one that cannot be asked for.

**What I need from you.** Which six you actually want. Changing the list is a
database change, so it needs your yes — and it is the kind that cannot be
undone on a live system without care.

---

## 45. Sharing your location, and the sick note

Two more fields on the design's panels have nowhere to go:

- **"Share my location · one time only"**, which the design makes *required*
  before an agent can say they are working outside.
- **"Add the sick note · photo or PDF"**, needed from day 2 of sick leave.

Nothing in this CRM stores a place or a file against a day or a leave
request. Neither field is drawn; the sick-note rule is still said in words,
and the outside panel asks where the agent is in writing instead.

**What I need from you.** Whether you want either. The location is the bigger
decision: it is personal data under UAE PDPL, it has to be stored, shown to
you and deleted on a schedule, and the design's own promise — *"We read it
once, now. We do not follow you"* — has to stay true.

---

## 46. "Performance this month · 86%" is a score against a target nobody set

The profile hero draws a big percentage over a bar, explained as *"Calls,
follow-ups on time, meetings and deals against your monthly target."* There
are no monthly targets in this CRM.

**What I built.** The same block, with a number that is counted:

- **An agent** sees the badges they have earned — 4 of 10, 40% — which is
  what the team wall already ranks on.
- **You and the admin** see the share of this month's new leads that were
  answered inside two hours, out of how many. It is the team number this
  company is actually run on, and it is the dashboard's own figure, so the
  two screens cannot disagree.

Both say in a line underneath that no target is set.

**What I need from you.** A monthly target per agent — deals, or viewings, or
calls — and this becomes the design's bar exactly.

---

## 47. Small things on these three screens that are drawn and not built

Each of these is one line, and each is a number or a thing the CRM does not
hold. Say the word on any of them.

- **The city a device signed in from** ("Dubai · active now") and the **"new
  place"** warning on an unusual one. The device list is real now — it is
  your own live sessions, and you can sign any of them out — but a session
  records an address, not a town. Turning an address into a city needs an
  outside service.
- **"Month PDF"** on an agent's own attendance. The owner's monthly file is
  being built separately; an agent's own is not.
- **"Last changed 24 Sep 2026"** under the password. Nothing records when a
  password was last changed.
- **The sidebar's "Inbox · later" marker.** The design greys the Inbox row
  out. It is the row ten people use to reach the screen, and the greying also
  makes it unclickable, so I left it alone — it is also in the part of the
  code another agent is working in.
- **The design's demo switcher** at the foot of the attendance page ("see
  each state: Not checked in · In office · Outside · Checked out"). It is a
  way to flip the drawing between states; the real screen shows the state
  that is true.

---

## 48. The office Wi-Fi: I ask for the name **and** the address

`design/web/settings-attendance.html` lists office **Wi-Fi network names** —
"homes.me-Office", "homes.me-Office-5G" — with the hint "Network name, exactly
as on the phone".

**No browser will tell a web page which Wi-Fi it is on.** Not Chrome, not
Safari, not on any phone. It is not a setting somebody forgot to turn on; it
is deliberately not available, on every platform.

What the server *can* see is the address the office's internet line is seen
from, and that is what check-in has always compared.

**What I built.** Each row carries both. The name is what you read and type —
the list looks exactly like the design — and the address sits underneath it in
small grey type, because that is the thing the gate actually matches. Removing
the address and keeping only the name would be a check-in gate that lets
anybody in from anywhere.

Under the list it says so in one line, and offers you the address this computer
is seen from, so you can add the office without knowing what an address is.

**What I need from you.** Nothing, unless you would rather the address were
hidden. I would keep it: when the internet provider changes it — which they do
— the only way anybody finds out is that nobody can check in, and this row is
where you would look.

---

## 49. "Download Excel" gives you a CSV, and the button says so

Three screens have an export the design calls an Excel file: the month on
Attendance rules, and "Export file" on the Feedback inbox.

They produce a **.csv**. Excel, Numbers and Google Sheets all open one by
double-clicking it, and it keeps your columns, your filters and your sorting.

Why not a real .xlsx: writing one needs a spreadsheet library installed on the
server, and every library on the server is one more thing that can stop a
deploy — on a CRM ten people use from nine in the morning. For one button that
is a poor trade.

The buttons read "Download file (CSV)" and "Export file" rather than promising
Excel.

**What I need from you.** Say the word if you want real .xlsx files and I will
add the library.

---

## 50. The logo takes PNG, JPG or WebP — not SVG

The Company screen's logo row says "PNG or SVG" in the design. The server
accepts PNG, JPG and WebP and refuses SVG.

An SVG is not a picture, it is a small program, and this logo is served to
every client who opens one of your sales offers. Accepting one would mean
anything inside it runs on our own web address, in the same place as the CRM.

The hint on the screen says "PNG, JPG or WebP, square, at least 512 px", so
nobody picks a file that will be refused.

**What I need from you.** Nothing. If your mark only exists as an SVG, export
it once at 1024 px as a PNG and it will look identical.

---

## 51. Homes AI's company text is six boxes, not one

`design/web/ai-settings.html` has one box, "What Homes AI should know about
us", with a counter that reads "N of 1,500 letters".

The CRM already stores this in six named sections — about us, what we sell,
how we talk to clients, things we never say, the questions clients ask, how we
work — and **the AI reads a different set of them for each job**: writing a
message uses the tone and the never-say list, judging a lead uses what we
sell. One box would have to be sent in full to everything, which costs more
and makes the answers vaguer.

**What I built.** One box per section, each with the design's own counter, its
own required minimum ("Write at least one full sentence.") and its own
too-long guard. The rules are the design's; the number beside each is that
section's own length.

**What I need from you.** Nothing, unless you would rather have the single box
back.

---

## 52. Feedback: one screenshot and one voice note per report

`design/web/feedback.html` lets an agent attach up to three screenshots. The
side panel in `feedback-inbox.html` draws one screenshot block and one voice
note.

I built one of each. Three would need a gallery in the panel that the design
does not draw, and in a bug report the second and third picture are almost
always the same screen again.

**What I need from you.** Say so if agents ask for more.

---

## 53. The banner cover styles are numbered, not named after projects

The home-banners form offers five cover styles. The design labels them with
four of your projects — The Archive, Shahrukhz, Damac Islands, Valia — and
"Plain".

They are not photographs of those projects. They are five coloured gradients,
and putting a project's name on a coloured rectangle that has nothing to do
with it is the sort of small lie that ends up on an agent's screen.

**What I built.** Five styles, unnamed, plus **Upload** — which now works, and
is how a real photograph of a real project gets onto a banner. The upload is
the part that was missing: the picture column has been in the database since
the start and nothing could fill it.

**What I need from you.** If you want the five to be your projects' real cover
photos, I can read them from the project library instead. It is a small job
once you say which projects.

---

## 54. "Invite a person" hands over a password; it does not send an email

The invite dialog in `settings-team.html` says "They get an email with a link
to set a password."

Nothing in the CRM can send that email: there is no outgoing mail server
configured, and a dialog that promises an email which never arrives is worse
than one that tells the truth.

**What I built.** The account is made at once and the screen shows a one-time
password, once, with a Copy button. The person must change it the first time
they sign in. The dialog says exactly that.

This is also why the "People" card counts **people who have never signed in**
rather than the design's "0 invites waiting": there is no invited-but-not-yet
state to count, and never-signed-in is the same question answered from what we
actually have.

**What I need from you.** An email server (`SETUP_NEEDED.md` §12), and this
becomes the design's flow exactly.

---

## 55. "Blocked in phone settings" and "Switched off" read the same here

The notifications tab in `settings-team.html` shows four states for a person's
phone: **On · iPhone**, **Not installed**, **Blocked in phone settings**,
**Switched off**.

The last two are states of the phone's own notification permission. **The
phone never tells a server which one it is.** What the server knows is whether
any device has ever registered for alerts.

**What I built.** Three states. "Not installed" covers all three ways of not
getting alerts, and a line under the table says so plainly, so nobody reads it
as "they have not installed the app" when they have.

The **Remind** button is real: it writes "Turn on notifications" into that
person's bell, which they see on My Day. It does not send a push, because the
whole reason they are on the list is that a push cannot reach them.

---

## 56. The thirty-day bars on System health start empty

The health page draws thirty days of bars per service, an uptime percentage
and a list of past problems.

Until today **nothing recorded any of it**, so those bars would have been
thirty green rectangles drawn because nobody was counting.

**What I built.** A check that runs every five minutes — which is what the
design's own sub-line promises — measuring six things and writing down what it
found: the website and sign-in, the database, notifications, tracked links,
file storage and Homes AI. The bars, the percentages and the list of past
problems are all read back from those rows.

**On the morning after this goes live the bars will be empty**, and the page
says so in a line rather than looking perfect. They fill in over the following
month.

Two numbers the design shows are still missing, because nobody tells the CRM
them: the database's **last backup time**, and the **total size** of the file
storage ("6.2 of 50 GB" — we show the 6.2, not the 50). Both are facts about
the hosting account, not about the CRM.

---

## 57. Two of these pages are not inside Settings

`feedback-inbox.html` and `home-banners.html` are drawn as **full-width pages
with a back link**, not as panels inside the Settings shell — the design marks
them `data-back="settings.html"` and `data-back="projects.html"`.

I built them that way. The feedback table is seven columns and about 1,050px
wide; inside the Settings shell it ran off the right-hand edge of a 1440px
screen. They are still in the Settings menu and the address has not changed.

---

## 58. The shift times are typed boxes, not the browser's time picker

The office shift on Attendance rules was reading **"7:00 PM"**, in a CRM
whose own rule is 24-hour everywhere.

That is not something we had got wrong. A browser draws
`<input type="time">` in **its own** language, the one chosen in the
browser's settings, and nothing on the page changes it: I set `lang` on the
field, on its parent and on the whole document, and all three still drew
"07:00 PM". So an agent whose laptop is set to US English sees the office
shift in AM/PM and an agent whose laptop is set to UK English sees the same
shift as 19:00.

The design hit this before us and solved it in its own script —
`design/web/app.js` says, in its own words, *"a native time field shows AM/PM
on some computers"* — by turning the field into a plain text box that only
accepts `HH:MM`. The build now does exactly the same: type `0930` and it
becomes `09:30`, type `9` and it becomes `09:00`, type anything else and the
box goes back to the time that was there. It reads the same on every
computer in the office.

**The dates are a different matter and are not fixed.** A date field has no
such trick available — it draws the day and month in whichever order the
reader's browser prefers, so the banner dates can read 03/14/2027 on one
laptop and 14/03/2027 on another. Nothing is lost or mis-saved either way
(the value the browser sends is always `2027-03-14`), but two people can read
the same banner differently. Making those day-first too would mean three
typed boxes instead of a date picker, which is worse for a date somebody has
to pick off a calendar. **I would leave the date pickers alone and make sure
every office laptop is set to UK English, which fixes the whole CRM at once
rather than one field at a time.** Printed dates and times are already
correct everywhere — `web/src/lib/format.ts` does those itself.

**The rest of v2 has the same time-field problem.** Three other screens use
the browser's time picker and will read "7:00 PM" in the same way — Calling
(`web/src/v2/Calling.tsx`), and the two older settings screens
`components/RoutingSettings.tsx` and `components/AttendanceSettings.tsx`.
They are in somebody else's slice this week; each is one component swap.
Written down in `docs/v2/questions-settings.md` §4.1.
