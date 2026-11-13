# The calendar and tasks: what I could not finish, and what I need from you

Eight things you found by hand are fixed. This is the short list of what I
could **not** build exactly as the design draws it, and the things that need
somebody else's hands. Nothing here stops the eight from working.

The decisions I took on my own are in `docs/decisions-to-confirm.md`, numbers
27 to 31 — a task with no time, the no-show red flag, the Telegram button, the
lead on a Follow-up, and the project on a booking.

---

## 1. The preview still answers the calendar with the old, shorter payload

`web/src/preview/mock-api.ts` is the stand-in server the preview uses — the one
in the panel beside the chat, and the one `npm run polish` drives. It answers
`/api/v2/calendar` with the payload the calendar used to need, and it has no
answer at all for the new addresses:

| What it is missing | What you see in the preview |
|---|---|
| `PATCH /api/v2/meetings/:id` | "Change day or time" does nothing |
| `DELETE /api/v2/meetings/:id` | Delete does nothing |
| `POST /api/v2/meetings/:id/receipt` | the booking form will not upload |
| the new fields on a meeting | no "Wants", no reminder, no no-show count |

**All four work against the real server.** The screen reads a missing field as
"not there" rather than breaking, so the preview is safe to look at — it just
cannot show those four things.

I did not touch that file because three other people are working in this
checkout at the same time and `mock-api.ts` is shared by every screen. It is
about twenty lines of work for whoever owns it next.

## 2. The clash warning only looks at the days on screen

"This time is taken" compares the new plan against the plans the calendar has
already loaded, which is the month, week or day you are looking at. Pick a day
outside that window — a plan in March while looking at November — and the
warning stays quiet.

It warns, it never blocks, so the worst case is a warning that does not appear.
Making it exact means asking the server on every keystroke, and I would rather
ask you first: **is a quiet warning on a far-off day worth a request every time
somebody changes the hour?** My answer is no.

## 3. The "+300 points" on "Booked a unit"

The design's tile says *"The lead moves to Won · +300 points"*. The lead really
does move to Won. The points are the Team Wall's, and the wall awards its own
points from its own rules when a deal lands — this screen does not add any, and
it does not say it has. The tile keeps the design's words because they describe
what happens, not what this panel does.

## 4. Two things on the Tasks screen that are not mine to change

Found while working, left alone:

- **The "Mine · The team" switch at the top right is cut off on a phone.** It
  runs about eight pixels past the edge at 390px wide, so "The team" reads as
  "The tea". It is the owner's control, it is not one of the eight, and it was
  there before this change.
- **The follow-up table has no Stage column and no row menu**, both of which
  `docs/v2/audit-2.md` §17 lists as not built. Also not one of the eight.

## 5. What the owner has to decide before this is finished

1. **The red flag** (`decisions-to-confirm.md` §28). The panel now promises one
   after two no-shows. Build it, or change the sentence.
2. **A task with no time** (§27). Leave it, or add the column.
3. **Whether a Follow-up needs a lead** (§30).

## A race in the server's meeting tests, found while checking this work

`server/src/http/routes/meetings.integration.test.ts` fails about one test in
eighteen, and **a different test each run** — once the sign-in itself ("Invalid
email or password" for a user created two lines earlier), once a request whose
cookie came back 401, once a 400 that arrived as a 401. Every one of them is
the users or sessions row not being there at the moment the request was served.

What it is not:
- Not the login rate limit. `max: 20` per five minutes, the file makes exactly
  20 sign-ins, and the limiter never logged a refusal during a failing run.
- Not account lockout. `login_attempts` is in `TRUNCATE_ORDER`, and no test in
  the file signs in with a wrong password.
- Not a password pepper. `createTestUser` hashes with plain bcrypt and no
  secret from the database.
- Not parallel test files. `vitest.config.ts` pins `singleFork: true` precisely
  because these suites share one database.
- Not the new test. The only change to this file was one added case, and the
  failures land on cases that predate it.

Run the failing test alone and it passes in 11.4 seconds. That eleven seconds
is itself worth a look: `resetTables()` truncates ninety-odd tables before
every single test, which is most of the suite's 182-second runtime and the
reason the thirty-second settings cache can expire in the middle of a file.

This is pre-existing and it is not a flake to re-run — it means a green
integration run cannot be fully trusted. Handed to its own agent to root-cause.
