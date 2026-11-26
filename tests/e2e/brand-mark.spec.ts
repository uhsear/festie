import { test, expect } from '@playwright/test';

// DP-08: the auth screens load the Daylight mark file when the Daylight theme is active.
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';

test('login shows favicon-daylight.svg in Daylight', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'festie-ui-theme-v1',
      JSON.stringify({ state: { theme: 'daylight', followSystemTheme: false }, version: 0 }),
    );
  });
  await page.goto(new URL('/login', BASE_URL).toString());
  await expect(page.locator('img[src="/favicon-daylight.svg"]')).toBeVisible();
  await expect(page.locator('img[src="/favicon.svg"]')).toHaveCount(0);
});
