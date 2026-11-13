import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The eight faults the owner found by hand, one test each, by name.
 *
 * These read the source rather than trusting it, in the house style of
 * `phone.test.ts` and `design-classes.test.ts`, and for the same reason: what
 * they check is invisible when it breaks. A date input with no `min` looks
 * exactly like one with it. A refusal printed under the wrong field is a
 * refusal that renders perfectly. A delete button with one tap behind it is a
 * delete button.
 *
 * The behaviour behind them is tested where it lives: the rules in
 * `plan-rules.test.ts`, the endpoints in
 * `server/src/http/routes/meetings.integration.test.ts`.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(path.join(HERE, name), 'utf8');

const CALENDAR = read('Calendar.tsx');
const TASKS = read('Tasks.tsx');

/** The body of the one JSX element whose text contains a marker. */
function around(source: string, marker: string, before = 900, after = 900): string {
  const at = source.indexOf(marker);
  expect(at, `"${marker}" is not in the source at all`).toBeGreaterThan(-1);
  return source.slice(Math.max(0, at - before), at + after);
}

describe('1. the calendar accepts a plan in the past', () => {
  it('puts a floor on both date inputs of the new-plan form', () => {
    const field = around(CALENDAR, 'id="v2-cal-day"');
    expect(field, 'the browser must not even offer a past day').toContain('min={today}');
  });

  it('checks the day and the time before it saves, and names which is wrong', () => {
    expect(CALENDAR).toContain('pastProblem(on, at)');
    expect(CALENDAR).toContain("past?.field === 'day' ? past.message : null");
    expect(CALENDAR).toContain("past?.field === 'time' ? past.message");
    /* The refusal is printed under the field it is about, not under the title. */
    expect(around(CALENDAR, 'id="v2-cal-day"')).toContain('{dayError}');
    expect(around(CALENDAR, 'id="v2-cal-time"')).toContain('{timeError}');
  });

  it('will not save while either of them is wrong', () => {
    expect(CALENDAR).toContain('if (leadProblem || titleProblem || dayError || timeError) return;');
  });
});

describe('2. a plan cannot be edited or deleted', () => {
  it('has "Change day or time", and it patches the plan', () => {
    expect(CALENDAR).toContain('Change day or time');
    expect(CALENDAR).toContain('api.patch(`/api/v2/meetings/${meeting?.id}`');
    expect(CALENDAR).toContain('Save the new time');
  });

  it('checks the past and warns of a clash on the new time too', () => {
    const card = around(CALENDAR, 'id="v2-cal-newday"', 1400, 1400);
    expect(card).toContain('min={today}');
    expect(CALENDAR).toContain('clashIn(plans, on, at, lengthMin, plan.id)');
  });

  it('has Delete, and it asks twice', () => {
    expect(CALENDAR).toContain('api.del(`/api/v2/meetings/${meeting?.id}`)');
    expect(CALENDAR).toContain("if (!sure) { setSure(true); return; }");
    expect(CALENDAR).toContain("sure ? 'Tap again to delete' : 'Delete'");
  });
});

