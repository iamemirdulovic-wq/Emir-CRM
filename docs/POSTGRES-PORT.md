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
| 2. Connection layer (`db/client.ts`) speaks Postgres | not started |
| 3. `ON DUPLICATE KEY UPDATE` → `ON CONFLICT` (26 places) | not started |
| 4. Test harness runs against Postgres | not started |
| 5. Full suite green on Postgres, duplicate storm included | not started |
| 6. Copy the live data across | **tool built** — `npm run copy-to-postgres` |
| 7. Cut over | not started |

The MySQL migrations in `server/migrations/` are untouched and still the live
schema. Nothing here affects the running system.

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
so 25 tables get `set_updated_at()`. That function must exist before the first
migration runs — it is created by the schema check, and will be created by the
migration runner in step 2.

**27 new indexes.** InnoDB indexes every foreign key by itself; Postgres does
not. Without them, every cascading delete and every join on those columns is a
sequential scan — slow in a way that only appears once the tables are large, by
which point it reads as "the new database is slow" rather than as a missing
index. `0013_foreign_key_indexes.sql` adds them.

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
