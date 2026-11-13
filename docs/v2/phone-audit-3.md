## Group 3 — projects, team and the person

*Read 13 Nov 2026. Twelve phone prototypes in `design/screens/` against the v2
build at 390 × 844 (`http://127.0.0.1:5182/?as=…`). Colour is not audited —
the prototypes are in the retired green palette. Layout and content are.*

**Two things are true on all twelve and are not repeated in every row.**

1. **The header.** Every prototype draws its own header as the first child of
   the scroller: a round back button with a hard-coded parent, an `<h1>`, a
   13px subtitle carrying the live count, and a right slot holding *that
   screen's* one action (`Manage projects` on Live projects, `Show on office
   TV` on Best of Homes, the settings gear on Profile, `+` on Manage
   projects) or nothing. The build replaces all of it with one shared
   `PhoneTop` — back (browser history), a short title from `titleFor()`,
   then search, the bell and **Add lead** on every screen. So on all twelve:
   the subtitle is gone or demoted into the page, the screen's own action is
   gone or demoted, and an **Add lead `+` appears on screens the design never
   puts it on** (a business card, a feedback form, a colleague's profile).
2. **The check-in gate.** Every prototype wires the round dial button to the
   "You're not checked in yet" sheet. That is shared-shell work covered in
   `docs/v2/phone-shell.md` §1.3 and is not re-listed per screen.

| Phone screen | Address in the build | Layout | Why |
|---|---|---|---|
| `LiveProjects.dc.html` | `/v2/projects` | **Different** | Design is four fixed cards with a pitch quote and lead counts; build is a filtered, searchable library with price/handover/stock on each card |
| `ProjectDetail.dc.html` | `/v2/projects/p-1` | **Different** | Design has a 210px cover hero with the header over it, a 3-across fact grid and a 4-button share row that opens a bottom sheet; build has a plain cover card, facts stacked one per row, and an inline 3-step "Send to a client" section instead of the sheet |
| `ManageProjects.dc.html` | `/v2/projects/manage` (owner) | **Different** | Design is a card per project with one cycling status button; build is a table with a 3-way segmented control, plus three count cards and two extra owner buttons above it |
| `TeamDirectory.dc.html` | `/v2/team` | **Different** | Design is a vertical list of rows (avatar, name, status, desk · languages, deals · meetings, chevron); build is a 2-across grid of avatar cards |
| `Colleague.dc.html` | `/v2/team/u-2` — **and an agent cannot reach it** | **Different** | Design is a full screen; build opens a bottom sheet from the team grid, and the link to the full page is owner/admin only |
| `TeamWall.dc.html` | `/v2/wall` | **Same** | Composer, then a feed of posts with 👏 / 🔥. Build adds filter chips and two panels below the feed |
| `Leaderboard.dc.html` | `/v2/best` | **Same** | Podium, nudge line, ranking, level bar, badges — same blocks in the same order |
| `Profile.dc.html` | `/v2/profile` | **Different** | Design is a performance card + 3 stats + **two menu cards of nine rows** + Log out; build is a hero + 3 shortcuts + About / Good to know / Badges, and the nine menu rows are not there |
| `PersonalInfo.dc.html` | **nowhere** | — | Not a section of `/v2/profile` and not a screen. Nothing in v2 edits name, phone, WhatsApp, email, languages or BRN |
| `Security.dc.html` | **nowhere** | — | Settings → General links to `/v2/me`, and `/v2/me` is not a route: it falls through to `NotFound` and lands on `/dashboard` |
| `DigitalCard.dc.html` | `/v2/card` | **Same** | Three steps with the same names and the same job, plus the public-link switch |
| `Feedback.dc.html` | `/v2/feedback` | **Different** | Design is four type tiles, a title, a body, six "where" chips, attachments, three urgency levels and a thank-you screen; build is three type tiles, a body and two urgency levels, with no success screen |

---

### `LiveProjects.dc.html` → `/v2/projects`

**Missing from the build:**

- The header: `<h1>` **"Live projects"** and the subtitle **"What we are
  selling right now"**. The build's phone bar says only "Projects".
- The owner's round **Manage projects** action in the header
  (`aria-label="Manage projects (owner)"`). The build puts "Manage projects"
  and "Home banners" in the filter row instead, below the chips.
- On every project card:
  - the **pitch quote** — `"Best seller this month, investors love it."`,
    `"Easy payment plan, great for first buyers."`, `"Villa lifestyle, family
    buyers."`, `"Emaar name sells itself. Collect interest forms now."` The
    build shows the payment plan and handover there instead.
  - **"Your leads 24 · Team 115"** — the agent's own count against the team's.
    The build's card has no lead count at all.
  - **"New leads to"** plus the avatar stack of the agents the project routes
    to (`RK` `TA` `NE`). Nothing in the build says who gets a project's leads.
