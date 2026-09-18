# Changelog

All notable changes to the Emir CRM, newest first. One entry per build phase.

## The delete button, the columns you could not see, and the rest of the names

The owner opened the CRM and could not work with it: names still wrong, no way to delete
anything, and most of the contacts table missing. All three were real.

**Fixed — the name test only caught half of them**
- Yesterday's fix checked the whole value against a list of form answers. It never looked at the
  individual words, so every *combination* got through: "Yes Afternoon", "Tomorrow morning",
  "Next wrrk Week after", "Noon". Six of the ten names on the owner's screen were caught; four
  were not.
- There is now a vocabulary of *when* — today, noon, weekend, next, after, şimdi, amanhã — and a
  value is rejected when most of its words come from it. Proportional rather than absolute,
  because "Next wrrk Week after" has a typo in it and an all-words rule would miss it.
- A single coincidence is not enough, which is what protects the real names: "Dawn Morning",
  "Sunday Adelaja", "Sabah Al-Ahmad" and "Noon Alhaddad" are all people, and all still are.
  Ten out of ten of the owner's bad names now flagged, and every real name kept.

**Added — a delete button, which did not exist**
- `POST /api/lists/bulk-delete` had been written, permissioned and audited, and nothing in the
  interface ever called it. There was no checkbox anywhere on Contacts and no way to remove a
  contact through the UI at all.
- Contacts now has a checkbox on every row, a select-all in the header, and a bar showing what
  is selected with Clear and Delete. Delete asks for confirmation, states plainly that the
  conversations, tasks and history go too, and is owner-only — as it is on the server, which is
  where it counts.

**Fixed — the table was hiding five of its eight columns**
- At a 1000px window the contacts table needed 873px inside a 686px panel: Source, Owner, Score,
  Added and the link into the thread were simply off the right edge, with nothing on screen to
  suggest scrolling. "I cannot see anything" was an accurate description.
- Tables now carry a CSS-only scroll shadow that appears on whichever side has more to show —
  four gradients, two painted in the content's own coordinate space so they scroll away at the
  end of the travel, no JavaScript and no scroll listener.
- And the columns that earn their place on a wide screen give it up on a narrow one. Project,
  Source and Added drop away below 1280px and 1080px, leaving the name, the stage, the owner and
  the way in. Measured at 1000, 1180 and 1400px: nothing hidden at any of them.

**Fixed — a stale process nearly sent me the wrong way**
- Half an hour was spent believing the new name test had failed, because an older server was
  still holding port 4311 and serving the previous build. The test harness reported exactly the
  old code's score, which is the most convincing kind of wrong answer. Worth recording: check
  what is actually listening before believing a result.

**Worth knowing about the imports screen** (no change made)
- The same file appears six times because it was uploaded six times. The first run created 503
  contacts; every run after that found them already there and counted them as updates. That is
  also why Undo offers nothing — it only removes contacts an import *created*, and by the sixth
  run there were none.
- The 32 skipped rows are the header lines each stacked form brought with it: "full name",
  "whatsapp_number", "numero_whatsapp". Correctly rejected, and the reason names the value.

**Verified** in a browser against the real contacts from the live CRM: 10 of 10 bad names
flagged with a reason each, 5 real names untouched, two contacts selected and deleted (15 → 13),
select-all reaching 13, and the table measured at three widths. 675 server tests, 86 web tests.

## Names that were not names

**Fixed — the importer took form answers as customers' names**
- The first live import produced contacts called "2pm / 6pm", "Katalog", "0.75", "Şimdi" and
  "I am on holiday till 25.05 and have time. From 9 am to 8 pm ( Cyprus time)". The export was
  several Meta forms concatenated, so the column holding a name for the first few hundred rows
  held the answer to a question for the rest. The importer chose the column once, from the top
  of the file, and then trusted every value in it.
- This is the same raggedness that ate the phone numbers a fortnight ago. That fix looked at
  the phone column only; the name column had nothing but an eight-word list of placeholders
  guarding it.
- Each value is now checked on its own. When the mapped column holds an answer, the neighbouring
  columns are searched for a real name — which recovers the rows where the name simply moved one
  column over — and if there is nothing name-shaped anywhere the name is left empty. The inbox
  already falls back to the phone number, which is what an agent needs in order to ring someone.
- The row is never rejected over a bad name. Every one of those contacts is a reachable person.

**Fixed — and the answer is kept, because it is worth more than the name was**
- "I am on holiday till 25.05, 9am to 8pm Cyprus time" is not a name, but it is the single most
  useful line in that lead's record. The discarded value goes onto the contact's timeline rather
  than into the bin.

**Added — a screen for the contacts already in the database**
- The importer no longer creates these, but 500-odd leads were imported before the fix. A
  "13 names to fix" chip on Contacts opens a list of every suspect name with the reason it was
  flagged, and one button clears them all.
- Deliberately not a migration that runs on start. Rewriting a column across every contact in a
  live CRM, silently, at deploy time, is the kind of thing that is only noticed when it was wrong.
  A manager reads the list and presses the button; every change is audited.
- Re-checked at the moment it is applied, not trusted from the request: between the list being
  read and the button being pressed, an agent may have typed the customer's real name in. That
  guard is what stops the feature destroying the thing it exists to produce.

**How the test decides**
- Built as a rejecter of things that are definitely not names, not a validator of things that
  are, because the two mistakes are not equal. A bad name goes out in the WhatsApp template as
  `{{1}}` — "Hello Katalog, thank you for your interest" — while a rejected good name costs
  nothing permanent.
- Catches digits, punctuation that names do not carry, keyboard mashing, sentences, and form
  answers in English, Portuguese, Turkish, Arabic, Russian and Spanish.
