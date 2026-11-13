import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every Call and every WhatsApp in the CRM is recorded.
 *
 * The owner found this on 13 Nov: only the power dialler posted to
 * `POST /api/v2/calls` and `POST /api/v2/taps`. Everywhere else, Call and
 * WhatsApp were plain `tel:` and `wa.me` links, so a call an agent made from
 * the lead page, from My day, from the pipeline board or from a follow-up did
 * not exist in calls-today, in the messaging report, in speed-to-lead or in
 * the "going cold" rule. `v2/call.ts` is the one helper that records it;
 * `lib/call-action.test.ts` holds what the helper does. This holds the other
 * half of the fault: that the screens actually use it.
 *
 * It reads the source, like `hook-order.test.ts` and `schema-map.test.ts`,
 * and for the same reason. A screen that quietly goes back to a bare `href`
 * compiles, renders, looks right and is invisible to a green suite — the
 * figures simply go wrong again, three weeks later, on somebody else's
 * screen. There is no component-testing library in this app, and mounting
 * eight screens would mean mocking forty endpoints to assert one thing;
 * `pipeline-call.test.ts` mounts one of them for real and clicks the button.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);

function source(file: string): string {
  return readFileSync(path.join(HERE, file), 'utf8');
}

/**
 * The source with its comments taken out.
 *
 * This file's own explanations contain the words `tel:` and `wa.me`, and so
 * do several of the screens' — the lead page says "`tel:` still carries the
 * unspaced number" right above the element. Scanning the raw text reported
 * that comment as an unrecorded call.
 */
