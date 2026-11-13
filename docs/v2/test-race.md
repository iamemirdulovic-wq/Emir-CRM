# The integration-test race

*13 November 2026.*

## The symptom

```
cd server && TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3307 TEST_DB_USER=crm \
  TEST_DB_PASSWORD=crmtest npx vitest run src/http/routes/meetings.integration.test.ts
```

About one test in eighteen failed, and **a different test each run**:

- `sign-in failed for user-xxxx@emircrm.test: 401 {"error":{"code":"unauthorized", …}}`
  — for a user `createTestUser` had inserted two lines earlier;
- a request whose cookie came back `401 Authentication required`;
- a test expecting `400` getting `401`.

Every one is the `users` or `sessions` row not being there when the request was
served. Run any single failing test alone with `-t "<name>"` and it passed.

## What it was

**Two vitest processes sharing one database.**

`server/vitest.config.ts` sets `pool: 'forks'` with `singleFork: true`, so the
test *files* inside one run never overlap. Nothing made the *run* exclusive.
The database name was a constant — `process.env.TEST_DB_NAME ?? 'emir_crm_test'`
— so every run started without `TEST_DB_NAME` landed on the same schema.

Every integration test calls `resetTables()` in `beforeEach`, which `TRUNCATE`s
the whole schema, `users` and `sessions` included. So a second run truncates the
first run's rows between its `createTestUser` and its `signIn`, or between two
requests that share a cookie. Which test is hit depends only on where the two
runs happen to be, which is why it moved every time and why a single test run
on its own always passed.

This was not hypothetical on the build box: five agents were working in the
repository and several were running `vitest` against the same MySQL at the same
time.

## How it was proved

Three pieces of evidence, in order.

**1. A failure that could only be another process.** The very first run
produced one failure of a shape the brief had not seen, and it gave the whole
thing away:

```
Duplicate entry '+971502223344' for key 'contacts.uq_contacts_phone'
```

That phone number is written by one helper in one file, once per test, and
`beforeEach` truncates `contacts` between them. A row of it survived that
truncate. Nothing inside one process can do that.

The general log confirmed the server was being shared. With
`SET GLOBAL general_log = ON, log_output = 'TABLE'`, one run of the
eighteen-test calendar file sat alongside **117** `TRUNCATE TABLE contacts`
statements on **86** distinct connections, and `INSERT INTO contacts`
statements naming columns that file never writes.
`information_schema.processlist` showed four other `vitest` runs live at that
moment. (The general log records no database name, and by then those four runs
had each been pointed at a hand-named database of their own, so most of those
117 belong to other schemas — that log shows the traffic, not the collision.
The duplicate-key failure above and the reproduction below are what show the
collision.)

**2. Reproduced on demand.** A second process doing nothing but what another
run's `resetTables()` does — `TRUNCATE sessions; TRUNCATE users` every 400 ms
against the same database — turned the suite from 18 passed into **14 failed**,
with exactly the reported shapes: `sign-in failed … 401`,
`expected 401 to be 400`.

**3. The control.** The same suite, unchanged, on a database no one else was
using (`TEST_DB_NAME=emir_crm_race`): **six runs, 18 passed each time**, while
the other four agents' runs continued on the same MySQL server throughout.

So the three hypotheses in the original brief — work leaking past a test
boundary, the thirty-second settings cache, an in-process worker polling — were
all wrong. For the record: `createApp()` starts only `startHeartbeat()`, which
touches no database, and nothing in the test path calls `startWorker()`.

## What changed

Test harness only. No production code, and no security control touched.

### `server/src/testing/global-setup.ts`

- A run with no `TEST_DB_NAME` now gets its own database,
  `emir_crm_run_<pid>_<epochSeconds>_<rand>`, created here and **dropped in a
  new `teardown()`**. Two runs can no longer see each other's rows.
- The name reaches the forked workers through `process.env.__EMIR_TEST_DB__` —
  the same channel that has always carried `__EMIR_DB_AVAILABLE__` into them,
  which is why it is known to work for this vitest version.
