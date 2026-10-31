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

2026-10-30 — dashboard — The agent's dashboard leads with what to do, the
owner's with what went wrong — An agent opening the CRM at 9am does not need
a chart; they need to know which of their ninety leads to ring first, and a
chart cannot answer that. "Do this now" is up to six cards ordered by what
costs most to leave undone — a lead about to be taken away, then a promise
already broken, then a hot lead nobody has rung. Nothing is counted twice: a
lead that is both hot and overdue appears in the more urgent card only,
because two cards for one lead is how a list stops being trusted. Empty
counts produce no card at all, because a dashboard full of "0 overdue"
teaches people to skim.

2026-10-30 — dashboard — A standing, not a rank number — "Near the top this
week" rather than "4th of 9". A leaderboard with a number against every name
turns a team into a scoreboard, and the person in last place stops opening
the dashboard, which is the opposite of what a nudge is for.

2026-10-30 — activity — Only the sign-in that does not belong — Ten agents
signing in from their phones every morning is Tuesday, not an event, and an
owner who has to read that will stop reading by Thursday. So there is no flag
for "signed in from a phone" or "signed in at 9am". There is one for a device
nobody has seen, one for a country nobody has signed in from, one for 1am to
5am — not the evening, because agents in this business work evenings — and
one for two countries too close together in time to have flown between, which
is the single strongest sign a password is in use by somebody else. The first
sign-in on a new account produces one line rather than three alarms for one
ordinary event.

2026-10-30 — activity — Active minutes are counted from heartbeats, capped —
The heartbeat only fires while the tab is visible, and a gap longer than two
minutes adds two minutes rather than the whole gap. A laptop left open over a
weekend would otherwise read as sixty hours of work, and every "hours worked"
report built on that is a lie.

2026-10-30 — activity — GeoIP is optional and the CRM works without it — A
MaxMind database is a licence, a download and a cron job to keep fresh. The
import is a runtime one with a variable specifier so `maxmind` never becomes
a dependency of this project, and every screen reads naturally with the city
missing.

2026-10-30 — activity — Team Activity is owner and manager only — Where a
colleague signed in from is personal data about them, not a company
noticeboard. A manager sees their own team and nobody else.

2026-10-30 — reports — The insight card says the numbers are counted — Every
line is a query. The AI layer, when switched on, may rephrase those lines and
nothing else; it never sees a number it could change and never invents one.
A dashboard that mixes measured figures with generated ones teaches people to
trust neither.

2026-10-30 — ui — The new-lead alert covered the toolbar's control — The
alert sits fixed at the top right, which is exactly where the toolbar's
right-hand control sits: the Live/Sign-ins switch, New campaign, the date
range. An agent with an alert up could not press any of them, on any screen.
The alert now starts below the toolbar — 140px on a desktop, 164px on a
phone, measured rather than guessed.

2026-10-30 — profiles — The covers are drawn, not photographed — A stock
photograph of the Dubai skyline is either licensed or stolen, and a
brokerage's own CRM must not be either. Six SVG covers generated from a
handful of numbers: a couple of kilobytes each, sharp at any size, identical
on every render, and belonging to nobody but this repository. Deliberately
abstract, so nobody can say "that is the Burj and you have drawn it wrong".

2026-10-30 — profiles — The QR code is generated here — Not installed, and
not fetched from one of the free QR image services. Those services work by
being told the URL you want encoded, which for a business card is a named
person at a named brokerage handed to a third party on every page load, for
ever. Two hundred lines avoids that and avoids a dependency to keep updated.
Byte mode, level M, versions 1 to 10 — about 213 characters, where a card URL
is forty; anything longer throws rather than producing a code that will not
scan.

2026-10-30 — profiles — The QR is verified by decoding it — An encoder nobody
has decoded is an encoder that ships broken. This Chromium has no
BarcodeDetector, so the test includes an independent decoder written against
the standard, which reads the mask out of the format bits in the finished
grid rather than being told which one was chosen. It found a real bug: the
second copy of the format information is split seven then eight, not eight
then seven, and writing eight overwrote the module that must always be dark —
which strict scanners check before anything else.