- The status pill wording **"Campaign live"** and **"New cluster"**. The build
  only has Selling now / Launching soon / Sold out.

**Extra in the build:** six filter chips (All · Dubai · Abu Dhabi · Selling now
· Launching soon · Our picks), a free-text search box, an "N projects" count, a
**Private** badge, "Starting from AED 1.9M" over the cover, payment plan and
handover columns, "Available 24 · of 120 units", "Prices checked 3 days ago",
and **Send to a client** / **Open** buttons on the card. The "From Emir" note is
there but is read from the pinned Team wall post rather than being its own text.

`DISAGREEMENT:` the phone design has **no filters and no search** — four cards,
fixed, chosen by the owner. `design/web/projects.html` has chips (All 4 ·
Selling now 3 · Launching soon 1 · Hidden 1) and a count. The computer design
wins, so the build is right; the phone's per-card **"Your leads · Team"** and
**"New leads to"** have no computer equivalent and are lost with it.

`DISAGREEMENT:` status pills. Phone: "Campaign live", "New cluster",
"Launching soon". Computer: "Selling now", "Launching soon", "Hidden".

---

### `ProjectDetail.dc.html` → `/v2/projects/p-1`

**Missing from the build:**

- The **cover hero**: 210px, with the back button and the status pill laid
  *over* it at the top and developer / name / area laid over it at the bottom.
  The build has the shared top bar, then a "Projects" back chip, then a cover
  block with the name on it — three separate strips where the design has one.
- The **3-across fact grid** (`Starting from` · `Payment plan` · `Unit types`).
  The build stacks four facts one per row down the page, which is most of a
  phone screen for three numbers.
- The footnote under the pitch: **"Written by the owner in Manage projects ·
  demo text"**.
- The **4-across share row** — `Brochure` · `Payment plan` · `Location` ·
  **`Video`**. The build has no **Video** option at all, and offers the other
  three only when the project has the file.
- The **"Send the {what} to" bottom sheet**: one row per lead in this project,
  each with its own **WhatsApp** and **Telegram** button, and
  **"Another lead · copy the link"** at the foot. The build replaces this with
  an inline three-step section — pick what, pick a lead from a `<select>`, then
  Open WhatsApp / Open Telegram / Copy the link.
- The sheet's confirmations: *"WhatsApp opens for {name} with the {what} link ·
  you press send · saved on the lead"*, *"Telegram opens for {name} with the
  {what} link · saved on the lead"*, *"{What} link copied · paste it anywhere"*.
- The leads block header **"YOUR LEADS IN THIS PROJECT · 24"** and its one-line
  rows (`Marco Bellini` / `Interested · payment plan today`). The build's rows
  carry name, phone, a stage chip, "No next step" and a Call button.

**Extra in the build:** a Handover fact, **"Your leads here / 55 / Asked about
Emaar Beachfront"** as a hero number, **"Built 62% so far"**, a "See all 55"
link, per-lead phone numbers, stage chips and Call buttons, a VIP tag, and a
drafted message preview in step 3.

