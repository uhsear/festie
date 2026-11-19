/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import viteConfig from './vite.config';

// Tests that touch window/document/localStorage/etc. without rendering a component. Everything else
// in *.test.ts runs in the cheaper node environment (no jsdom boot, no setup file).
const domTests = [
  'src/components/crew/crew-map/useGeolocationWatch.test.ts',
  'src/components/features/useDetailPanelData.test.ts',
  'src/hooks/useCrewQuerySink.test.ts',
  'src/hooks/useFestivalLoader.test.ts',
  'src/hooks/useFestivalMode.test.ts',
  'src/hooks/useHaptics.test.ts',
  'src/hooks/useIOSInstall.test.ts',
  'src/hooks/useInboxRefresh.test.ts',
  'src/hooks/useKeyboardTrap.test.ts',
  'src/hooks/useLastKnownFix.test.ts',
  'src/hooks/useLineupHref.test.ts',
  'src/hooks/useMediaQuery.test.ts',
  'src/hooks/useNowIndicator.test.ts',
  'src/hooks/useOfflineDownload.test.ts',
  'src/hooks/useOfflineQueue.test.ts',
  'src/hooks/usePushLanding.test.ts',
  'src/hooks/usePushNotifications.test.ts',
  'src/hooks/useRealtimeSync.test.ts',
  'src/hooks/useScrollFade.test.ts',
  'src/hooks/useScrollReset.test.ts',
  'src/hooks/useSetStatus.test.ts',
  'src/hooks/useTimelineFilters.test.ts',
  'src/lib/downloadExport.test.ts',
  'src/lib/providerScripts.test.ts',
  'src/lib/setRowTimes.test.ts',
  'src/lib/shareImage.test.ts',
  'src/lib/sharePoster.test.ts',
  'src/lib/theme.firstVisit.test.ts',
  'src/lib/theme.test.ts',
  'src/lib/web-vitals.test.ts',
  'src/router.test.ts',
];

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
      css: false,
      projects: [
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
            setupFiles: ['./src/test-setup.ts'],
            include: ['src/**/*.test.tsx', '.storybook/**/*.test.mjs', ...domTests],
          },
        },
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: ['src/**/*.test.ts'],
            exclude: [...configDefaults.exclude, ...domTests],
          },
        },
      ],
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
