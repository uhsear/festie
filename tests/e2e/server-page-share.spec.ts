import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { renderShareErrorPage, renderSharePage } from '../../routes/share.js';

// DP-15: the share page and its error page on the brand shell. Rendered from the real renderers
// and loaded with setContent, so no database or server is needed. The /fonts files are not served
// here. A real share page from the DP-03 crew is still to be captured (see the item report).

const share = renderSharePage({
  username: 'Dana', avatarUrl: '', festivalName: 'Example Fest', festivalLocation: 'Example Field',
  days: [{
    label: 'Fri', date: 'Fri, Nov 6',
    sets: [
      { artist: 'Opener', timeText: '8:00 PM', stage: 'Main Stage', stageColor: '#7c3aed', priority: 'must' },
      { artist: 'Middle', timeText: '9:30 PM', stage: 'Garden', stageColor: '#16a34a', priority: 'want-to-see' },
      { artist: 'Closer', timeText: '11:00 PM', stage: 'Garden', stageColor: '#16a34a', priority: 'maybe' },
    ],
  }],
  totalPicks: 3, mustCount: 1, wantCount: 1, maybeCount: 1,
  origin: 'https://example.test', shareUrl: 'https://example.test/s/x', ogUrl: 'https://example.test/s/x/og.png',
  ogAlt: 'alt', jsonLd: '{}', compareUrl: 'https://example.test/c', addUrl: 'https://example.test/c#add', appUrl: 'festie://x',
});
const error = renderShareErrorPage('We cannot find that schedule', 'This schedule may have been removed.', 'https://example.test');

const luminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

for (const scheme of ['dark', 'light'] as const) {
  for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
    for (const [name, html] of [['share', share], ['error', error]] as const) {
      test(`share ${name} ${label} ${scheme}`, async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });
        await page.setContent(html);
        await testInfo.attach(`share-${name}-${label}-${scheme}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

        await expect(page.locator('svg[aria-label="Festie"]').first()).toBeVisible();

        const colours = await page.evaluate(() =>
          [...document.querySelectorAll('body, body *')].flatMap((el) => {
            const s = getComputedStyle(el);
            return [s.color, s.backgroundColor, s.borderTopColor];
          }),
        );
        expect(colours).not.toContain('rgb(255, 170, 0)'); // #ffaa00
        expect(colours).not.toContain('rgb(136, 136, 136)'); // #888

        const { ink, fill } = await page.locator('.ds-cta').first().evaluate((el) => {
          const s = getComputedStyle(el);
          return { ink: s.color, fill: s.backgroundColor };
        });
        const [a, b] = [luminance(ink), luminance(fill)].sort((x, y) => y - x) as [number, number];
        expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);

        if (name === 'share') {
          // Want is aqua here as in the app.
          const want = await page.locator('.share-priority', { hasText: 'Want to See' }).evaluate((el) => getComputedStyle(el).color);
          expect(want).toBe(scheme === 'dark' ? 'rgb(0, 232, 208)' : 'rgb(0, 89, 79)');
        }

        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
      });
    }
  }
}