describe('3. a cancelled plan still looks like a normal plan', () => {
  it('carries the result through from the server rather than a bare boolean', () => {
    expect(CALENDAR).toContain('result: meeting.result');
  });

  it('wears its own word in the day list and on the panel', () => {
    /* Three places read it: the day list, the panel's chip row, and the
       grid's own tooltip. */
    expect(CALENDAR.match(/resultChip\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(around(CALENDAR, 'const chip = resultChip(plan.result)')).toContain('{chip.label}');
  });
});

describe('4. a new task always opens at 10:00', () => {
  it('opens at the next free time instead', () => {
    expect(TASKS).toContain('nextFreeSlot(');
    expect(TASKS, 'nothing is hard-coded to ten any more').not.toMatch(/useState\(\s*'10:00'\s*\)/);
  });

  it('blames the time, under Time, when only the hour has gone', () => {
    expect(TASKS).toContain("past?.field === 'time' ? past.message : null");
    expect(around(TASKS, 'id="v2-task-time"')).toContain('{timeProblem}');
  });

  it('blames the day, under Day, when the day has gone', () => {
    expect(TASKS).toContain("past?.field === 'day' ? past.message : null");
    expect(around(TASKS, 'id="v2-task-day"')).toContain('{dayProblem}');
  });

  it('keeps the title field for what is wrong with the title', () => {
    expect(around(TASKS, 'id="v2-task-title"')).toContain('{titleProblem}');
    expect(around(TASKS, 'id="v2-task-title"')).not.toContain('{why}');
  });

  it('says what the design says when a meeting has no time', () => {
    expect(TASKS).toContain("'A meeting needs a time.'");
  });

  it('lets an overdue task be renamed, but not pushed further back', () => {
    /* The rule is suspended only while the day and the hour are the ones the
       task already had. Change either and the past is refused again. */
    expect(TASKS).toContain('const past = wasPast && keptItsHour ? null : pastProblem(on, at);');
  });
});

describe('5. the new-plan form has no lead picker', () => {
  it('has one, filled from the agent’s own leads', () => {
    expect(CALENDAR).toContain('id="v2-cal-lead"');
    expect(CALENDAR).toContain("api.get('/api/my-leads?tab=all&pageSize=200')");
    expect(CALENDAR).toContain('Choose from your leads…');
    expect(CALENDAR).toContain('Pick from the list. A team plan has no lead.');
  });

  it('requires one for a meeting, a site visit and a call', () => {
    expect(CALENDAR).toContain("const LEAD_REQUIRED = ['meeting', 'site_visit', 'call']");
    expect(CALENDAR).toContain("needsLead && !leadId ? 'Choose a lead from the list.' : null");
  });

  it('sends the lead and the person with the plan', () => {
    const body = around(CALENDAR, "await api.post('/api/v2/meetings'", 200, 700);
    expect(body).toContain('opportunityId');
    expect(body).toContain('contactId');
  });
});

describe('6. no clash warning', () => {
  it('compares the new plan against that day', () => {
    expect(CALENDAR).toContain('clashIn(plans, on, at, mins)');
    expect(CALENDAR).toContain('This time is taken.');
  });

  it('warns and does not block', () => {
    /* The design's own behaviour: the button changes its word and still
       saves. A calendar that argues is a calendar nobody uses. */
    expect(CALENDAR).toContain("clash ? 'Save anyway' : 'Save the plan'");
    expect(CALENDAR).not.toContain('disabled={busy || Boolean(clash)}');
    const save = around(CALENDAR, "clash ? 'Save anyway' : 'Save the plan'", 300, 60);
    expect(save).toContain('disabled={busy}');
  });
});

describe('7. "several days" is missing', () => {
  it('has the switch and the 2-to-5-day chips', () => {
    expect(CALENDAR).toContain('Runs for several days');
    expect(CALENDAR).toContain('[2, 3, 4, 5].map');
    expect(CALENDAR).toContain('{one} days');
  });

  it('saves it as one all-day plan ending the midnight after the last day', () => {
    expect(CALENDAR).toContain("instantOf(addDays(on, spanDays), '00:00')");
    expect(CALENDAR).toContain('allDay: multi');
  });

  it('draws it on every day it covers, as a band', () => {
    expect(CALENDAR).toContain('d-band');
    expect(CALENDAR).toContain("first ? '' : 'd-mid'");
    /* The month cell asks the map for each day, so the expansion has to put
       the plan in every one of them. */
    expect(CALENDAR).toContain('put(dayKey(next), plan)');
  });
});

describe('8. the meeting result throws almost everything away', () => {
  it('offers the design’s five answers', () => {
    for (const one of ['showed', 'no_show', 'rescheduled', 'cancelled', 'booked']) {
      expect(CALENDAR).toContain(`result === '${one}'`);
    }
  });

  it('asks a meeting that happened for the next step and the interest', () => {
    expect(CALENDAR).toContain("message: 'Choose the next step.'");
    expect(CALENDAR).toContain("message: 'Choose Hot, Warm or Cold.'");
    expect(CALENDAR).toContain('How interested is the client?');
    /* The endpoint has always accepted both, and nothing ever sent them. */
    expect(CALENDAR).toContain("interest: result === 'showed' ? interest : null");
  });

  it('really moves the plan when it was moved', () => {
    expect(CALENDAR).toContain('New day');
    expect(CALENDAR).toContain('Who asked to move it?');
    expect(CALENDAR).toContain('movedTo: moved');
  });

  it('asks a no-show to be tried again, and has the message ready', () => {
    expect(CALENDAR).toContain('Try again');
    expect(CALENDAR).toContain('Message is ready');
    expect(CALENDAR).toContain('we waited for you');
  });

  it('asks who cancelled', () => {
    expect(CALENDAR).toContain('Who cancelled?');
    expect(CALENDAR).toContain("message: 'Choose who cancelled.'");
  });

  it('asks a booking for the unit, the price, what was paid and a receipt', () => {
    expect(CALENDAR).toContain('Price in AED');
    expect(CALENDAR).toContain('Paid now in AED');
    expect(CALENDAR).toContain('Booking form or receipt');
    expect(CALENDAR).toContain("message: 'Paid now cannot be more than the price.'");
    expect(CALENDAR).toContain('api.upload<{ name: string }>(');
  });

  it('sends the note the endpoint has always taken', () => {
    expect(CALENDAR).toContain('note: note.trim() || null');
  });

  it('will not save until the one missing answer is given', () => {
    expect(CALENDAR).toContain("message: 'Choose one result first.'");
    expect(CALENDAR).toContain('if (why) return;');
  });
});
