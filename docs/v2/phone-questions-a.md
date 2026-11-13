# Phone build — group A's questions

*My Day · the owner's home · the dashboard · My leads · All leads · the lead
page · Notes · Add a lead · Incoming · VIP leads I gave · Pipeline · the
transfer sheet. Written while building the phone layout, 13 Nov 2026.*

Each line is one thing the design asks for that the build does not do, and
why. Nothing below was guessed at — where a number or a field does not exist
in the database, the screen leaves a blank rather than inventing one.

---

## 1. Numbers the server does not send

**"62 open · 12 to call today" under My leads.** `/api/my-leads/counts`
returns one count per tab — today, new, hot, overdue, no next step, VIP, lost,
all — and "all" includes Won and Lost. There is no open-lead count, so the
header reads **"124 leads · 100 to call today"**. Do you want an *open* count
added to that endpoint (all minus Won minus Lost), or is "leads" fine?

**"Emigeo Homes · all leads" under Dashboard.** The dashboard payload does not
carry the company's name, and hard-coding a brand into a screen is how a
rename becomes a week of work. The sub reads **"Every agent · lead totals are
always now"** — which also carries the half of the design's period sentence
that stops an owner misreading the page. Say the word and it becomes the
company name read from Books settings.

**The dashboard's "Team today" columns.** The design shows AGENT · LEADS ·
TOUCH · MTG · REPLY. The payload has open leads, calls, meetings, units and
overdue follow-ups per agent — there is no "touched within 2 hours" or
"average reply time" per agent. The phone shows **Agent · Open · Calls · Mtg ·
Overdue**. Worth adding touch-rate and reply-time per agent, or leave it?

**"the 3 most urgent shown" on Pipeline.** The board endpoint sends each
column's first page ordered newest first, not by urgency, so the line reads
**"the 6 newest shown"**. The design's wording would need the board to sort by
how late each lead is.

## 2. Whole features with nothing behind them

**VIP leads I gave (`/v2/vip`) — no hand-off list endpoint.** `vip_handoffs`
holds who gave it, who got it, the deadline, when it was accepted and when it
was refused. Nothing lists that table: `server/src/v2/vip.ts` only accepts or
refuses one by id, and `/api/v2/home` reads the single hand-off waiting for
the agent who is signed in. So the screen is built from
`/api/my-leads?tab=vip`, which an owner sees across every agent, and it shows
the state (Came back / Waiting / Called / Meeting / Offer / Won), who holds
it, and when they last spoke.

**What it cannot show:** "given 14:20 to Bassam", "Accepted in 2 min · called
in 5 min", "Not accepted yet · 24 min left of 30". An invented "accepted in 2
min" is a lie about an agent's work, so those lines are left out. A small
owner-only endpoint over `vip_handoffs` would give all three — shall I ask for
one?

**"Remind the agent" on a waiting VIP.** The only reminder endpoint is
`/api/v2/messaging/remind`, which sends "Tell us what happened after you
opened WhatsApp or Telegram" and refuses when there is nothing to answer.
That is a different message, so the button is not there. **"Give to another
agent"** and **"I will call myself"** both work (they reassign the lead).

**Notes — the transcript and the AI fields.** `Notes.dc.html` draws a voice
note with a **written transcript** and then *"Emir AI found these. Save to
lead?"* — budget, unit, payment and a task, each pre-ticked. Nothing
transcribes audio and nothing extracts fields from it, so neither is drawn.
Everything else on that screen is now real: the Notes tab on the lead runs the
working notes API — type chips, quick phrases, pin, edit, reminder,
attachments and hold-to-record voice notes. It had been saying "not built yet
· phase 4" while the endpoint behind it was complete.

**Notes — the four named folders.** Passport & ID (private, with a lock),
Booking forms, WhatsApp screenshots, Payment receipts. A note's file has a
name and a type but no folder or privacy flag, so there is no honest way to
draw those four boxes, or the line *"IDs are seen only by Rocky, managers and
owners. Every view is logged."* Do you want a category on an uploaded file?

