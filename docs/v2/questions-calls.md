# Recording every Call and every WhatsApp

*13 Nov 2026. What was wired on to the shared helper, what was deliberately
left alone and why, and the one thing that is still blocked. Written for the
next person who touches a Call button, and for Emir where a decision is his.*

---

## The fault

Emir found it on 13 Nov: **a call only counted if it was made from the dialler.**

`POST /api/v2/calls` and `POST /api/v2/taps` are where every figure he reads
comes from — calls today, WhatsApp clicks today, who has not rung anybody
since nine, the messaging report, speed-to-lead, the clicks-by-hour chart on
Team live, the "not checked in" card beside it, and the "going cold" rule that
decides which leads come back to him. Only `Calling.tsx` posted to them.
Everywhere else — the lead page, My leads, My day, the pipeline board, a
follow-up, a project's lead list — Call and WhatsApp were plain `tel:` and
`wa.me` links. An agent could spend a morning on the phone from the lead page
and the CRM would show that nobody had called anybody.

`web/src/v2/call.ts` is the one helper that fixes it: it asks the check-in
gate, writes the row, then opens the phone or WhatsApp. It was built and
tested (`web/src/lib/call-action.test.ts`, 16 tests) and nothing imported it.
This is the wiring.

## Wired

Each of these now goes through `useCallAction`, renders its `banner`, and
records before it hands over. Every one was pressed in a real browser against
the preview and the request seen going out.

| Screen | What was wired |
|---|---|
| `v2/Lead.tsx` | The big phone number at the top (it is a Call button — the design makes it the largest thing on the page for that reason), the Call button and the WhatsApp button |
| `v2/Leads.tsx` | The phone card's two round buttons, the table row's Call and WhatsApp, and the side panel's Call and WhatsApp |
| `v2/Home.tsx` | My day: the VIP hero's phone number and its "Call now", the due-now call rows, and the "good hour to ring" rows |
| `v2/Pipeline.tsx` | The kanban card's Call and the phone board's round Call |
| `v2/Tasks.tsx` | The follow-up Call, as `source: 'followup'` |
| `v2/Activity.tsx` | **Nothing — see below.** |
| `v2/Projects.tsx` | The Call in the project's leads table, and the send card's WhatsApp |
| `v2/Calendar.tsx` | The "sorry we missed you" WhatsApp in the no-show form |

Three things about how it was wired, so a later change does not undo them:

**The `href` stays on the element.** Every Call is still
`<a href="tel:…" onClick={…}>`, with the click taken over by
`e.preventDefault()`. The href is what a long press on a phone offers, and
what right-click-copy gives an agent who wants to paste a number into
WhatsApp Web. Taking it off to "force" the handler would lose both.

**One hook per screen, not one per row.** The helper's gate reads
`/api/attendance/today`, so a `useCallAction` inside `LeadRow` would ask for
it once per lead on screen — fifty requests on a list of fifty. The hook sits
in the screen component and the actions are handed down as a `dial` prop.

**The follow-ups tab had the gate and no recording.** `Tasks.tsx` asked the
agent whether they were in the office and then recorded nothing, so the answer
was collected and binned. Its own `useCheckIn` is gone; the helper owns the
gate there now, and asks once.

## Deliberately not wired

**`v2/Team.tsx` — colleagues' own mobiles.** Those Call and WhatsApp buttons
ring an agent, not a client. Filing them as client contact would put calls
nobody made to a lead into calls-today and into that agent's activity figures.

**`v2/Activity.tsx` — also a colleague.** This one was on the list I was given
as "Call from the feed", and reading the file it is not a feed of leads:
`/v2/activity` is the owner-only Team activity screen (`team-activity.html`),
and the Call sits on an *unusual sign-in* card — the owner ringing the agent
whose sign-in looked odd, on that agent's own number from the team list. Same
reason as Team, so it was left alone.

**`v2/Offers.tsx` — a share sheet with no recipient.** It opens
`wa.me/?text=…` with no number in it; the agent picks who to send it to inside
WhatsApp. There is nobody to file the tap against, and a tap row needs a lead.

