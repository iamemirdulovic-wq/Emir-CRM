import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findHookOrderProblems } from './hook-order.js';

/**
 * A hook below an early return blanks the whole screen the instant the data
 * loads. It happened on the lead page, in a build that compiled and whose
 * 1,284 tests passed. So: a test that reads the source.
 */

const SRC = join(import.meta.dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : [];
  });
}

describe('finding a hook called after an early return', () => {
  it('flags a hook below a conditional return', () => {
    const problems = findHookOrderProblems(`
export function LeadPage() {
  const detail = useAsync(load, []);
  if (!detail.data) return <Spinner />;
  const actions = useLeadActions(detail.data.id, detail.reload);
  return <div>{actions.sheet}</div>;
}
`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ component: 'LeadPage', hook: 'useLeadActions' });
  });

  /*
   * The lead page exactly as it shipped. Kept verbatim rather than
   * paraphrased, so the test proves it catches the real thing and not a
   * tidied-up version of it.
   */
  it('catches the lead page as it actually went live', () => {
    const problems = findHookOrderProblems(`
export function ContactDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const detail = useAsync<Contact360>(() => api.get(\`/api/contacts/\${id}\`), [id]);
  const [busy, setBusy] = useState(false);

  async function setDnc(dnc: boolean) {
    setBusy(true);
    try {
      await api.post(\`/api/contacts/\${id}/dnc\`, { dnc });
      detail.reload();
    } finally {
      setBusy(false);
    }
  }

  if (detail.error) return <ErrorNote>{detail.error}</ErrorNote>;
  if (!detail.data) return <Spinner />;

  const { contact, opportunities } = detail.data;
  const opportunity = opportunities[0];
  const actions = useLeadActions(opportunity?.id ?? '', detail.reload);

  return <LeadActionBar lead={contact} state={actions} />;
}
`);
    expect(problems.map((p) => p.hook)).toEqual(['useLeadActions']);
  });

  it('allows every hook above the returns', () => {
    expect(findHookOrderProblems(`
export function LeadPage() {
  const detail = useAsync(load, []);
  const actions = useLeadActions(detail.data?.id ?? '', detail.reload);
  if (!detail.data) return <Spinner />;
  return <div>{actions.sheet}</div>;
}
`)).toEqual([]);
  });

  it('ignores a hook inside a callback, which runs on every render anyway', () => {
    expect(findHookOrderProblems(`
export function Panel() {
  const toast = useToast();
  if (!ready) return null;
  return <button onClick={() => useless(toast)}>Go</button>;
}
`)).toEqual([]);
  });

  it('does not read the word return inside a string or a comment', () => {
    expect(findHookOrderProblems(`
export function Panel() {
  const label = 'return it to the pool';
  // return early when nothing is owed
  const toast = useToast();
  return <span>{label}</span>;
}
`)).toEqual([]);
  });

  it('treats each component in a file separately', () => {
    const problems = findHookOrderProblems(`
export function First() {
  if (!a) return null;
  return <b />;
}

export function Second() {
  const toast = useToast();
  return <b onClick={toast} />;
}
`);
    expect(problems).toEqual([]);
  });
});

describe('every component in the app', () => {
  const files = walk(SRC);

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))(
    'calls no hook after an early return in %s',
    (_name, path) => {
      const problems = findHookOrderProblems(readFileSync(path as string, 'utf8'));
      expect(
        problems.map((p) => `${p.component} calls ${p.hook} on line ${p.line}, below an early return`),
      ).toEqual([]);
    },
  );
});
