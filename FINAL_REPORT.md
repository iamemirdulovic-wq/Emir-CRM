# Emigeo Homes CRM — what was built

30 October 2026 · 88 commits on `claude/new-session-krd7bx` · 2,699 tests green

Read this first, then `SETUP_NEEDED.md`. Everything in plain English; the
developer detail is in `docs/`.

---

## 1. Start here: it is not live yet

**Everything I built is finished and tested, and none of it has reached
crm.homes.me.** I found this at the end, while writing this report, and it is
the first thing you need to know.

The deploy is wired to run after the tests pass **on a branch called `main`**.
This repository has no branch called `main` — the work sits on
`claude/new-session-krd7bx`. So the deploy has never run: 87 pushes, 87 green
test runs, zero deploys. Nothing failed; the last step simply never fired,
and a step that never fires says nothing.

Nothing is lost. The whole build is in GitHub, tested, waiting.

**Fixing it is two clicks and it is your call, not mine** — either rename the
branch to `main` (then it deploys by itself from now on) or press **Run
workflow** once by hand. **`SETUP_NEEDED.md` §0** has both, click by click.
I did not do it myself because either one puts new code onto the server ten
people use, and that is yours to decide.

So: what the live site shows you today is **not** what is described below.

---

## 2. What was built

Seventeen steps. Each was tested and looked at on screen before being ticked
in `PROGRESS.md`.

**The foundation.** The design system — buttons, badges, pickers, phone and
money fields, bottom sheets, dialogs, empty states — all in one place, so a new
screen looks like the others for free. Sounds for a new lead, a win and a
notification, with a mute switch. The CRM installs on a phone like an app and
opens offline.

**Who can see what.** Six roles. An agent sees their own leads, a manager their
team's, you everything. That is enforced on the server for **every** endpoint
and every query — not hidden in the interface, where anyone could go around it.
Every change writes to the audit log: who, when, before and after.

**Getting leads in, once.** Meta, Google, your website, property-investment.ae,
WhatsApp, a spreadsheet, typed by hand — all land in one place, and the same
person never becomes two records. A test fires the same lead twenty times in
parallel and requires exactly one contact to come out — and that test now
really runs (see §7).

**The 5-minute rule.** A new lead is assigned instantly, round-robin, skipping
agents who are off shift, and preferring whoever speaks the language and knows
the project. If nobody has touched it in five minutes it moves to someone else
and you are told. If the CRM is off when the clock runs out, it catches up when
it starts and sends **one** summary, not seven alarms.

**Alerts that survive.** Push, email, and a bell inside the CRM. Everything is
written down before it is sent, so an agent whose phone was face-down still
finds the lead waiting. A failed push is a nuisance, not a lost lead.

**The day's work.** My Leads with the tabs an agent actually lives in, the lead
page with nine one-tap actions that each log what happened and move the stage,
and a panel at the top that says **what to do next** — which channel, when, and
whether to contact them at all. Those three come from rules, not from the AI,
so they work with AI switched off.

**Notes** on a lead, with the digest and the "what did we agree" line.

**Bulk import** that handles a hundred thousand rows in the background: map the
columns (the AI suggests the mapping), clean the phone numbers, check against
the CRM for duplicates, assign them, and get a report with the failures
downloadable to fix and re-upload. Imported leads deliberately do **not**
trigger the instant WhatsApp.

**Client email and campaigns.** Templates, merge fields, a signature from your
company record, open and click tracking, call campaigns with a dialler view,
and bulk WhatsApp that only ever goes to people who consented and only with
approved templates.

**Dashboards.** The agent's leads with instructions — up to six "do this now"
cards, ordered by what costs most to leave undone, each a button to exactly
those leads. Yours leads with what went wrong, then the numbers against
yesterday, then one line of good news. It does not congratulate you, because an
email that always opens "great work" gets filtered and then so does the one
that matters.

**Reports.** Source quality per ad, agent speed-to-lead, team activity, the
audit log, and a 9 AM Dubai morning summary where "yesterday" means the Dubai
day.

