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

---

# Added 13 Nov, after the design pictures arrived

The owner's 59 phone pictures (`design/phone-shots/`) made a proper comparison
possible for the first time. What follows is from that pass: what I changed,
what the two designs disagree about, and what is still waiting on you.

## 6. Where the phone design and the computer design disagree

**"My Leads" or "My leads".** `Leads.dc.html` writes the title with a capital
L; `design/web/my-leads.html` writes "My leads". The computer is newer, so the
title stays **"My leads"**.

**The order of Add a lead.** The phone draws one card of name · phone ·
WhatsApp · Telegram · email, then "Project they asked about", then "Lead
source". `add-lead.html` draws **1 Who is it?** (name, phone, lead source) and
**2 More details · optional** (WhatsApp, Telegram, email, project, budget…).
The computer wins, so the two numbered cards stay. Only the header changed, to
the phone's small centred one.

**The transfer sheet's title.** The phone writes "Transfer this lead" with the
client's name under it. `lead-kit.js` titles the computer panel "Transfer
{name}". The build said "Transfer a lead", which is neither; it now says
**"Transfer this lead"** with the name under it.

**The transfer sheet's wording.** The phone asks "Who speaks the client's
language?" and "Why?"; the computer panel says "Language" and "Reason". The
computer wins, so those two labels are unchanged. The phone also puts a
**"See {agent}'s full profile ›"** link under every agent — that is not built,
because the panel is the same one the computer uses and a link inside each row
would change the computer too. Say the word and it goes in both.

**The Homes AI line on My Day.** The phone draws the AI tip as the last card
on the screen; `my-day.html` draws it as the first line under the title. The
computer wins: it stays at the top, now under the banner.

## 7. What changed on these twelve screens

- **My Day** — the date is now above the greeting; the banner carousel is at
  the top, under the greeting, with its dots; **"Turn on notifications"** is
  built (see §8); and **"Start calling · N ready"** now shows even when a VIP
  lead or the check-in card is holding the top of the screen, which it did not
  before — the only way into the call list was to go to My leads first.
- **The owner's home** — the date above the greeting; **"Add a lead and give
  it"** is the card the design draws, with "Type it once, pick the agent, mark
  it VIP" under it, and Import Excel · Incoming are a row of two under that;
  every "Needs you now" row has its icon and keeps its verb on the right
  (they were three stacked lines); "TODAY IN NUMBERS" names the block; Team
  today is four tiles across; and **"Team right now" is a list rather than a
  table** — its last two columns, Calls today and Last seen, were off the
  right-hand edge of the screen with nothing to say they were there.
- **The dashboard** — the small centred title with the round **Team live**
  button the design puts beside it; the totals card comes before the written
  brief, as the design has it; and the brief's rows no longer cut "1 lead
  transfers need your appr…" mid-word.
- **All leads** — an owner opening Leads on a phone now lands on **All**, not
  Today (see §4, still your call for the computer), with the design's small
  centred title and "Owner · N leads · every agent" under it. An agent who
  arrives on the Hot chip no longer sees the title "All leads".
- **The lead page** — the seven buttons are the design's two rows, Call ·
  WhatsApp · Telegram then Follow-up · Meeting · Won · Lost, instead of four
  rows of two.
- **Notes** — see §9.
- **Add a lead · Incoming · VIP leads I gave · Pipeline** — the design's small
  centred title on each. Incoming also reads the design's own sentence ("N free
  leads. Take one only if you can call it now.") in a card, and each lead now
  carries a "waiting 42 min" pill at the top right with the reason in a note
  box and the button full width under it, instead of a 26px number in a column.
- **Add a lead** no longer puts the cursor in Full name on a phone: the
  keyboard covered half the form before you had read a word, and the accent
  ring round an empty field read as an error.
- **The transfer sheet** — a VIP lead now says what the design says, and
  offers **Go to My Day**, which is where "I can't take it" lives. It was a
  dead end with only a Close button.

## 8. Turn on notifications — one thing I need from you

The card is built and it asks the browser properly. **But nothing can reach a
closed phone until the Firebase keys are set** (`SETUP_NEEDED.md` §12). Until
then, pressing "Turn on" asks the phone, and says plainly: *"This phone will
show alerts. Leads on the lock screen need one more switch from the office."*

Are the Firebase keys set on crm.homes.me? If they are not and you do not want
them yet, I would rather hide the card than have ten agents press a button
that half works. Which?

**A) Set the keys** (recommended — a VIP lead gives an agent 30 minutes and
this is the only thing that will wake them) · **B) hide the card until the keys
are in**.

## 9. Notes is a screen of its own in the design, and a tab here

`Notes.dc.html` is "Notes & files" with the lead's name under it — its own
screen with its own back button. In this build it is the fourth tab on the
lead page, and giving it an address of its own means editing files this group
may not touch. What I did instead: tapping a tab on a phone brings it to the
top of the screen, so Notes fills the phone the way the design draws it.
Do you want it as a real screen with its own address?

## 10. Two things the phone design has on My Day that this build has not

`Main.dc.html` ends with **"Meet your colleagues"** (a row of faces) and
**"Projects we sell now"** (a row of project cards with "24 my leads" on
each), plus an **"Overview"** heading over the four tiles and a **"Today's
calls · +240 points"** block with the streak. The team and the projects both
have whole screens of their own in this build and the strips would be a
summary of them; the points and the streak are on the hero already. Worth
adding to the bottom of My Day, or leave it?
