## Group 4 — messages, AI and the owner's reports

*Audit only, 13 Nov 2026. Twelve phone prototypes in `design/screens/` against the
build at 390 × 844. Colour is not audited; layout, blocks and wording are.*

**Three things checked first, because they were asked for.**

1. **No bottom bar on Chat and Email — confirmed in the prototypes, and the build
   agrees.** `grep -c "<nav"` over the twelve files: `Chat.dc.html` and
   `Email.dc.html` have **0**; `Inbox`, `Templates`, `AskAI`, `OwnerLive`,
   `TeamActivity`, `OwnerMessaging`, `OwnerFeedback`, `Import`, `Automations` and
   `Desks` each have **1**. `Login.dc.html` and `Dialer.dc.html` also have 0, so
   `docs/v2/phone-shell.md` §1.2 is exactly right about the four. `Chat`'s
   scroller also drops the 108px bar gutter — its padding is `18px 18px 24px`,
   not the standard `14px 20px 108px`. In the build, `web/src/v2/phone.tsx` names
   `/v2/calling` and `/v2/email` as no-bar routes and `Inbox.tsx:94` calls
   `useFullAttention(openId !== null)` for the thread. Measured at 390: the open
   thread has **no `.v2-bar`**, and `/v2/email` has **no `<nav>` at all**. Both
   correct. The one wrinkle is that `/v2/email` in the build is a browsing screen
   (a template library), not a single task, so it loses the bar for a reason the
   design never intended.

2. **Inbox → Chat on a phone.** The prototype has no transition at all: it is two
   separate files, and every one of the five rows in `Inbox.dc.html` is
   `<a href="Chat.dc.html">`. `Chat.dc.html` goes back with
   `<a href="Inbox.dc.html" aria-label="Back">` — a hard-coded parent, not
   history, and a 14px-radius rounded square rather than the usual 44px circle.
   The build does the same thing properly: `Inbox.tsx` watches
   `matchMedia('(max-width:900px)')` and at 390 renders `showList = !open` /
   `showThread = Boolean(open)`, so opening a row replaces the list in place and
   the thread's own back button clears `openId`. That part is right. What is
   wrong is what comes with it — see the Chat row below: the app shell's header
   stays on top of the thread's header, and the Contact-360 panel is rendered
   **below** the composer instead of being suppressed, so on a phone you scroll
   past the send button into a second screen's worth of lead detail.

3. **Import.** The prototype is one screen with six states and a dot strip:
   **Upload · Columns · Check · Give · Confirm · Done**. Every step is listed in
   the row below. The build has all six steps under the same six names and nearly
   all of the copy, and it is driven by a real file upload — but **step 1 and
   step 4 keep the computer design's two-column grid at 390px**, so the drop zone
   and the "A good file" checklist sit side by side in ~130px columns and wrap one
   word per line, and on step 4 the "Who gets the 208 leads?" heading wraps one
   word per line while the Project field is drawn **on top of** the paragraph
   beside it. Steps 2, 3, 5 and 6 are usable with a thumb. Step 6 pushes the
   document to 416px wide — the red "Undo this import" button sticks 26px past
   the right edge.

**Totals: 3 Same, 9 Different, 0 with no address — but `Email.dc.html` has no
address for what it actually draws, which is the same finding by another name.
88 missing items, 8 disagreements between the phone and computer designs.**

| Phone screen | Address in the build | Layout | Why |
|---|---|---|---|
| `Inbox.dc.html` | `/v2/inbox` (agent) | **Different** | Design is a back-button + centred title + four whose-chats chips over one card whose rows scroll with the page; the build is a left title with no subtitle, a search field, a two-way `Mine \| Free` segment, four *channel* chips, and a list in a nested 502px inner scroller inside a 644px card |
| `Chat.dc.html` | a thread inside `/v2/inbox` | **Different** | Design is a full screen with its own header, a round Call button, a quick-send chip row and the composer at the foot; the build keeps the app header above the thread's header (two back buttons), has no Call and no chip row, and stacks the whole Contact-360 panel below the composer |
| `Email.dc.html` | `/v2/email` | **Different** | The phone design is not a screen — it is a rendered 600 × 1040 **email** (the "Emir just handed you a VIP lead" message). `/v2/email` is an email-template library with a Computer/Phone preview toggle. Nothing in the build renders this email |
| `Templates.dc.html` | `/v2/templates` | **Different** | Design is one compact "16 TEMPLATES" list plus a New-template composer; build is one tall card per template showing the whole body, Meta's own category tabs, and a detail sheet — and no way to make a template |
| `AskAI.dc.html` | `/v2/ai` | **Different** | Design pins the composer at `bottom:92px` above the bar and reserves 170px of scroller for it; the build puts the composer inline in the card where it scrolls away, and adds two blocks the phone design does not have |
| `OwnerLive.dc.html` | `/v2/team-live` as owner | **Different** | Design is three KPI tiles, a two-colour stacked hourly chart, a status-pill agent list and a dark four-tile attendance card; build is owner sub-tabs, one black live card, a single-series chart with a Calls/WhatsApp toggle, and a six-column table you scroll sideways |
| `TeamActivity.dc.html` | `/v2/activity` as owner | **Same** | Same three tabs (Time in CRM · Sign-ins · Unusual · N), same per-agent time rows with a progress bar, same Review-opens-a-sheet behaviour |
| `OwnerMessaging.dc.html` | `/v2/messaging` as owner | **Different** | Design fits its six-column table into 390 with `1.6fr repeat(5,minmax(0,1fr))`; the build's seven-column table is 651px wide and **pushes the whole page to 697px — the screen scrolls sideways at 390** |
| `OwnerFeedback.dc.html` | `/v2/settings/feedback` as owner | **Different** | Design is four status tabs with counts over one card per report with three action buttons; build is a different status vocabulary, one Answer button, and a first row whose title is squeezed to ~60px and wraps one word per line under a pill |
| `Import.dc.html` | `/v2/import` as owner | **Different** | Same six steps and most of the same words, but steps 1 and 4 keep a desktop two-column grid at 390px and break; the design's column-mapping sheet is a native `<select>` in the build |
| `Automations.dc.html` | `/v2/automations` as owner | **Same** | Same shape: a take-back-rule card with a VIP timer and an imported-lead timer as chips, a working-hours line, then three switch groups (Leads · Follow-ups and meetings · Attendance) |
| `Desks.dc.html` | `/v2/settings/desks` as owner | **Same** | Same shape: header + explainer + one card per desk + an edit **bottom sheet** with name, max-open-leads chips, members, Save desk and a two-tap Delete |