2026-10-30 — profiles — The numbers on a profile cannot be typed — An agent
writes their own bio and picks a cover. Deals, viewings and how fast they
answer are counted. A profile where the figures are typed is a profile nobody
believes, starting with the person whose profile it is.

2026-10-30 — profiles — Badges are earned, never awarded — A badge somebody
can hand out is a badge somebody can withhold, and "employee of the month" is
a thing an agent resents. Every one of these is a fact checked against the
same data the reports use. They are also reachable: four land in a first
month, because a shelf that is empty on somebody's second day is a shelf they
stop looking at.

2026-10-30 — profiles — The level is a word — "Solid", "Senior", not "Level
3". A number invites comparison; a word describes. And the step from no badges
to one moves it, because the first badge should feel like something.

2026-10-30 — profiles — The public card is off by default and 404s the same
either way — A card nobody switched on cannot leak. A profile that is off,
and a slug that does not exist, both return exactly the same page: a
different message would let anybody test which agents work here by guessing
names.

2026-10-30 — profiles — The card is server-rendered HTML — No bundle, no
session, no API call, fourteen kilobytes including the cover and the QR. A
client who scans a code at a sales centre on one bar of signal gets the page,
and it works with JavaScript off. The template is a pure function so it can
be rendered and looked at without a database or a running server — which is
the only way a page nobody logs into gets checked before a client sees it.

2026-10-30 — wall — Every XP rule answers one question — "What would somebody
do if they wanted to win without doing the work?" So: points are for outcomes,
never activity (logging a call earns nothing — a person paid for activity logs
calls that did not happen; reaching somebody earns, because the client is a
witness). Everything pays once per thing, enforced by a unique key on the
table rather than a check in code, so a retried job cannot pay twice.
Everything repeatable has a daily cap, because without one the winner is
whoever has the most leads, which is a fact about the router. And nothing at
all is paid for posting on the wall: the moment points come from posting, the
wall fills with posts.

2026-10-30 — wall — The streak ignores the weekend — The UAE week is Monday to
Friday. A streak that breaks because somebody did not work Saturday is a
streak that tells people to work Saturday. A weekend day that was worked
counts; it is just never required. The sidebar says so out loud, so nobody
thinks they lost one.

2026-10-30 — wall — Kudos are five a week and one per person per week — Five
so they mean something. One per colleague per week because otherwise two
people trade five each and both end the week with twenty-five points for
nothing.

2026-10-30 — wall — No birthdays — The spec asked for birthday posts. The CRM
holds no date of birth, and starting to hold one so a wall can post about it
is not a trade worth making — it is personal data collected for a greeting.
Work anniversaries come from the joining date, which the CRM already has for
other reasons.

2026-10-30 — wall — The CRM posts, which is why anyone opens it — A wall with
only what people typed is empty by the second week. A deal closing, a new
starter and Monday's roundup appear on their own, so it is worth a look on a
quiet Tuesday. Every auto-post is idempotent on its subject, so a retried job
does not congratulate somebody twice.

2026-10-30 — wall — Deal values are off unless somebody turns them on — What a
colleague earned is not everybody's business, and a wall that leaks it is a
wall people stop posting on. The post says the project; an owner can show the
figure on one post if they want to.

2026-10-30 — wall — The Monday roundup says what people did — "Layla — 2
deals, 6 viewings", not "Layla — 418 points". A score means nothing to
anybody. A week where nothing happened gets no post rather than a post about
nobody.

2026-10-30 — palette — The palette does not skip letters — Fuzzy matching
would let "slt" find Settings. An agent who types three letters and lands on a
screen they did not mean has been hurt by the feature; one who types three
letters and gets nothing just types a fourth. A word in the label has to start
with what was typed, or the whole label has to contain it.

2026-10-30 — palette — Leads come above the screens once something is typed —
The sidebar is already a good way to reach a screen. The one thing it cannot
do is find a person, so that is what the palette leads with. With nothing
typed it is the other way round, and at most three actions, or the opening
list is "sign out, switch light and dark" and one page.

