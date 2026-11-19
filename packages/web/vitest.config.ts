/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from 'vite';
import viteConfig from './vite.config';

// Coverage thresholds sit 3 pts below (rounded down) the actuals measured 2026-11-18 with
// `pnpm --filter @festie/web test:coverage`:
//   statements=81.98%, branches=74.81%, functions=76.91%, lines=83.77%
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
        include: ['src/components/**/*.tsx', 'src/hooks/**/*.ts', 'src/lib/**/*.ts', 'src/routes/**/*.tsx'],
        exclude: ['src/**/*.test.*', 'src/**/*.spec.*', 'src/**/*.stories.tsx', 'src/test-setup.ts', 'src/routeTree.gen.ts'],
        ...(withThresholds && {
          thresholds: {
            statements: 78,
            branches: 71,
            functions: 73,
            lines: 80,
          },
        }),
      },
    },
  }),
);