- Every real name from the import survives: "Paulo de A. L. Neto", "Brother Calvin-Cía",
  "أحمد الهاشمي", single-word names like "Ahmed", and a seven-word formal Arabic name. Two of
  those were false positives in the first draft, caught by the tests: "Didi" was read as
  keyboard mashing, and a word-count rule rejected a long Arabic name. The word count is gone,
  replaced by a check for pronouns and verbs — which never appear in a name, where the particles
  that make names long (de, van, bin, al) always might.
- Guessing from an unmapped column is held to a tighter standard than the mapped one: a wrong
  guess invents a customer out of an answer, and nobody ever notices. "Nothing useful here" and
  "Not interested" both got through the first version.
- One limit worth stating: a single made-up word cannot be told from a name. "Hwmen" is kept.

**Fixed — a route that could never have been reached**
- `GET /api/contacts/name-review` was declared after `GET /api/contacts/:id`. Express matches in
  definition order, so the router answered it by looking for a contact whose id is the string
  "name-review".

**Fixed — layout**
- A long value in the review table stretched its cell and overlapped the column beside it.

**Verified** in a browser against the real names from the live CRM: 13 flagged with the correct
reason for each, 10 real names left alone, the list empty afterwards and the contacts showing
their phone numbers. Arabic was checked end to end after mojibake appeared in a test — the
corruption was the `mysql` CLI connecting as latin1, not the CRM, which round-trips
"أحمد الهاشمي" correctly on both read and write. 653 server tests, 86 web tests.

## The task manager

**Added — creating, editing and finishing work without a page reload**
- An Add / Edit dialog with title, description, priority, type, due date and time, and —
  for managers — who it is assigned to. One dialog for both, because the fields are
  identical and two would drift apart.
- Every change is applied to the screen before it is sent: adding, editing, ticking off,
  reopening and deleting. A task appears in about a quarter of a second rather than
  waiting on a round-trip. When a request fails the row goes back exactly as it was and
  says why — the half of "optimistic" that is easy to skip and the only half that makes
  it safe.
- The filter chips move with the rows. One task can be counted twice, since an overdue
  task is also open, so the arithmetic lives in one tested place; the delete and revert
  paths use the same numbers negated, which is what stops "Overdue 3" appearing above a
  list of four.
- Agents may only make work for themselves. Managers may assign within their team. A
  colleague's task reports "does not exist" rather than "forbidden", so the endpoint
  cannot be used to find out who has what.

**Added — files on a task card**
- Drag and drop or pick photos and PDFs, with image thumbnails rendered on the card
  itself. Images open inline, everything else downloads.
- Allow-list, not block-list: JPEG, PNG, WebP, GIF and PDF. SVG is excluded although it
  is an image, because an SVG is a document that can carry script and serving one from
  the CRM's own origin would run that script with the session cookie in scope.
- The file on disk is named after its row id, never after anything the uploader typed,
  and every read or delete checks the resolved path is inside `UPLOAD_DIR` first.
- Attachments are served through the task's own permission check, never statically: a
  guessable URL would make every file in the CRM readable to anyone who found one link.
- Deleting a task takes its files with it; the hourly maintenance job sweeps up any bytes
  whose rows have gone.

**Added — a calendar beside the list**
- Month, week and day. Month is a real seven-column grid, always six weeks so the page
  does not change height as you page through the year. Week and day are a row per day,
  because a 60px column cannot show a task title.
- Monday first: the UAE working week has run Monday to Friday since 2022, and a calendar
  starting on Sunday puts the weekend in the middle.
- The range asked for ends at midnight the day *after* the last one shown, so a task due
  at 23:59 on the final day is inside it rather than invisible.

**Added — deadline reminders by email**
- A sweep every five minutes emails whoever owns a task shortly before it is due. Swept
  rather than scheduled: a job queued at creation time would be wrong the moment somebody
  moved the deadline, and could never catch up on a task whose moment passed while the
  worker was down.
- The row is claimed before the email is attempted, so a slow SMTP server cannot cause a
  second sweep to send the same nudge again. Moving a deadline or reassigning the task
  clears the claim, so the new owner and the new time still get their warning.
- These are internal emails to staff, so they deliberately bypass the lead-messaging
  guards: consent, DNC and quiet hours protect leads, not the people who work here.

**Fixed — "today" meant today in UTC**
- Timestamps are stored and read as UTC, so the Tasks screen asked `DATE(due_at) =
  CURDATE()` and got a UTC answer. Between 20:00 UTC and midnight — the small hours of
  the next morning in Dubai — that is a day behind: an agent opening the app at 1am was
  shown yesterday afternoon's tasks and none of the day ahead.
- Both sides of the comparison are now shifted into Dubai, matching how the dashboard
  already buckets its daily counts. A test pins the boundary, and fails against the old
  query.
- The calendar grid buckets by the Dubai day for the same reason. Everything else in the
  CRM renders Asia/Dubai, so a browser-local grid would have drawn a task on the 17th
  while the row beneath it read "18 Sept" — one screen, two answers.

**Fixed — a file with a non-English name could not be downloaded**
- HTTP header values are Latin-1. An attachment named in Arabic, or with an em dash
  pasted from a listing, produced a `Content-Disposition` Node refuses to send, and the
  download returned a 500. In a Dubai brokerage that is not an edge case.
- Now RFC 6266: an ASCII `filename` every client understands plus a UTF-8 `filename*`
  that modern ones prefer, so the real name reaches the disk. Verified with an Arabic
  filename end to end.

**Fixed — layout**
- The task row's controls dropped onto their own line at phone width instead of being
  squeezed between the text, which had been wrapping titles two words to a line.
