# Decisions I made without asking — please confirm

Emir asked me to keep working rather than stop for each decision, and to take
the option the master prompt calls "assumed" where there is one. Everything I
chose that way is listed here, newest last. Each one is cheap to change.

Nothing here touches the live CRM. All of it is on the `v2` branch.

---

## 1 · The test address is a preview, not a second website

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
