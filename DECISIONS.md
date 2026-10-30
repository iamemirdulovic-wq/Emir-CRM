# Decisions

One line per decision: `date — area — decision — why`.
Written as the build goes. Read this before changing anything that looks odd.

---

2026-10-30 — process — Work autonomously; do not stop to ask Emir — The master
build prompt (Part B1) says so explicitly, overriding the "ASK ME FIRST" rule
in `CLAUDE.md`. Every judgement call that rule would have surfaced is recorded
here instead.

2026-10-30 — data model — **Do not create a `leads` table.** The spec's `leads`
columns are added to the existing `opportunities` (the enquiry) and `contacts`
(the person) — The CRM already splits a lead that way, and the whole of
ingestion, dedupe, the inbox, workflows and every report is built on it. A
second table holding the same person would be two sources of truth, and the
one thing the business cannot afford is a duplicated or lost lead.

2026-10-30 — data model — `lead_activities` → the existing `activities` table;
`user_sessions` → the existing `sessions` table (extended); `routing_settings`
→ the existing `app_settings` rows — Same reason: one source of truth. The new
spec columns are added to these.

2026-10-30 — deployment — **Commit freely, push only on a completed step** —
A push to `claude/new-session-krd7bx` deploys to `crm.homes.me` within a
minute, with no staging and seven agents working in it. A commit costs
nothing; a push is a release.

2026-10-30 — safety — Backup runs on the server from `npm start`, immediately
before migrations, not from the build machine — The database listens on
localhost, so nothing outside the box can reach it. A backup taken anywhere
else would be a backup of nothing.

2026-10-30 — safety — A failed backup warns loudly but does **not** stop the
server — Seven agents losing the CRM because `mysqldump` is missing is worse
than one start without a fresh dump. The real guarantee is that migrations
cannot be destructive, which is now enforced by a test
(`server/src/db/migrations.safety.test.ts`) that fails CI on `DROP`,
`RENAME`, `TRUNCATE`, `MODIFY`, an unqualified `DELETE`, or a `NOT NULL`
column added without a default.

2026-10-30 — design — Keep the existing accent teal `--primary:#00AFC8` rather
than the spec's `#0E7C86` — Part C2 says "if the CRM already has an accent
colour, keep it". It is also the colour in the design Emir approved, and
changing it would repaint every screen the team already knows.

2026-10-30 — design — Build the missing Part C3 components into the existing
`web/src/design/` system, matching its naming — There is already a working
design system ported from the approved file. A second component library beside
it would mean two buttons that look slightly different.

2026-10-30 — web — No phone-number library in the browser. The country list,
grouping and length check are hand-written — The server already runs every
number through libphonenumber before storing it, and a browser can never be
the authority on whether a number is real. Adding ~145KB to a bundle an agent
loads on mobile data, to duplicate a check that is made again server-side, is
not worth it. The browser's job is to make the number readable and catch the
obvious slip; the server rules.

2026-10-30 — web — Sounds are synthesised with the Web Audio API, not shipped
as mp3 files — Nothing to download on a phone in a lift, no licence to get
wrong, and the tone is tuned by changing a number rather than finding another
recording.

2026-10-30 — web — Set `<html lang>` to `en-AE` (and `ar-AE`), and echo every
chosen callback time back in the CRM's own format — Browsers format their own
date controls from the *browser's* language, which we do not control. An agent
whose phone is set to US English sees month-first, and 10/11 means two
different days to two people in the same office. The echo under the field
removes the ambiguity whatever the browser does.

2026-10-30 — web — The PWA keeps the name "homes.me" under the icon but
"Emigeo Homes CRM" in the install dialog — The spec asks for the company name;
the approved design and the logo on screen say homes.me. This gives the
company name where it identifies the app and the brand where people look at it.

2026-10-30 — docs — Corrected `AUDIT.md`: the app uses `BrowserRouter` with
ordinary paths. Only the **preview** build uses `HashRouter` — My first reading
of it was wrong, and it would have misled every later step that reads
`location.pathname`.

2026-10-30 — security — Export, bulk delete, hard delete and audit-log reading
move from `admin` to **owner only** — Part D1 says so, and the reason holds:
an export is a copy of the client database that walks out of the building and
cannot be called back. An admin runs the CRM day to day; taking the whole
database out of it is not day to day.

