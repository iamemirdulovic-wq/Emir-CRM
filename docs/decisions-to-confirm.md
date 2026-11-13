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
