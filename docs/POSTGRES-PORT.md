# Moving the database to Neon

Neon is PostgreSQL; this CRM was written for MySQL. That is a port, not a
setting. This page records what has been done, what is left, and the decisions
taken along the way.

## Why it is smaller than it first looks

Every query in the server goes through three functions in `server/src/db/client.ts`.
The eight other files that mention `mysql2` import it only for type names. So
the `?` → `$1` placeholder change, which looked like 939 edits, happens in one
file.

## Status

| Step | State |
|---|---|
| 1. Schema ported, 68 tables | **done** — `server/migrations-pg/` |
| 2. Connection layer (`db/client.ts`) speaks Postgres | **done** |
| 3. `ON DUPLICATE KEY UPDATE` → `ON CONFLICT` (26 places), and the rest of the dialect | **done** |
| 4. Test harness runs against Postgres | **done** |
| 5. Full suite green on Postgres, duplicate storm included | **done** |
| 6. Copy the live data across | **tool built** — needs the Hostinger server |
| 7. Cut over | needs the owner |

The MySQL migrations in `server/migrations/` are kept as the record of the live
schema until the copy is done, and are no longer applied by anything.

Steps 6 and 7 cannot be done from a development machine: one needs the server
that holds the live MySQL, the other is a deliberate switch with the app
stopped. Everything before them is finished and tested.

## How the schema was ported

Not by hand. `scripts/mysql-to-postgres.py` converts the MySQL files
mechanically; `scripts/check-postgres-schema.mjs` then applies the result to a
real Postgres (pglite, in-process, no server) and reports what was built.
Retyping 1,590 lines of DDL would have been 1,590 chances to drop a column
silently.

Proved, rather than assumed:

- All 12 files apply cleanly.
- **68 tables and 781 columns** — compared table by table and column by column
  against the MySQL source. No table and no column is missing.
- 236 indexes, and **every foreign key has one**.

## Decisions

**`CHAR(n)` became `varchar(n)`, not `uuid`.** Postgres raises an error on a
malformed uuid where MySQL simply matches nothing, so a lookup with a bad id
would turn a clean 404 into a 500. This keeps today's behaviour exactly.

**`TINYINT(1)` became `smallint`, not `boolean`.** The code reads and writes 0
and 1 in hundreds of places; booleans would mean changing every one of them for
no gain.

**`ENUM` became `text` + `CHECK`.** The same values are enforced, and adding one
later is an ordinary migration rather than `ALTER TYPE`.

**`ON UPDATE CURRENT_TIMESTAMP` became a trigger.** Postgres has no equivalent,
so 25 tables get `set_updated_at()`. The function is defined at the top of
`0001_init.sql`, where the first trigger in that file needs it. It was missing
at first and the ordering test had been creating it by hand, which hid the
fact that `0001_init` could not apply at all — found only by running the
migrations against a real server.

**27 new indexes.** InnoDB indexes every foreign key by itself; Postgres does
not. Without them, every cascading delete and every join on those columns is a
sequential scan — slow in a way that only appears once the tables are large, by
which point it reads as "the new database is slow" rather than as a missing
index. `0013_foreign_key_indexes.sql` adds them.

## What actually differed, beyond the syntax

The placeholders and the upserts were the easy part. These are the differences
that change behaviour rather than spelling, each found by a test rather than by
reading.

**An error inside a transaction aborts all of it.** MySQL let a transaction
carry on after a failed statement, so the ingestion code could attempt an
insert, catch the duplicate-key error and take another path. In Postgres every
statement after the error fails with "current transaction is aborted". This is
the heart of identity resolution — twenty copies of one lead arrive together
and nineteen of them lose the race — so left unported it would have lost leads
rather than merging them. Every one of those inserts now uses
`ON CONFLICT DO NOTHING` and reads the affected-row count, which raises
nothing. The single place that cannot (an `UPDATE` that may collide on a
unique identifier) uses a `SAVEPOINT`.

**`LIKE` is case-sensitive.** MySQL's default collation is not, so an agent
typing "ahmed" found "Ahmed Khan". Twenty-nine searches — contacts, the inbox,
offers, the project library, the AI tools — are now `ILIKE`. This one is worth
remembering because nothing would have crashed: the search box would simply
have stopped finding people.

**An aggregate cannot take a boolean.** `SUM(status = 'won')` counted trues as
1 in MySQL; Postgres has real booleans and rejects it. These are now
`COUNT(*) FILTER (WHERE …)`.

**Integer division truncates.** Two of the library's KPI cards ranked projects
by `won / leads`. With `COUNT` returning integers that is 0 for everything
except a project that converted every lead, so the ranking would have been
silently meaningless. Cast to `numeric`.

**`GROUP BY` cannot name a select alias**, and `DAYOFWEEK`, `TIMESTAMPDIFF`,
`DATE_FORMAT`, `GET_LOCK`, `<=>`, `JSON_EXTRACT` and MySQL's multi-table
`DELETE … JOIN` all have different spellings. The first-run setup lock is now
`pg_try_advisory_xact_lock`, which releases itself when the transaction ends —
a crash there can no longer wedge the setup page for everyone.

**Intervals cannot take a bound parameter.** `INTERVAL '? days'` is not a thing;
`make_interval(days => ?)` is, and it needs no quotes, which keeps the SQL
readable inside TypeScript strings.

## How it is tested now

The suite runs against a real PostgreSQL, not a mock: **957 tests, all green**,
including the duplicate-storm tests that fire twenty identical leads in
parallel and insist on exactly one contact.