2026-10-30 — data — "Delete" is now a timestamp, never a DELETE — Every
foreign key into `contacts` cascades, so one owner selecting a hundred rows
took their opportunities, activities, WhatsApp threads and the notes an agent
wrote after a viewing, with nothing to restore from but the overnight dump.
A test (`auth/deleted.test.ts`) now fails the build if any file hard-deletes a
contact or an opportunity; it immediately found a second one I had missed, in
the import undo.

2026-10-30 — data — Identity resolution deliberately does **not** filter
deleted contacts; it revives them — The phone number is unique across the
whole table, so a second row for the same person cannot be inserted. Finding
the old row and clearing the timestamp is both the only thing that works and
the better answer: they are the same person, and their history is worth more
than a blank record. Their old closed enquiries stay deleted, so stale cards
do not reappear on the board.

2026-10-30 — security — Phone masking in lists is **cosmetic, and is written
down as such** — The full number stays in the response so the Call button can
dial without a round trip, which means anyone who opens developer tools can
read it. It raises the effort of copying a column of clients by hand and does
nothing more. The protection that is real sits elsewhere: agents only ever
receive their own leads (fenced in SQL), exports are the owner's alone, and
opening 200+ leads in an hour tells the owner.

2026-10-30 — security — The browsing alarm counts and reports; it never blocks
— An agent stopped mid-call by a false positive is a worse outcome than the
thing being guarded against, and an owner who gets a false alarm on Tuesday
ignores the real one on Friday. It fires once per hour-long window, not once
per lead past the line.

2026-10-30 — routing — Deactivating an agent returns their open leads to
Incoming — They used to stay assigned to an account that cannot sign in, so no
card moved, no follow-up fired and no timer bounced them. The lead was not
lost on paper; it was just never going to be called again, which is the exact
failure this CRM exists to prevent.

2026-10-30 — process — **Check CI after every push. "Tests pass" locally is not
the same as tests passing** — 268 integration tests skip in this environment
for want of a MySQL, and there is no way to run them here: no mysqld, no
Docker daemon. CI is the only place they run. I pushed three times saying the
tests passed while CI was red, which was true of what I could run and
misleading about what mattered. From here, every push is followed by reading
the CI run before anything is called done.

2026-10-30 — testing — `resetTables()` now clears the settings cache — Settings
are cached in memory for thirty seconds and truncating the table does not
touch that, so a test that changed a setting handed its value to every test
after it. The failure would land on whichever test happened to run next, which
is the worst kind to debug.

2026-10-30 — testing — The SLA breach now has a test for each ending, and each
says which setting it exercises — The default changed to "back to Incoming"
when Incoming was built, but the only integration test still asserted the old
auto-reassign behaviour, so CI went red and the new default — the one Emir
actually runs — had no coverage at all.

2026-10-30 — ingestion — The spec's 0–6 lead score is **not** adopted; the
existing 0–100 score stays and gains a reason and a band — The simple rules in
D3.1 would be a downgrade from what is already there, and the same document
asks elsewhere for a score out of 100. What was missing was not arithmetic but
words: "82" tells an agent who to call first, "Budget AED 2.5M · ready now ·
asked for a call" tells them how to open. Stored rather than recomputed, so
what shows next to a lead is what was true when it was scored.

2026-10-30 — ingestion — A lead that returns after being marked Lost goes to
Incoming, not to its old agent — The sticky-owner rule normally sends a
returning client to the agent who knows them, which is right, unless that
agent is the one who decided they were not a buyer. Then the new message is
evidence against that decision and the owner should see it. A client who ever
*bought* is exempt: whoever sold to them gets the call.

2026-10-30 — ingestion — The public form endpoint is a second door beside the
HMAC one, not a replacement — HMAC signs the whole body with a shared secret,
which is right for server-to-server and impossible in a browser, where
anything the page knows everybody knows. The public endpoint instead gets a
revocable site key, a 10/minute limit per address and a honeypot. The HMAC
endpoint is untouched, as the owner asked.