- The toolbar wraps on a phone; "Add task" had been cut off the right edge.
- A `pill due` badge was picking up `margin-left:auto` from an older `.task .due` rule
  and drifting to the far edge of whichever row it landed in.
- The attachment remove button is always visible on touch devices, which have no hover.

**Verified** in a real browser: adding, ticking off, reopening, editing and deleting a
task, with the filter counts checked after each step and against the server after a
reload — zero page reloads throughout. 590 server tests (16 for the task manager, 8 for
the header encoding), 86 web tests (32 for the calendar's date maths, 22 for status and
counts), month/week/day and phone layouts screenshotted.

**Needs the owner** — deadline emails only send once `SMTP_HOST` is configured.

## The move-stage menu, cut in half

**Fixed**
- The menu for moving a card to another stage was positioned inside the card. The card
  sits in `.col-body`, which scrolls vertically, inside `.board`, which scrolls
  horizontally — so the menu was clipped by both, and on a card in the first column it
  also ran off the side of the screen. Half the stages were unreachable.
- It renders into `document.body` now, fixed-positioned from the button's own rectangle,
  which puts it outside every scroll container. `placeMenu` keeps it on screen: pulled
  back from either edge, opened upwards when there is no room below, never taller than
  the space there is, and aligned to the mirrored edge in Arabic.
- Closed on scroll and resize, because a fixed menu does not travel with the column it
  was opened from and would otherwise hang in mid-air.

**Verified** in a real browser at 1280×800 and at phone size: the menu is fully on screen
for a card in the first column, a card further along, and on mobile. Eight placement
tests cover the cases that are awkward to reach by hand — both screen edges, no room
below, and a right-to-left layout. 574 server tests, 32 web tests, 18 browser steps.

## The first real import, in full

**Fixed — a fresh install had no pipeline, so every import failed**
- The browser setup screen created the owner's account and nothing else. The pipeline,
  its stages, the workflow definitions, the tag namespaces, the Meta field map and the
  round-robin cursor were only ever created by `npm run seed` — a command the whole
  no-terminal deploy exists to avoid. So the first import into a live CRM failed all 535
  rows with `Default pipeline "offplan_sales" is not seeded`, which is true and useless.
- That data is not the owner's; it is what the product is made of. `seedReferenceData`
  now runs on every start, before the server listens. Every step was already idempotent,
  which is what makes that safe.

**Fixed — a ragged file lost a quarter of its leads**
- The export turned out to be several Meta forms stacked together, each asking different
  questions, so the column holding a phone number in one block held a name in the next.
  152 reachable people were rejected with `"Angie Sandridge" is not a valid phone number`.
- When the mapped column yields nothing usable, the importer now looks through the columns
  nobody mapped for a value libphonenumber accepts as a real number for the chosen region —
  and likewise for an email address. Strict on purpose: a budget, a row id or a year must
  never become a number an agent rings.

**Fixed, caught by its own test**
- The fallback found the number and then threw it away: the raw value was still what got
  passed on, so those rows would have been created with no phone at all — reachable in
  principle, unreachable in fact, and silent about it.

**Verified against the owner's own 535-row file**
- Before: 370 created, 165 rejected. After: **502 created, 32 skipped, 1 failed.**
- What is still rejected should be: 19 duplicates within the file, 6 rows with neither a
  phone nor an email, and the half-dozen embedded header rows the concatenation left
  behind — `whatsapp_number`, `full name`, `please_share_your_valid_whatsapp_number…`.
- 574 server tests and 24 web tests green. The uploaded file was deleted afterwards.

## Live, and the first real file

**Fixed — a real Meta export could not be imported at all**
- The reader took row 1 as the header, always. A 535-lead export arrived with the campaign
  name alone in A1 and **no header row underneath it** — so the wizard showed one column
  called "SKY Flame - Portuguese", refused the import for want of a phone or email, and
  would have eaten the first lead as a header had it got that far.
- `chooseHeader` now reads the first ten rows before deciding: it skips title and blank
  lines, which are recognisable because the rows beneath them are wider, and detects that
  a file has no headers at all when its first row already carries an email address, a
  phone number, or mostly digits. The rules only call a row "data" on evidence a label
  would never carry, because the errors are not symmetric — mistaking a header for data
  costs one junk row an agent can delete, while mistaking data for a header swallows a
  lead and misnames every column after them.

**Added — mapping by values, for files whose names cannot help**
- Columns named "Column 1"…"Column 9" are honest and useless, so `inferMappingFromValues`
  reads the values instead: a column of email addresses is an email column whatever it is
  called. Only email, phone and full name are inferred, because those three decide whether
  an import is possible at all; a wrong guess elsewhere would be quietly wrong.
- It claims each field once. The export carried the same phone three times — raw,
  `p:`-prefixed and formatted — and mapping all three would have had the last silently
  overwrite the first.
- A real column name still wins over a guess: an agency's own "Mobile No." is better
  evidence than a sample of twenty rows.
- The wizard now says when a file had no header row, so numbered columns read as an
  explanation rather than a fault.

**Fixed**
- `\W` is ASCII-only even under the unicode flag, so the first name test rejected every
  Arabic, Cyrillic and Chinese name. A CRM selling Dubai and Abu Dhabi off-plan cannot
  have a name test that only passes Latin script. It uses `\p{L}` now, with a test.
- Merging the value-inferred mapping with the name-matched one erased it: a header matcher
  returns an entry for every column, `null` where it recognised nothing, and spreading
  that over the inference wiped every guess. Found by running the owner's own file through
  and seeing every column come back unmapped.