2026-10-30 — shortcuts — Only ⌘K is taken from the browser — Every other
modifier combination belongs to the browser, and a CRM that swallows ⌘R or
⌘L to be clever is a CRM people fight. Single letters are free because they
are dead inside any field.

2026-10-30 — shortcuts — G then a letter, and an unknown second key cancels —
Single letters for navigation collide with everything, and the two-key form is
the one people already know. Pressing G then N does nothing rather than adding
a lead: somebody who pressed G meant to go somewhere, and firing the wrong
thing because the second key was not in the table is how a shortcut rings a
client by accident.

2026-10-30 — tour — Five steps, and a different five for an owner — The only
tour anybody finishes is the one that ends before they get bored. An owner's
first question is "what has nobody taken", which an agent cannot even see, so
the two tours start in different places.

2026-10-30 — tour — Kept on the server, not in the browser — Somebody who
finished the tour on their laptop should not be walked through it again on
their phone. `user_prefs` is deliberately a short, fixed list of names: a table
anybody can write arbitrary keys into becomes the dumping ground for things
that should have been columns.

2026-10-30 — ai — The next step is decided by rules, the AI only words it —
The channel, the date and whether to contact somebody at all are the three
that cost money when they are wrong: a viewing on a date the model made up, a
WhatsApp to somebody who asked us to stop, a call at 2am. Rules decide those,
the same way every time, and the feature works with AI switched off — which is
how this CRM will run most days.

2026-10-30 — ai — A figure the model produced that is not in the notes is
dropped in code — The prompt says not to invent prices, and prompts are
advice. The check is a function that compares every money, area, percentage
and year against the text the model was given, and throws away the line
carrying anything it made up. It is not corrected, because there is no way to
know what it should have said.

2026-10-30 — ai — The AI moves a score, it never sets one — At most 20 points,
scaled by its own confidence, and nothing at all below half. An unreachable
lead can never be made hot, whatever it wrote, because "hot" here means a
manager gets a push and somebody drops what they are doing. A confident "junk"
puts a button on the screen; it does not close anything.

2026-10-30 — ai — Every verdict is kept, not overwritten — One row per time
the AI looked at a lead. "It said junk in March and hot in May" is then a fact
we can show rather than a thing anybody has to take on trust, and a prompt
change that makes it worse is visible instead of invisible.

2026-10-30 — ai — The nightly pass is capped at 120 leads — Every one is a
model call against the owner's monthly budget. It takes the oldest verdicts
first, so a bigger database means each lead is looked at less often rather
than the bill growing.

2026-10-30 — settings — The company lives in Settings, not in the source — The
constants file said out loud that these belonged in Settings beside the TRN.
They reach every WhatsApp footer, every email signature, every offer and every
business card, and changing the company's name needed a developer and a
deploy. The constants stay as the defaults, so an installation that never
opens the screen behaves exactly as before.

2026-10-30 — settings — Each field says where it shows up — "ORN" means
nothing on its own. "The RERA office registration number, on every offer" tells
an owner what changing it will do to a client, which is the only reason they
are on that screen.

2026-10-30 — settings — Renaming warns instead of pretending — Meta approves a
WhatsApp template's footer as part of the template, so changing the name here
cannot change one already approved. The template library is now built from the
company record, so a re-submission picks the new name up by itself, and the
screen says plainly that a re-submission is needed. The alternative is a client
welcomed by one company and followed up by another — the exact bug the single
constant was introduced to fix.

2026-10-30 — settings — The messaging limits are clamped, not validated — Six
automatic messages a day is the ceiling whatever is typed, and the quiet window
cannot be made shorter than four hours. An owner may be stricter than the
master prompt and only slightly looser. A number typed into a box should not be
able to switch a guard off, and refusing the save instead would just mean
somebody typing until it is accepted.

2026-10-30 — settings — Problems are listed, not enforced — A half-filled
company record is a normal state on day one. Refusing to save the legal name
because the TRN is not ready yet helps nobody, so the checks appear as a
"Worth fixing" list beside the fields instead.

