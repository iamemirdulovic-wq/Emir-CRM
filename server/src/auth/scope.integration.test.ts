import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { newId } from '../lib/ids.js';
import { visibleUserIds } from './scope.js';
import type { Role } from './rbac.js';

async function createTeam(managerId: string | null, memberIds: string[], isActive = true): Promise<string> {
  const id = newId();
  await execute('INSERT INTO teams (id, name, manager_user_id, is_active) VALUES (?, ?, ?, ?)', [
    id,
    `Desk ${id.slice(0, 8)}`,
    managerId,
    isActive ? 1 : 0,
  ]);
  for (const userId of memberIds) {
    await execute('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)', [id, userId]);
  }
  return id;
}

const viewer = (id: string, role: Role) => ({ id, role });

describeWithDb('visibleUserIds', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetTables();
  });

  it('gives an owner no restriction at all', async () => {
    const owner = await createTestUser({ role: 'owner' });
    expect(await visibleUserIds(viewer(owner.id, 'owner'))).toBeNull();
  });

  it('holds an agent to their own records', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await createTestUser({ role: 'agent' });
    expect(await visibleUserIds(viewer(agent.id, 'agent'))).toEqual([agent.id]);
  });

  it('gives a manager their reporting line', async () => {
    const manager = await createTestUser({ role: 'manager' });
    const reports = await createTestUser({ role: 'agent', managerId: manager.id });
    await createTestUser({ role: 'agent' });

    const ids = await visibleUserIds(viewer(manager.id, 'manager'));
    expect(new Set(ids)).toEqual(new Set([manager.id, reports.id]));
  });

  it('gives a manager the desk they run, even with no reporting line set', async () => {
    // The Phase 12 desks ("Arabic desk", "Abu Dhabi team") name their manager on
    // the team, not on each member. A manager of a desk whose members do not
    // also carry manager_id would otherwise open an empty board.
    const manager = await createTestUser({ role: 'manager' });
    const onTheDesk = await createTestUser({ role: 'agent' });
    const elsewhere = await createTestUser({ role: 'agent' });
    await createTeam(manager.id, [onTheDesk.id]);

    const ids = await visibleUserIds(viewer(manager.id, 'manager'));
    expect(new Set(ids)).toEqual(new Set([manager.id, onTheDesk.id]));
    expect(ids).not.toContain(elsewhere.id);
  });

  it('counts someone on both the desk and the reporting line once', async () => {
    const manager = await createTestUser({ role: 'manager' });
    const agent = await createTestUser({ role: 'agent', managerId: manager.id });
    await createTeam(manager.id, [agent.id]);

    const ids = await visibleUserIds(viewer(manager.id, 'manager'));
    expect(ids).toEqual([manager.id, agent.id]);
  });

  it('ignores a desk that has been switched off', async () => {
    const manager = await createTestUser({ role: 'manager' });
    const agent = await createTestUser({ role: 'agent' });
    await createTeam(manager.id, [agent.id], false);

    expect(await visibleUserIds(viewer(manager.id, 'manager'))).toEqual([manager.id]);
  });

  it('does not widen a manager to a desk somebody else runs', async () => {
    const manager = await createTestUser({ role: 'manager' });
    const other = await createTestUser({ role: 'manager' });
    const theirAgent = await createTestUser({ role: 'agent' });
    await createTeam(other.id, [theirAgent.id]);

    expect(await visibleUserIds(viewer(manager.id, 'manager'))).toEqual([manager.id]);
  });
});
