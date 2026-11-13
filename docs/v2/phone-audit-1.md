## Group 1 — home and leads

*Audited 13 Nov 2026 on branch `v2`. The design side is
`design/screens/*.dc.html` read at 390 × 844 (body markup plus the
`<script type="text/x-dc">` block — the prototypes' template runtime
`support.js` is not in the repo, so nothing binds in a browser and the source
is the only reliable reading). The build side is the preview at
`http://127.0.0.1:5182/` at 390 × 844, plus `web/src/v2/*` and
`web/src/styles/v2-shell.css`. Colour is not audited.*

| Phone screen | Address in the build | Layout | Why |
|---|---|---|---|
| `Main.dc.html` | `/v2` as agent | **Different** | Design opens with a 168px banner carousel and the attendance card, then a 2×2 overview grid, a stage donut and four horizontal strips. Build opens with one hero card, stacks the four counts as six full-width stat cards, has no quick-actions / colleagues / projects strips, and puts the carousel last. |
| `OwnerHome.dc.html` | `/v2` as owner | **Different** | Design's "Needs you now" rows are title + consequence + a right-aligned verb link; the build drops the consequence line and wraps the verb button under the title. "Team today" is a 4-tile grid in the design and renders as one run-on line (`2In office1Late1Outside1Not marked`) in the build. "Today in numbers" is a label/value list in the design and six full-width stat cards in the build. |
| `OwnerDashboard.dc.html` | `/v2/dashboard` as owner | **Different** | Design's "Every lead by stage" is a donut with a 7-row legend; the build is a vertical bar list. Design's "Team today" is a 5-column mini table that fits 390px; the build's is a 7-column table whose last cell ends at x = 672 — 282px off the right edge, reachable only by dragging the card sideways. |
| `Leads.dc.html` | `/v2/leads` as agent | **Different** | Different order (design: search → chips → result line + links → Start calling → rows; build: chips → links → Start-calling card → search → Stage/Project dropdowns → count → rows), and the rows are an HTML `<table>` reflowed by CSS rather than the design's two-part cards. |
| `AllLeads.dc.html` | `/v2/leads?tab=all` as owner | **Different** | Not a screen of its own: it is the All tab of My leads, and an owner opening `/v2/leads` lands on "My leads · Today", not on the 863-lead book. The design's agent chip row, Going-cold filter, select-to-move mode, floating "Move N leads" bar and move sheet are all absent. |
| `Lead.dc.html` | `/v2/leads/o-1` | **Different** | Design's header *is* the record — back button, stage pill, score pill, then the identity block, no page title. Build adds the phone header titled "My leads" above it. "What Sara wants" is a read-only `<dl>` in the build and seven tappable edit rows in the design. |
| `Notes.dc.html` | **none** | — | **No address in the build at all.** The Notes tab on the lead says "Notes are not built yet · Notes, voice notes and reminders arrive in phase 4"; the Files tab says "Files are not built yet · Photos, booking forms and ID arrive in phase 4". Nothing else in v2 renders a voice note, a transcript, an AI-extracted field or a document folder. |
| `AddLead.dc.html` | `/v2/leads/new` | **Different** | The page has no title of its own — the phone header reads "My leads". The country picker is a 320px dropdown anchored under the code button (`.v2-cc-menu`, `position:absolute`), not a full-height sheet with its own title and close button. Several chip sets are shorter than the design's. |
| `Incoming.dc.html` | `/v2/incoming` as agent | **Same** | Count card → lead cards (avatar, name, project, why-it-is-here line, waiting age, one action) → rules at the foot. Same blocks, same order, same job. |
| `OwnerAssign.dc.html` | **none** | — | **No address in the build at all.** The brief and `docs/v2/screens.md` both read this as "the give-to-an-agent dialog on Incoming". It is not: it is a whole owner screen, `<h1>VIP leads I gave</h1>` / "Owner · who took them and how fast", with All / Needs you / Going well tabs and a row per VIP hand-off showing who holds it and how long it has been. Nothing in the build tracks a given VIP after it is given. |
| `Dialer.dc.html` | `/v2/calling` | **Different** | Design is a full-attention mode with no bottom bar *and no header* — a close arrow, a two-line title and a points pill. The build drops the bottom bar correctly but keeps the standard phone header (back · search · bell · +) and then draws its own `<h1>Calling</h1>` under it, so there are two headers. The five outcome follow-ups are inline sub-panels inside the card in the build and one five-mode bottom sheet in the design. |
| `Pipeline.dc.html` | `/v2/pipeline` | **Different** | Design is stage chips + one vertical card list. Build is a sideways-scrolling kanban: `grid-auto-columns:minmax(252px,252px); overflow-x:auto` under `@media (max-width:900px)`, so at 390px one and a half columns are on screen and the other five are a horizontal drag away. |

---

### `Main.dc.html` → `/v2` as agent

**Missing from the build:**