**Verified**
- Against the real 535-lead file: title row skipped, nine columns named by position, the
  first lead kept, and name, email and phone mapped automatically with the duplicate phone
  columns left alone.
- 568 server tests and 24 web tests green.

**Worth knowing**
- That file's numbers are Portuguese (+351), and some rows omit the country code. The
  import's phone region defaults to AE, so it must be set to PT on the Settings step or
  those numbers become UAE ones.

## Phase 14 (in progress) — Deploying itself

**Added**
- **`.github/workflows/deploy.yml`** — the repository deploys itself. It runs after CI
  passes on `main`, or on demand, and does the whole thing: build, upload, install,
  migrate, switch the `current` symlink atomically, restart under pm2, health check, and
  roll back to the previous release if the new one does not answer. It keeps the last
  five releases. No third-party actions: plain `ssh` and `scp`, so the deploy trusts
  nothing but GitHub and the server.
- **`deploy/server-setup.sh`** — one-time server preparation, safe to re-run. It refuses
  early and says why if Node is missing or too old, installs pm2, builds the
  `releases/ current/ shared/` layout, and writes `shared/.env` with a freshly generated
  `ENCRYPTION_KEY`. It never writes a database password: those stay on the server.
- **`deploy/ecosystem.config.cjs`** — the API and the worker under pm2, both fed from
  `shared/.env`, which the config parses itself because the app deliberately reads
  `process.env` only. `UPLOAD_DIR` is pointed at `shared/`, so import files survive a
  deploy instead of vanishing with the release that received them.

**Fixed, found by rehearsing the deploy**
- **`node dist/db/migrate.js` did nothing and exited 0.** The entrypoint check was
  `process.argv[1].endsWith('migrate.ts')`, which is false once the file is built as
  `migrate.js`. The first production deploy would have reported success and started the
  app against a completely empty database. `seed.ts` and `demo.ts` had the same check.
  All three now use `isEntrypoint(import.meta.url)`, which compares basenames without the
  extension, and it has its own tests.
- `npm ci` validates the lockfile against every workspace in the root `package.json`, so
  the release has to carry `web/package.json` even though the server only serves that
  workspace's built output. Without it the install failed on the server.
- Two shell bugs in my own workflow that would each have failed a deploy that had already
  succeeded: `grep | cut` under `pipefail` when `PORT` is absent, and
  `[ cond ] && continue` under `set -e` in the release-cleanup loop.

**Verified**
- The release was packaged exactly as the workflow packages it, extracted into the real
  directory layout, installed with `npm ci --omit=dev`, migrated against an empty MySQL
  (42 tables, 5 migrations), seeded, started in `NODE_ENV=production`, and driven through
  the browser suite: 17 steps pass, 1 skips for want of a conversation in a freshly
  seeded database. HSTS and the CSP were confirmed on the live response.
- 530 server tests and 24 web tests green.

**Added, after the hosting answer came back**
- Hostinger Cloud runs Node, but one process per application: no PM2, no second
  process, no background workers. `WORKER_IN_PROCESS=1` puts the worker inside the API
  so the follow-ups still run. `/health` reports where it is, so the keep-alive ping
  doubles as the check that it is there at all.
- `npm start` is now `scripts/start.mjs`: it builds if there is no build, migrates, then
  starts. Managed platforms differ in whether they run a build step, and this stops that
  difference from mattering. Proven from a clean checkout — no `dist`, empty database —
  to a serving site with 42 tables, in one command.
- `docs/GO-LIVE.md`: six steps with every value already filled in.

**Added, so there is no terminal in the deploy at all**
- **First-run setup in the browser.** `npm run seed` needed a console, and managed
  hosting may not have one. While the `users` table is empty the sign-in page hands you
  a setup screen instead; you create the owner account and are signed straight in. The
  server refuses the endpoint the moment any account exists, so the window is open only
  while an attacker and the owner are in the same position: the CRM holds nothing yet.
  Six simultaneous submissions produce exactly one owner — a named lock, because an empty
  table has no row to lock.
- The setup screen also generates an `ENCRYPTION_KEY` to copy into the hosting panel, per
  request and never stored. That was the last thing that needed a command line.
- Built on the login screen's own markup, so the first thing a new deployment shows looks
  like the product rather than a wizard bolted to the side.

**Fixed**
- Test files were compiled into the production build, so a test that did not typecheck
  would fail a deploy of code that was perfectly fine — and ship test helpers to the live
  server. `tsconfig.build.json` excludes them; `npm run typecheck` still covers them,
  which is where a broken test belongs.

**Fixed, found on the first real deploy**
- `npm run build` died on `tsc: command not found` the moment the environment variables
  were added. `NODE_ENV=production` makes npm omit devDependencies — which is where
  TypeScript and Vite live, correctly, since they build the app and are not needed to run
  it. So the platform installed, set NODE_ENV for the build too, and the build failed with
  everything configured exactly right. `scripts/build.mjs` now fetches the build tools
  when they are missing and is a no-op when they are not. Reproduced by installing with
  `NODE_ENV=production` — 252 packages, no `tsc` — and then fixed against that same tree.

**Still needed from the owner**
- Confirmation that the Hostinger plan can run a Node.js process — see
  `docs/HOSTING-CHECK.md`. Everything above is written for a plan that can; if it cannot,
  the hosting changes before any of it runs.
- The four GitHub secrets, and the database created in hPanel.

## Phase 13 — Hardening and the security pass

**Fixed — permissions on the Phase 12 surface**
- A power-dialler card can only be worked or handed back by the agent it belongs to.
  `logOutcome` and `releaseMember` both take the caller's scope; previously an agent
  could log an outcome on, or release, any card whose id they knew — including a
  colleague's live call.