**Profiles and a business card.** Numbers that cannot be typed — deals,
viewings and speed are counted. Ten badges, none of which anybody can hand out,
because a badge somebody can give is a badge somebody can withhold. A public
card at `/card/{slug}` that is 14 kilobytes including the QR code, works with
JavaScript off, and is off by default.

**The Team Wall.** The CRM posts to it itself when a deal closes, so it is not
empty by the second week. Every points rule was written by asking what somebody
would do to win without doing the work: points are for outcomes, never
activity; nothing is paid twice; everything repeatable has a daily cap; posting
earns nothing. The streak ignores the weekend, because a streak that breaks on
Saturday is a streak telling people to work Saturday.

**Finding things fast.** Cmd+K finds any lead, screen or action. A phone number
matches from its right-hand end, so "050 123 4567", "+971 50 123 4567" and an
Arabic-numeral paste all find the same person. Keyboard shortcuts that go dead
inside a text box, so writing a note cannot ring a client mid-sentence. A
five-step tour, different for an owner than an agent.

**Emir AI**, where it earns its place: the lead verdict, the morning read, the
notes digest, column mapping on import, and the plain-language project search.
It is fenced: **every figure comes from a database query**, and any price, size
or date the model produces that was not in what it was given is **deleted in
code before it is stored** — because a prompt that says "do not invent figures"
is advice, not a rule. It never closes, deletes or sends anything.

**Your settings.** The company name, TRN, ORN, licence, address, numbers and
logo are now yours to change in **Settings → Company** — they used to be
written into the code, so changing your own company name needed me. They reach
every WhatsApp footer, email signature, offer and business card. The messaging
limits — quiet hours, how many messages a day, the pause after an agent writes
— are wired into the real send guard, and they are clamped: six a day is the
ceiling whatever is typed, and the night cannot be made shorter than four
hours. A number typed into a box must not be able to switch a guard off.

**The project library and sales offers** — the off-plan library with its KPI
cards and AI search, and the offer builder, client page and tracking.

---

## 3. What I found that you did not ask about

Four of these were doing real damage and nothing was reporting them.

**The pipeline had stopped being a board.** Two stylesheets both defined
`.board` — the kanban, and the Team Wall's leaderboard. The second one says
"stack these vertically", loads later, and had been quietly stacking every
stage one on top of the next since the wall was built. No error, no failing
test, and a screenshot of a stacked board still looks like a CRM. Two more of
the same shape: the bell notifications that mattered most rendered small and
bold instead of normal, and every internal note in the inbox sat 12 pixels too
low with a grey icon. Fixed, and **the build now fails** when two stylesheets
define the same plain class name — which caught my own first attempt at the
fix a minute after I wrote it.

**The new-lead alert sat on top of a button.** At the same height as the
toolbar's right-hand control, making that control unpressable on every screen
that has one.

**The lead page could be dragged sideways on a phone.** A seven-button action
bar is 795 pixels wide on a 390-pixel screen. It swipes now.

**The handover file told you to paste variables that do not exist.**
`EMAIL_API_KEY`, `MAXMIND_LICENSE_KEY`, four `FEATURE_*` switches and three
`VAPID_*` keys — nine names, none of them real, all written before the feature
was finished. You would have pasted them, pressed Restart, seen the feature
still off, and had no way to tell a wrong instruction from your own typing.
They are corrected, and **the build now fails** if any document names a setting
the server does not read, or leaves one out.

**Two people setting up the CRM at the same moment both became the owner.**
This one matters most. The very first account is created from a public page —
it has to be, because on managed hosting there is no terminal — and that page
is open until the first account exists. It was supposed to be impossible for
two to be created. CI had actually caught it once and then passed twice more,
so it was sitting in the history looking like a glitch. It is a race: the code
took a lock, let go of it a fraction too early, and the second request looked
at a table that still appeared empty. In practice: if someone else had hit that
page in the same second as you, they would have an owner account on your CRM
and nothing anywhere would have said so. It cannot happen now, and not because
the code is more careful — the database itself holds a single row that can only
exist once. I ran that test twelve times to be sure; the old code passed about
two runs in three, which is exactly why it went unnoticed.