Each test worker gets its own database (`emir_crm_test_1`, `_2`, …). Sharing
one was the first thing Postgres caught: a worker's reset truncates every
table, which deadlocks against another worker's inserts — and when it does not
deadlock, it quietly empties the rows another test is still using.

## Two things still worth knowing before cutover

**Distance.** The database is `localhost` today and answers in well under a
millisecond. Neon is across a network. Identity resolution holds row locks
inside a transaction while it checks for duplicates, so the link's latency
multiplies there. Pick the Neon region nearest the Hostinger server.

**Scale to zero.** Neon can suspend an idle database. A lead arriving at 3am
would then wait for it to wake, which eats into the 30-second reply the whole
system is built around. Keep the compute warm, or accept that cost knowingly.

## Copying your data in

`server/src/db/copy-to-postgres.ts` reads from the live MySQL and writes to
Neon. It **must run on the Hostinger server**, which is the only machine that
can reach both: MySQL is on localhost there, and Neon is out on the internet.

```bash
export DATABASE_URL="postgresql://…neon.tech/…"   # from the Neon dashboard

npm run copy-to-postgres -- --check     # count both sides, copy nothing
npm run copy-to-postgres                # copy into an empty Postgres
npm run copy-to-postgres -- --replace   # empty the Postgres tables first
```

Apply `server/migrations-pg/` to the Neon database before the first run, or it
will say so and stop.

What it does and does not do:

- **Never writes to MySQL.** It only reads.
- **Refuses a Postgres database that already holds rows**, unless `--replace`
  is given. Copying twice into the same tables would double every lead, and
  that is the one mistake here with no clean way back.
- **Copies parents before children**, worked out from the foreign keys rather
  than from a hand-written list that would drift as tables are added. Five
  tests hold this against the real schema; reversing the order fails two of
  them.
- **Counts every table afterwards** and fails loudly if a single one differs
  from MySQL. A copy that *looks* finished is worse than one that admits it
  broke.
- Moves the sequence on `login_attempts`, the one auto-numbered id, past the
  copied rows — otherwise the next sign-in attempt collides.
- Reads dates as strings rather than as JS dates, because converting through
  the server's timezone is exactly where an hour goes missing.

### Do a trial copy first, and expect it to find things

Copy into a Neon **branch**, not the database you intend to keep. Real data has
history in it: a status value from before a rule tightened, a row from an older
version of the schema. Those show up as a `CHECK` constraint rejecting a value,
and it is much better to meet them on a throwaway branch than during a cutover.

### This does not move the CRM

Until step 2 is done, the CRM still reads and writes MySQL. A copy made now is
a **snapshot**, and it starts going out of date the moment the next lead
arrives. Its purpose is to prove the copy works and to surface data surprises
early — the real copy happens at cutover, with the app stopped for a few
minutes so nothing is written to the old database while it runs.

## The cutover, step by step

Everything in the code is done. What is left needs the Hostinger server and a
decision to switch. Read it through once before starting; the whole thing is
about twenty minutes, and the CRM is down for roughly five of them.

Pick a quiet hour — late evening Dubai time, when leads are not arriving.

### Before the day

1. **Make the Neon database.** In Neon, create a project in the region nearest
   the Hostinger server, and a database called `emir_crm`.
2. **Copy the pooled connection string.** It is the one with `-pooler` in the
   host name.
3. **Build the schema on it.** On the server, with `DATABASE_URL` set to that
   string:
   ```bash
   cd ~/emir-crm && npm run migrate
   ```
   It should report 13 migrations applied.
4. **Do a trial copy onto a Neon branch**, not onto `emir_crm`. Real data has
   history in it — a status value from before a rule tightened, a row from an
   older schema — and the place to meet that is a branch you can throw away.
   ```bash
   npm run copy-to-postgres -- --check     # counts both sides, copies nothing
   npm run copy-to-postgres                # the real copy, into the branch
   ```
   If it stops on a `CHECK` constraint, tell me the message; it means a row in
   the live data holds a value the new schema does not allow, and the fix is a
   one-line migration, not a hand edit.

### On the day

5. **Stop the app**, so nothing writes to MySQL while the copy runs:
   ```bash
   pm2 stop emir-api emir-worker
   ```
6. **Copy the data for real**, into `emir_crm`:
   ```bash
   npm run copy-to-postgres
   ```
   It counts every table afterwards and fails loudly if even one differs.
   `--replace` empties the Postgres tables first; it is only for a second
   attempt, and it is irreversible.
7. **Point the app at Neon.** In `.env`, set `DATABASE_URL` to the pooled
   string and leave `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
   as they are — `DATABASE_URL` takes precedence when it is set.
8. **Start it again:**
   ```bash
   pm2 start emir-api emir-worker && pm2 logs --lines 50
   ```
9. **Check it, in this order.** Sign in. Open the lead board. Open one lead and
   see the WhatsApp history. Send yourself a test lead from the website. Check
   Settings → Health.

### If something is wrong

Nothing has been deleted. MySQL is untouched and still holds everything.
Remove `DATABASE_URL` from `.env`, restart, and you are back on MySQL as
though nothing happened — except for anything written while you were on Neon,
which is why the check in step 9 comes before telling the team.

Keep MySQL for at least a week after the switch.

### Two things to set up once you are on Neon

- **Back up `KEY_FILE`.** The API keys and tokens in `app_secrets` are
  encrypted with it, and it is deliberately not in the database. A Neon
  restore without that file comes back with every integration dead.
- **Decide about scale-to-zero.** Neon can suspend an idle database. A lead
  arriving at 3am would wait for it to wake, which eats into the 30-second
  reply the whole system is built around. Either keep the compute warm, or
  accept that knowingly.