`DISAGREEMENT:` `design/web/project.html` keeps **Video (1 min 20)** as a fourth
send option and adds **"The link is tracked. You get an alert when the client
opens it."** and a *"WhatsApp opened · waiting for your update / What
happened?"* follow-up sheet. The phone has the Video button but neither the
tracking line nor the follow-up. The computer wins — so Video, the tracking
line and the follow-up sheet are all missing from the build.

---

### `ManageProjects.dc.html` → `/v2/projects/manage` as owner

**Missing from the build:**

- The header: back → `Settings`, `<h1>` **"Manage live projects"**, subtitle
  **"Owner · what the team sells now"**, and the round **`+` Add a project**
  button in the header.
- The explanation sentence, in the design's own words: **"Agents see *Selling
  now* and *Launching soon* on their Projects page. *Hidden* is only for
  owners."** The build says "Agents see only projects that are 'Selling now' or
  'Launching soon'." — the Hidden half of the rule is dropped.
- The row sub-line **"{developer} · {area} · from {price} · {n} leads"** as one
  line. The build spreads the same facts over a table row.
- The **one cycling status button** (`Selling now ⟳` → `Launching soon ⟳` →
  `Hidden ⟳`) and its confirmations: *"The Archive · Hidden · agents no longer
  see it"* / *"· Selling now · agents see it"*. The build uses a three-way
  segmented control, which is three tap targets where the design has one.
- The per-row **"Edit details"** and **"See as an agent"** buttons. The build
  has Edit and View per row and a single "See as an agent" button at the top of
  the page.
- The agent block is only half there. Design: a card with **"Only for owners and
  admin"**, *"You are signed in as an agent. This page is not in your menu and
  you cannot open it."*, and a **"Go to My Day"** button. Build: one red
  `ErrorNote` reading "Projects are managed by the owner. You can see them under
  Projects." — no heading and no way out.
- The edit sheet's error wording: **"Project name and developer are needed."**
  and **"A project with this name already exists."**
- The save-button label **"Add project · hidden until you show it"** — the
  build's button says only "Save project", so the "starts hidden" promise is in
  a hint line instead of on the button.

**Extra in the build:** three count cards (Selling now 3 / Launching soon 1 /
Hidden 0), a **Home banners** button, a brochure cell per row with the PDF name
and size or an **Upload** button, an **Emirate** select in the edit panel, a
price hint, a Status control inside the panel, and the closing paragraph about
what hiding a project keeps.

---

### `TeamDirectory.dc.html` → `/v2/team`

**Missing from the build:**

- The header `<h1>` **"Meet the team"**; the build's bar says "Team" and the
  words "Meet the team" survive only as a tab label.
- The **list** shape. Design: one full-width row per person — 48px initials
  avatar, name, status badge on the same line, `desk · languages` under it, and
  a results line **"7 deals this month · 14 meetings"**, with a chevron. Build:
  a 2-across grid of cards with the avatar, name, role, a status chip and the
  languages — and **no deals-or-meetings line anywhere**.
- The desk filter chips **"Dubai off-plan" · "Arabic desk" · "Abu Dhabi"**. The
  build substitutes developer names (Damac, Emaar); the code says why — there
  are no desks in the database.