**"Tap any line to edit" on the lead page.** Project, Unit, Budget, Purpose,
Timeline, Payment and Language are each a one-field edit sheet in the design.
Only contact fields can be written today (`PATCH /api/contacts/:id` takes
name, email, phone, language, country, city, notes); nothing writes the
opportunity's project, unit or budget. So the block is still read-only. Also:
**Purpose, Timeline and Payment are not sent by the lead endpoint at all**, so
those three rows are missing rather than empty.

**"In short:" — the AI summary on the lead page.** Not drawn; there is a
notes digest endpoint but nothing that writes the three-line summary the
design shows, and a made-up summary of a client is worse than none.

## 3. Where the two designs disagree, or the design asks for something the server refuses

**DISAGREEMENT · the lead page's title.** `Lead.dc.html` gives this screen no
page title at all: the header is the record — back button, stage pill, score
pill, then the name as an 18px `<h1>` with the phone number under it at
20px/800. The shell always draws a title and group A may not edit `Shell.tsx`,
so the header now carries **the lead's name** and **"New · Score 83 · with
Layla Hassan"**, and the title is brought down to 20px on this one screen so
that the phone number (36px) is still the largest text on it — your own
instruction. If you would rather the header said "My leads" again, say so.

**The phone number is now grouped on the lead page.** It printed
`+971501234567` and the calling screen printed `+971 50 123 4567`. The lead
page is the one an agent reads aloud, so both now group.

**A VIP lead can no longer be transferred from the transfer sheet.** The
server refuses it outright — *"A VIP lead cannot be passed sideways. Send it
back to whoever gave it to you."* — so the sheet used to show a form that
could only ever end in that error. It now shows the red note and a Close
button, which is what `TransferLead.dc.html` does.

**The lost reasons still differ from both designs.** The design's six are
Bought elsewhere · Budget too low · Just browsing · **Not into off-plan** ·
**Is a broker, not a buyer** · Other. The build's are Bought somewhere else ·
Budget too low · Only looking · **Never reachable** · **Changed their plans** ·
Something else. Two of them are different things, not different words, and the
reason is stored in the database and reported on — so changing them is your
call, not mine. Which six do you want?

**"Other" is missing from the lead-source chips.** The design's last chip is
**Other**, which reveals "Write the source". The server's source list is a
fixed set of nine values with no "other", and `manual` is already taken by
"Old client" (agent) / "Owner's contact" (owner). Adding it needs a new source
value. The owner's list is also missing **Old client** for the same reason.

**"Incoming" as a target when moving leads.** The owner can select rows on All
leads and move them to an agent — that works, one reassign per lead. The
design also offers **Incoming** as a target; there is no endpoint that
unassigns chosen leads (only `/api/v2/dashboard/move`, which sends *one
agent's whole* open list back). Left out.

## 4. One thing I did not change, and think you should decide

**An owner opening "All leads" lands on Today.** The owner's menu row says
"All leads" and goes to `/v2/leads`, which opens the Today tab — their own
follow-ups, not the 863-lead book. The All tab is one tap away and is now
built as the design draws it (agent chips, select-to-move, the move sheet,
the agent pill per row). Making the owner land on All is a one-line change,
but it changes the computer too, so I have left it alone.

**A) Owner and admin land on All leads** (recommended — it is what the menu
says) · **B) leave it on Today.** Which?

## 5. Two things that are broken wider than the phone

**The owner's "Team today" tiles have no styling at any width.**
`.d-mini-stats` is only defined under `.p-my-day` in the generated page CSS,
and the owner's home is `.p-owner-home` — so the four tiles rendered as one
run-on line, `2In office1Late1Outside1Not marked`. The phone is fixed here;
**the computer still shows it**, and the fix belongs in a file this group may
not edit.

**"Needs you now" has no second line.** The design writes each row as a title,
then *why it matters* — "Given to Bassam 14:20 · 30 min passed · back in
Incoming" — then the verb. `/api/v2/home` sends `{kind, text, n, action, to}`
and nothing else, so only the title is drawn. The second line is the half that
makes the row worth reading; it needs the endpoint to send it.