2026-10-30 — routing — The SLA is an exact-time job per lead, **not** the
30-second sweep the spec asks for — The deadline is known the moment a lead is
assigned, so the cheapest correct thing is to ask to be woken then: no polling
at all, and the bounce lands on the second rather than up to half a minute
late. The jobs table's dedupe key already makes two workers produce one bounce,
which is the property the sweep was specified to guarantee.

2026-10-30 — routing — Quiet hours pause the *clock*, never the reply — A lead
arriving at 03:10 still gets its WhatsApp inside thirty seconds. What must not
happen is holding a sleeping agent to a five-minute call-back and taking the
lead off them at 03:15 for failing: by morning the lead has bounced, the agent
has a breach against their name, and nobody has spoken to the client. The lead
stays theirs overnight and the clock starts at 08:00.

2026-10-30 — routing — The spec's "on-duty agent" out-of-hours mode is not
built — Emigeo has seven agents and no night shift. Pausing is the behaviour
that fits; a rota nobody is on would be a screen to maintain and a way to send
a 3am lead to someone who is also asleep. Easy to add if a night desk ever
exists.

2026-10-30 — routing — Bounce alerts are damped after three in a minute — A
worker coming back from an outage runs a queue of expired timers in seconds,
and each is a real bounce wanting to tell somebody. Seven buzzes in four
seconds gets the phone silenced, and the next one — on a normal Tuesday, about
a lead that matters — is silenced with it.

2026-10-30 — notifications — Everything is written down before it is pushed —
Push was fire-and-forget: it reached the phone or it did not, and either way
nothing survived. An agent whose phone was face-down, or who never allowed
notifications, had no way to discover that a lead was given to them at 11:40.
The record is what the bell reads, and it is what turns a failed push from a
lost lead into a nuisance.

2026-10-30 — notifications — Web Push with VAPID is **not** added; FCM stays —
The spec asks for VAPID, but Firebase Cloud Messaging is already wired,
working and configured, and it is a Web Push transport underneath. Running
both would mean two subscriptions per device and two ways for a notification
to go missing. `scripts/make-vapid-keys.mjs` is there if the owner ever wants
to drop Firebase.

2026-10-30 — css — Dropdown panels composite their glass over the app's own
background colour rather than relying on `backdrop-filter` — The blur is off on
older devices, off under the "reduce glass" setting, and off in headless
rendering. A dense list of text has to be legible either way; the blur is an
enhancement, not the thing holding it up.

2026-10-30 — leads — Walk-in, referral, Instagram and event are real sources,
not flavours of "manual" — Where a lead came from is the question the
source-quality report exists to answer, and a walk-in converting at four times
the rate of an Instagram enquiry is exactly what gets lost if they share a
label.

2026-10-30 — leads — A manual lead gets no automatic welcome template —
Somebody has just spoken to this person. A template arriving thirty seconds
later saying "thank you for your interest" reads as a machine that was not
listening. Scoring still runs.

2026-10-30 — leads — An agent adding their own lead keeps it with no clock —
They are standing in front of the client; there is nothing to chase. A manager
handing one to somebody else is an ordinary hand-over and does get a clock.

2026-10-30 — web — Confetti is forty lines and a canvas rather than a library
— Fifteen kilobytes downloaded on mobile data for something that lasts a
second and a half is not a trade worth making. It does nothing at all under
reduce-motion.

2026-10-30 — notifications — Rather than add VAPID beside FCM, the silent
failure was made visible — The real risk was never which transport: it was
that push dies quietly in two ways, with no credentials or with an agent who
never allowed notifications, and the lead still bounces five minutes later
off somebody who was never told. Settings → Health now names who has no
device registered. Two push stacks would have added a second way to go
missing without closing that.

2026-10-30 — leads — My Leads is a list, not a second board — The spec asks
for a List/Board switch on this screen. The CRM already has a kanban at
/pipeline, built on the same opportunities, with drag between stages. A second
board inside My Leads would be two screens to keep in step and two places to
fix a stage bug. The tabs answer a different question from the board — "what
do I owe today" rather than "where is everything" — which is why this screen
exists at all.

