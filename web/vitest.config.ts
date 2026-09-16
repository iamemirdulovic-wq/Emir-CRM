import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom, because the theme module reads matchMedia, localStorage and the
    // <html> element, and those are the parts worth pinning down.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
});