- The search placeholder **"Search name or language"** (build: "Search a name
  or a language" — same thing, different words).
- The empty state **"Nobody matches. Try another name or language."** Build:
  "Nobody found / Try another name or language, for example 'Russian'. / Show
  everyone".
- The closing rule, printed on the screen: **"You see results and profiles of
  colleagues, never their leads."** It is nowhere in the build.
- `data-set="hmCol={name}"` — the design opens the colleague as *their own
  screen*. The build opens a sheet. See the next row.

**Extra in the build:** a **Meet the team / Team wall** tab pair, counts on each
chip, a **You** badge on your own card, an **"open leads"** number per card, an
**"Owners and office"** block with Phone buttons, and a **Team and roles** link
for owners.

---

### `Colleague.dc.html` → `/v2/team/u-2`

**The finding that matters: an agent cannot reach this screen on a phone.**
Tapping a card on `/v2/team` opens the `Colleague` **bottom sheet**, and the
sheet's `{first}'s page` link to `/v2/team/:id` is rendered only when
`owner = user.role === 'owner' || 'admin'`. An agent has no other route to it.
So for the people this screen is for, "every block reachable on a phone" is
**no** — they get the sheet, which is a shorter screen.

What the sheet does carry: name, role, status chip, headline, **Phone** and
**WhatsApp** buttons, the privacy line, Speaks, Sells, four stat tiles, Badges,
and a footer with "Transfer a lead to {first}" / "Team wall".

**Missing from the build (sheet and full page both):**

- The header subtitle **"{desk} desk · Property Consultant"**.
- The design's exact privacy rule: **"Opens your own phone or WhatsApp. Nothing
  is logged and no check-in is asked."** The build says "A call or message to a
  colleague is private. Nothing is logged." — the *no check-in is asked* half,
  which is the part an agent actually worries about, is gone.
- Two of the four stats: **"Meetings this month"** and **"Calls this week"**.
  The build shows Deals won / Viewings booked / Usual reply, and Open leads for
  owners only.
- The **bar chart** — *"Deals in the last 6 months · {total}"*, six bars
  labelled Jun…Nov with the current month filled dark. Not in the sheet, not on
  the full page. The code says nothing can fill it.
- The **ABOUT** block in its design form: `Sells:` / `Languages:` /
  `Badges: {n} of 10` as three labelled lines.
- The call toast when the person is away: *"Your phone opens to call Sultan ·
  Sultan is on leave today"*. The build's sheet says the same thing only in the
  footer, and only for a lead transfer.

**Missing from the full page at `/v2/team/u-2`:** the **Phone** and **WhatsApp**
buttons — the whole point of opening a colleague — are on the sheet but not on
the page. The page shows the phone number as a read-only row under "Good to
know".

**Extra in the build:** a badges-earned percentage ring, a Level chip, a BRN
chip, an About/bio section, "Team wall" / "Business card" / "The team"
shortcuts, and the ten badges with their descriptions.

`DISAGREEMENT:` the phone design opens a colleague as a **full screen**;
`design/web/team.html` opens a **side panel** on the team page. The computer
design wins, so the build's sheet is the right shape — but then the sheet has
to carry everything the phone screen does, and the agent-only path to the full
page should not be the thing that fills the gap.

---

### `TeamWall.dc.html` → `/v2/wall`

**Missing from the build:**

- The header subtitle **"Wins and news · 13 people"**.
- The composer placeholder **"Share a win or a tip with the team"** (build:
  "Share news, a win or a question with the team").
- The empty-composer error **"Write something first."** The build disables the
  button instead, which says less.
- The post button label **"Post to the team"** — the build's reads "Post".
- The confirmation **"Posted · the team gets one notification"**, which is the
  sentence that tells an agent what posting actually costs the team.

**Extra in the build:** filter chips (All · Owner news 2 · Wins 1), a **Pinned**
marker, kind chips, a 0/500 character counter, comment counts, a **Coming up**
calendar panel, a **Best of Homes** ranking panel, and the **"What goes on the
wall"** explanation. All four of those extras come straight from
`design/web/team-wall.html`.

---

### `Leaderboard.dc.html` → `/v2/best`

**Missing from the build:**

- The header subtitle **"Week 46 · ends Sunday 23:59"** and the round
  **"Show on office TV"** button. Nothing anywhere in `web/src` matches
  "office TV" — the whole feature is absent, and it is the one thing on this
  screen the owner asked for by name in the screen's own description.
- The nudge line under the podium: **"6 calls or 1 meeting puts you in first
  place."** This is the sentence that makes the leaderboard do work.
- The per-row detail **"52 calls · 3 meetings"** under each name in the
  ranking. The build's table is name + points only; the code explains that
  nothing counts calls and meetings by agent for a week.
- The level line as the design writes it: **"Level 7 · Closer"** with
  **"260 points to Legend"** beside it. The build has a level card but names
  the next level differently.
- The crown on first place, and the plinths of different heights (70 / 100 /
  50px) that make the podium a podium. The build has the plinths; the crown is
  the avatar photo instead.

**Extra in the build:** a **Meet the team / Best of Homes** tab pair, a **Live**
pill, "You are 1st / 377 points", "You are 23 points from the next level", a
streak / badges / thank-yous tile row, **Start calling** and **Open the team
wall** buttons, ten badges with their earning rules, and a **How you get
points** table.

`DISAGREEMENT:` both designs are **weekly** — the phone says "Week 46 · ends
Sunday 23:59", `design/web/best-of-homes.html` has a Week 46 / Last week /
November switcher and "Podium · week 46 · Live · 4 days left". The build is
**"Podium · last 30 days"** with no period switcher. The computer design wins,
so the build is wrong on both counts.

`DISAGREEMENT:` the next level. Phone: "260 points to **Legend**". Computer:
"1,740 of 2,000 points · 260 to **Level 8 · Top closer**".

---

### `Profile.dc.html` → `/v2/profile`

`Profile` and `Colleague` are **not** the same layout with different buttons.
The design draws two different screens: Profile is a settings hub (a
performance card, three stats, nine menu rows in two cards, Log out); Colleague
is a results page (contact buttons, four stats, a six-month bar chart, an About
block). The build renders both from one component, `V2Person`, and the only
differences are the top-bar title, the third shortcut ("My attendance" vs "The
team") and the footer link ("Edit my profile" vs "← The team"). **The build
built the Colleague screen and used it for both.**

**Missing from the build:**

- The header: back → `Menu`, the centred title **"Profile"** and the round
  **Settings** gear on the right.
- The identity row the design draws: 76px avatar with a green tick badge, the
  name at 22px, **"Property Consultant · rocky@homes.me"**, and two chips —
  **"BRN in Personal information"** and **"Level 7"**.
- The **performance card**: *"My performance this month / **Excellent** / Fast
  replies and no overdue follow-ups. Keep going."* with an 86% ring. The build
  shows "Badges earned 40%" instead; the code gives the reason (no monthly
  target exists in the database).
- The three stat tiles as the design labels them: **"Deals won"**,
  **"Viewings"**, **"Avg reply"**.
- **The first menu card — four rows, none of them in the build:**
  - **Personal information** — *"Photo, BRN, languages, what I sell"*
  - **My digital card** — *"homes.me/card/rocky · opened 38 times"*
    (the build has the card screen; the row and the open count are gone, and
    `Card.tsx` documents why the count is left out)
  - **Badges & level** — *"6 of 10 badges"*
  - **My attendance** — *"6 of 7 working days this month"* (the build has the
    shortcut but not the count)
- **The second menu card — five rows, none of them in the build:**
  - **Notifications** — *"Phone alerts, sounds, quiet hours"*
  - **Language** — *"English"*, with an **EN** chip
  - **Security** — *"Password, signed-in devices"*
  - **Homes AI** — *"Ask anything about your leads"*
  - **Report a bug or suggest** — *"Goes straight to Emir & George"*
- The **Log out** button at the foot. There is no way to sign out from the v2
  profile; it is in Settings → General and in the Settings nav.

**Extra in the build:** a Level chip and a BRN chip, the badges-earned ring,
**Team wall** and **Business card** shortcuts, an About/bio section, a "Good to
know" list (Speaks / Sells / Phone / Email) and all ten badges.

**Broken:** **"Edit my profile"** links to `/profile` — the v1 editor, outside
v2, which `docs/v2/screens.md` already flags as never redrawn.

---

### `PersonalInfo.dc.html` → **not in the build**

This is a full screen in the prototype and **it is not a section of the
profile and not a screen of its own in v2**. There is no address for it.
`/v2/profile` has no editable field; `Settings → My profile` points at
`/v2/me`, which is not a route.

The nearest thing that exists is `/v2/card` step 2, which asks for roughly the
same values — but it writes them to `localStorage['homes.card.studio']` and to
the printed card only. **Nothing in v2 writes a name, phone, WhatsApp number,
email, languages or BRN back to the profile**, so a new agent cannot fill in
their own record, and the Team page, transfers and the public card all read a
record nobody can edit from v2.

**Every field the prototype has:**

| Field | Placeholder |
|---|---|
| Full name | `Your name` |
| Job title | `Property Consultant` |
| Phone for clients | `+971 …` |
| WhatsApp number | `+971 …` |
| Work email | `name@homes.me` |
| Languages | `English, …` |
| BRN (RERA broker number) | `5-digit number on your broker card` |

**And everything else on the screen:**

- Header: back → `Profile`, `<h1>` **"Personal information"**, subtitle
  **"Shown on your digital card"**.
- A **completeness bar**: **"Profile {n}% complete"** on the left and, on the
  right, **"Add: Full name, Job title, …"** — or **"All done"**, or
  **"Add a photo"** when only the photo is missing. Counted over the seven
  fields plus the photo.
- A **photo row**: avatar (initials when there is no photo), **"Profile
  photo"**, the sub-line **"Photo is set"** / **"No photo · your initials are
  shown"**, and **Change** / **Remove** buttons. Toasts: *"Camera or gallery
  opens · pick a clear face photo"*, *"Photo removed"*.
- Three validation messages, word for word:
  - **"Write your full name."**
  - **"Write your phone number with the country code."** (at least 9 digits)
  - **"Write your BRN (4 to 6 numbers). It must be on your card by law."**
- A save button that reads **"Save changes"** when dirty and **"Saved"** when
  not, and the confirmation **"Saved · your digital card is updated"**.
- A footer link **"See my digital card ›"**.

`DISAGREEMENT:` `design/web/profile.html` has the same fields as a **"Personal
info" tab inside the profile page**, not a separate screen, and differs in
three places: Email is read-only (*"Your sign-in email. Ask an owner to change
it."*), Languages is a chip picker with the rule *"Choose at least one
language."*, and the BRN hint reads *"Broker registration number · 4 to 6
digits"* rather than the phone's "5-digit number". The computer design wins on
all three.

---

### `Security.dc.html` → **not in the build**

Also absent. `Settings → General` ends with a **Security** button pointing at
`/v2/me`, and `/v2/me` is not in `App.tsx`'s route table: it falls through to
`NotFound` and ends up on `/dashboard`. The **Settings nav's "My profile" tab
points at the same dead `/v2/me`.** Two dead links, both reached by the obvious
path. An agent in v2 **cannot change their own password.**

**Everything the prototype has:**

- Header: back → `Profile`, `<h1>` **"Security"**, subtitle **"Password and
  signed-in devices"**.
- **Change password** card:
  - **Current password**
  - **New password**
  - button **"Update password"**
  - the rule: **"Forgot it? Owners and admin can reset it from Team & roles."**
- **Two-step sign-in** — a row with an icon, the title, the sub-line
  **"Required for owners and admin"** and an on/off switch.
- **SIGNED-IN DEVICES** — three rows, each an icon, a name, a place-and-time
  line and an action:
  - *iPhone · Home Screen app* / *Dubai · active now* / chip **"This phone"**
  - *Mac · Chrome* / *Office Wi-Fi · 2 h ago* / **Sign out**
  - *Windows · Edge* / *Unknown place · 3 days ago* / **Sign out**
- A full-width **"Sign out of all other devices"** button.

`DISAGREEMENT:` `design/web/profile.html` carries the same content as a
**"Security" tab** on the profile page and adds what the phone leaves out:
a third field **New password again**, the rule **"At least 8. Mix letters and
numbers."**, **"Last changed 24 Sep 2026."**, two-step detail (*"After the
password we ask for a 6-digit code … Asked on a new device and every 30
days"*, **New backup codes**, **Move to a new phone**), a **"new place"** flag
on an unknown device, **"Do you not know a device? Sign it out and change your
password."**, and a **Sign out here** button beside "Sign out all others". The
computer design wins — so the rebuild target is the fuller version, not the
phone's.

---

### `DigitalCard.dc.html` → `/v2/card`

**The flow is three steps, and the build has all three with the same names.**

| Step | What it asks |
|---|---|
| **1 · Choose design** | Pick one of three card designs — **Signature** (badged *Recommended*), **Reverse**, **Light** — each shown as a card you can **turn over**, with a one-line description and a colour-swatch row. Plus **"Compare side by side"**, a **"Selected: {name}"** readout and **Continue**. |
| **2 · Your details** | Four labelled groups. **About you**: Full name (*"The first name is bold on the card."*), Job title, BRN / RERA number (*"Shows after your title, as BRN 12345."*). **Contact**: Phone, the checkbox **"WhatsApp is the same as my phone"**, Email, Website. **Office**: Address line 1, Address line 2. **Options**: four switches — **Tagline** (*"Find a home that makes you smile." on the front*), **WhatsApp QR code**, **Rounded corners** (*3 mm. The printer die-cuts them.*), **Company name** (*EMIGEO Homes Real Estate LLC, small, on the back*). Then **Card size** (85 × 55 mm / 3.5 × 2 in) and the checkbox **"Show the safe area (on screen only)"**. Buttons: **Back to designs** / **Looks good**. A live front-and-back preview sits above, with the note *"The QR opens your WhatsApp chat. Scan it with your phone to test it."* |
| **3 · Download** | A front/back preview, the headline **"Your card is ready."**, a chip row (design · size · Rounded/Square corners · QR on/off) with an **Edit** button, then **PDF for printing**, the checkbox **"Add crop marks for the printer"**, **PNG, both sides**, **JPG, both sides**, **Mockup for sharing**, the printer note, and **Make another card**. |

Above the three steps, and outside them, sits the **"Share my card publicly"**
switch and the link row.

**Missing from the build:**

- The header `<h1>` **"My digital card"** and subtitle **"Your link and your
  printed card"**. The build's phone bar shows **"My business …"** — the title
  is truncated at 390px.
- The intro row **"Printed business card / Pick a design, fill in your details,
  download a file your printer can use."**
- The per-tile **flip button** (`aria-label="Turn the Signature card over"`) in
  step 1. The build's tiles show the front only; flipping happens in the
  preview beside them.
- The **"Recommended"** badge on Signature.
- The **"Selected: {name}"** readout under the three tiles.
- **"Compare side by side"** as a **bottom sheet** titled *"All three, side by
  side"* with a **"Use this design"** button under each pair. The build expands
  a grid inline and has no per-design "use this" button.
- The step-2 **group headings** — About you / Contact / Office / Options / Card
  size. The build has one flat list of fields, so "Options" and "Card size"
  arrive without a label.
- The field hints **"The first name is bold on the card."** and **"Shows after
  your title, as BRN 12345."**
- Step 3's headline **"Your card is ready."**, the **chip row** summarising the
  choices, and the **Edit** button beside it.
- **"Make another card."**
- Beside the public link: the **"Send on WhatsApp"** button. The build has the
  switch and Copy link only.

**Extra in the build:** a **Download all** button, a per-step Back/Next footer
with "Step N of 3", a **Show safe area** switch promoted into the same row as
the other four options, and the explanation *"The link opens a page with your
photo, your numbers and a button that saves you to a client's phone. Nothing
counts how often it is opened."* — `Card.tsx` documents that last one as a
deliberate replacement for the design's "Opened 14 times this month".

`DISAGREEMENT:` the printer advice. Phone: *"Ask for **400gsm** matte card and
**soft-touch lamination**, and ask for a **colour proof**: orange looks
slightly different on paper. Rounded corners need a **die-cut**."* Computer
(`digital-card.html`): *"**350 g** paper, matt. Ask the print shop for a **test
card** first…"* The build follows the computer design.

`DISAGREEMENT:` the design descriptions, which contradict each other on which
side is orange. Phone: Signature *"Orange front, black back"*, Reverse *"Black
front, orange back"*, Light *"Warm white front, black back"*. Computer:
Signature *"Black with orange · the homes.me look"*, Reverse *"Orange front ·
strong at events"*, Light *"White · cheapest to print"*. The build uses the
**phone's** wording (`web/src/card/brand.ts`), so one of the two is wrong on
screen today and somebody has to say which.

---

### `Feedback.dc.html` → `/v2/feedback`

**Missing from the build:**

- The header: `<h1>` **"Help us improve"**, subtitle **"Report a bug or suggest
  a feature"**. Worse, `feedback` is not in `titleFor()` in `Shell.tsx`, so the
  phone bar falls back to **"homes.me"** — the screen has no name on a phone.
- The **fourth type tile**. The design has four, two across:
  **Bug** *"Something is broken"* · **Issue** *"Slow, confusing or wrong"* ·
  **New feature** *"Something we should add"* · **Idea** *"Make work easier"*.
  The build has three (Something is broken / Hard to use / An idea) and folds
  *New feature* and *Idea* into one.
- The **Short title** field. The build has only the body.
- The **"Where in the CRM?"** chips — Calendar · Lead page · My Leads · Dialer ·
  Attendance · Other.
- The two attachment tiles: **"Screenshot added · taken automatically"** and
  **"Voice note · hold to record"**.
- The **Low** urgency level. The design has three (Low / Normal / Blocking my
  work); the build has two (Normal / It stops me working).
- The send button's wording: **"Send to Emir & George"**. The build's says
  "Send it", and the owners are never named.
- The footnote **"Your phone model, screen and time are attached automatically,
  so the developer can fix it fast."**
- **The whole success screen.** The design replaces the form with
  **"Thank you, Rocky!"**, *"Ticket **#1042** is with Emir and George. You'll
  get a notification when it is planned and when it is fixed. **+15 points for
  helping.**"* and a **"Send another"** button. The build shows a toast and
  leaves the form where it was — no ticket number, no points, no confirmation
  you can read a second later.
- On **MY REPORTS**: the kind-and-date line **"Bug · 9 Nov"**. The build shows
  the date but not the kind.

**Extra in the build:** the reply from the owner shown inline under each report,
the status words "Not looked at yet / On the list / Done / Not doing this", a
"stopped you working" marker, a minimum length check (*"Write a little more —
at least a sentence."*) and a body placeholder that changes with the type.

`DISAGREEMENT:` the "where" control. Phone: six chips. Computer
(`feedback.html`): a **dropdown of every screen in the CRM** (My Day, Dashboard,
My leads, All leads, Lead page, Add lead, Incoming, Pipeline, Calling,
Transfers, Calendar, Tasks and follow-ups, Projects, Team, Team wall, Best of
Homes, Attendance, Notifications, Search, Homes AI, Business card, Settings,
Phone app, Other). The computer wins.

`DISAGREEMENT:` the send button. Phone: **"Send to Emir & George"**. Computer:
**"Send report"**. And the reply promise — phone has none; computer has
**"We read every report within 2 working days."** The build has neither.

Both designs agree on **+15 points for a report** and on a **ticket number**;
neither exists in the build.

---

## Layout defects found while looking

- **`/v2/team`, colleague sheet.** At 390 × 844 the sheet's sticky footer
  ("Transfer a lead to Omar" / "Team wall") sits over the stat tiles, cutting
  "4 Deals won" and "31 Viewings booked" in half.
- **`/v2/card`.** The phone bar title truncates to **"My business …"**.
- **`/v2/feedback`.** The phone bar title is **"homes.me"** (missing from
  `titleFor()`).
- **`/v2/feedback`.** Three type tiles in a two-across grid leave the third
  alone on its own row, and at 390px the first tile's title wraps to three
  lines ("Something / is broken").
- **`/v2/me` is not a route.** Two links reach it — the Settings nav's
  **My profile** tab and the **Security** button at the foot of Settings →
  General — and both drop the user out of v2 onto `/dashboard`.