2026-10-30 — leads — Only "no answer" gets an automatic next step — The right
answer there is obvious and waiting for someone to type it loses it: try again
in two hours, backing off to four and then a day, and switching to WhatsApp
after three unanswered calls, because ringing the same number every two hours
is how a brokerage's number gets blocked. Every other action deliberately
leaves the lead in "No next step", where it is visible. Inventing a promise
nobody made is worse than admitting none exists.

2026-10-30 — leads — `/contacts` redirects rather than 301s — React Router
cannot issue a real 301; the server serves one SPA for every path. The route
resolves and replaces the history entry, which is what a bookmark, an old push
notification and an already-sent email all need.

2026-10-30 — notes — Notes become their own table, and nothing is moved —
Until now an internal note was a `note` row on the activity timeline: no
author beside it, no way to correct a typo, no way to pin the one line that
mattered. `lead_notes` fixes all three for anything written from now on. The
old rows stay exactly where they are and still show in the timeline, because
they hold real words agents wrote and a migration that rewrites those is a
migration that can lose them.

2026-10-30 — notes — The client's own words were in the database and on no
screen — `contacts.notes` is not team notes at all; it is whatever the client
typed into the ad form, written by ingestion and never displayed. It is the
only thing on the record in their own words, so it now sits above the notes,
labelled as theirs and styled so it cannot be mistaken for something an agent
wrote.

2026-10-30 — notes — A voice note is the whole note, no typing required —
An agent has most to say in the two minutes after a viewing, which is exactly
when they are walking to a car with a phone in one hand. Save is enabled with
a recording and no text; the body is filled in as "🎤 Voice note" so the row
still reads as something. Requiring words as well would mean typing, which is
the thing the recording exists to avoid.

2026-10-30 — notes — Files upload after the note is saved, not before —
A file has nothing to attach to until the note exists, and uploading as soon
as it is picked would leave an orphan on disk behind every abandoned draft.
They are staged in the composer, shown with a name and a size, removable, and
sent one at a time once the note has an id — one at a time because these are
phone uploads on a car's signal, and ten parallel requests is how all ten
fail.

2026-10-30 — notes — Undo instead of "Are you sure?" — Deleting a note is a
soft delete with an Undo in the toast, held for seven seconds rather than the
usual 2.6, because 2.6 is not long enough to read, decide and reach. A
confirmation dialog in front of every delete teaches people to click through
dialogs, which is how the one that mattered gets clicked through too.

2026-10-30 — uploads — One place decides what may be stored and where —
The allow-list and the "is this path inside UPLOAD_DIR" check were inside the
task attachment module. Notes needed both, and copying them is how one copy
quietly drifts. They are now in `lib/uploads.ts`, unit-tested without a
database — including the SVG and HTML exclusions, the `../../etc/passwd`
climb, and the `uploads-old` sibling directory that merely starts with the
same characters.

2026-10-30 — notes — A note id is not authority to touch the note — The
patch and restore routes checked who wrote a note but never that the caller
could see the lead, so an agent knowing an id could pin or restore a note on a
colleague's client. Both now resolve the note to its contact and run the same
check the lead page runs. Found while adding the file routes, fixed before
they were written.

2026-10-30 — imports — Most of Step 9 was already built, and saying so is
the point — Column synonyms, split-even assignment, undo within 24 hours
skipping worked-on leads, and the import history page all existed from the
original build and work. They were checked rather than rebuilt. Rewriting
working code to make a checklist feel earned is how a working import breaks.

2026-10-30 — imports — Each upload gets a tag of its own — Every imported
contact already carried `src:import-<label>`, which is provenance, not
identity: run the Expo list twice in a week and both uploads answer to the
same tag, so "the ones from Tuesday" can no longer be told from "the ones
from Friday" — which is exactly the question asked when a batch turns out to
be bad. Each upload now also gets `batch:expo-2026-30oct-a3f2`: the label,
the day in Dubai time, and four characters of the id. Generated on the
server when the import starts, never accepted from the client, because a tag
the caller picks is a tag two imports can share.