**`v2/Projects.tsx`, the send card's Telegram button.** Its WhatsApp is on the
helper. Its Telegram deliberately is not: the helper opens `t.me/+<digits>`,
which is the lead's own chat but carries no message, because Telegram has no
`?text=` on that form. The whole job of that card is to deliver the link and
the sentence around it, so Telegram keeps the share-sheet URL that carries
both, and posts its own tap. One hand-rolled post left in the app, and this is
why.

**Anything under `web/src/pages/` or `web/src/components/`.** That is the live
v1 CRM and out of scope for this.

## Still blocked: the Call in the inbox

`v2/Inbox.tsx` has a round Call button in the thread header and it still
records nothing. A call is recorded **against the lead**, and the inbox's
payload (`server/src/http/routes/inbox.ts`) carries the conversation and the
contact — there is no lead id in it.

I did not add one, and this is the decision behind that. A contact can hold
more than one lead: the brief's own rule is that a fresh inquiry on a different
project becomes a second opportunity. The inbox list already picks "the
newest" for the stage pill it shows, and copying that for a call would mean
every call from the inbox is filed against whichever inquiry happens to be
newest. For a pill that is cosmetic; for a call it puts a call on the wrong
lead, and that is worse than a call that is missing — it moves the wrong lead's
stage, resets the wrong lead's "going cold" clock and credits the wrong
project.

**Emir, this is the one thing here that needs you:**

> An agent is in the inbox, in a chat with somebody who has asked about two
> different projects. They press Call. Which lead should the call go on?
>
> **A) The one the agent picks** (recommended) — when the contact has more
> than one open lead, the button asks "which one?" first. One extra tap on the
> rare chat, always right.
> **B) The newest one**, silently. No extra tap, wrong whenever the older
> inquiry is the live one.
> **C) Leave it as it is** — the inbox Call opens the phone and is not counted.
>
> A is a small change to the inbox endpoint plus a chooser; B is two lines.

Until that is answered the button stays as it is, and a call made from the
inbox is missing from the figures. `docs/v2/questions-bugs.md` carries the
short version of the same note.

## What holds it

- `web/src/lib/call-action.test.ts` — 16 tests on the helper itself: the gate,
  "call anyway", both field spellings, a failed recording still dialling, no
  gate before a tap, WhatsApp opening before the request is awaited.
- `web/src/v2/call-wiring.test.ts` — 36 tests that read the source of all
  eight screens: each takes the helper, each renders the banner, and **no
  `tel:` or `wa.me` is left in an element that does not call `dial.call` or
  `dial.whatsapp`.** It reads the source because a screen that quietly goes
  back to a bare `href` compiles, renders, looks right and is invisible to a
  green suite — the figures just go wrong again three weeks later. The same
  file also pins the three screens that are deliberately not wired, so
  changing one of them is somebody deciding rather than somebody tidying.
- `web/src/v2/pipeline-call.test.ts` and `web/src/v2/leads-call.test.ts` — two
  screens mounted for real with the buttons clicked, because the source tests
  prove the helper is wired in and cannot prove the wiring works.

## The preview

Two housekeeping items came with this job.

`POST /api/v2/calls` and `POST /api/v2/taps` **already had mock handlers** by
the time this work started (`web/src/preview/mock-api.ts`, beside the `PATCH`
pair), returning `{ id }` exactly as the real routes do. Nothing was needed;
every button below was pressed in the preview and not one of them showed the
helper's error line.

The mock's own timeline wording **is fixed**: it built `lead.assigned` titles
as `Assigned by language and project`, the phrase Emir asked to be gone, so a
screenshot of the preview still showed what had been removed from the product.
It now prints the two sentences `server/src/assignment/why.ts` writes, word for
word. The server module cannot be imported there — the preview is built from
`web/` alone — so the strings are copied with a comment saying where they come
from.

One thing noticed in the preview and **not** changed, because it is nobody's
bug report: the mock's My day always sends the VIP lead as `accepted: false`
and the accept POST does not flip it, so the VIP hero's "Call now" button can
never be reached in the preview. Its phone number, which is the same handler,
was pressed and recorded. Worth a line in the mock one day.
