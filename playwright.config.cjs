const { defineConfig } = require('@playwright/test');

const artifactDir = process.env.PLAYWRIGHT_ARTIFACT_DIR || 'output/playwright';

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // One retry, and a test that needed it fails the run, so a flake shows up instead of hiding.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      stylePath: './tests/e2e/screenshot.css',
    },
  },
  snapshotDir: 'tests/__snapshots__',
  snapshotPathTemplate: 'tests/__snapshots__/{testFileName}/{arg}{ext}',
  fullyParallel: false,
  // Every test's fixture truncates and reseeds the one festie_test database, so a second worker wipes rows mid-test (8 of 16 failed at workers=2).
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `${artifactDir}/report` }],
  ],
  outputDir: `${artifactDir}/test-results`,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'visreg-setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'visreg-auth',
      testMatch: /visual-regression-auth\.spec\.ts/,
      use: { storageState: 'tests/e2e/.auth/state.json' },
      dependencies: ['visreg-setup'],
    },
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
  ],
});
