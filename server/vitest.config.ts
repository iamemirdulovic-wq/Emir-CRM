import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: ['./src/testing/global-setup.ts'],
    // Integration suites share one database, so they must not run concurrently.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
