import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { renderFestivalPage } from '../../lib/festival-page.js';

// DP-13: the public festival page on the brand shell. The page is rendered from the real
// renderer and loaded with setContent, so no database or server is needed. The /fonts files
// are not served here; the font checks read the computed family, and tests/design-css.test.ts
// covers that the files exist.

const FESTIVAL = {
  id: 'fest-1',
  name: 'Example Fest',
  location: 'Example Field',
  timeZone: 'America/New_York',
  stages: [
    { id: 'a', name: 'Main Stage', color: '#7c3aed' },
    { id: 'b', name: 'Garden', color: '#16a34a' },
  ],
  days: ['2026-11-06', '2026-11-07', '2026-11-08'].map((date, index) => ({
    label: `Day ${index + 1}`,
    date,
    sets: [
      { id: `s${index}a`, artist: `Opener ${index + 1}`, stageId: 'a', startTime: '20:00', endTime: '21:00' },
      { id: `s${index}b`, artist: `Closer ${index + 1}`, stageId: 'b', startTime: '23:00', endTime: '00:30' },
    ],
  })),
};

const html = renderFestivalPage({ festival: FESTIVAL, origin: 'https://example.test', slug: 'example-fest' });

const rgbToLuminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

for (const scheme of ['dark', 'light'] as const) {
  for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
    test(`festival page ${label} ${scheme}`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height });
      await page.setContent(html);
      await testInfo.attach(`festival-${label}-${scheme}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

      const colours = await page.evaluate(() =>
        [...document.querySelectorAll('body, body *')].flatMap((el) => {
          const s = getComputedStyle(el);
          return [s.color, s.backgroundColor, s.borderTopColor];
        }),
      );
      expect(colours).not.toContain('rgb(214, 21, 79)');

      const family = await page.locator('h1').evaluate((el) => getComputedStyle(el).fontFamily);
      expect(family.startsWith('"Clash Display"')).toBe(true);

      const { ink, fill } = await page.locator('.ds-cta').evaluate((el) => {
        const s = getComputedStyle(el);
        return { ink: s.color, fill: s.backgroundColor };
      });
      const [a, b] = [rgbToLuminance(ink), rgbToLuminance(fill)].sort((x, y) => y - x) as [number, number];
      expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);

      const box = await page.locator('.fp-link').first().boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);

      if (width >= 900) {
        const columns = await page.locator('.fp-days').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
        expect(columns).toBeGreaterThanOrEqual(2);
        await expect(page.locator('.fp-full > summary')).toBeHidden();
        await expect(page.locator('.fp-set').first()).toBeVisible();
      } else {
        await expect(page.locator('.fp-set').first()).toBeHidden();
        await page.locator('.fp-full > summary').click();
        await expect(page.locator('.fp-set').first()).toBeVisible();
      }

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
    });
  }
}
