import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom, because the theme module reads matchMedia, localStorage and the
    // <html> element, and those are the parts worth pinning down.
    environment: 'jsdom',
    /*
     * Dubai, because the product is.
     *
     * Several things here are read in the viewer's own clock: what time it is
     * where a client is, how far that is from Dubai, and the next decent hour
     * to ring them. In a browser that clock is an agent's, in Dubai. On a
     * build machine it is UTC, so without this the tests measure the runner
     * and not the product -- and they disagree by four hours, which is the
     * exact size of the mistake they exist to catch.
     */
    env: { TZ: 'Asia/Dubai' },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
});
