import { test, expect } from '@playwright/test';

// DP-19: the wordmark keeps one weight (700) at every breakpoint.
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';

for (const width of [380, 480, 1440]) {
  test(`login wordmark is weight 700 at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(new URL('/login', BASE_URL).toString());
    const weight = await page
      .getByTestId('brand-wordmark')
      .evaluate((el) => getComputedStyle(el).fontWeight);
    expect(weight).toBe('700');
  });
}