- Campaign statistics are filtered for agents, who now see their own row rather than the
  whole desk's numbers.
- Adding and removing list members is manager-only, and the contact ids are narrowed to
  what the caller may see before anything is written. The bulk endpoints report
  `requested` and `applied` so the UI can say when a selection was trimmed.
- Undoing an import needs `admin` plus the `bulk:delete` permission: it deletes contacts,
  and the specification keeps bulk deletion with the owner and admin.
- `GET /api/users` returns only what an agent needs to render an assignee — id, name,
  role, active, availability — and their own row for the rest. Colleagues' email
  addresses are no longer part of the payload every screen loads.

**Fixed — a manager could not see their own desk**
- Visibility read `users.manager_id` only, while Phase 12's desks name their manager on
  the team. A manager put in charge of the Arabic desk, but not set as each member's
  manager, saw an empty board — and saw it silently, because every query simply returned
  fewer rows. `visibleUserIds` is now the union of the reporting line and the desks the
  viewer manages, taken once so no caller has to remember it. An inactive desk, and a
  desk somebody else runs, still count for nothing.

**Fixed — a production trap**
- The `log` WhatsApp provider writes messages to the console and reports success. On a
  live server that is the worst possible failure: the inbox shows a welcome message, the
  agent believes the lead has been contacted, and nothing was ever sent. The server now
  refuses to boot in production on that provider unless `ALLOW_FAKE_WHATSAPP=1` says the
  owner means it — and with the flag on, sends are recorded as failed with
  "Not sent — WhatsApp is not connected yet. Call or email this lead instead."

**Added**
- **A real Content-Security-Policy.** Nothing sits in front of the app on Hostinger, so
  it is set here: `script-src` is self plus the hash of the one inline script, which is
  computed from the built `index.html` at boot so the policy follows the file instead of
  drifting from it. `object-src 'none'`, `frame-ancestors 'none'`, `base-uri` and
  `form-action` pinned to self. HSTS is sent in production and omitted in
  development, where a pin on localhost outlives the reason for it.
- **The server refuses to start in production without `COOKIE_SECURE`.** Without it
  the session cookie rides plain http, and one café network is all it takes. It was on
  the deploy checklist; a checklist is not a control.
- **Upload retention.** An import's file is deleted once its undo window closes, and an
  abandoned upload after a week. The sweep refuses any path that does not resolve inside
  `UPLOAD_DIR`, so a tampered row cannot turn it into an arbitrary delete. It runs inside
  the hourly `maintenance.cleanup` job, which also now actually calls `pruneCronKeys` —
  it was written in Phase 5 and never wired up.
- **Per-user upload rate limiting.** A whole office shares one IP, so the upload budget
  is keyed by user rather than address.

**Fixed — log redaction**
- `redact` masked phones and emails under a key it recognised, but let them through
  inside free text. The commonest leak is MySQL's own duplicate-key error, which quotes
  the offending value: `Duplicate entry '+9715…' for key 'uq_contact_phone'`. Every
  string in a log context is now scrubbed, including a bare digit run inside quotes —
  a `wa_id` is stored without the leading `+`, so the same error naming
  `uq_contacts_wa_id` would otherwise have printed the number in full. Unquoted long
  numbers are left alone so timestamps and row counts stay readable.

**Reviewed**
- An independent security pass over this work found one regression, now fixed and
  recorded above: helmet sends HSTS by default, so gating it on `COOKIE_SECURE` —
  which is off by default — *removed* the header from precisely the deployment that
  needs it most, an HTTPS site whose cookie is not marked Secure. Both halves of that
  hole are now closed. The pass confirmed the upload containment check, the dialler
  scoping, the bulk-endpoint narrowing, the trimmed user directory and the CSP.

**Dependencies**
- `drizzle-orm` and `drizzle-kit` removed. Nothing imported them — the migrations are
  hand-written SQL — and the package carried a SQL-injection advisory.
- `nodemailer` to 10.x (SMTP command injection, mail to an unintended domain) and
  `react-router-dom` to 7.x (open redirect). Every router API the app uses is unchanged
  in 7.
- Two moderate advisories remain, both `exceljs`'s transitive `uuid`: the flaw needs a
  caller-supplied buffer, and exceljs calls `uuidv4()` with no arguments. npm's "fix"
  downgrades exceljs to 3.x, which would cost the streaming reader the 100k-row import
  depends on.

**Verified**
- 524 server tests and 24 web tests green; 18 browser steps pass with the CSP in place,
  which is what proves the policy does not break the app.
- Reviewed every route file for viewer scoping, and the dynamic SQL for injection: every
  interpolated identifier comes from a literal or `assertIdentifier`, and every value is
  a placeholder.
- No secrets in tracked files; `.env.example` and `server/.env.test` carry placeholders
  only.

## Phase 12 — Bulk import, lists, campaigns and team assignment

**Added**
- Migration `0005`: eleven tables — `imports`, `import_rows`, `import_mappings`, `lists`,
  `list_members`, `campaigns`, `campaign_members`, `teams`, `team_members`,
  `assignment_rules`, `lead_pool_claims` — plus `opportunities.import_id`.
- **Bulk import** of CSV and Excel, built for 100,000+ rows. The file streams to disk
  (no multipart buffering), is read by a hand-written streaming CSV parser or ExcelJS's
  streaming reader, staged row by row, then imported in chunks of 1,000 by a job that
  re-enqueues itself — so a worker restart costs one chunk, and the user can close the
  page. A seven-step wizard covers upload, column mapping, cleaning, duplicates,
  settings, assignment and the report; failed rows come back as a CSV with the reason.