- **The attendance pill in the header.** Design header row is avatar · spacer · *attendance pill* · search · bell. The pill is 44px, white, with a live pulsing dot, and reads "In office" → `Attendance` or "Outside" → `WorkOutside`. `PhoneTop` in `web/src/v2/Shell.tsx` renders avatar · spacer · search · bell only.
- **The "I'm working outside" card** (design state `aOut`): where you are, the back-by time, and an **"I'm back"** button.
- **The Wi-Fi "are you back?" interrupt.** The only centre-screen dialog in the whole phone design: a card that drops in from the top with a rippling icon — *"Are you back in the office? / Office Wi-Fi found. Tap yes, and your outside time is saved on today's attendance."* → **"Yes, I'm back in the office"** / "Not yet". In the build this exists only as a *setting* on the owner's attendance settings page (`web/src/v2/settings/Attendance.tsx:330`, `Ask "Are you back in the office?"`), never as the prompt itself.
- **The VIP refuse path.** Design has **Accept VIP lead** *and* a two-tap refuse: the button reads "I can't take it", and on first tap becomes "Tap again to send it back". After refusing, a strip: *"Khalid Al Mansoori was sent back to Incoming. Emir was told and will give the lead to someone else. It is no longer in your lists."* with **Undo**. The build's VIP hero has "Accept VIP lead" and "Open the lead" — there is no way to refuse one from My Day.
- **The line under the two VIP buttons:** *"If you don't call in time, the lead goes back to Incoming and Emir is told."*
- **The notification-permission card.** "Turn on notifications / New leads, meetings and follow-ups on your lock screen, like WhatsApp. Tap one and it opens the right page." with **Turn on** · **How to install** · a dismiss ×; and on "Turn on", the card is replaced by a **fake lock-screen notification** that drops in from the top ("homes.me CRM · now · Test: notifications work 🎉 / Tap a notification and it opens that lead, task or meeting."). In the build this lives on `/v2/settings/phone-app`, not on My Day.
- **Quick actions** — the 4-tile row: Add lead · Follow-ups · Calendar · Projects.
- **"Meet your colleagues"** — the horizontal avatar strip with deal counts, + "See all" → `TeamDirectory`.
- **"Projects we sell now"** — the horizontal project-card strip with "24 my leads" on each, + the all-projects arrow.
- **The stage donut.** Design draws an animated ring with the total in the middle and a six-row legend (New 18 · Called 14 · Interested 11 · Meeting 6 · Offer 3 · Won 2). The build draws a horizontal bar row which is itself clipped at 390px — "Meeting" reads "Meetin" and its percentage is cut.
- **"+240 points"** on the today's-calls card.
- **"Shift 09:00 – 18:00 · you are not checked in yet"** — the build's check-in hero says "Shift starts 09:00 · check-in works only on the office network" instead, so the shift *end* is never shown.
- **Confetti on check-in.** `web/src/lib/celebrate.ts` exists but is imported only by the v1 components (`web/src/components/LeadActions.tsx`, `web/src/components/AddLead.tsx`, `web/src/pages/Wall.tsx`). No v2 screen fires it.
- **The banner carousel's shape.** The design's slide is an eyebrow label (`FROM EMIR` / `BEST OF HOMES` / `OFFICE`), a headline, one line of body and a cue ("See project →"), 168px tall, third block on the page. The build's slide is title + body + an optional link button, no eyebrow, no cue, and it is the **last** block on the page. Auto-advance at 4500ms and the widening dots are both present (`web/src/v2/Home.tsx:688`).
- **The date line above the greeting.** Design: small date line, then `<h1>`. Build: `<h1>` first, then "Friday 13 November at 12:46".

**Extra in the build:** a Homes AI one-liner directly under the greeting; a countdown *ring* for the VIP timer (the design uses a text countdown "24:12 left to call"); "Open the lead" beside Accept; a Follow-ups card (25 overdue / 100 today); a Transfers card; "Ahmed Khalil opened your link · Brochure · 08:28 · 2 times" folded into the "Waiting for your update" card rather than standing alone; "18 of 40 calls today" with a progress bar inside the Call-list card.

---

### `OwnerHome.dc.html` → `/v2` as owner

**Missing from the build:**

- **The consequence line on every "Needs you now" row.** The design writes the row as title + a second line that says why it matters + a verb link on the right:
  - "VIP lead not called: Omar Khan" / "Given to Bassam 14:20 · 30 min passed · back in Incoming" → **Give again ›**
  - "2 leave requests" / "Rocky 18–20 Nov · Shan 14 Nov" → **Answer ›**
  - "Bassam is absent" / "No check-in, no leave, nothing shared" → **See ›**
  - "3 leads waiting in Incoming" / "Oldest is waiting 42 min · 1 is VIP" → **Give ›**
  - "1 blocking bug from Talha" / "\"Call button does nothing on Pipeline\"" → **Open ›**
  The build has four rows with the title only ("1 VIP lead not called in time", "3 leads waiting to be given out", "1 lead transfers need your approval", "2 leave requests to answer") and no second line at all.
- **The "Bassam is absent" row** and **the "1 blocking bug from Talha" row** — neither is in the build's queue.
- **The sub-line on the primary card:** "Add a lead and give it" / *"Type it once, pick the agent, mark it VIP"*. The build has the title only.
- **"Open the full dashboard"** — the build's link reads "The full dashboard / Sources, agents, the funnel and the money".
- **The "Today in numbers" label/value rows with their pre-filters.** Design rows carry a `data-set` that opens the destination already filtered — e.g. "Follow-ups overdue (team) 9 ›" opens All leads on the Overdue filter (`data-set="hmAllF=Overdue"`), "Leads with no next step 31 ›" on No-next-step. The build's six stat cards link to lists but there is no Overdue / No-next-step filter on the leads screen to land on.
- **"Calls · WhatsApp · Telegram  214 · 104 · 28 ›"** as one row → `OwnerMessaging`. The build splits it into "Calls today 31 · 18 WhatsApp · 2 Telegram".
- **The date *and time* line** — design "Wednesday, 11 November · 14:55"; build "Friday 13 November at 12:47", and it sits under the greeting rather than above it.

**Layout defect:** "Team today" renders as `2In office1Late1Outside1Not marked` — the four tiles have lost their grid and their spacing at 390px. This is the single worst-looking thing in the group.