- **Setting `TEST_DB_NAME` yourself still wins**, and such a database is never
  created or dropped by the harness: that is how you point a run at a database
  you want to keep and inspect afterwards.
- Because naming it yourself turns the isolation off, setup now prints a loud
  warning when the named database already has another connection. A warning,
  not a refusal — a sleeping connection left by a crashed run looks identical
  from here.
- Abandoned databases are swept. At setup, any `emir_crm_run_*` database older
  than six hours is dropped. **Only names this harness generates are ever
  considered**, so a hand-made `emir_crm_test`, or the eleven hand-named
  databases other agents had on the box, are untouched.
- If `CREATE DATABASE` is refused — a test user without the privilege — the run
  says so in full and **falls back to `emir_crm_test`**, with the warning that
  it is shared. It does *not* report "no database reachable": that path skips
  every integration suite in the repository and calls the run green, which is
  the worst possible answer to a missing privilege. Reaching the server and
  creating a database are now two separate attempts with two separate messages.

### `server/src/testing/db.ts`

- `TEST_DB` reads `TEST_DB_NAME`, then `__EMIR_TEST_DB__`, then falls back to
  `emir_crm_test` for a run started without this project's vitest config.
- `resetTables()` now runs on **one** pooled connection it holds for the whole
  reset. `FOREIGN_KEY_CHECKS` is a session setting, and the old code set it
  with `execute()`, which takes whichever connection the pool hands it — so
  `SET FOREIGN_KEY_CHECKS = 0`, the truncates and `SET … = 1` could land on
  three different connections. It has evidently always worked, because the
  calls are awaited one at a time and the pool hands back the same idle
  connection; it was a flake waiting for a busy pool, and worse, it could
  leave FK checks off on a connection the pool then gave to a test.
- `resetTables()` no longer truncates all 106 tables every time (see below).
- The comment claiming "a whole suite runs well inside thirty seconds" is gone.
  It was false, and it was not the reason the settings cache is safe —
  `clearSecretCache()` on every reset is.

### Documentation

`README.md`'s paragraph on pointing the tests at a MySQL now says that each run
makes its own database, and what `TEST_DB_NAME` gives up. `docs/CHANGELOG.md`
has the entry.

That README line failed the suite the first time, and the check that caught it
was right: `src/config/env-docs.test.ts` holds every variable named in these
documents to the ones `env.ts` actually declares, with a short list for the
ones only scripts and the test harness read. `TEST_DB_NAME` and
`TEST_DB_PORT` were added to that list beside `TEST_DB_HOST`, `TEST_DB_USER`
and `TEST_DB_PASSWORD`, which is what it is for. The alternative — writing the
name without backticks so the check does not see it — is exactly the dodge
that test's own comment warns against.

## The reset is now about ten times cheaper

Measured on this box: `TRUNCATE`-ing the 106 tables in `TRUNCATE_ORDER` took
**4–6.5 seconds**, every test, against tests that are themselves milliseconds.
An empty InnoDB table is no cheaper to truncate than a full one — it still drops
and recreates its tablespace — and nearly all 106 are empty.

So a reset now asks, in **one** query, which tables actually hold a row:

```sql
(SELECT 'app_settings' AS t FROM `app_settings` LIMIT 1) UNION ALL
(SELECT 'app_secrets'  AS t FROM `app_secrets`  LIMIT 1) UNION ALL …
```

and truncates those. Measured at 90–230 ms for all 106 branches.

**Why isolation is still complete.** A table with no rows in it needs no
truncating — that is the whole argument, and it would be enough on its own if
the probe could not be outrun. It can, by a millisecond or two: work still in
flight from the previous test could insert a row after its table was probed.
So the answer is *remembered and never forgotten*. Once a table has been seen
holding a row, it is truncated on every later reset in the run whether the
probe finds anything in it or not. A table that has ever been written to is
therefore emptied exactly as before, and a table that never has cannot hide a
row for more than one reset. Rows are never orphaned either: a child table with
rows is always truncated, so truncating its parent cannot leave danglers.