- **Column mapping** suggested by a deterministic matcher that places the headers real
  agency exports use ("Mobile No.", "Budget AED", الاسم). Never maps two columns to one
  field. An optional AI pass fills what is left, sees only the headers — never a row —
  and is skipped entirely when AI is off.
- **Imported leads never trigger Workflow A**, with a test, and a counter-test that a
  normal lead still does. A file of forty thousand old leads must not send forty thousand
  welcome messages.
- **24-hour undo** that removes only contacts the import created, and only those nobody
  has worked: any message, any task, any activity beyond the import's own, a stage move, a
  reply, or a place on a list or campaign all protect the record.
- **Lists**, saved and smart. A smart list stores a filter and is evaluated on read, so it
  stays current on its own. Bulk assign, tag and untag on any selection; export and
  bulk-delete kept on their own endpoints with their own permissions, as the specification
  requires.
- **Campaigns**: a power dialler that hands an agent one lead at a time with everything
  needed to make the call, and a throttled WhatsApp send.
- **The bulk WhatsApp guard**, server-side so no client can get around it: consent only,
  never a DNC contact, approved templates only, throttled, the skipped-for-no-consent
  count shown before sending, and an automatic pause if the template's quality rating
  drops or too many sends fail. Quiet hours, the three-a-day cap and the bot pause still
  apply on top, because every message still goes through `sendWhatsApp`.
- **Assignment**: one agent, round-robin a team, split evenly, split by percentage (largest
  remainder, so no lead is lost to rounding), by rule on language / project / emirate /
  budget, or a shared pool. Workload is shown before assigning and warns when someone
  would be left far above the team average. Every assignment is audited.
- **The shared pool**: "Claim next lead", a per-agent claim limit, voluntary release, and
  automatic recycling of claims nobody touches. Teams live under Settings → Desks.

**Fixed, found by testing**
- `SELECT … LIMIT n FOR UPDATE SKIP LOCKED` locks every row it returns, and an `ORDER BY`
  on an expression forces a filesort that locks the whole matching set first. Either one
  hands the first agent the entire queue and tells everyone else it is empty. Both hot
  paths now order along an index with `LIMIT 1`; a new index on
  `opportunities (owner_user_id, status, created_at)` removes the filesort from the pool
  claim.
- Campaigns built from a smart list found nobody, because the builder read `list_members`
  and a smart list has none. Everything that acts on "the people on this list" now goes
  through one resolver.
- The dialler correctly refused to hand an owner someone else's leads, which also stalled
  a campaign whose agent was away. Managers and above can now work any row; an agent still
  never gets a colleague's lead.
- `row_number` and `position` are reserved words once window functions exist; the columns
  are `line_number` and `sort_order` so the migration applies on MySQL 8 and MariaDB alike.

**Verified**
- 510 tests green (486 server, 24 web), including: a 2,500-row import across three chunks
  with the counts adding up exactly; five agents claiming from the pool at once getting
  five different leads, and six agents on one lead getting exactly one claim; four agents
  on one campaign getting four different people; and every branch of the consent rules.
- Driven end to end in a browser against a real MariaDB: a 250-row file uploaded, mapped
  automatically, checked, assigned and imported — 250 created, 2 rejected with useful
  reasons — then a smart list built from it, a campaign created, a call logged as
  Interested and the lead moved into the pipeline.
- 18 browser smoke steps pass; no console errors, no unexpected 4xx.

## Phase 11 — The CRM screens on the new design

**Added**
- Every CRM screen rebuilt on the Phase 10 design system: login, change password,
  dashboard, pipeline, inbox, Contact 360, contacts, tasks, projects, automations and
  settings. Tailwind is gone; the app now loads only the ported design stylesheets.
- **Dashboard**, new: four KPIs with sparklines, leads over time against the previous
  period, a speed-to-lead gauge with the 5-minute SLA count, sources, the quality funnel,
  an arrivals heatmap and the "King of Emir" leaderboard. One request
  (`GET /api/reports/dashboard`) fills the screen, scoped in SQL to what the viewer may
  see — an agent's dashboard is their own leads, a manager's is their team's.
- **Tasks**, new: the follow-ups Workflows A and B create, plus anything agents add, with
  overdue first. `GET /api/tasks`, and complete/reopen on a shared service so the Tasks
  screen and Contact 360 behave identically.
- **Automations**, new: the workflows, their last-7-days run counts, and on/off switches
  for owners and admins. Switching one off is audited with before and after.
- **Settings**, new, absorbing the old Team, Templates and Reports pages: your account and
  interface language, appearance (light / dark / system) and "Reduce glass effect", the
  team with password resets, the WhatsApp template library, and an operational health tab.
- The lead drawer from the design, over the board: stage bar, AI summary, facts, the
  activity trail and call / WhatsApp / open actions.
- `availability` on the session user, so the sidebar's "available for new leads" switch
  shows the real state rather than assuming it.
- Interface language is now a self-service setting rather than an administrative one.
- The contacts list returns each person's current stage and project.
- The browser smoke test rewritten for the new screens: 16 steps including the dashboard
  drawing from real data, the 24-hour window indicator, the dark theme applying without a
  reload, and Arabic mirroring the layout.

**Fixed**
- The sidebar's unread badge asked `/api/inbox/conversations?filter=unread&limit=50`.
  Neither is a valid parameter, so the request 400'd on every navigation and the badge was
  always empty. It now uses the same scope the Inbox screen defaults to.
- `scrollIntoView` on the message list scrolled every ancestor, dragging the whole inbox
  off the top of the screen. The list scrolls itself now.
- The inbox overflowed its own height, because a grid child defaults to `min-height:auto`
  and would not let the tall composer shrink.
- The 90px reserve at the foot of a view is for the phone bar, which is hidden on desktop;
  keeping it there pushed the full-height inbox under the sticky top bar.
