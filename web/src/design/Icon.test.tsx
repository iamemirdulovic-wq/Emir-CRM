import { describe, expect, it } from 'vitest';
import { ICON_NAMES, Icon } from './Icon.js';

describe('icon registry', () => {
  it('has no duplicate names', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it('uses the design file’s kebab-case names', () => {
    // Porting a screen is a substitution of data-lucide="x" for name="x", so a
    // name that is not kebab-case would silently break that.
    for (const name of ICON_NAMES) expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('covers every icon the approved design uses', () => {
    // Guards against someone trimming the registry and leaving a screen with a
    // missing glyph. The list comes from design/emir-crm-design.html.
    const fromDesign = ['kanban', 'message-circle', 'layout-dashboard', 'users', 'check-square',
      'building-2', 'zap', 'settings', 'log-out', 'search', 'bell', 'plus', 'moon'];
    for (const name of fromDesign) expect(ICON_NAMES).toContain(name);
  });

  it('renders every icon without throwing', () => {
    for (const name of ICON_NAMES) expect(() => Icon({ name })).not.toThrow();
  });

  it('refuses an unknown name rather than rendering a blank', () => {
    // @ts-expect-error - the point of the test is the runtime guard.
    expect(() => Icon({ name: 'no-such-icon' })).toThrow(/Unknown icon/);
  });
});