function code(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The JSX elements a Call or a WhatsApp is ever drawn as. */
const OPENS_TAG = /<(a|button|Link)[\s>]/g;

/**
 * The opening tag that encloses `at`, attributes and all.
 *
 * Attributes are where the handler lives, so the test has to see the whole
 * `<a href={…} onClick={…}>` as one thing: a `tel:` in the `href` is only a
 * fault if there is no `dial.call` beside it. Braces are counted so that a
 * `>` inside an arrow function body does not end the tag early.
 */
function enclosingTag(text: string, at: number): string | null {
  OPENS_TAG.lastIndex = 0;
  let start = -1;
  for (let found = OPENS_TAG.exec(text); found; found = OPENS_TAG.exec(text)) {
    if (found.index >= at) break;
    start = found.index;
  }
  if (start < 0) return null;

  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Every `tel:` or `wa.me` in the file, with the element it sits in. */
function handOffs(file: string): Array<{ what: string; line: number; tag: string | null }> {
  const text = code(file);
  const found: Array<{ what: string; line: number; tag: string | null }> = [];
  for (const match of text.matchAll(/tel:|wa\.me\//g)) {
    found.push({
      what: match[0],
      line: text.slice(0, match.index).split('\n').length,
      tag: enclosingTag(text, match.index),
    });
  }
  return found;
}

/** The eight screens wired on to the helper, and what each one offers. */
const WIRED: Array<{ file: string; what: string; calls: boolean; whatsapp: boolean }> = [
  { file: 'Lead.tsx', what: 'the lead page', calls: true, whatsapp: true },
  { file: 'Leads.tsx', what: 'My leads, the owner’s book and the side panel', calls: true, whatsapp: true },
  { file: 'Home.tsx', what: 'My day', calls: true, whatsapp: false },
  { file: 'Pipeline.tsx', what: 'the pipeline board', calls: true, whatsapp: false },
  { file: 'Tasks.tsx', what: 'a follow-up', calls: true, whatsapp: false },
  { file: 'Projects.tsx', what: 'a project’s leads and its send card', calls: true, whatsapp: true },
  { file: 'Calendar.tsx', what: 'the no-show message', calls: false, whatsapp: true },
];

describe('the screens that ring a lead use the one helper', () => {
  for (const screen of WIRED) {
    describe(`${screen.file} — ${screen.what}`, () => {
      it('takes the helper from v2/call.ts', () => {
        expect(code(screen.file)).toMatch(/import \{[^}]*useCallAction[^}]*\} from '\.\/call\.js'/);
      });

      /*
       * Without the banner on the page the check-in sheet has nowhere to be
       * drawn, so `call()` waits on an answer nobody can give and the button
       * does nothing at all — and a failed recording says so in it, which is
       * the only place the agent is told.
       */
      it('renders the helper’s banner, so the check-in sheet has somewhere to go', () => {
        expect(code(screen.file)).toContain('dial.banner');
      });

      it('has no Call or WhatsApp left that records nothing', () => {
        for (const spot of handOffs(screen.file)) {
          expect(
            spot.tag,
            `${screen.file}:${spot.line} — a ${spot.what} link outside any element`,
          ).not.toBeNull();
          expect(
            spot.tag ?? '',
            `${screen.file}:${spot.line} — this ${spot.what} hand-off does not go through the helper, `
              + 'so the call or the tap is never recorded',
          ).toMatch(/dial\.(call|whatsapp)/);
        }
      });

      if (screen.calls) {
        it('records the call', () => {
          expect(code(screen.file)).toContain('dial.call(');
        });
      }

      if (screen.whatsapp) {
        it('records the WhatsApp tap', () => {
          expect(code(screen.file)).toContain('dial.whatsapp(');
        });
      }
    });
  }

  /*
   * The helper's own gate is the only one. The follow-ups tab used to ask the
   * check-in question itself and then record nothing, so an agent answered it
   * and the call still vanished; wiring the helper in beside it would have
   * asked the same question twice in a row.
   */
  it('leaves one check-in gate on the follow-ups tab, not two', () => {
    const text = code('Tasks.tsx');
    expect(text, 'the helper owns the gate now').not.toContain('useCheckIn');
    expect(text).toContain("useCallAction({ source: 'followup' })");
  });

  /* The dialler is told apart from the rest of the CRM by `source`. */
  it('says which screen the call came from', () => {
    expect(code('Tasks.tsx')).toContain("source: 'followup'");
    expect(code('Calling.tsx'), 'the power dialler keeps its own word')
      .toContain("source: 'dialler'");
  });
});

/**
 * The three that are deliberately left alone.
 *
 * Each is a judgement rather than an oversight, so each is written down here:
 * a change to any of them should be somebody deciding, not somebody tidying.
 * `docs/v2/questions-calls.md` has the long version.
 */
describe('what is deliberately not recorded', () => {
  /*
   * Team and Team activity ring a colleague on their own mobile — an owner
   * asking an agent about an odd sign-in, or a manager ringing their team.
   * Filing those as client contact would put calls nobody made to a client
   * into calls-today and into that agent's activity figures.
   */
  it('does not record a call to a colleague', () => {
    for (const file of ['Team.tsx', 'Activity.tsx']) {
      expect(code(file), `${file} rings staff, not leads`).not.toContain('useCallAction');
    }
  });

  /*
   * The offers share sheet is `wa.me/?text=` with no number in it: the agent
   * picks the recipient inside WhatsApp. There is nobody to file it against.
   */
  it('does not record the offer share sheet, which has no recipient', () => {
    const text = code('Offers.tsx');
    expect(text).not.toContain('useCallAction');
    expect(text, 'still the recipient-less share form').toContain('wa.me/?text=');
  });

  /*
   * The inbox thread header has a Call button and the inbox payload carries
   * no opportunity id — only the conversation and the contact. A contact can
   * hold more than one opportunity, so picking one would be a guess, and a
   * call filed against the wrong lead is worse than one filed against none.
   * Blocked on the server, written up, and left blocked.
   */
  it('leaves the inbox Call blocked rather than guessing which lead it was', () => {
    expect(code('Inbox.tsx')).not.toContain('useCallAction');
  });
});
