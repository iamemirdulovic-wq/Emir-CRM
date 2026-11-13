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