---

### `Inbox.dc.html` → `/v2/inbox`

**Missing from the build:**

- The **LATER PHASE banner**: a near-black card with a lime pill and the sentence
  *"Not in the first build. For now WhatsApp and Telegram open on the agent's
  phone and every tap is logged."* The build has built the inbox, so the banner is
  wrong for it — but nothing has replaced it, and `Menu` in the design shows the
  row as "Inbox · later". Somebody has to decide which story the phone tells.
- The **centred title with a subtitle**. Design: a 44px round back button, then a
  centred 17px `<h1>Inbox</h1>` with *"WhatsApp, email and notes in one place"*
  under it, then an empty 44px spacer to keep it centred. The build has a
  left-aligned title and no subtitle at all.
- The **`Unassigned` chip**. The build calls it **Free**, which is the word
  `Incoming` uses for the lead pool, not the word the design uses here.
- The **`All` scope for an agent.** The design's fourth chip is `All`. The build
  only offers `Everyone` to owner/admin/manager (`seesEveryone`), so an agent has
  no way to see every thread. That may be the right rule, but it is a rule the
  design does not state.
- The design's chip reads **`Unread 5`** with the count baked in whatever the
  filter; the build's reads `Unread · 2` and counts only what the current filter
  returned.
- The **channel badge sitting on the avatar** — a 20px circle clipped to the
  avatar's bottom-right corner, white-ringed: green speech bubble for WhatsApp,
  blue envelope for email, amber pencil for a note. The build draws a small green
  badge beside the *name* instead, and nothing in the list distinguishes a note.
- A **note thread**. The design's list mixes channels — `Sara Nunes · Mon · "Note:
  wants sea view only"` with a pencil badge. The build's channel filter is
  `All / WhatsApp / Email`; there is no note channel in the list.
- **The page scrolls, not the list.** The design puts the five rows in one card
  inside the normal 108px-gutter scroller. In the build `.d-ib-scroll` is
  `overflow-y:auto` at 502px tall holding 556px of rows, inside a 644px card, on
  an 869px document — two scrollers on one phone screen, and the last row is cut
  off at rest.