- Anchors styled as buttons (Call, WhatsApp, All contacts) carried an underline.
- `humanize('1_3_months')` read as "1 3 Months"; ranges and a few source names now have
  proper phrasings.

**Not in this phase**
- Bulk import, lists, campaigns and team assignment: Phase 12.
- Emir Books, and the CRM | Books switcher. The sidebar still reserves its space.
- Arabic covers navigation, the login screen and the shared labels, as before. Screen body
  copy is English; the layout mirrors correctly either way.

**Verified**
- 374 tests green (350 server, 24 web); no TypeScript errors.
- 16 browser steps pass against a real MariaDB with demo data, with no console errors and
  no failed requests. Every screen rendered at 1440px and 390px.

## Phase 10 — Design system

**Added**
- The approved design at `design/emir-crm-design.html` ported into the app as four
  stylesheets — `tokens.css`, `base.css`, `components.css`, `animations.css` — carrying
  the CSS across verbatim, cascade order included, so the result matches the design
  rather than resembling it. `docs/DESIGN.md` explains the layout and the four places
  it deliberately differs.
- Lucide icons bundled through npm instead of the design's CDN, keyed by the design's
  own kebab-case names so porting a screen is a substitution. 109 icons, tree-shaken.
  A blocked icon host has broken this app's icons once already.
- `AppShell`: glass sidebar, sticky top bar, mobile bottom bar. Nav items are real
  links, styled identically to the design's buttons.
- Chart primitives ported from the design's own drawing code — `Spark`, `AreaChart`,
  `Donut`, `Gauge`, `Funnel`, `Heat` and `CountUp` — taking real data where the design
  generated demo series.
- Theme system: light / dark / follow-the-system, plus the "Reduce glass effect"
  setting the specification asks for. Both are applied before first paint by an inline
  script, so a stored choice never flashes the default.
- An RTL block that mirrors the fixed shell for Arabic; the design is LTR only.
- A development-only design-system gallery at `/design-system.html`, excluded from the
  production build, rendering the shell, every chart and every icon on one page.
- Tests in the `web` workspace (vitest + jsdom), and `npm test` now runs both workspaces.

**Not in this phase**
- The CRM | Books switcher, at the owner's instruction. The sidebar reserves its
  footprint; the design's switcher CSS and the whole Books stylesheet are parked in
  `books.css`, imported by nothing.
- The CRM screens themselves. They still render on the previous stylesheet until
  Phase 11 moves them over; the two are not loaded at the same time.

**Verified**
- 352 tests green (328 server, 24 new in web); no TypeScript errors.
- Rendered in Chromium at 1440px and 390px, in light, forced dark, system dark,
  reduced glass and reduced motion, and in RTL: no console errors, no failed requests,
  no horizontal scroll, and icons draw as glyphs rather than as text.
- The production build is unchanged in size and does not contain the gallery.

## Phase 1 — Foundation (auth, roles, schema, audit)

**Added**
- npm workspaces monorepo: `server` (Express + TypeScript + MySQL 8) and `web` (React + Vite + Tailwind PWA).
- Schema migrations `0001`–`0003` covering 30 tables: users, sessions, audit log, contacts,
  contact identities, pipelines and stages, opportunities, inbound events, conversations,
  messages, WhatsApp templates, activities, tasks, tags, consents, suppressions, projects,
  form field map, workflows, workflow runs, jobs, push tokens, conversion events,
  brochure views, AI field suggestions, assignment state and the unassigned queue.
- Forward-only migration runner tracked in `schema_migrations`, plus an idempotent seed
  (pipeline and stages, day-one WhatsApp templates, workflows, tags, form field map, owner account).
- Email + password login only: server-side sessions in MySQL, httpOnly / SameSite=Lax cookie,
  7-day or 12-hour lifetime, argon2 hashing with a bcrypt(12) fallback, 8-character minimum,
  forced change of temporary passwords, 5-failure account lockout for 15 minutes and per-IP
  rate limiting.
- Role matrix for `owner`, `admin`, `manager`, `agent` and `automation`, enforced server-side
  by permission and by data scope (own / team / all).
- `audit_log` writer with before/after field diffing. Every login, failed login, lockout and
  password change is recorded.
- Configuration through zod-validated environment variables; all external API versions pinned
  in a single `API_VERSIONS` constant; AES-256-GCM helpers for encrypting tokens at rest;
  a JSON logger that redacts secrets and masks phone numbers and email addresses.

**Verified**
- Migrations apply cleanly from empty to seeded on a live MySQL-compatible server.
- Login, session cookie, `/api/auth/me`, account lockout after 5 failures and the audit trail
  exercised end to end over HTTP.
- 64 unit tests green; no TypeScript errors.

## Phase 2 — Ingestion and deduplication

**Added**
- Canonical Lead DTO that every source normalizes into: person, real estate, attribution,
  consent, notes and any unmapped answers.
- Source adapters for Meta Lead Ads (webhook + `/{leadgen_id}` fetch + `/{form_id}/leads`
  backfill), WhatsApp Cloud API (`messages[]`, `statuses[]`, `referral`), website forms,
  Google Ads lead forms and CSV / manual entry.
- Value parsers that turn free-text form answers into CRM enums: budget bands
  ("AED 1M – 2M", "800k-1.2m", "up to 3M", "5M+"), purpose, payment method, timeline and
  emirate, in English and Arabic, plus script-based language detection.
- `form_field_map`-driven field mapping, so a new custom question on a lead form is a
  configuration change rather than a deploy. Unmapped answers are preserved on the lead.