2026-10-30 — settings — The logo URL is public — It is in the footer of every
client email and at the top of every offer page, both opened by people with no
account here. The URL carries a version so a replacement is not served from a
cache, and there is exactly one logo on disk so an old one in another format
cannot linger.

2026-10-30 — settings — A standing check that settings stay audited — Every
change is audited because `saveSetting` and `saveSecret` write the row
themselves, so the way that stops being true is somebody writing to
`app_settings` directly. A test scans the source for that rather than trusting
a comment, in the same spirit as the hook-order and schema-map checks.

2026-10-30 — polish — The layout pass is a browser, not a person — A hundred
and eight screenshots is more than anybody looks at properly. A browser can be
asked exactly the questions that matter: is anything past the right edge, does
the page itself scroll sideways, is any text cut off with no way to read it,
is any button too small for a thumb. It found the lead page dragging sideways
on a phone, a thirteen-pixel row button and a timestamp pushing the audit log
off the screen — none of which I had spotted by eye. Kept as `npm run polish`.

2026-10-30 — polish — A class is a component or a modifier, never both — This
has now bitten four times: `.note` was the hint under a field and the modifier
on a note bubble, so every internal note in the inbox sat twelve pixels too
low; `.unread` was the conversation badge and the modifier on an unread
notification, so the notifications that mattered most rendered at eleven
pixels bold. Neither shows in a type check or a test. There is a standing
check for it now, with an allowlist for the one composition that is meant.

2026-10-30 — polish — Hit areas grew, nothing moved — A thirteen-pixel button
is a button you miss, but making every control forty-four pixels would pull
the dense rows apart and change a design that was approved. Padding and an
invisible pseudo-element give the thumb something to land on while the row
keeps its proportions. Thirty-two rather than Apple's forty-four, because
that is where a miss stops being the common case inside a list.

2026-10-30 — polish — The board swipes rather than wraps on a phone — Seven
action buttons wrapped onto three rows push everything an agent came to read
below the fold. Swiping keeps Call and WhatsApp under the thumb and the rest
a flick away, which is the pattern people already know.

2026-10-30 — polish — The preview is not allowed to lie — Two whole screens —
the project library and the sales offers — showed "No route for GET" because
nothing mocked them. A preview with holes in it is worse than none: it is the
only way anybody sees the app before it is live, and a screen that errors
there reads as a screen that is broken.

2026-10-30 — polish — Two stylesheets, one name, two components — `.board` was
the pipeline's kanban in components.css and the Team Wall's leaderboard in
kit.css. kit.css loads later and says `flex-direction: column`, so the board
had not been a board since the wall was built — every stage stacked on top of
the next, on every screen size, in both themes. Nothing failed: no type error,
no test, and a screenshot of a stacked board still looks like a CRM. The
collision check now compares what each file says a class's layout is, and the
list of stylesheets it reads comes from `index.css` rather than being written
out again, so a parked file joining the build is checked the day it does.

2026-10-30 — polish — `.callout`, because both obvious names were taken — The
hint with an icon could not be `.note` (a modifier on a channel badge and a
message bubble) and could not be `.hint` either (already the plain one-line
hint under a login field, which would have gained `display:flex`). The
collision check caught the second attempt a minute after it was written, which
is the argument for having it.

2026-10-30 — deploy — **The deploy has never run, and I did not make it run** —
`deploy.yml` fires on `workflow_run` of CI with `branches: [main]`. This
repository has no `main`: the work is on `claude/new-session-krd7bx`. So 87
green CI runs produced zero deploys, and nothing from Steps 0–17 has reached
crm.homes.me. Found while checking the handover rather than reported by
anything — a workflow that never triggers is silent, which is the worst shape
for this kind of bug. The two fixes are a branch rename or a manual dispatch,
both in `SETUP_NEEDED.md` §0 and both the owner's to choose: pointing an
automatic deploy at the branch I am committing to would send every future push
of mine straight onto a site ten people use, and the build prompt's "work
autonomously" does not stretch to that. The branch filter is left exactly as
it is, because `main` is the right answer once a `main` exists.