Order is preserved — the list is filtered, not rebuilt — so `app_settings`
still goes first and children still precede parents.

Effect on the calendar file: **110 s → 24 s**, per test 4–10 s → 0.8–1.6 s,
*including* the ~9 s to migrate a fresh database. The whole server suite —
165 files, 2,960 tests — came in at **615 s**. The saving shrinks as a run goes
on, because the remembered set grows towards the whole schema as more files
write to more tables.

`src/testing/reset-complete.test.ts` still guards the *list* against the
migrations and is unchanged. Two guards were added:

- **`src/testing/reset.integration.test.ts`** (new) checks the *behaviour*
  against a real database: write rows into `users`, `contacts`, `audit_log`
  and `app_settings`, reset, and assert that the only table left holding a row
  is the `form_field_map` the reset re-seeds. It does that twice — once for a
  table being written to for the first time, once for a table already in the
  remembered set — and then checks that `beforeEach` has cleaned up after
  itself before the next test.
- `TRUNCATE_ORDER` entries are checked at module load to be plain
  `[a-z][a-z0-9_]*` names, since a table name cannot be a bound parameter and
  has to go into the probe as text.

## The result

- `npx vitest run src/http/routes/meetings.integration.test.ts` with the
  reported env: **five runs in a row, 18 passed each** — and the full server
  suite was running concurrently in another process throughout, which is the
  demonstration that the isolation holds.
- **Two runs started at the same moment, neither naming a database**: 18 passed
  each. That is the exact shape that used to fail.
- Full server suite, `npx vitest run` with the same env: **166 files, 2,963
  tests passed**, in 457 s.
- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- No `emir_crm_run_*` database left behind after a run — checked with
  `SHOW DATABASES` after each.

Each branch of the setup was exercised on purpose, not just reasoned about:

| Case | What happened |
|---|---|
| Ordinary run | Own database made, migrated, dropped at the end |
| `SKIP_DB_TESTS=1` | 18 skipped, as before |
| Port with nothing listening | "No database reachable", 18 skipped, as before |
| `TEST_DB_NAME` with another connection on it | The shared-database warning printed |
| `CREATE DATABASE` refused | Fell back to `emir_crm_test` and **ran** the integration tests (7 passed), rather than skipping them |
| Abandoned `emir_crm_run_*`, 7 hours old | Dropped, and named in the output |
| `emir_crm_run_*` a minute old (another live run) | Left alone — including, as it happened, the concurrent full suite's own database |
| A database not matching the generated pattern | Left alone |

## Still unsafe

- **Timings in this document are indicative only.** They were taken while five
  agents were running suites on the same box, and the same measurement varied
  by 50% between rounds. Treat the ratios, not the numbers.
- **`TEST_DB_NAME` is still a loaded gun.** Two runs that both set it to the
  same value collide exactly as before. They now get a warning on stdout; they
  do not get stopped.
- **The sweep is time-based, not liveness-based.** A run that somehow lasts
  more than six hours could have its database dropped under it by a run that
  starts later. Six hours is far outside anything measured, but it is an
  assumption rather than a guarantee.
- **The 269 server integration tests still skip silently** when no MySQL is
  reachable. A green run that says "skipped" has not tested the database. That
  is unchanged and still worth knowing.
- **Tables outside `TRUNCATE_ORDER` and `KEPT` persist for the life of a
  database.** With a fresh database per run that is now a non-issue by default,
  but it still bites anyone reusing one via `TEST_DB_NAME`.
- **A late insert can still outlive a reset**, for a table being written to for
  the first time in a run, in the few milliseconds between the probe and the
  truncates. The old code had the same exposure, just shifted: a row inserted
  after its own table's `TRUNCATE` survived then too. Nothing here fixes
  requests whose handlers outlive their responses; it only stops them being
  confused with the cross-process race.