- Identity resolution in a transaction with row locks: match on phone → wa_id → email,
  fill only empty fields, never overwrite agent-edited data, keep the first-touch source,
  and keep a returning lead with their existing agent.
- Re-inquiry rule: a second inquiry within 30 days on the same project adds an activity to
  the open card instead of opening a duplicate opportunity.
- Immutable `inbound_events` log, unique on (source, external_id), so a replayed webhook
  never reaches the pipeline twice.
- Webhook endpoints for Meta Lead Ads, WhatsApp, website and Google, each verifying its
  signature (`X-Hub-Signature-256`, HMAC or reCAPTCHA, `google_key`), storing the raw
  payload, answering within 2 seconds and processing after the response is flushed.
- Inbound WhatsApp handling: message storage, the 24-hour window, delivery ticks that only
  move forward, and an email fallback scheduled when Meta's marketing limits reject a send.

**Changed**
- Transactions now run at READ COMMITTED. Under REPEATABLE READ a webhook that lost the race
  to create a contact kept a snapshot from before the winner committed, and opened a second
  opportunity for the same inquiry; gap locking also deadlocked concurrent inserts against
  the same unique key.
- An email-only match whose phone number disagrees no longer merges. It creates a separate
  contact linked by `possible_duplicate_of` and tagged `ops:possible_duplicate`, because
  merging silently discarded the new lead's phone number.
- Inbound message handling takes its row locks up front, contact before conversation, to
  avoid the shared-to-exclusive lock upgrade that deadlocked concurrent webhooks.

**Verified**
- Duplicate-storm test: 20 identical leads in parallel produce exactly 1 contact, 1
  opportunity and 1 Workflow A job; run five times with no flakiness. The same holds for
  20 parallel leads written in five different phone formats, and for 20 concurrent inbound
  WhatsApp webhooks (1 contact, 20 messages). Two different people arriving together stay
  two contacts.
- Replay tests over every fixture in `/fixtures`, including redelivery of the same payload.
- 159 tests green; the 31 database-backed tests skip cleanly when no server is reachable.

## Phase 8 — Web app (PWA), demo data and exactly-once workflows

**Added**
- React + Vite + Tailwind PWA served from the same origin as the API, so the session
  cookie stays httpOnly and SameSite=Lax with no CORS surface: login, forced
  temporary-password change, Kanban board, unified inbox, Contact 360, contacts,
  projects, templates, reports and team management.
- Responsive Material-style layout: a navigation rail on desktop, a bottom bar on
  mobile, safe-area padding for installed iOS, and an installable manifest with a
  service worker that caches the shell but never CRM data.
- RTL-ready Arabic throughout, including a language switch that persists to the user record.
- `npm run demo` loads a realistic dataset by driving the real pipeline — ingestion,
  assignment, workflows — rather than inserting rows, so a demo shows what the system
  actually does.

**Fixed**
- Workflow A and Workflow C are now exactly-once, enforced by a unique index rather
  than a read-then-write check. A retried job was sending a lead a second welcome
  message, and re-running inbound routing replied twice and created a duplicate
  call-back task. Ten concurrent retries now produce exactly one welcome, and five
  concurrent retries of one inbound message produce one reply and one task.
- Icons are inline SVG instead of a CDN icon font. With the font host unreachable —
  offline, a restricted network, or a blocked region — every icon rendered as raw
  ligature text ("view_kanban", "logout"), which is exactly the condition a field
  agent's phone hits.
- The inbox thread endpoint never joined `contacts`, so the thread header showed
  "Unknown" with no phone number.
- The inbox defaulted every role to the "Mine" filter, so an owner or manager — who
  rarely owns conversations — opened an empty inbox that looked broken. Managers now
  start on "All".
- The language toggle wrote only to local storage, and the next session refresh
  reset it from the server, so switching to Arabic appeared to do nothing.
- The desktop and mobile navigations shared the accessible name "Main".

**Verified**
- 317 tests green.
- 13 browser steps driven through real Chromium at desktop and phone viewports: the
  login gate, wrong-password rejection, the forced password change, all seven board
  columns, the inbox thread, Contact 360, projects, reports, team, the mobile bottom
  navigation, and the Arabic RTL switch persisting across a reload.

## Phase 9 — Documentation, hardening and CI

**Added**
- `docs/ARCHITECTURE.md`, `docs/WEBHOOKS.md`, `docs/WORKFLOWS.md` and
  `docs/DEPLOYMENT.md`. The deployment guide answers the hosting question the
  specification asks: what the plan must support, what degrades if it does not, and
  which steps need the owner rather than code (Meta app review, WhatsApp template
  approval, SPF/DKIM/DMARC, a Google Ads developer token).
- Rate limiting on the unauthenticated surface — login, webhooks and brochure links —
  as a cheap layer in front of the existing per-account lockout and per-IP budget.
- A runtime identifier guard on the few dynamic column lists. Every user-supplied
  value already goes through a placeholder and every interpolated column name already
  comes from a fixed allowlist, but nothing enforced that; now a later edit that feeds
  request keys into a patch object fails loudly instead of opening a hole.
- GitHub Actions CI: typecheck, the full suite against a real MySQL 8 service
  container, and the production build.

- `e2e/ui.mjs` (`npm run e2e`), the browser smoke test, kept in the repository so the
  team can rerun it. It is idempotent: the owner's temporary password only works once,
  so the sign-in step falls back to the replaced password and skips the gate rather
  than failing on a second run.

**Verified**
- 328 tests green, and green again with no database reachable (59 skip cleanly).
- Clean install from an empty server: 4 migrations, 31 tables, seed, build, run.
- The compiled production build serves the API and the SPA from one origin.
- 13 browser steps pass, twice in a row against the same environment.