**Extra in the build:** a "Team right now" table (Who / Today / Open leads) whose "OPEN LEADS" column is cut off at the right edge; a "From the office" banner at the foot.

---

### `OwnerDashboard.dc.html` → `/v2/dashboard` as owner

**Missing from the build:**

- **The page title.** The phone header reads **"homes.me"**. The design is `<h1>Dashboard</h1>` with the sub "Emigeo Homes · all leads".
- **The "Team live" button** in the header (top right, → `OwnerLive`). The build has search · bell · + instead.
- **The period sentence.** Design: *"Calls, meetings and deals for: Today, Wed 11 Nov. Lead totals are always now."* — the second half is the part that stops an owner misreading the page. Build: "Live · Wed 11 Nov, 14:55".
- **The stage donut + 7-row legend** (New 456 · Called 214 · Interested 96 · Meeting 31 · Offer 12 · Won 4 · Lost 50). Build draws a vertical bar list.
- **The attendance card** — "Attendance today · live", the 4-up In / Late / Outside / Leave-absent counts, an avatar strip, and the line "Bassam not checked in · Nelson outside", the whole card linking to `OwnerLive`.
- **"240 last night"** on the all-leads card, and the three-up Open / Untouched / Won under it.
- **The four period tiles** with their own captions: "Touched in 2 h · of last night's import", "First click · median · target 5 min", "Call clicks · plus 104 WhatsApp", "Meetings booked · in this period".
- **"Where leads come from"** as the design frames it — Imported files 531 "3 files this month" · Owner VIP hand-offs 24 "15 accepted in time" · Added by agents 48 "Referrals convert best". The build's "Sources" card has different rows (Meta lead ads / WhatsApp ad / Imported / Website / Google Ads / Added by hand) and no caption under any of them.
- **"58 untouched 3–7 days / Auto-recycle in 24 h"** — the second Going-cold row. The build has the "Move N" action (per agent) but not the 3–7-day band or the auto-recycle sentence.

**Layout defect:** the "Team today" table is 7 columns wide (Agent · Where · Calls today · 7-day · Meetings · Units · Open · Overdue). At 390px its right-most cell ends at **x = 672** — 282px past the viewport. The page itself does not scroll sideways, so four of the columns can only be reached by dragging inside the card, with no affordance saying so.

**Extra in the build:** a dark AI brief card at the top carrying the decision rows; "New leads per day" as a 14-day bar chart with a vs-previous comparison; per-agent sparklines; "Moving sends that person's open leads back to Incoming for you to give out. It never picks the next agent."

---

### `Leads.dc.html` → `/v2/leads` as agent

**Missing from the build:**

- **The header subtitle** "62 open · 12 to call today". The design's pattern-B header always carries a 13px sub under the `<h1>`; the build has none on this screen (or on any other in this group).
- **The result line.** Design: "12 leads · best time to call first" on a tab, "62 shown of 62 · most urgent first" on All, and *"3 found for "mar""* on a search. Build: "50 of 100 leads", with no sense of ordering and no echo of the search term.
- **Search overrides the active chip.** In the design, typing clears the tab selection (`!q && s.tab === label` decides the filled pill) and searches the whole book. In the build the search is applied *within* the open tab.
- **The reason note per row.** Design's lower bar is `local time · reason`, and the reason is coloured by urgency: "VIP · call within 24 min", "Follow-up overdue since 11:00", "Not called yet · goes back tomorrow 09:00", "No answer twice · try again", "No next step · plan one", "Lost · budget too low · try again in 3 months". The build shows a next-step line ("Overdue 13 Nov, 05:45", "Due 14 Nov") but not the human reason.
- **Round icon-only message and call buttons** on each row. The build uses three labelled buttons — Call · WhatsApp · an external-link icon — which is why a row is six lines tall.
- **The back button → `Main`.** Deliberate (the five bottom-bar routes are treated as roots), but it is a difference from the design.
- **The per-lead avatar colour.** Design assigns a fixed colour per lead (`#E07B45`, `#3B8FD1`, …) so a face is recognisable down the list; the build derives one from the name.
- **The check-in gate on every Call button.** See the section at the end.

**Cards or tables at 390px:** the **design is a list of cards** — each lead is its own rounded block in two stacked parts. The **build is an HTML `<table>`** (`.d-table.d-sticky.d-id-leads` with a `<thead>` of Lead · Phone · Project · Stage · Local time · Next step) that `@media (max-width:767px)` reflows into a 2-column grid per `<tr>` with `thead{display:none}` (`v2-shell.css:2427–2483`). It *reads* as cards, but they are table rows inside one white card with a hairline between them, not separate blocks, so the per-lead colour, the VIP badge position and the two-part structure of the design's card are all approximations.

**Extra in the build:** a dark "N leads are ready to call · one at a time, VIP first" strip around the Start-calling button; **Stage** and **Project** dropdowns; removable filter chips and a "Clear all"; a "Show 50 more" pager with "1–50 of 100".

---

### `AllLeads.dc.html` → `/v2/leads?tab=all` as owner

**Missing from the build:**

