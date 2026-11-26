import { test, expect } from '@playwright/test';

// DP-16: the legal pages, the offline page and the export template use the brand face and the token colours.
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const PAGES = ['/terms', '/privacy', '/dmca', '/delete-account', '/security-whitepaper', '/offline.html'];
const RETIRED = ['rgb(168, 216, 234)', 'rgb(0, 229, 160)'];

for (const scheme of ['dark', 'light'] as const) {
  for (const route of PAGES) {
    test(`${route} in ${scheme}: Clash Display h1, no retired colour`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(new URL(route, BASE_URL).toString());
      const fontFamily = await page.locator('h1').first().evaluate((el) => getComputedStyle(el).fontFamily);
      expect(fontFamily).toMatch(/^"?Clash Display"?/);
      const colours = await page.evaluate(() =>
        [...document.querySelectorAll('body, body *')].flatMap((el) => {
          const style = getComputedStyle(el);
          return [style.color, style.backgroundColor, style.borderTopColor];
        }),
      );
      for (const retired of RETIRED) expect(colours).not.toContain(retired);
    });
  }
}
