import { defineConfig } from 'vitest/config';

// Coverage thresholds sit 3 pts below (rounded down) the actuals measured 2026-11-02 with
// `pnpm --filter @festie/shared test:coverage` (statements=89.02%,
// branches=82.03%, functions=85.8%, lines=90.16%). They enforce only when
// COVERAGE=1 to gate regressions without slowing ordinary local/CI runs.
const withThresholds = process.env.COVERAGE === '1';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-setup.ts', 'src/**/index.ts', 'src/types/**'],
      ...(withThresholds && {
        thresholds: {
          statements: 86,
          branches: 79,
          functions: 82,
          lines: 87,
        },
      }),
    },
  },
});