- **The screen itself as a destination.** An owner opening `/v2/leads` gets "My leads · Today". The design's owner screen is `<h1>All leads</h1>` / "Owner · 863 leads · every agent", reached from `OwnerHome`, with **More** lit in the bottom bar (not Leads).
- **The agent chip row** — `All agents · Talha · Rocky · Yuliia · Nelson · Olga · Srdjan · Tej · Shan · Sultan · Bassam` as a scrolling pill row. The build has an "Agent: all" `<select>`.
- **The "Going cold · 12" filter chip.** The build's filter chips are the My-leads tabs; Going cold exists only on the dashboard.
- **Select-to-move.** The design's count row carries a text button **"Select to move" / "Cancel"**; in select mode every row grows a checkbox, the count reads "N most urgent shown · N selected", and a floating pill appears above the bottom bar reading **"Move N leads"**.
- **The move sheet** — "Move N leads to", a button per agent **plus "Incoming"**, and a confirm button that reads **"Move to {agent} · notify them"** or **"Pick who gets them"** and plays the error sound when nothing is chosen.
- **The toast after a move:** *"N leads moved to {agent} · notes and history go with them."*
- **The warn pill on a row** — "No call in 26 h" / "Follow-up overdue 2 days" / "No next step" as an amber pill under the lead's sub-line.
- **The agent name as a pill on the right of each row**, turning green once that lead has been moved. The build shows an avatar + name instead.
- **The owner-only block for agents:** *"Only for owners and admin / You are signed in as an agent. This page is not in your menu and you cannot open it."* + "Go to My Day". (The design prints this on `AllLeads`, `OwnerHome`, `OwnerDashboard` and `OwnerAssign`.)

**Cards or tables at 390px:** the **design is a list of rows inside one card** — checkbox · (name, sub, warn pill) · agent pill. The build is the same reflowed `<table>` as My leads, with the agent avatar added as row 4. Closer here than on My leads, since the design is itself a tight list rather than a two-part card.

**Extra in the build:** Stage, Project and Source dropdowns; "Last contact" per row.

---

### `Lead.dc.html` → `/v2/leads/o-1`

**Missing from the build:**