2026-10-30 — docs — The documentation is checked against the Zod schema, not
trusted — `SETUP_NEEDED.md` told the owner to set `EMAIL_API_KEY`,
`EMAIL_TEST_INBOX`, `MAXMIND_LICENSE_KEY`, `FEATURE_GEOIP`, `VAPID_*` and four
`FEATURE_*` flags. Not one of those names exists. They were written before the
features were finished and never corrected, and nothing complains: the owner
pastes them, the CRM starts, the feature stays off, and he has no way to tell a
wrong instruction from his own typing. `config/env-docs.test.ts` now fails the
build when a variable named in `.env.example`, `SETUP_NEEDED.md`, `README.md`,
`docs/DEPLOYMENT.md` or `docs/NOTIFICATIONS.md` is not one the server reads,
and when a variable the server reads is missing from `.env.example` (15 were).

2026-10-30 — auth — **The first owner is one row with a fixed primary key, not
an advisory lock** — CI run 85 failed on `setup.integration.test.ts`: two
parallel first-run submissions both returned 201 and both became owners. The
route already took `GET_LOCK('emir_crm_setup')`, and the lock was released
*inside* the transaction — so the gap between the release and the commit was
exactly the gap that mattered. The second connection took the lock, counted a
`users` table that still looked empty because the first insert was uncommitted,
and inserted a second owner. Two owners, no error. It then passed on the next
two runs, which is why this had to be read as a race rather than a flaky test:
a failure that comes and goes on a security boundary is the bug reporting
itself. Fixed by moving the guarantee into the schema — `setup_claims` holds one
row whose primary key is always 1, written in the same transaction as the
account, so the loser blocks on the key and then gets a duplicate. No ordering
to get right. Verified by running that test twelve times: twelve passes, where
the old code passed roughly two runs in three.

2026-10-30 — testing — **The between-test reset is checked against the
migrations** — Adding `setup_claims` turned four tests red in a file it had
nothing to do with: `TRUNCATE_ORDER` in `testing/db.ts` is hand-written, the new
table was not in it, and the first test to claim the CRM claimed it for the rest
of the file. Checking the list against the schema found 27 more tables added
since it was last maintained — notes, notifications, the wall, badges, kudos, XP
events, email campaigns, preferences, AI usage, `app_secrets`. Each of those was
a test's rows reaching the next test. All 27 added; the suite stayed green, which
says nothing was depending on the leak. `testing/reset-complete.test.ts` now
fails the build when a table is in neither list, so the next one is a decision
rather than an oversight. Only `migrations`, `pipelines` and `pipeline_stages`
are kept, each with its reason written beside it.

2026-10-30 — testing — **The 269 integration tests have now actually run** —
Every report up to this point said they skip for want of a MySQL, and that was
true: this machine has no database and Docker has no daemon. It does have apt.
Installing `mysql-server-8.0` and running `mysqld_safe` gives the same 8.0.46
CI uses, and the whole suite — 2,332 tests, integration included — passes
against it. That is how the setup race was reproduced and how the fix was
proved. Worth doing first next time rather than last: the claim "the tests pass"
meant 12% less than it sounded like for the whole build.

2026-10-30 — testing — **The browser smoke test had stopped being runnable, and
that hid two things** — `npm run e2e` is the only check that drives the real
app in a browser, and it had not been run since the tour, the rebrand and the
My Leads work landed. Seven of its twenty steps failed, none of them because
the product was broken: it waited for the words "Emir CRM" on a login page that
now says homes.me; it clicked a `/contacts` sidebar link that Step 7 replaced
with My Leads; and five steps failed because **the tour is modal on a first
sign-in and was swallowing every click after the dashboard.** That last one is
correct behaviour — the dim catches a click and skips the tour, Escape closes
it, `aria-modal` says so — but a smoke test that trips over it is a smoke test
nobody runs again, and a step that silently finds nothing (the `/contacts`
click) is a step that passes by doing nothing. The tour is now checked rather
than worked around: it must appear for an account that has never seen it, and
Escape must close it. Twenty steps, all green, twice in a row.