**Extra in the build:** a "Search chats" field (the design has no search on
Inbox); the `Everyone` scope for managers and above; a real unread count on the
chips; an empty state (*"No chats here · A chat appears as soon as a lead writes
in."*); live refresh over a websocket.

`DISAGREEMENT:` the computer design (`design/web/inbox.html`) filters by channel —
`All · WhatsApp · Telegram · Unread · 2` — while the phone filters by owner —
`Mine · Unread 5 · Unassigned · All`. They are different axes, not different
wording. The build has taken both and made them two rows. The computer wins, so
the channel row stays; the owner row then needs a decision rather than a guess.
The computer's third channel is **Telegram**; the build's is **Email**.

---

### `Chat.dc.html` → one thread inside `/v2/inbox`

**Missing from the build:**

- The **round Call button in the thread header**, lime, 44px, present twice in the
  markup for the check-in gate (`aria-label="Call Marco"` as an `<a>` when checked
  in, as a `<button>` that opens the gate sheet when not). The build's thread
  header has no call affordance at all.
- The **name as a link to the lead page** (`<a href="Lead.dc.html">` around
  "Marco Bellini" and the line under it). The build's header name is plain text;
  the only way through is "Open the lead" at the bottom of the panel below.
- The header's second line, **"WhatsApp · Italy 11:55 AM"** — the channel and the
  lead's *local time*. `phone-shell.md` §5.10 lists this as one of the things that
  is on the phone because the phone is where the agent is. The build shows
  "+971501234567 · Layla Hassan" instead: the phone number and the owner, no local
  time.
- The **quick-send chip row** above the composer, horizontally scrolling, five
  chips: **Payment plan · Brochure · Location · Video · AI reply**. Nothing in the
  build's thread offers these. The lead panel below has four buttons under
  "READY MESSAGES" — First message · After a missed call · Sending details ·
  Checking in — which are templates, not these five, and **there is no "AI reply"
  anywhere**.
- The **microphone icon inside the composer** (a voice note from the chat). The
  build's composer is text only.
- The check-in gate sheet. Every call affordance on this screen is gated; the
  build's thread has no call, so it has no gate either.

**Wrong in the build (not missing — broken at 390):**

- **The app shell's header stays above the thread.** You get "← Inbox 🔍 🔔 ＋"
  and then, under it, the thread's own "← SM Sara Al Mansoori · Open · 23 h left".
  Two headers, two back buttons, ~120px of the screen gone. The design's Chat
  *replaces* the screen.
- **The name is clipped and overlaps the window pill.** Measured at 390:
  `.d-grow` is 93px wide, the `.d-bold.d-truncate` name inside it renders 116px
  (130→246), and the green `Open · 23 h left` chip starts at x=235. The name runs
  under the chip. The phone line "+971501234567 · Layla Hassan" is truncated to
  93px.
- **The Contact-360 panel renders below the composer.** `Inbox.tsx:243` is
  `{showThread && open && <LeadSide … />}`, and at 390 `showThread` is true
  whenever a thread is open, so the panel stacks under the thread card instead of
  being suppressed. On a phone you scroll past "Nothing goes out until you press
  Send" into LEAD / Score / Wants / Agent / Next step / Language / the AI summary
  / READY MESSAGES / Open the lead / All templates. The phone design has none of
  this on Chat; it is the `Lead` screen's job.

**Extra in the build:** delivery ticks on sent bubbles; system rows the design does
not draw (*"Sent automatically · lead_welcome_en"*, *"Stage moved from
attempted_contact to engaged_qualified"*, *"Intent: PRICING"*); the 24-hour window
pill *"Open · 23 h left"*; the collision guard *"Somebody else is replying to this
chat."*; a three-channel composer (WhatsApp · Email · Note) with the line *"Nothing
goes out until you press Send."* The design has the single system row
*"Call · 4 min · Interested"* and nothing else of this kind.

---

### `Email.dc.html` → `/v2/email`

**This phone screen has no address in the build, and that is the finding.**

`Email.dc.html` is a 600 × 1040 board (`$preview: {width:600, height:1040}`), not a
390px screen. What it draws is **one rendered email** — the message an agent
receives when the owner hands them a VIP lead. It is a specimen of outbound mail,
not a page of the CRM. `/v2/email` is an email **template library** with a
Computer/Phone preview toggle. Neither contains the other.

**Missing from the build** (everything the prototype draws):

- A **dark-green letterhead** with the homes.me mark and a **VIP LEAD** pill.
- *"Hi Rocky,"* then the headline *"Emir just handed you a VIP lead"*.
- A **call-within card**: *"Call within / **30 minutes**"* and, under it,
  *"After that it goes back to Emir."*
- A **lead card**: 28px avatar "KA", *"Khalid A."*, *"+971 50 ••• 7712 · Dubai"*,
  then a three-cell grid — **Project** "The Archive" · **Budget** "AED 2M cash" ·
  **Wants** "2BR".
- **"Note from Emir: Very serious buyer, met him at a dinner. Call today."**
- A lime primary button **"Open lead & accept"**, then two side-by-side buttons
  **"Call now"** and **"WhatsApp"** (green), all three deep-linking to the lead.
- A **"YOUR DAY SO FAR"** strip: `18/40 Calls` · `9/20 WhatsApp` · `#2 Best of
  Homes`.
- A footer: *"Emigeo Homes Real Estate LLC · The Bayswater, Business Bay,
  Dubai"* / *"You get this because you're on the homes.me team."* + an **Email
  settings** link to Notifications.

**Extra in the build:** the template library itself — four built-in emails (First
reply, After a call they did not answer, Sending project details, Checking in on a
quiet lead) with their subjects and a highlighted-variable preview, a
Computer/Phone render switch, the banner *"Email is off. Email sending has not been
switched on yet."*, and the closing line *"Open a lead and press Email to send one
of these. Whether the client opened it is recorded on that lead, not here."*

`DISAGREEMENT:` the computer design (`design/web/email.html`) draws a **mailbox** —
`Inbox · 4` / `Drafts · 2` / `Sent`, a **Write** button, and a message list with
open tracking (*"Opened 2 times"*, *"Not opened"*). The phone design draws **one
rendered email**. The build is a third thing again. `docs/v2/screens.md` already
marks this row **Partly** and gives the reason (the CRM has no mailbox). The
computer wins, so the mailbox is what `/v2/email` owes; the VIP email the phone
draws is a *notification template* and belongs beside the other outbound emails,
not at a route.

---

### `Templates.dc.html` → `/v2/templates`

**Missing from the build:**

- The **LATER PHASE banner** (same wording as Inbox).
- The explanation card: *"Templates with a **green** tag are approved by Meta and
  can be sent any time. Others work only inside 24 h after the client writes to
  you."* The build says something adjacent at the foot — *"Only an approved
  template can go out more than 24 hours after a client last wrote."* — but the
  design puts it at the top, before the list, which is where it does its job.
- The **"16 TEMPLATES" card header** and the compact row form: a 40px round icon,
  the name, a one-line purpose under it (*"New lead · English"*, *"2 h before
  meeting"*, *"After a no-show"*, *"After reschedule"*, *"Sends PDF + pitch"*,
  *"Sends plan table"*), and a status pill on the right. The build gives each
  template a full card with the entire message body in it, so three templates fill
  the screen where the design shows seven.
- The **New template composer**, the whole bottom card: a **Name** field
  (`value="Launch invite"`), a textarea prefilled *"Hi {{1}}, {{2}} is launching
  this week with {{3}} payment plan. Shall I send you the brochure?"*, the hint
  line **"{{1}} client name · {{2}} project · {{3}} plan"**, and the button
  **"Send to Meta for approval"**. The build has none of it and says why, in its
  own sheet: *"Changing a template means asking WhatsApp to approve it again, so it
  is edited in the code and submitted, never typed here."* That is a real answer,
  but it is a decision the design did not make and it is not written down in
  `DECISIONS.md`.
- The **"Draft"** status. The design has three — Approved (green), In review
  (amber), Draft (grey). The build has Approved, In review and *"Paused by
  WhatsApp"*; a template that exists only in the CRM has no state.
- The design's back button goes to **Settings**; the build's goes to the shell's
  previous screen.

**Extra in the build:** Meta's own category tabs (All 12 · Marketing 9 · Service
3) with real counts; the language tag (EN / AR) on every card; every variable
highlighted in the body; a detail **bottom sheet** per template with a WhatsApp
bubble preview, the raw `{{1}}` text, **Close** and **Copy the text**; the line
*"10 approved · 2 waiting or blocked at WhatsApp."*

`DISAGREEMENT:` the computer design groups templates by purpose — *All 16 · Hello 4
· Meeting 4 · Brochure and links 3 · Payment plan 2 · Follow-up 3*. The phone
design has **no tabs at all**. The build uses Meta's categories and explains in
`Templates.tsx` that the computer's groups "do not exist anywhere in the CRM". The
computer wins, so either those six groups become real, or the departure gets
written down.

---

### `AskAI.dc.html` → `/v2/ai`

**Missing from the build:**

- The **pinned composer**. Design: `position:absolute; left:14px; right:14px;
  bottom:92px`, sitting just above the floating bar, with the scroller padded
  `14px 20px 170px` to clear it. The build puts the composer inline, as the last
  row inside the card, so it scrolls away the moment there is a conversation —
  the one control the screen exists for.
- The header subtitle **"Asks your leads, calendar and projects"** under the
  `<h1>Homes AI</h1>`. The build's subtitle is the privacy line instead.
- The design's four of five **TRY ASKING** chips. Design: *"Which leads should I
  call first?"*, *"How many meetings do I have on Friday?"*, **"Write a WhatsApp to
  Marco in Italian"**, *"Which follow-ups are overdue?"*, **"What is the payment
  plan of The Archive?"**. Build: *"Who should I call first?"*, *"Which of my leads
  have no next step?"*, *"What is my day today?"*, *"Which of my leads are going
  cold?"*, *"Which project do my leads ask about most?"*. Only the first survives
  in spirit. The two bolded above matter: one is the "write me a message in the
  client's language" case, the other is the "read it out of the project library"
  case, and they are the two things the brief says Emir AI is for.
- The **deep-link button inside an answer**. Every answer in the prototype carries
  one — *"Open the calendar"*, *"Open follow-ups"*, *"Start calling"*, *"Open live
  projects"*, *"Open attendance"*, *"Open Marco and WhatsApp"* — and it also
  pre-sets the destination's state (`hmFuTab=Overdue`, `hmLead=Marco Bellini`),
  which `phone-shell.md` §5.7 says becomes a URL parameter. The build's opening
  message promises it — *"I give you a link to the right page"* — but there is no
  conversation to check it in, and nothing in the page draws an answer-link.
- The empty-send behaviour: the design refuses with the `error` tone and the toast
  **"Type a question first"**.
- The design's opening line names the time: *"Hi Rocky. Ask me about your leads,
  your day or a project. I answer from the CRM, 14:55 today."* The build's drops
  the timestamp.
- The dial button pulses on this screen in the design (`class="fab"`,
  `fabpulse`); it is present in the build but the composer is not above it.

**Wrong in the build (broken at 390):** the input's placeholder is cut by the Ask
button — *"Ask about your leads, your da|"* with the orange button over the rest.
The field and the button are in the same row with no reserved space between them.

**Extra in the build:** the **New chat** button; a *"Homes AI tip for now"* black
card with **Open the list →**; the **WHAT IT CAN DO** block (six lines, four ✓ and
two ✗, including *"Prices, payment plans and handover dates come straight from the
project library. It leaves a figure blank rather than guessing, and it never
promises a return."*); the **YOU ASKED BEFORE** block (*"Nothing yet. Your own
questions are kept on this device, so you can ask one again."*). All four come from
the computer design `homes-ai.html`, so they are right to be there — they just
have no place in the phone design's ordering, which is header → messages → chips →
rule → pinned composer.

---

### `OwnerLive.dc.html` → `/v2/team-live` as owner

**Missing from the build:**

- The title. Design: `<h1>Team live</h1>` with *"Owner view · updated 10 sec
  ago"*. Build: the header says **"homes.me"** and a *"Live · 12:48"* pill.
- The **"Open TV mode"** button in the header (`aria-label="Open TV mode"`).
  Nothing in the build offers it. See the disagreement below.
- The **three KPI tiles**: `214 Call clicks today` · `104 WhatsApp clicks` ·
  **`5 Meetings booked`**. The build has Call clicks, WhatsApp clicks and
  **Telegram clicks** — *Meetings booked* is gone, which is the only one of the
  three that is an outcome rather than a click.
- The **stacked two-colour hourly chart** with its own legend (dark = Calls, light
  green = WhatsApp) and seven hour labels 9–3. The build draws one series at a
  time behind a `Calls | WhatsApp` toggle, so you cannot see the two together,
  which is what the stack was for.
- The **per-agent totals in the Right now list**: each row in the design carries
  *"52 calls · 24 WhatsApp"* under the name. The build's rows carry a doing-now
  phrase and a last-seen time; the numbers are only in the wide table below.
- The design's **five presence states as pills**: *"On a call · 3 min"*, *"In a
  lead"*, **"Power hour"**, *"Idle 34 min"*, *"Not checked in"*, each with a
  coloured dot on the avatar. The build has *"Going through leads"*, *"On their
  day"*, *"In the CRM"*, *"Away from the CRM"* — no "on a call", no idle duration,
  no "power hour", and no "not checked in" state in this list.
- The dark **"Attendance today"** card with four tiles — `6 In` · `1 Late` ·
  `1 Outside` · `2 Leave / absent`. The build has a white card with a stacked bar
  and a five-item legend (In office · Late · Outside · Leave · Not marked), which
  is a different thing in a different place.
- The **Emir AI line at the foot**: *"Emir AI: Shan has 31 untouched leads. Move 15
  to Nelson, who is free?"* The build has a Homes AI card, but at the **top** and
  about something else (*"86 leads are not touched yet · imported, back to Incoming
  tomorrow 09:00"*), and it does not name an agent to move work to.
- The agent-role block the design carries on every owner screen:
  *"Only for owners and admin / You are signed in as an agent. This page is not in
  your menu and you cannot open it."* with a **Go to My Day** button.

**Wrong in the build (at 390):** the "Today by agent" table is clipped at the right
edge — you see AGENT, DOING NOW and the first letters of CALLS, and have to scroll
the card sideways for WHATSAPP, TELEGRAM and LAST CLICK. The page itself does not
overflow, so this is a contained sideways scroll rather than a break, but it is
still a six-column table on a 390px screen, which `phone-shell.md` §5.4 says the
phone design does not do.

**Extra in the build:** the `Activity | Live | Messaging` owner sub-tabs; *"The
full report →"*; *"Of 4 signed in · 1 idle"*; the hourly chart's **now** marker and
*"Best hour 10:00"*; the per-metric deltas (*+12% vs yesterday*, *+8%*, *same*);
*"Counted again every 30 seconds"*; and a card the design does not have —
**"Calls marked 'not checked in'" · 2 · "Priya Nair called 2 leads at 09:12 and
09:18, before checking in at 09:24."**, which is the gate's consequence sentence
finally showing up somewhere an owner can see it.

`DISAGREEMENT:` **TV mode exists only on the phone.** `grep -ril "tv mode"
design/web/` returns nothing — the computer design has no such button, and neither
does the build. The phone prototype's button is `data-ui="act"`, i.e. a toast stub,
so even the prototype does not show what TV mode looks like. The computer wins, so
this drops unless Emir asks for it; it is listed because it is a whole feature that
exists in one design and not the other.

---

### `TeamActivity.dc.html` → `/v2/activity` as owner

**Missing from the build:**

- The title and subtitle: `<h1>Team activity</h1>` / *"Owner · who used the CRM and
  when"*. The build's header reads just **"Activity"**.
- The **"Profile" button on every Time-in-CRM row**, which opens that colleague
  (`hmCol` is set and the toast reads *"Open Meet the team to see Talha's
  results"*). The build's rows have no action at all — you cannot get from this
  screen to the person.
- The design's own phrasing for an agent who is not simply working: the `b` field
  is *"3 h 10 min · outside since 10:15"*, *"0 h 48 min · idle most of the day"*,
  *"on leave"*, *"not signed in today"*. The build has a time, a bar, first-seen,
  last-seen and a device, and says "Yousef on leave" only in the summary card —
  the row itself is four dashes.
- The **"Sign out" button on every Sign-ins row**, with the consequence spelled
  out in the toast: *"Talha was signed out of every phone and must sign in
  again."* The build has Sign out on rows that are signed in now, which is more
  careful, but the sentence is gone.
- The design's sign-in strings name the **install mode**: *"iPhone · Safari · Home
  Screen app · 08:55 · office Wi-Fi"*, *"Mac · Chrome · 09:03 · then phone
  outside"*, *"Android · 08:41 · a phone not seen before"*. The build has device
  and city but neither *Home Screen app* nor *office Wi-Fi* — and office Wi-Fi is
  the whole basis of attendance (§5.2).
- In the Review sheet, **"It was them · mark as OK"** and **"Sign out everywhere
  and reset the password"** as two equal buttons. The build has "It was them" and
  "Sign out everywhere", and `Activity.tsx:542` explains the omission: the endpoint
  does not reset a password and a button claiming it would lie. Correct call —
  but the design's sheet is two buttons and nothing else, where the build's asks
  for a typed reason first.
- The empty state **"Nothing unusual. All checked."**
- The footer line **"Today, Wed 11 Nov · until 14:55"**.
- The agent-role block (*"Only for owners and admin…"*).

**Extra in the build:** the dark hero *"Average time in the CRM today · 1 h 55 ·
per person who has worked today · 4 of 5"*; three summary cards (Most active /
Least active (working) / Not seen today); on Sign-ins, the sub-filters
`All · Signed in now · New device`, a **"This is you"** marker and *"The two
hundred most recent sign-ins, newest first."*; on Unusual, a written reason per row
(*"Priya Nair signed in from Philippines, which they have never done before."*), a
**"Phone Priya"** action, and a severity word (*"Look now"* / *"Needs a look"*).
All of that is from the computer design and is better than the prototype.

`DISAGREEMENT:` the computer design's Time-in-CRM table has **7 days** and **Leads
opened** columns and states the rule *"5 minutes without a click stops the
clock."* The phone design has neither column and no rule line; the build says
*"More than two minutes without the page checking in stops the clock."* Three
documents, three answers. `docs/v2/screens.md` already marks this row **Partly**
for the two missing columns. The number in the sentence needs to be one number.

---

### `OwnerMessaging.dc.html` → `/v2/messaging` as owner

**Wrong in the build, and it is the worst thing in this group:** at a 390px
viewport `document.scrollWidth` is **697**. `table.d-table.d-id-agents` is 651px
wide and never narrows, so the whole page scrolls sideways and every card sits in
the left 390px of a 697px canvas with grey beside it. The design solves exactly
this with `grid-template-columns:1.6fr repeat(5,minmax(0,1fr))` on each row — a
six-column grid that *does* fit 390. Measured offenders: `TH Reply rate` (100px,
right edge 478), `TH.d-t-right Links opened` (113px, right 591), `TH.d-t-right No
update` (106px, right 697).

**Missing from the build:**

- The title. Design: `<h1>WhatsApp &amp; Telegram</h1>` / *"Owner · today · no API
  needed"*. Build: **"Messaging"** / *"WhatsApp and Telegram taps"*. The design's
  subtitle is the point of the screen — these numbers exist *because* there is no
  WhatsApp API — and it is gone.
- The design's **four KPI tiles** in one row: `132 Taps` · `104 Confirmed` ·
  `41 Replied` · `27 Links opened`. The build has four cards stacked full-width,
  one per screen-height, so you cannot see them together.
- The **Emir AI line** naming the two agents with a problem: *"**Talha** tapped 30
  times but confirmed only 18, and 9 have no update. **Sultan** has 6 without
  update."* The build sorts the table by "no update" and offers a Remind button,
  but there is no sentence.
- The **"LINKS OPENED BY CLIENTS"** card's design wording: *"Marco Bellini opened
  The Archive brochure / Rocky · 21:14 · opened 3 times"*. The build has the same
  card with the lead name truncated to *"Marco Bellini · Brochu…"* at 390.
- The agent-role block (*"Only for owners and admin…"*).

**Extra in the build:** a `Today | Week | Month` range switch; percentages under
every number (*96% of taps*, *46% of confirmed*); a reply-rate bar per agent; the
**Remind** button with its explanation (*"Remind sends one notification with every
open question in it."*); the **"What the agents answered"** breakdown with a
stacked bar and seven outcomes; and the honest note *"The column records that a
client replied, not what they said — so 'interested' and 'not now' cannot be split
apart here."*

`DISAGREEMENT:` the phone design's table column is **SENT** and its counting rule
is *"**Sent**: agent was away 10 s or more and confirmed."* The computer design's
column is **Confirmed** and its rule is *"**Confirmed** · back in the CRM the
agent answers 'What happened?'."* The phone adds a 10-second away threshold that
the computer does not have. The computer wins; the build already follows it. Also:
the computer splits replies into *"He replied: interested"* and *"He replied: not
now"*; the phone's rule is only *"**Replied**: agent chose a reply result"*, and
the build says the split cannot be made.

---

### `OwnerFeedback.dc.html` → `/v2/settings/feedback` as owner

**Missing from the build:**

- The title. Design: `<h1>Feedback inbox</h1>` / *"Owner · bugs and ideas from the
  team"*. The build's page heading is right but the **app header above it says
  "Settings"**, and the back button goes to the settings hub, so on a phone the
  screen is announced as Settings.
- The design's **status vocabulary**: tabs `New · 3`, `Planned · 2`, `Fixed · 1`,
  `All · 6`, and a status pill reading **New** (amber), **Planned** (blue),
  **Fixed** (green). The build uses `Everything`, `Stopping somebody · 1`,
  `Not looked at · 1`, `On the list · 1`, `Done · 1`. Five chips where the design
  has four, and three different words for the three states.
- The **kind chip** — **Bug** (red) or **Idea** (purple) — on every card. The build
  shows an icon instead and never says which it is.
- The **"Plan it"** and **"Mark fixed"** buttons on each card, and **"Open again"**
  in place of "Mark fixed" once a report is fixed. The build has only **Answer**;
  there is no way to move a report's status from this screen.
- The toast wording that follows those buttons: *"Marked Planned · Talha was
  told"*.
- The reply **bottom sheet**: *"Reply about"* + the report title, a textarea with
  placeholder **"e.g. Thank you, we fix it this week"**, a **Send reply** button,
  and the toast *"Reply sent · they get a notification"*.
- The footer button **"Send all open items to the developer (file)"** and its
  result: *"File made · N open items with screen and phone model"*.
- The empty state **"Nothing in this list."**
- The agent-role block (*"Only for owners and admin…"*).

**Wrong in the build (broken at 390):** on the top (urgent) card the title column
is squeezed to roughly 60px by two pills on the same row — *"Stops them working"*
and *"Not looked at"* — so *"The call button does nothing on the lead page when the
lead has no project."* renders **one word per line** for eighteen lines, with the
first word under the red pill. Nothing wraps the pills to their own row.

**Extra in the build:** the banner *"1 person cannot work properly right now. Those
are at the top of the list."*; the route the report came from (*"on
/v2/leads/o-1"*) on every card; the owner's previous reply shown inline
(*"Emir Dulovic: Fixed — it scrolls sideways now."*).

`DISAGREEMENT:` the computer design (`feedback-inbox.html`) adds two things the
phone has not got — **"Every report gives the sender +15 points"** and an **Export
file** button — and lays the reports out as a table (`# · Report · Type · From ·
Urgency · Status`) with a detail panel holding a **screenshot** and a **0:18 voice
note**. The phone has a card list with inline actions and the file export worded
as *"Send all open items to the developer (file)"*. The computer wins, so the +15
points rule and the screenshot/voice-note attachments are owed; neither exists in
the build.

---

### `Import.dc.html` → `/v2/import` as owner

**The prototype's six steps, in order, and whether the build has them at 390.**

| # | Step | In the build | Usable with a thumb at 390? |
|---|---|---|---|
| 1 | **Upload** | Yes | **No** — two desktop columns side by side, each ~130px; the drop-zone text reads *"Drop your / Excel or / CSV file / here"* and the checklist reads *"Phone / numbers / with the / country / code, / for / example / +971 / 50 555 / 0101."* |
| 2 | **Columns** | Yes | Yes, but by native `<select>`, not the design's sheet |
| 3 | **Check** | Yes | Yes — stat tiles, radio cards, two explanation cards; all full width |
| 4 | **Give** | Yes | **No** — the heading *"Who gets the 208 leads?"* wraps one word per line, and the **Project** label and its select are drawn on top of the paragraph beside it |
| 5 | **Confirm** | Yes | Yes — a clean key/value summary and one primary button |
| 6 | **Done** | Yes | Yes, except the red **Undo this import** button overflows to 416px |

**Missing from the build:**

- **Step 1.** The design's file button carries the state in its own two lines —
  *"Choose an Excel or CSV file"* / *"From your phone, computer or Google Drive"*,
  becoming *"Nov_batch_C.xlsx"* / *"240 rows · 7 columns · tap to pick another
  file"*. The build has a drop zone that says *"or click to choose a file from this
  **computer**"* on a phone, and no Google Drive. The design's **"Up to 5,000
  rows"** limit and its **"Download the empty template ›"** link are both absent
  (the computer design has them too: *"Not more than 5,000 rows. Split bigger
  files in two."* and **Download the template**). The design's disabled primary
  button reads **"Choose a file first"**; the build's reads "Next: Columns" and is
  simply greyed.
- **Step 2.** The design taps a row to open a **bottom sheet** headed *"Column
  "Mobile" goes to"* with a 2-column grid of ten fields — Full name, Phone,
  WhatsApp, Email, Project, Country, Language, Budget, Note, **Don't import**. The
  build uses a 22-option native `<select>` per row. The design's instruction
  *"We matched your columns. Tap a row to change it. **Name and Phone must be
  matched.**"* becomes *"Tell us where each column of your file goes. We guessed
  for you."* The design's targeted errors — *"No column is matched to Full name.
  Tap a row and choose Full name."* — are not there, nor is the toast when a field
  is taken from another column: *""Whatsapp no" is now set to Don't import,
  because only one column can be Phone."*
- **Step 3.** The design's arithmetic line is spelled out as a sentence —
  *"208 new + 18 duplicates + 14 bad = 240 rows"*. The build draws it as
  `240 rows in the file = 208 new leads + 18 duplicates + 14 bad rows`, which is
  the same thing. The design's duplicate choices carry a judgement in the
  sub-line: *"Skip them / **Safest.** The lead stays with its agent, nothing
  changes."* and *"Import them again as new / **Not advised:** two agents may call
  the same client."* The build's sub-lines are neutral. The design's bad-row card
  gives the counts in one line — *"9 phone numbers too short · 3 with no name ·
  2 empty rows. **Nothing bad goes to an agent.**"* — and the last sentence is
  missing from the build.
- **Step 4.** The design's **"Project for these leads"** is a chip row —
  `From the file · The Archive · Shahrukhz · Damac Islands · Valia`; the build uses
  a `<select>`. The design shows a **toggle switch per agent** with
  `role="switch"`, a running header **"N AGENTS CHOSEN · = 208 leads"**, and a
  per-agent warning in the sub-line: *"57 open now · **already busy**"*,
  *"31 open now · **on leave today**"*, *"44 open now · **absent today**"*. The
  build shows "22 open now" and nothing else — an owner cannot see who is on leave
  before giving them seventy leads. The design's error is *"Pick at least one
  agent, or send them to Incoming."*; the build's is *"Choose at least one
  agent."*, dropping the way out.
- **Step 5.** The design's summary has six rows — File / Will be imported / Left
  out / Project / **Source on each lead** / Goes to — and the "Goes to" value is a
  sentence (*"Talha, Rocky, Yuliia · equal split"* or *"Incoming (you give them by
  hand)"*). The build lists File / New leads / Duplicates / Bad rows / Project /
  Source / Countdown / Goes to, which is close. Missing is the design's
  Incoming-case note: *"Nobody is notified now. Agents are told when you give the
  leads from Incoming."*, and the line **"Leads nobody calls in 24 hours come back
  to Incoming."**
- **Step 6.** The design's **per-agent result list** — `Talha +21`, `Rocky +21`,
  … and a **Total** row — is not in the build; it shows New leads / Already in the
  CRM / Skipped and bad rows instead, so you cannot see who got what. The design's
  **undo bottom sheet** is also missing: *"Undo the import of 208 leads?"* /
  *"Only leads nobody has called yet are removed. Agents get one notification."* /
  a red **"Yes, undo the import"** / **"Keep the leads"**. The build's Undo button
  has no confirmation step shown. The design's success line names the
  notification: *"9 agents got one notification each"* or *"They wait in Incoming ·
  nobody was notified"*.
- The **step dots**: the design draws six 28px circles, completed ones showing
  **✓**, the current one ringed. The build draws the same strip but it is cut off
  after step 3 at 390 and scrolls sideways; at step 6 it runs to 719px.
- The agent-role block (*"Only for owners and admin…"*).

**Extra in the build:** real file parsing with a real preview; per-column sample
values (*"Sara Ahmed · Omar Haddad"*); *"Name found" / "Phone found"* confirmation
chips; named duplicate examples with their current owner (*"Marco Bellini · +39 333
455 4821 — with Rocky"*); per-row bad-row reasons (*"Row 52 · Julia Stein — Phone
number is too short"*) plus reason counts; the repeated reassurance *"Nothing is in
the CRM until you press Import on step 5."*; a live progress line *"Importing… 161
of 240"*; **Download the rows that did not import**; and a dated undo deadline —
*"You can undo this import for 24 hours, until Sat 14 Nov, 08:53. Leads an agent
has already called stay in the CRM."*

---

### `Automations.dc.html` → `/v2/automations` as owner

**Missing from the build:**

- The design's subtitle *"Owner · rules that run by themselves"* (the build has
  *"Rules the CRM runs by itself, so no lead is forgotten."*, which is fine) — but
  the **app header above it says "Automations"** on this route while the Settings
  nav strip sits under it, so the screen has two identities.
- The take-back card's own sentence: *"If the agent does not call in time, the
  lead comes back to Incoming and the owner is told."* and the label **"VIP lead
  (if you did not choose a time)"**.
- The design's closing rule, which is the most important line on the screen:
  **"The CRM never sends WhatsApp by itself. It prepares the message; the agent
  presses send on his own phone."** Nothing in the build says it.
- Six rules the design lists that the build does not have:
  **"Hot lead alert"** (*"Owners are told when a lead is marked ready to book"*),
  **"Tell owners about duplicates"** (*"When an import or an agent hits a number
  that is already in the CRM (the check itself is always on)"*),
  **"No-show message ready"** (*"Prepares 'Sorry we missed you' · agent sends it
  himself"*),
  **"Late alert"** (*"Owner is told when check-in is after 09:10"*),
  **"Back from outside"** (*"Asks 'Are you back?' when office Wi-Fi is seen"*),
  **"Weekly attendance email"** (*"Monday 08:30 to owners"*, the design's only rule
  that ships off).
- The design's toast on every switch: *"Hot lead alert · on"* / *"· off"*.
- The agent-role block (*"Only for owners and admin…"*).

**Extra in the build:** an On/Off switch on the take-back rule itself (the design's
take-back rule cannot be turned off); a **"Taken back today"** card listing the
leads that came back with the reason (*"Shahrukhz · Bassam did not call in time ·
11:40"*) and an **Open Incoming →** link; a drawn working-hours bar
(`00:00 — 10:00 · clock runs — 19:00 · clock stops — 24:00`) with the real shift
times rather than the design's hard-coded 09:00–18:00; per-group counts
(*3 of 3 on*, *4 of 4 on*, *2 of 3 on*); four rules of its own —
*"Mark leads as 'going cold'"*, *"Remind the agent when a follow-up is due"*,
*"Red flag after 2 no-shows"*, *"Remind people to check in"*; and the footer
*"Times come from **Attendance rules**. Every change here is saved at once and
written in the activity log."*

---

### `Desks.dc.html` → `/v2/settings/desks` as owner

**Missing from the build:**

- The design's explainer sentence: **"When you import leads you can send them to
  one desk. An agent can be in more than one desk."** The build's footer says
  something else entirely (see the disagreement below) and never mentions the
  import link, which is the reason desks exist.
- The design's desk-card sub-line **"6 agents · max 60 open leads each"** and the
  **members line as a comma-joined list** under it (*"Talha, Rocky, Yuliia, Olga,
  Srdjan, Tej"*). The build gives each member their own row with a usage bar,
  which is better, but it is three or four rows per desk where the design has one
  line.
- The design keeps **Max open leads inside the edit sheet**; the build puts the
  40/50/60/80 segment on the card itself, so a thumb scrolling the list can change
  a desk's limit by accident.
- The design's sheet validation: **"Write the desk name."** and **"Choose at least
  one agent."** The build has the required marker on the name field; only the
  second message appears.
- The **3-column chip grid of all ten agents** in the sheet. The build lists agents
  as full-width rows — again better on a phone, but a different control.
- The design's delete toast: *"Desk deleted · agents and leads stay as they are"* —
  the sentence that says a delete is safe.
- The agent-role block (*"Only for owners and admin…"*).

**Extra in the build:** a summary card (Desks 3 · Agents on a desk 4 ·
*"Layla sits on 2"* · Over the limit now 1 · *"Omar 57 of 50"*) with a **Move
leads** button; per-member open/limit bars that turn red over the limit; and, in
the sheet, *"Also on Arabic desk"* under an agent who is on two.

**Correct, and worth recording because it is rare in this group:** the edit flow is
a real **bottom sheet with a grab handle** at 390 (`.d-dialog` turned into a sheet
by `v2-phone.css`), and **Delete is two-tap** — `settings/Desks.tsx:322` and `:490`
both render *"Tap again to delete"*. That is `phone-shell.md` §1.5 and the
two-step-destructive rule in §6, implemented.

`DISAGREEMENT:` the computer design says the limit is **enforced** —
*"An agent over the limit gets no new leads from 'Share equally' and from imports.
You can still give a lead by hand."* and *"Above this number the bar turns red and
new leads skip the agent."* The phone design says nothing about enforcement at all.
The build says the opposite of the computer: *"Nothing is blocked by this number
yet: sharing leads out and imports do not look at it."* The computer wins, so
either the limit starts skipping agents or the owner is told it is only a gauge —
but the three documents currently say three things.

---

### Notes on the method, for whoever rebuilds

- **`design/screens/support.js` is missing from the repository.** Every prototype
  loads `<script src="./support.js">` and it is not on disk, so the `sc-if` /
  `sc-for` runtime never runs: in a browser every conditional block renders at
  once and `{{…}}` bindings show as literal text. Screenshots of these files are
  therefore every state stacked. This audit reads the `<body>` and the
  `<script type="text/x-dc">` block instead, which is where the states and the
  wording actually live.
- **`data-ui="act"` is a stub**, not a behaviour: the shared handler turns the
  button's label into a toast (`/^send/ → 'Sent'`, `/^import/ → 'Import started ·
  agents will be notified'`). So "Open TV mode", "Send to Meta for approval" and
  "Send all open items to the developer (file)" exist as buttons with a name and
  nothing behind them. They are listed above as missing controls, not as missing
  features — what each one does still has to be decided.
- **The three overflow breaks found here** (`/v2/messaging` at 697px, import step 6
  at 416px, and the Chat header's name running under the window pill) would each
  have been caught by `npm run polish`. Whatever route list that check uses does
  not cover `/v2/messaging`, the import flow past step 1, or an open inbox thread.
