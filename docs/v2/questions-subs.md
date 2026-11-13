# The line under the page title — what could not be built as drawn

*Written 13 Nov 2026 while giving fourteen screens the `data-sub` their design
file declares. Emir reads this; none of it is urgent and none of it blocks
anything.*

Every page in `design/web/*.html` puts a short line under its title — the date
and the shift on Attendance, "10 agents · 6 in office now" on Team. The shell
draws it; fourteen screens were not setting one, or were setting the phone
prototype's line instead. They all set one now, from
`web/src/v2/subs.ts`.

**The design's numbers are invented.** There are not really ten agents and
sixteen WhatsApp templates. Every number on these lines is now counted from
what the screen itself loaded, so Team reads "4 agents · 1 in office now" in
the preview and will read whatever is true on the day in the real CRM.
`web/src/v2/subs.test.ts` holds that: each line is built from a fixture and
checked against that fixture's own figures, and the design's numbers are
checked to be absent.

Four things need a word from you.

---

## 1. Add a lead — the line is set but the top bar will not draw it

`design/web/add-lead.html` puts "Name, phone and source are needed. The rest
can wait." under the title, and the screen now sets exactly that. **On a
computer it still shows nothing**, and the reason is not on this screen.

The top bar treats any address of the shape `/v2/leads/<something>` as an open
lead, and on an open lead it replaces the title with an "All leads" link back —
which, following the design's own rule, drops the sub-line with it. `/v2/leads/
**new**` matches that shape, so the Add-a-lead screen is being drawn as though
it were a client's record: no title, no line under it.

The design does not do that. `lead.html` is the only page in the package drawn
with a back link; `add-lead.html` has a title and a sub like every other page.

**This is a one-line change in the shell** (`web/src/v2/Shell.tsx`), which I
was asked not to touch in this piece of work, so I have left it. Until it is
made, `scripts/computer-proof.mjs` will keep listing `add-lead` as a page whose
line is missing. The phone is unaffected — it shows the line already.

---

## 2. Attendance — the end of the shift is not in the answer

The design asks for:

- agent: *"Wednesday, 11 November 2026 · shift 09:00 – 18:00"*
- owner: *"Wednesday, 11 November · shift 09:00 – 18:00"*

The date is now the real Dubai date, and the start of the shift is the real
one. **The end is not available to the screen.** `/api/v2/attendance/me`
returns when the shift starts and nothing else; the end of the day is stored in
the attendance settings and is not sent with it. Rather than print six o'clock
because the design says six o'clock, the line reads:

> Friday, 13 November 2026 · shift starts 09:00

**Do you want the full "09:00 – 18:00"?** If so the answer needs one more field
in it — a small change, in the server, that I did not make on my own because
adding a field is yours to approve. Say the word and it is ten minutes.

---

## 3. Best of Homes — there is no week and no deadline

The design asks for *"Week 46 · Mon 9 – Sun 15 Nov · ends Sunday 23:59"*.

The board does not work that way. It ranks points over a **rolling thirty
days**, so there is no week number, and nothing for a deadline to be the end
of — nothing resets on Sunday night. A countdown to a deadline that does not
exist is the worst of the three options. So the line gives the window the board
really uses, both ends off the Dubai clock:

> Points over the last 30 days · 16 Oct – 14 Nov

**Would you rather the leaderboard actually ran Monday to Sunday and reset each
week?** That is the bigger question underneath this, and it is a real choice —
a weekly reset makes the board a competition, a rolling thirty days makes it a
form. It is already noted in `phone-questions-c.md`; this is the second time it
has come up, which probably means it wants deciding.

---

## 4. Where the phone design and the computer design say different things

The two designs share one slot, so only one line can be shown and it shows on
both. **The computer design won every time**, which is the standing rule. These
are the ones where it changed what was on screen.

| Screen | The phone prototype said | What it says now (the computer design) |
|---|---|---|
| **Add a lead** | Name, phone and lead source are needed | Name, phone and source are needed. The rest can wait. |
| **Import** | Owner & admin · Excel or CSV | Excel or CSV · 6 short steps |
| **My digital card** | Your link and your printed card | Make your card in 3 steps |
| **Team wall** | Wins and news · 13 people | News and wins from the whole office |
| **Team live** | Owner view · updated 10 sec ago | What the team does right now |
| **WhatsApp & Telegram** | Owner · today · no API needed | WhatsApp and Telegram taps |
| **Inbox** | WhatsApp, email and notes in one place | WhatsApp and Telegram chats in one place · later phase |
| **Email** | *(the prototype is the email itself, not a screen)* | Email to clients from the CRM · later phase |
| **WhatsApp templates** | Messages agents send in one tap | 12 WhatsApp templates · later phase |
| **Help us improve** | Report a bug or suggest a feature | Bugs, problems and ideas go straight to the owners |

Three of those are worth a second look:

- **Inbox.** The computer design's line names **Telegram**, and the inbox does
  not carry Telegram chats — it carries WhatsApp, email and internal notes,
  which is what the phone line said. So the line is now the design's and is
  describing a channel that is not there and leaving out two that are. Say
  which you want; the phone's wording was the truthful one.
- **My digital card.** The old line also said which step you were on ("Step 2
  of 3"), which the design's does not. The stepper on the page shows that
  anyway.
- **Team live** and **Import** both lost a useful word — how often the live
  numbers are counted again, and that importing is owner-only. Both facts are
  still on the page itself.

Nothing here is a bug. If you read any of these ten and prefer the old
wording, it is one line each to put back.