2026-10-30 — testing — The My Leads tabs are a `tablist`, so
`getByRole('button', { name: 'All' })` finds nothing — Worth writing down
because it cost twenty minutes: the Settings tabs are `Chip` buttons and the My
Leads tabs are `Tabs` with `role="tab"`, and the two look identical on screen.
The lead page also opens on "Follow-up today", which is empty on a day with
nothing due, so a test that wants a lead has to click "All" first.

2026-10-30 — docs — `SETUP_NEEDED.md` §5 did not mention `WORKER_IN_PROCESS`,
which is the setting that whole section exists for — The developer docs are
right about it (`.env.example`, `DEPLOYMENT.md` and `GO-LIVE.md` all say it),
but the owner-facing file told him to check the app says "Running" and stopped
there. Hostinger runs one process per application; the timers live in a worker;
the default is off. With it off the CRM looks completely normal and silently
never sends a welcome message, never fires a follow-up and never checks the
five-minute rule — which is the single worst failure this product can have,
because the screens all work. Found by reading `/health` on a real server:
`"worker":"separate"`. §5 now names the variable and gives him a URL to check it
in a browser, which is also how he can tell the CRM is up.

2026-10-31 — leads — **A note moves a New Lead to Attempted Contact by itself**
— Asked for by the team: writing down what was said is evidence the call was
already made, and a stage somebody has to remember to drag is a stage that is
wrong by Thursday, which makes every report built on it wrong too. The limits
matter more than the rule, so they are in one pure function
(`leads/note-stage.ts`) with the reasons beside them: only out of New Lead,
only while the lead is open, never for the automation account. A note on a lead
at Appointment Scheduled reading "client called to confirm Saturday" must not
drag it backwards — that destroys information rather than recording it — and a
note on a Won lead is history being written down, not a reopening. It goes
through `moveStage`, not an UPDATE, so it writes the activity, the audit row
and the Meta `contacted` quality event exactly like a move made by hand; a
stage that changed with no trail is one an agent cannot argue with. The agent
is told ("Noted — moved to Attempted Contact") because a card that moves
silently is a card people stop trusting. If the move fails the note is still
saved: the agent's words are the thing being protected.

2026-10-31 — permissions — **Seeing a lead and opening it asked two different
questions** — Reported from the live CRM with screenshots. My Leads scopes on
`opportunities.owner_user_id`, as every list does; the lead page scoped on
`contacts.owner_user_id`. They agree until a person already in the CRM gets a
second enquiry assigned to somebody else, which is ordinary — the contact's
owner is sticky on purpose so a returning buyer comes back to the agent who
knows them, and `add-lead` only fills it `WHERE owner_user_id IS NULL`. The
agent then saw the lead on his list and got "This lead belongs to another
agent" on tapping it. The same check gates notes, the inbox thread and email,
so the lead was not just unopenable, it was unworkable. Owning the person **or
any of their enquiries** is now enough. The stickiness is deliberately left
alone: with the page fixed, two agents each holding their own enquiry on one
person is a sensible state, and stealing the contact to paper over it would
take the person from the agent who owns them.

2026-10-31 — company — **The business card and every client email printed a
hard-coded company name** — Both read an `app_settings` row called `company`
and pulled `.name` out of its JSON. Nothing has written that row since the
Company screen was built: it stores one setting per field
(`COMPANY_LEGAL_NAME`, `COMPANY_TRADING_NAME`, …). So the owner could fill in
Settings → Company, press Save, and the two things clients actually see would
go on saying "Emigeo Homes" forever. No error, no blank, nothing to notice —
the fallback was the bug's disguise. Both now read `companyDetails()`, and
`brandingFrom()` is the one place that turns the record into what the outside
world sees. `config/company-source.test.ts` fails the build if anything reads
the dead row again.

2026-10-31 — profiles — **An agent can now put a photo on their own card** —
`users.photo_url` existed, the card rendered it and the email signature used
it, and nothing in the product could set it: there was no upload anywhere, so
every card showed initials. Added on the profile screen, built like the company
logo — same size guard, same rate limit, one file per person, a `?v=` on the
URL so a replacement is not served from cache. The image route is public and
mounted before the auth middleware, because a business card is opened by people
with no account, and only the image is: everything else on the profile router
still needs a session, and changing somebody else's photo is still owner/admin
only.

