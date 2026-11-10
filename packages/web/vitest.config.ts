/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from 'vite';
import viteConfig from './vite.config';

// Coverage thresholds sit 3 pts below (rounded down) the actuals measured 2026-11-02 with
// `pnpm --filter @festie/web test:coverage`:
//   statements=71.65%, branches=68.23%, functions=67%, lines=72.99%
// They only enforce when COVERAGE=1, to avoid slowing ordinary local runs.
const withThresholds = process.env.COVERAGE === '1';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', '.storybook/**/*.test.mjs'],
      css: false,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'json-summary'],
        include: ['src/components/**/*.tsx', 'src/hooks/**/*.ts', 'src/lib/**/*.ts'],
        exclude: ['src/**/*.test.*', 'src/**/*.spec.*', 'src/test-setup.ts', 'src/routeTree.gen.ts'],
        ...(withThresholds && {
          thresholds: {
            statements: 68,
            branches: 65,
            functions: 64,
            lines: 69,
          },
        }),
      },
    },
  }),
);
