/**
 * Finds a hook called after an early return.
 *
 * React identifies hooks by call order, so a `useSomething()` that sits below
 * a `return <Spinner/>` runs on the second render and not the first. The hook
 * count changes, React throws, and the whole page goes blank — not a subtle
 * wrong colour, the entire screen. It compiles, every test passes, and it only
 * appears when real data arrives a moment after the first paint, which is
 * exactly the moment nobody is looking.
 *
 * This went live on the lead page once. Hence a check rather than a habit.
 */

export interface HookOrderProblem {
  component: string;
  hook: string;
  line: number;
}

const HOOK = /(?:^|[^.\w])(use[A-Z]\w*)\s*\(/;
const FUNCTION_START = /^(?:export\s+)?function\s+([A-Z]\w*)\s*\(/;
/** Arrow components: `const Thing = (...) => {` or `= forwardRef(...)`. */
const ARROW_START = /^(?:export\s+)?const\s+([A-Z]\w*)\s*(?::[^=]+)?=\s*(?:\w+\()?\s*(?:function\s*)?\(/;

/** Strings and comments hold words like "return" that are not statements. */
function stripNoise(line: string): string {
  return line
    .replace(/\/\*.*?\*\//g, '')
    .replace(/\/\/.*$/, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

export function findHookOrderProblems(source: string): HookOrderProblem[] {
  const lines = source.split('\n');
  const problems: HookOrderProblem[] = [];

  let component: string | null = null;
  let depth = 0;
  let returnedAt = 0;
  let inComment = false;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';

    /* Block comments spanning lines would otherwise leak braces and prose. */
    let text = raw;
    if (inComment) {
      const end = text.indexOf('*/');
      if (end === -1) continue;
      text = text.slice(end + 2);
      inComment = false;
    }
    const open = text.lastIndexOf('/*');
    if (open !== -1 && text.indexOf('*/', open) === -1) {
      inComment = true;
      text = text.slice(0, open);
    }

    const clean = stripNoise(text);

    if (component === null) {
      const match = FUNCTION_START.exec(raw.trim()) ?? ARROW_START.exec(raw.trim());
      if (match) {
        component = match[1] ?? null;
        depth = 0;
        returnedAt = 0;
      }
    }

    if (component !== null) {
      /*
       * Depth 1 is the component's own body. A hook nested deeper is inside a
       * callback or another function and is somebody else's problem.
       */
      const before = depth;
      for (const char of clean) {
        if (char === '{' || char === '(') depth += 1;
        if (char === '}' || char === ')') depth -= 1;
      }

      const body = before === 1 || depth === 1;
      if (body && /(?:^|[^\w.])return(?:\s|;|$)/.test(clean)) returnedAt = i + 1;

      const hook = body ? HOOK.exec(clean) : null;
      if (hook && returnedAt > 0 && hook[1] !== 'useState') {
        problems.push({ component, hook: hook[1] ?? '', line: i + 1 });
      }

      if (depth <= 0 && before > 0) {
        component = null;
        returnedAt = 0;
        depth = 0;
      }
    }
  }

  return problems;
}