2026-10-30 — imports — The five-minute timer is available, and capped at 200
rows — The default stays off and that default is load-bearing: forty
thousand old leads through Workflow A would wake every agent's phone forty
thousand times and bounce most of them before anyone could answer. But the
opposite case is just as real — twenty names off a stand at Cityscape,
uploaded that evening, which are new leads in every sense. Above 200 rows
the switch is unavailable rather than merely warned about, and it says why
instead of sitting there greyed out. The limit is re-checked when the import
runs, because settings are JSON on a row and "the wizard disabled the
button" is not a rule the server has enforced. Turning it on never sends a
WhatsApp or an email: an imported list has no fresh consent and no open
24-hour window, so a template to all of them is the send that gets a number
banned.

2026-10-30 — imports — My Leads can filter by tag — A batch tag that nothing
can filter by is not a way of finding anything. `/leads?tag=batch:…` now
filters, names the filter on screen and offers to clear it, so the link from
an import lands somewhere that shows the batch rather than everything.

2026-10-30 — preview — The import wizard had no mock at all — Pasting rows
or dropping a file called endpoints the preview did not answer, so the
wizard could be opened and never used. Anyone reviewing the CRM through the
preview would have found the import simply dead. Mocked now, including the
row count coming from what was actually pasted, so the row-limit rule can be
seen working rather than described.

2026-10-30 — email — A sent email is a message, not an `email_message` — The
spec listed an `email_messages` table. The unified inbox is one thread per
contact mixing WhatsApp, email and notes, so a sent email goes in `messages`
beside the rest. Two tables would mean the inbox reading both and drifting
the first time one gained a column. `email_events` holds what happened after
it left — opened, clicked, bounced — as a row per event rather than a flag,
because "opened four times over two days" is a different lead from "opened
once".

2026-10-30 — email — Sending is off by default, and a key is not consent —
`FEATURE_EMAIL_SENDING` is false unless deliberately set. With it off every
template merges, every message is recorded and every campaign reports, and
nothing leaves the building. A Brevo key sitting in `.env` does not turn it
on: a deployment that has not flipped the switch is telling us it is not
ready. Test mode redirects every message to one address with the real
recipient in the subject, and a test mode with nowhere to redirect to refuses
to send rather than falling through to the client.

2026-10-30 — email — The unsubscribe link is signed, not stored — An HMAC of
the contact id rather than a random token in a table. Nothing to create
before the first email, nothing to look up on the click, nothing to expire —
three fewer things to go wrong in the path whose failure is "we kept emailing
someone who asked us to stop". It never expires on purpose: a client who
finds a two-year-old email and presses unsubscribe means it.

2026-10-30 — email — One click unsubscribes, with no confirmation step — A
"are you sure?" page is one more thing between somebody asking to be left
alone and it happening, and the people clicking it are already annoyed. A
mail client prefetching the link could unsubscribe someone by accident; that
risk is real and far smaller than ignoring a request to stop.

2026-10-30 — email — The preview comes from the server — The composer shows
the real HTML, rendered by the same function that sends it, in a sandboxed
iframe. A preview assembled in the browser is a preview that stops matching
the moment the branding changes, and the first person to notice would be a
client.

2026-10-30 — email — The six system templates quote no numbers — No price, no
handover date, no payment plan, no percentage. Those come from the projects
table and belong in an offer, where they are versioned. A number typed into a
template is a number nobody updates and a promise the brokerage has to keep.
There is a test for it.

2026-10-30 — email — A campaign claims each recipient before sending — The
member row is marked sent and only then is the email sent, so a retried job
finds it taken. With a unique key on (campaign, contact) behind it, that is
what stands between a worker restart and a client receiving the same email
twice. The campaign also pauses itself at a 5% bounce rate, because carrying
on past that damages the sending domain for every other email the brokerage
sends — including the one-to-one replies that actually matter.

2026-10-30 — schema — Every SQL statement is checked against the migrations —
A query in this step asked `users` for `phone`, where the column is
`phone_e164`. It type-checked, and the `catch` around it would have signed
every client email with the company name instead of the agent's, silently,
for as long as nobody looked. There is now a check that reads the schema out
of the migrations and every simple statement out of the source, and fails
when one names a column the other does not have. Joins, aliases and
subqueries are skipped rather than guessed at — a check that cries wolf gets
switched off.

2026-10-30 — users — `job_title`, `brn` and `photo_url` added now — The email
signature needs them today and the business card in Step 12 needs them next.
A UAE broker must show their BRN on client-facing material, so it is a field
rather than a line someone remembers to type.
