import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { getOnboarding, listForOwner, saveOnboarding } from './store.js';
import { QUESTION_IDS } from './questions.js';

/**
 * The welcome against a real database.
 *
 * Three promises worth holding to, because each one is a thing an agent would
 * notice and nobody would think to check:
 *
 *   - answers merge, so finishing on a laptop what was started on a phone
 *     does not wipe the phone's answers;
 *   - "finish later" is its own state, different from never having been
 *     asked, so only one of them nags;
 *   - coming back and finishing stops them counting as skipped.
 */
const everything = Object.fromEntries(QUESTION_IDS.map((id, i) => [
  id, id === 'deals_per_month' ? '6' : `answer ${i}`,
]));

describeWithDb('a new agent’s welcome', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { await closeTestDatabase(); });
  beforeEach(async () => { await resetTables(); });

  it('starts with nothing, and says so without a row', async () => {
    const agent = await createTestUser({ role: 'agent' });
    expect(await getOnboarding(agent.id)).toEqual({
      preferredName: null, answers: {}, completed: false, skipped: false,
    });
  });

  it('keeps what they typed', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await saveOnboarding(agent.id, {
      preferredName: 'Mahi',
      answers: { the_dream: 'A house for my mother' },
    });
    const state = await getOnboarding(agent.id);
    expect(state.preferredName).toBe('Mahi');
    expect(state.answers.the_dream).toBe('A house for my mother');
    expect(state.completed).toBe(false);
  });

  /* Started on the phone at the sales centre, finished at the desk. */
  it('adds to the earlier answers instead of replacing them', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await saveOnboarding(agent.id, { answers: { the_dream: 'kept' } });
    await saveOnboarding(agent.id, { answers: { five_years: 'added' } });

    const state = await getOnboarding(agent.id);
    expect(state.answers.the_dream).toBe('kept');
    expect(state.answers.five_years).toBe('added');
  });

  it('is finished once every question has an answer', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await saveOnboarding(agent.id, { answers: everything });
    expect((await getOnboarding(agent.id)).completed).toBe(true);
  });

  it('remembers that they chose to finish later', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await saveOnboarding(agent.id, { skip: true });
    const state = await getOnboarding(agent.id);
    expect(state.skipped).toBe(true);
    expect(state.completed).toBe(false);
  });

  it('stops counting them as skipped once they come back and finish', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await saveOnboarding(agent.id, { skip: true });
    await saveOnboarding(agent.id, { answers: everything });

    const state = await getOnboarding(agent.id);
    expect(state.completed).toBe(true);
    expect(state.skipped).toBe(false);
  });

  it('keeps one agent out of another’s answers', async () => {
    const a = await createTestUser({ role: 'agent' });
    const b = await createTestUser({ role: 'agent' });
    await saveOnboarding(a.id, { answers: { the_dream: 'mine' } });

    expect((await getOnboarding(b.id)).answers).toEqual({});
  });
});

describeWithDb('what the owner sees', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { await closeTestDatabase(); });
  beforeEach(async () => { await resetTables(); });

  it('lists people who have not answered, because that is most of the point', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const rows = await listForOwner();
    const mine = rows.find((r) => r.userId === agent.id);
    expect(mine).toBeDefined();
    expect(mine?.answers).toEqual({});
    expect(mine?.completedAt).toBeNull();
  });

  it('shows the answers once they are given', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await saveOnboarding(agent.id, { preferredName: 'Mahi', answers: everything });

    const mine = (await listForOwner()).find((r) => r.userId === agent.id);
    expect(mine?.preferredName).toBe('Mahi');
    expect(mine?.answers.deals_per_month).toBe('6');
    expect(mine?.completedAt).not.toBeNull();
  });

  /* The service account is not a person and has nothing to say. */
  it('leaves the automation account out', async () => {
    await createTestUser({ role: 'automation' });
    expect((await listForOwner()).every((r) => r.role !== 'automation')).toBe(true);
  });
});