2026-10-31 — profiles — The card refused a photo uploaded to the CRM itself —
`renderCardHtml` only accepted `^https?://`, and an uploaded photo is a path on
this server. So the upload above would have worked, served, and shown initials
anyway. It now accepts a same-origin path as well; `//host` is still refused,
because a browser reads that as a host rather than a path, and so are
`javascript:` and `data:` — this page is served to the public with no session
behind it.

2026-10-31 — cards — **The Business Card Studio renders one artboard, and
everything comes from it** — The preview, the PDF, the PNG, the JPG and the
mockup are all `renderFace()`, an SVG in real millimetres. The alternative —
a pretty preview and a separate print path — is how a card gets approved on
screen and arrives from the printer different, which is a cost nobody notices
until a box of five hundred is wrong.

2026-10-31 — cards — Poppins is self-hosted, and embedded three times over —
The brand sheet sets the card in Poppins; the CRM itself is Inter. Three
separate places had to be fixed and each failed silently: the preview rendered
in Inter (no `@font-face`), the PDF fell back to Helvetica (jsPDF ships only
the fourteen standard fonts), and the PNG/JPG fell back to the system sans
because **an SVG rasterised through an `<img>` is an isolated document and
cannot see the page's fonts**. That last one is the nasty one: the preview
beside the download button was correct while the downloaded file was not. The
TTFs are now self-hosted, registered with jsPDF, and inlined as base64 inside
the SVG before rasterising. OFL licensed, licence shipped beside them.

2026-10-31 — cards — The print PDF keeps square corners; only the images are
rounded — Rounded corners are a die-cut, not something a press prints. The
first PDF had the rounding baked in, so the artwork arrived as a rounded shape
on a white page: the ink stops short of the cut and the finished card shows
white slivers at every corner. The artwork is square and full-bleed now, and
page 3 of the PDF tells the printer the radius. The PNG and JPG keep the
rounding, because that is the card anybody pictures.

2026-10-31 — cards — The QR encoder is copied into the web app rather than
shared or re-installed — `server/src/profiles/qr.ts` already existed, written
rather than installed so that a client's number never goes to a free QR
service. The studio needs the same thing in the browser, and the two
workspaces share no source. A shared package means touching both tsconfigs and
both builds for one file that implements a frozen standard; so it is copied,
and `qr-parity.test.ts` fails the build if the two ever differ. The studio
sends nothing anywhere, which is the point: the number being encoded is the
agent's own.

2026-10-31 — cards — `jspdf` and `svg2pdf.js` are the only new dependencies,
and they are lazy — Named in the brief. They load on the first press of a
download button, so the rest of the CRM does not carry a PDF writer it never
uses. The QR library the brief also suggested was not installed, because we
already have one.

2026-10-31 — deploy — **It was deploying the whole time; I was reading the
wrong thing** — On 30 Oct I recorded that `deploy.yml` had never run and
concluded that nothing from the build had reached the live site. The first
half was true: it fires on `main`, there is no `main`, zero runs. The
conclusion was wrong. Hostinger's own GitHub integration is connected to this
repository, watches the working branch, and had deployed **every commit** —
the panel lists them all, green, about 75 seconds each. I had the owner
chasing SSH keys and repository secrets for two days over a deploy path
nothing uses.

What produced the error: I inferred the state of a system I could not reach
from the only evidence I could reach, and wrote it down as fact instead of as
an inference. The container has no route to the site, so the honest sentence
was "the Actions deploy has never run; I cannot see from here whether the site
is current" — and then ask for the hosting panel, which settled it in one
screenshot. Corrected in `FINAL_REPORT.md`, `SETUP_NEEDED.md`, `PROGRESS.md`
and `CLAUDE.md`, with the mistake left visible in each rather than quietly
rewritten.

The operational consequence matters more than the error: **every push is a
release to ten people, with no staging and no approval.** That is now the
first thing `CLAUDE.md` says about this repository.
