import { defineConfig } from 'vitest/config';

// Coverage thresholds sit 3 pts below (rounded down) the actuals measured 2026-11-18 with
// `pnpm --filter @festie/shared test:coverage` (statements=90.62%,
// branches=83.57%, functions=87.4%, lines=91.75%). They enforce only when
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
      exclude: ['src/**/*.test.ts', 'src/test-setup.ts', 'src/**/index.ts', 'src/types/**', 'src/global.d.ts'],
      ...(withThresholds && {
        thresholds: {
          statements: 87,
          branches: 80,
          functions: 84,
          lines: 88,
        },
      }),
    },
  },
});