**27 tables were never being cleared between tests.** Which means tests were
quietly handing data to each other, and a test that only passes because of the
one before it is a test that is not checking anything. Found by accident — I
added one small table and four unrelated tests went red. All 27 fixed, and the
build now fails if a new table is left out.

**The QR code on the business card had a real bug**, found by writing a second,
independent decoder and reading the finished grid rather than trusting the
encoder: the second copy of the format information is split seven-then-eight,
not eight-then-seven, and getting it wrong overwrote the one module that must
always be dark — which strict scanners check first.

I also ran every screen — 27 routes, two screen sizes, both themes, 108
combinations — through a real browser that fails on anything overflowing,
clipped or too small to tap, rather than looking at screenshots. That is
`npm run polish`, and you can run it again.

---

## 4. What I deliberately did not do

- **Emir Books.** Out of scope for this build, and not started. There is no
  CRM | Books switcher. Treat it as not begun, not half-done.
- **No `leads` table.** The CRM already splits a lead into the person and the
  enquiry, and every part of it is built that way. A second table holding the
  same person would be two sources of truth.
- **No birthdays on the Team Wall.** The CRM holds no date of birth, and
  starting to hold one so a wall can post a greeting is not a fair trade.
- **Web Push with its own keys.** Firebase is already wired and is Web Push
  underneath. Running both would mean two subscriptions per phone and two ways
  for an alert to go missing.
- **Deal values are hidden on the wall** unless you turn them on for a post.
  What a colleague earned is not everybody's business.
- **I did not deploy, and did not point the automatic deploy at my own
  branch.** See §1.

Every one of these, and about a hundred smaller ones, is dated and explained in
`DECISIONS.md`. Read it before changing something that looks odd.

---

## 5. What needs you

`SETUP_NEEDED.md`, in order. The short version:

| | |
|---|---|
| 🔴 §0 | **Get it deployed** — rename the branch, or run the deploy once |
| 🔴 §1 | **Delete the leaked Gemini key** and paste a new one |
| 🔴 §2 | **Change the database password** — it was in a screenshot |
| 🔴 §3 | **Point everything at crm.homes.me** — five webhooks |
| 🟠 §4–6 | Check backups are running · check it restarts itself · fill in Settings → Company, then re-submit the WhatsApp templates |
| 🟡 §7–10 | Brevo for email · Firebase for phone alerts · the form on homes.me |

Two to be careful with. The **Gemini key and the database password were both
shown in screenshots and must be treated as public** — anyone who saw them can
spend your money or read your data. And the SSH details from that screenshot I
have never used and never will.

---

## 6. If I carry on, this is the order I would take

1. **Get it live and watch it** — §0, then an hour watching the logs.
2. **Connect WhatsApp properly.** It is the one thing the whole product is
   built around and it is still recording messages as *not sent*.
3. **Delete `web/src/pages/Projects.tsx`.** It is the old library screen,
   replaced and now unreachable, and dead code is what rots next.
4. **Emir Books**, when you want it.

I had a fourth item here — "the 269 tests that have never actually run" — and I
closed it instead of handing it to you. It is how the owner-account bug above
was found.

---

## 7. The numbers

| | |
|---|---|
| Commits | 88 |
| Server tests | **2,332 passing, none skipped** — against a real MySQL 8 |
| Web tests | 367 passing |
| Type errors | none |
| Migrations | 25, every one additive — nothing drops a column or a table |
| Tables | 87 |
| Screens | 26, each checked at two sizes in both themes |
| Screens with a problem on the final pass | none |

**On that first row.** Until today every report I gave you said "the tests
pass", and what it meant was that 2,051 passed and 269 quietly skipped — the
ones that need a real database, which is to say the ones that test the
database. This machine has no MySQL, so I had been taking them on trust for
seventeen steps. It turns out it can install one. The first full run found the
owner-account race in §3 within six minutes. I should have done that on day
one, and the honest version of this report says so.

Six checks read the source code rather than trusting it, and every one of them
exists because it caught something real: hook order, the schema map, settings
auditing, class-name collisions, the documentation against the settings the
server reads, and the between-test reset against the schema.

---

**Is this right, or do you want changes?**
