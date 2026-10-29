import { describe, expect, it } from 'vitest';
import { decideCopy } from './copy-once.js';

/**
 * Four answers, and the difference between them is a lead board that is full,
 * empty, or holding every lead twice. The decision is a pure function so every
 * combination can be stated here rather than discovered on the owner's server
 * during a deploy.
 */
describe('deciding whether a deploy should copy the live data', () => {
  const base = { requested: true, hasDatabaseUrl: true, postgresRows: 0, mysqlReachable: true };

  it('does nothing at all when nobody asked', () => {
    expect(decideCopy({ ...base, requested: false }))
      .toEqual({ act: 'skip', reason: 'not_requested' });
  });

  it('copies when asked, with an empty target and the old database answering', () => {
    expect(decideCopy(base)).toEqual({ act: 'copy' });
  });

  /* The one that matters most: a second deploy with the flag still set. */
  it('refuses to copy into a database that already holds rows', () => {
    expect(decideCopy({ ...base, postgresRows: 1 }))
      .toEqual({ act: 'skip', reason: 'already_populated' });
  });

  it('skips rather than fails, so a later routine deploy still succeeds', () => {
    const decision = decideCopy({ ...base, postgresRows: 50_000 });
    expect(decision.act).toBe('skip');
  });

  /*
   * Coming up with an empty CRM looks exactly like losing everything, so this
   * case stops the deploy instead of starting.
   */
  it('stops the deploy when a copy was wanted and the old database is unreachable', () => {
    expect(decideCopy({ ...base, mysqlReachable: false }))
      .toEqual({ act: 'refuse', reason: 'mysql_unreachable' });
  });

  it('stops the deploy when there is nowhere to copy to', () => {
    expect(decideCopy({ ...base, hasDatabaseUrl: false }))
      .toEqual({ act: 'refuse', reason: 'no_database_url' });
  });

  /*
   * Once the data is across, MySQL is meant to be gone. That must read as the
   * finished state, not as a failure that blocks every future deploy.
   */
  it('treats a populated target as finished even when the old database has gone', () => {
    expect(decideCopy({ ...base, postgresRows: 12, mysqlReachable: false }))
      .toEqual({ act: 'skip', reason: 'already_populated' });
  });

  it('never copies unless it was explicitly asked to', () => {
    const states = [0, 1, 99].flatMap((postgresRows) =>
      [true, false].flatMap((mysqlReachable) =>
        [true, false].map((hasDatabaseUrl) => ({
          requested: false, hasDatabaseUrl, postgresRows, mysqlReachable,
        }))));

    for (const state of states) {
      expect(decideCopy(state)).toEqual({ act: 'skip', reason: 'not_requested' });
    }
  });
});