- **The page header is wrong.** The build draws the standard phone header with `<h1>My leads</h1>` above the record. The design has no page title here: back button · **stage pill** · **score pill ("Score 72")** on one row, then the identity block.
- **The time-zone card.** A whole block in the design: a country badge ("IT"), "Number from Italy", "11:55 AM · 3 h behind Dubai", a live pulsing dot with *"Good time to call now · best: 10–12 & after 18:00 his time"*, and a **"Next step:"** line. The build has one line of flag + local time and one line of "Good time to call them now" — the offset, the best-hours window and the Next-step line are not there (Next step is a separate card lower down).
- **"with Rocky"** under the number, and the trait chips (Investor · Cash buyer · IT · EN) as the design groups them. The build has one chip row mixing stage, score, VIP, Hot, source and language.
- **The AI summary.** *"**In short:** Italian investor, AED 2M cash for a 2BR in The Archive. Wants the payment plan and rental yield. Wife decides too."* — absent.
- **Every "What {first} wants" row being a button.** The design labels the section "tap any line to edit" and each of **Project · Unit · Budget · Purpose · Timeline · Payment · Language** opens a one-field edit sheet ("Change: {label}" + a text input + Save + *"The change is written on the timeline with your name."*). The build renders a read-only `<dl>` and has **Purpose**, **Timeline** and **Payment** missing entirely (it shows Project · Unit · Budget · Where · Language · Source · Lead #).
- **The Wants / Doesn't want chip groups** (Sea view · Balcony · Near metro / Ground floor · Long handover).
- **Telegram.** The design's primary action row is **Call · WhatsApp · Telegram**; the build's Telegram is a disabled "Soon · phase 6" stub.
- **The messaging sheet** — the whole leave-and-come-back loop. "Pick a ready message", the note that links carry a tracked URL (`homes.me/p/archive-rk42`) and *"When Marco opens it, you get an alert: a good moment to call"*, a send button whose label warns *"Opens on your phone. On a computer it opens the web version."*, and the return mode: *"You opened WhatsApp for Marco / Welcome back. Tell the CRM what happened."*, "Logged: tapped at 14:55 · away **1 min 12 s**", outcome chips, a voice note, and *"Later · it stays in "waiting for your update""*. The build's WhatsApp button is a bare `https://wa.me/` link.
- **The pending-update button** at the top of the record when a WhatsApp/Telegram tap was never resolved.
- **The Notes tab.** Count + **Add note**; per-note type chip (Note / Call / Objection), **PINNED** badge, who and when, body, an optional reminder line, Pin / Edit; a voice note rendered as a play button + a 24-bar waveform + duration. The build's Notes tab is an empty state.
- **The add-note sheet** — type chips, quick-phrase chips that append to the draft, **hold-to-record** with a live `0:NN` counter and a Stop button, an attach button, and a reminder picker.
- **The Files tab** — file rows with Open, plus upload chips. The build's Files tab is an empty state.
- **The Info tab's audit line:** *"Rocky changed budget 1.5M → 2M · today 10:40 · history"*. The build's Info tab has Phone · Email · Language · Lead # · Added · Last spoken to, and no Nationality, Birthday or WhatsApp-2 rows.
- **"Voice notes and photo gallery ›"** → the Notes screen.
- **The Lost sheet's reasons.** Design (and `design/web/lead.html` agrees word for word): **Bought elsewhere · Budget too low · Just browsing · Not into off-plan · Is a broker, not a buyer · Other**. The build uses *Bought somewhere else · Budget too low · Only looking · Never reachable · Changed their plans · Something else* — two of the six reasons are different things, not different wording.
- **The "Try again in 3 months" toggle** with the exact date spelled out ("Reminder on 11 Feb 2027"). It appears in both designs and nowhere in v2 (`grep "Try again in 3 months" web/src/` finds nothing).
- **The confirm button that names the outcome and refuses first.** Design: `"Mark as Lost · Bought elsewhere"`, or `"Pick a reason first"` with the error sound when nothing is chosen. Build: a fixed "Mark lost" with an inline "Choose a reason first." error.
- **The Won sheet's shape:** "Amazing, Rocky! Tell us about the deal. It goes on the Team wall.", unit number, **price** and **paid-now** fields, a dashed **attach-receipt** zone that flips to a solid confirmation, "What was signed?" (EOI / Booking form / Full payment), **"Mark as Won · +300 points"**, and confetti. The build asks for the price, the unit and a note, plus a "Yes — they bought it." checkbox; no receipt, no what-was-signed, no points, no confetti.
- **The Meeting sheet's chain:** *"After you save, WhatsApp opens so you can send {first} the time. You get a reminder 2 hours before."*, and saving goes straight into the messaging sheet with the "Meeting time" template pre-selected.
- **Bottom sheets.** Every one of these is a bottom sheet in the design; in the build they are centred boxes (`.d-dialog{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%)}`, `v2-ui.css:365`), at every width including 390px.

**Extra in the build:** a Hot chip and a numeric score chip; "Speaks en" as its own line; a "Next step / Coming up" card with Change; a "From the sheet" card showing the import row the lead came in on; a timeline with coloured icon dots.

---

### `Notes.dc.html` → **no address in the build**

The whole screen is unbuilt. For the rebuild, this is everything on it:

- Header: back → `Lead`; `<h1>Notes & files</h1>`; sub = the lead's name.
- **Voice note card** — eyebrow "VOICE NOTE · TODAY 10:47", a **1.5x** speed button, a play button, a 30-bar waveform, "0:27 / 0:42", and the **transcript** in quotes: *"Spoke to Marco, he's ready with two million cash, wants a two-bed in The Archive, asked for payment plan and rental yield. Call him tomorrow at eleven."*
- **"Emir AI found these. Save to lead?"** — four pre-ticked checkboxes, each `label → value`: Budget → **AED 2M**, Unit → **2BR · The Archive**, Payment → **Cash**, Task → **Call tomorrow 11:00**; then **"Save 4 to lead"**.
- **"Hold to record a voice note"** — full-width.
- **Gallery** section header with a **"Scan / upload"** button.
- Four folder rows: **Passport & ID** "2 files · private" (with a lock mark), **Booking forms** "1 PDF", **WhatsApp screenshots** "6 images", **Payment receipts** "Empty".
- The rule, printed at the foot: *"IDs are seen only by Rocky, managers and owners. Every view is logged."*

**Extra in the build:** nothing — the Notes and Files tabs on the lead both say "not built yet · phase 4".

---

### `AddLead.dc.html` → `/v2/leads/new`

**Missing from the build:**

- **The page title.** The phone header reads "My leads". The design is `<h1>Add a lead</h1>` with the sub "Name, phone and lead source are needed".
- **The country picker as a sheet.** The design opens a full bottom sheet: a title row "Choose country" with a round close button, a search field placeholdered *"Search country or code, e.g. India or +91"*, a region chip row, then a scrolling list of flag · name · code, and the empty state *"No country found. Try the code, e.g. +44"*. The build opens a 320px-wide anchored dropdown (`.v2-cc-menu{position:absolute;top:calc(100% + 6px)}`, kept at `min(320px, 100vw - 48px)` on a phone) with a "Country or code" input, region chips, and "No country found."
- **Chips the design has and the build does not:**
  - Project: **The Archive · Shahrukhz · Damac Islands · Valia · Not sure yet · Other** (Other reveals a free-text field). The build reads projects from the database and has no "Other".
  - Lead source, agent: the design's seventh chip, **Other** (reveals "Write the source"). Build has six, no Other.
  - Lead source, owner: the design has **Email to owner · Owner's contact · Referral · Walk-in · Event / expo · Old client · Other**; the build has five — **Old client** and **Other** are missing.
  - Looking for: design **Studio · 1BR · 2BR · 3BR · 4BR+ · Villa**; build collapses 3BR and 4BR+ into "3BR+".
  - Budget: design's sixth chip **Not sure**.
  - Speaks: design is **multi-select** over English · Arabic · Hindi · Urdu · Russian · French · Chinese · Other (8). Build is a single choice over 6, with French relabelled "Other".
  - Agent's "Who works it?": design **Me · Leave in Incoming**. The build shows the full agent list to an agent too.
- **The "OWNER · GIVE THIS LEAD" section label** over the owner block.
- **The VIP switch's explanation:** *"Top of the agent's My Day, with a timer. Comes back to you if not called."* The build says "The agent gets a clock. Not called in time → back to you."
- **The agent rows' availability sub-line.** Design shows what each agent is doing; the build shows "N open".
- **Confetti on save**, and the save button's `coin` sound.
- **The new-number confirmation** *"New number. Not in the CRM yet."* as a positive green state. (The idle line and the duplicate block are both present; the duplicate does block the save, as the design requires.)

**Extra in the build:** the form is cut into numbered cards (1 Who is it? / 2 More details · optional / 3 Who works it?); a **Timeline** chip row (Now · 1–3 months · 3–6 months · 6–12 months · Not sure) that neither design has — `AddLead.tsx:60–67` says so in a comment and gives the reason; a live "Still needed: name, phone, source, who works it." line under the save button.

---

### `Incoming.dc.html` → `/v2/incoming` as agent — **Same**

**Missing from the build:**

- **The taken state.** Design replaces the card with a confirmation — *"{name} is now your lead. It is in My Leads."* — and an **"Open the lead and call"** link. The build shows a banner, "{name} is now in My leads · call today", with no way through to the lead.
- **The rule as one sentence.** Design prints it at the foot: *"One rule: a VIP lead comes back if not called in the time the owner set (30 min if he did not choose). An imported lead comes back after 24 hours with no call."* The build splits it into a "The rules" card of three lines, which carries the same facts.
- **The empty state's wording:** "Incoming is empty / Every lead has an agent." Build: "No free leads now / You took them all. New free leads show up here."
- **The agent-side auto-assign.** Correctly absent — it is owner-only in both.

**Cards or tables at 390px:** both sides are **cards**, one per lead, and they match: avatar, name, project, the why-it-is-here line, the waiting age, one action. This is the one screen in the group that needs no structural work.

**Extra in the build:** a Waiting / Came back to you tab pair; the lead's phone number on the card for an owner; "Only an owner gives it" as a lock chip on a VIP row; a "Share equally" card explaining what it does before you press it; a four-line "How a lead gets here" card with a link to the take-back-time settings; a "My leads" shortcut.

---

### `OwnerAssign.dc.html` → **no address in the build**

`docs/v2/screens.md` lists this as "the 'give to an agent' dialog on Incoming". It is not. It is a whole owner screen that no address serves:

- Header: back → `OwnerHome`; `<h1>VIP leads I gave</h1>`; sub "Owner · who took them and how fast".
- A primary link, **"Add a lead and give it as VIP"** → `AddLead`.
- Tabs: **All · Needs you · Going well**.
- One card per VIP hand-off: the lead's name (a link), a sub-line "{project} · {detail} · given {time} to {agent}", a **state badge** — *Came back · Waiting · Called · Meeting · Offer* — and a line of detail: "Not called in 30 min. Bassam is absent today.", "Not accepted yet · 24 min left of 30.", "Accepted in 2 min · called in 5 min · follow-up Friday.", "Accepted in 1 min · meeting on Thursday 15:00.", "Offer sent · AED 4.1M."
- Two buttons, shown only on *Came back* and *Waiting*: **"Give to another agent"**, and **"Remind the agent"** (Waiting) or **"I will call myself"** (Came back).
- The give sheet: "Give {name} to", a button per agent, and a confirm reading **"Give to {agent} · 30 min to call"** or **"Pick an agent"**.
- The toast: *"{name} given to {agent} as VIP · loud alert sent."*
- The owner-only block for agents.

**What the build has instead:** the give-to-an-agent **dialog** on `/v2/incoming` (`Incoming.tsx:455–522`) — a centred box, not a bottom sheet, with an agent list carrying a "Best match" chip and open-lead counts, a "Put a clock on it" segmented control (No clock / 5 minutes to accept), and "Give to {agent}". The owner's Incoming also has a "Came back to you · 1" tab and a "Give again" button on a VIP row. None of that tracks a VIP *after* it has been given: there is no list of hand-offs, no how-fast-was-it-accepted, no "Remind the agent", no "I will call myself", and the design's 30-minute clock is a 5-minute one.

**Extra in the build:** the "Put a clock on it" control; "Fewest open leads first. People marked unavailable cannot be chosen."

---

### `Dialer.dc.html` → `/v2/calling`

**Missing from the build:**

- **The header.** Design: a close arrow (→ `Leads` in queue mode, → `Lead` in single-call mode), a two-line title — **`POWER DIALER · 11 LEFT AFTER THIS`** over **`Lead 1 of 12`** — and a **"+15 points per call"** pill. The build keeps the standard phone header (back · search · bell · +) and then draws `<h1>Calling</h1>` under it, so the full-attention mode has two headers and three ways out. (The bottom bar *is* correctly hidden — `NO_BAR_ROUTES` in `web/src/v2/phone.tsx`.)
- **Single-call mode.** The design's `isOne` state: header "ONE CALL" / "Call Marco Bellini", no progress bar, no points pill, and a footer **"Done · back to the lead"**. The build's `/v2/calling` is always the queue; the Call button on the lead page is a plain `tel:` link, so there is no way to enter the dialer for one lead.
- **The avatar.** Design puts a 76px coloured avatar at the top of the lead card. The build has none.
- **The "Say:" script line.** *"**Say:** "Hi Marco, this is Rocky from homes.me about The Archive.""* — one per lead in the design's data, written to the lead's situation. Absent.
- **The "why they are in the list" line** next to the local time — "VIP from Emir · call first", "Overdue · promised 11:00", "Wants the payment plan", "New · imported · not called yet", "No answer twice". The build has a VIP note and a "WHAT YOU PROMISED" box, not this line.
- **The tap-logged strip** — *"Call tap logged 14:55 · opening your phone…"* / "WhatsApp tap logged 14:56 · opening WhatsApp…". The build has a static "Every tap is logged".
- **Both guard rails as shaking inline lines.** Design: *"Tap Call or WhatsApp first, then say how it went."* and *"You called. Choose what happened first, or tap Skip."*, each with the `shake` animation. The build shows a static lock chip "Click Call or WhatsApp first" in the card head and a static hint "Save a result before Next, or skip this lead."
- **The "Not interested" sheet's reasons** — same six as the lead page (Bought elsewhere · Budget too low · Just browsing · **Not into off-plan** · **Is a broker, not a buyer** · Other) and the **"Try again in 3 months · Creates a reminder for 11 Feb 2027"** toggle.
- **The "Call back" time chips** — **In 1 hour · Tonight 19:00 · Tomorrow 10:00 · Pick date & time**, where the last one reveals the native date and time inputs. The build goes straight to Day / Time / Why fields, so the common case takes three controls instead of one tap.
- **The "Interested" next-step chips** — **Send payment plan on WhatsApp · Book a meeting / site visit · Call back tomorrow 11:00 · Send brochure + location**, with "Book a meeting" revealing date/time/place and "Send …" showing *"Saving opens WhatsApp on your phone with the message ready. You press Send. The tap is logged."* The build says only "The lead moves to Interested. Choose what happens next on the lead page."
- **The confirm buttons that name the outcome** — "Set call back · Tomorrow 10:00", "Save · add the meeting", "Save · open WhatsApp", "Save the new number" / "Flag wrong number", "Mark as Lost · {reason}" / "Pick a reason first". The build has one "Save result".
- **The wrong-number field.** Design takes the correct number and explains: *"The lead is flagged for the owner and removed from your count. If you add a correct number, it stays with you."* Deliberately left out — `Calling.tsx:552–556` says nothing takes a replacement number, so it would throw it away.
- **The No answer / Busy sheet's prepared WhatsApp** — a row reading "Send a WhatsApp too" / *""Hi {first}, I just tried to call you…" · opens WhatsApp on your phone"*, which flips to "WhatsApp opened · tap logged ✓". The build has a checkbox, "Also open WhatsApp with a short 'I tried to call you' message".
- **The finished state as a screen.** Design: a tick, "List finished", *"Nice work, Rocky. Every result is saved on its lead."*, the three numbers, then **"See my follow-ups"** and "Back to My Day". The build shows a centred dialog titled "Good work" with the same three numbers, "Keep calling" and "Back to My Day" — no link to the follow-ups.
- **Bottom sheet, not inline.** The design's five outcome forms are one bottom sheet with a coloured mark, a title and a sub-line per mode ("Not interested / Pick a reason · the lead goes to Lost", "Call back / When should you call {first} again?", "Interested / Great! Set the next step now", "Wrong number / Fix it or flag it for the owner", "No answer / A reminder is set for you"). The build opens them as a sub-panel inside the "What happened?" card, with no title or sub-line.

**Extra in the build:** "0 calls 0 WhatsApp 0 results saved" in the progress line; an "End session" button; "Open the lead"; a "WHAT YOU PROMISED" box; "Today's list" with the queue numbered and VIP first; the check-in banner at the top of the page; the consequence sentence under each outcome ("The lead comes back in your list in 2 hours", "…in 1 hour").

**Deliberate wording change:** the design's **"+15 points per call"** is **"+2 points when you reach someone"** in the build; `Calling.tsx:144–150` explains that the wall really pays two points for reaching somebody and there is no per-call rule.

---

### `Pipeline.dc.html` → `/v2/pipeline`

**Missing from the build:**

- **The whole layout.** Design: a scrolling row of **six stage chips** — New · Called · Interested · Meeting · Offer · Won, each a 96px tile with its name and its count — then a title line *"Interested · 14 leads · the 3 most urgent shown"*, then a **vertical list of cards** for the open stage only.
- **The card's "next stage" line.** Each card's second row is a link reading **"Open the lead · next stage: Meeting"** (or "Open the deal" on Won), beside a round call button.
- **The rule, printed at the foot of the screen:** *"A lead changes stage by itself when you call, book a meeting, send an offer or mark it Won on the lead page. Stages: New → Called → Interested → Meeting → Offer → Won. Lost is kept apart."* The build has a shorter version in the filter row — "No drag. A stage changes when you save a call, a meeting, an offer or Won." — which loses the stage order and the Lost sentence.
- **The empty state** "No leads in this stage."
- **The header subtitle** "62 open leads by stage · Won is counted apart".
- **The back button → `Menu`**, and **More** lit in the bottom bar rather than Leads.

**Cards or tables at 390px:** the **design is stage chips + one vertical list of cards** — explicitly not a board. `docs/v2/phone-shell.md` §5.4 says so: *"`Pipeline` likewise is not a kanban board — it is stage chips plus a vertical card list… There is no horizontal drag anywhere in the 68 files."* The **build is a kanban board** that scrolls sideways: `v2-shell.css:1491–1495` sets `grid-auto-columns:minmax(252px,252px); overflow-x:auto; scroll-snap-type:x proximity` under `@media (max-width:900px)`. At 390px that shows column 1 and a sliver of column 2; Meeting, Offer and Won are three drags away.

**Extra in the build:** a search field and a Project dropdown; a percentage on each column head; "+ N more" per column linking to All leads; a Lost strip at the foot with a count and "See all lost"; the owner's Agent filter and an avatar per card.

---

## DISAGREEMENTS between the phone and the computer design

- **DISAGREEMENT: Pipeline.** `design/screens/Pipeline.dc.html` is stage chips plus a vertical card list with the stage model written out in prose at the foot. `design/web/pipeline.html` is a kanban board (`.kanban`, `.kb-col`). The build follows the computer design and scrolls it sideways on a phone. The owner has said the computer design wins; this is the case where that costs the most on a phone, because five of six columns are off-screen.
- **DISAGREEMENT: the phone number on the calling screen.** `design/screens/Dialer.dc.html` renders the name at **24px / 800** and the number at **14px / 400 in muted grey** — the number is *not* the biggest text. `design/web/calling.html` renders the number at **50px / 770** and the name at 17px / 660. The computer design is the one that matches what the owner asked for, and the build follows it.
- **DISAGREEMENT: the "Add a lead" timeline field.** Neither design has a "when do they want to buy" field on this form; the build adds one. `web/src/v2/AddLead.tsx:60–67` records the reason (the follow-up rules and the lead score both read the column). Listed here so it is a decision rather than a drift.

---

## The two things the owner named

### 1. The phone number must be the biggest text

Measured in a real browser at 390 × 844, leaf elements only, largest first.

| | Lead page | Calling screen |
|---|---|---|
| **Phone prototype** | number **20px / 800**; name `<h1>` 18px / 700; avatar initials 21px | name **24px / 800**; number **14px / 400, muted grey** |
| **Computer design** | number **28px / 760**; name 17px / 680 | number **50px / 770**; name 17px / 660 |
| **Build at 390px** | number **28px / 760**; name 17px / 680 | number **28px / 770**; name 17px / 660 |

**The rule is already met on both screens in the build** — the number is the largest text on the page by 11px on each. Two things to know before the rebuild touches them:

- **The phone prototype's Dialer breaks the rule.** It puts the name at 24px and the number at 14px grey. Rebuilding that screen from the prototype would make it worse. Build the number from `calling.html`, not from `Dialer.dc.html`.
- **The calling screen's number has been shrunk for the phone and could be bigger.** `v2-shell.css` steps it 50px → 34px (≤767px) → **28px (≤460px)**. Measured in the live card: the inner width is **322px**, and `+971 50 123 4567` renders **244px at 28px**, **279px at 32px**, **314px at 36px** and **349px at 40px**. So **36px is the largest that fits** a 16-character UAE number, and 28px is leaving 78px unused. A long international number (`+880 17 1234 5678`) wants about 34px.
- **On the lead page there is more room still.** The number has **358px** to live in and renders **220px at 28px** — 40px would fit (315px).
- **One inconsistency worth fixing in the same pass:** the lead page prints the raw E.164 with no grouping — `+971501234567` — while the calling screen prints `+971 50 123 4567`. The ungrouped one is the harder of the two to read aloud, and it is the one an agent dictates from.

### 2. The question the design asks before a call

**Where it lives in the prototypes.** It is not one screen's feature — it is the shell. Every call affordance is written twice in the markup, as a link when `gateFree` and as a button that opens the sheet when `gateLocked`, and the sheet's markup is byte-identical on **64 of the 68 files** (all but `Login`, `Dialer`, `Chat`, `Email`). In this group it sits on `Main` (the "Start calling" button, every "Best time to call now" row, the VIP "Call now"), `Leads` (the "Start calling" strip and every row's call button), `Lead` (the Call button), `Pipeline` (every card's call button), `Incoming`, `AddLead`, `Notes`, `AllLeads`, `OwnerHome`, `OwnerDashboard`, `OwnerAssign` — and on the **round dial button in the bottom bar of every one of them**. `Dialer` itself has no gate; it has the *consequence* strip instead (below).

**The three answers, word for word** (from the sheet, identical in every file):

> **You're not checked in yet**
> Work hours 09:00 – 18:00 · calls need a check-in
>
> 1. **Check in now and call** — *Office Wi-Fi found · takes 1 second* → goes straight to the dialer
> 2. **I'm working outside** — *Viewing, sales centre, meeting* → goes to `WorkOutside`
> 3. **Call anyway** — *Each call is marked "not checked in" · owners see it* → goes to the dialer
>
> After 18:00, on weekends and holidays, calls open directly. Owners and admin are not asked.

Each of the three is a full-width row with a round coloured icon on the left, a title, a grey sub-line and a chevron on the right. The sheet has a round close button; tapping the dim layer also closes it. And on `Dialer`, if "Call anyway" was used, a warning strip sits under the header: *"Not checked in · these calls are marked for the owners."*

**What the build does instead** (`web/src/v2/check-in.tsx`):

- **It asks on one screen only.** `useCheckIn` is imported by `web/src/v2/Calling.tsx` and nothing else. The Call button on the lead page is `<a href="tel:…">`; the Call buttons on My leads, on All leads, on the Pipeline cards and in the My Day call list are all `tel:` links; the round dial button in the bottom bar is a `<Link to="/v2/calling">`. None of them asks. An agent who never opens `/v2/calling` is never asked all day.
- **It is a centred box, not a sheet.** `<div className="d-dialog d-open d-sm">` over `d-scrim`, and `.d-dialog` is `position:fixed; left:50%; top:50%; transform:translate(-50%,-50%)` at every width.
- **The three answers are plain buttons** with no icons, no sub-lines and no chevrons: "Check in now and call", "I'm working outside", "Call anyway".
- **The sub-line is different:** "Checking in takes one tap and only works on the office Wi-Fi. You can call either way." in place of "Work hours 09:00 – 18:00 · calls need a check-in".
- **"I'm working outside" does not go to `WorkOutside`.** It swaps the dialog's body for a "Where are you?" text field and a "Save and call" button. The design's second answer is a route to a whole screen that collects where, why, with whom, back-by and a note.
- **The consequence sentence is shortened** to *""Call anyway" marks this call **not checked in**."* — it drops "owners see it", which is the half that makes the sentence work.
- **The exemption is never printed.** "After 18:00, on weekends and holidays, calls open directly. Owners and admin are not asked." The rule *is* implemented — `FROM = 9`, `UNTIL = 18`, `user?.role === 'agent'` — but nobody reading the dialog is told it, so the agent cannot tell a lock from a bug.
- **There is no close button** on the dialog, and no "not checked in" strip on the dialer once "Call anyway" has been used. The build has an amber banner at the top of `/v2/calling` instead — *"You are not checked in. Calls you make now are marked "not checked in", and the owner sees it."* — which is shown whether or not the agent chose "Call anyway".

---

## Counts

- **Same: 1** — `Incoming`.
- **Different: 9** — `Main`, `OwnerHome`, `OwnerDashboard`, `Leads`, `AllLeads`, `Lead`, `AddLead`, `Dialer`, `Pipeline`.
- **No address in the build: 2** — `Notes`, `OwnerAssign`.
- **Missing items listed: 139.**
