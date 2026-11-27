import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { renderInviteErrorPage, renderInviteJoinPage } from '../../lib/invite-pages.js';

// DP-14: the crew invite page and its error page on the brand shell. Rendered from the real
// renderers and loaded with setContent, so no database or server is needed. The /fonts files are
// not served here; the font checks read the computed family, and tests/design-css.test.ts covers
// that the files exist.

const join = renderInviteJoinPage({
  crewName: 'Example Crew',
  ownerName: 'Dana',
  memberCount: 6,
  spotsLeft: 2,
  festivalName: 'Example Fest',
  startDate: '2026-11-06',
  endDate: '2026-11-08',
  inviteCode: 'ABC123',
  origin: 'https://example.test',
  memberInitials: ['D', 'A', 'B', 'C', 'E'],
  now: new Date('2026-10-28T12:00:00Z'),
});
const error = renderInviteErrorPage("We couldn't find a crew with this code.");

const rgbToLuminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

for (const scheme of ['dark', 'light'] as const) {
  for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
    for (const [page_, html] of [['join', join], ['error', error]] as const) {
      test(`invite ${page_} ${label} ${scheme}`, async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });
        await page.setContent(html);
        await testInfo.attach(`invite-${page_}-${label}-${scheme}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

        const colours = await page.evaluate(() =>
          [...document.querySelectorAll('body, body *')].flatMap((el) => {
            const s = getComputedStyle(el);
            return [s.color, s.backgroundColor, s.borderTopColor];
          }),
        );
        expect(colours).not.toContain('rgb(214, 21, 79)'); // #d6154f
        expect(colours).not.toContain('rgb(255, 92, 133)'); // #ff5c85

        const family = await page.locator('h1').evaluate((el) => getComputedStyle(el).fontFamily);
        expect(family.startsWith('"Clash Display"') || family.startsWith("'Clash Display'")).toBe(true);

        const { ink, fill } = await page.locator('.ds-cta').evaluate((el) => {
          const s = getComputedStyle(el);
          return { ink: s.color, fill: s.backgroundColor };
        });
        const [a, b] = [rgbToLuminance(ink), rgbToLuminance(fill)].sort((x, y) => y - x) as [number, number];
        expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);

        if (page_ === 'join') {
          await expect(page.locator('.iv-face')).toHaveCount(5);
          await expect(page.locator('.iv-when')).toHaveText('Fri in 9 days');
        } else {
          await expect(page.locator('svg[aria-label="Festie"]')).toBeVisible();
        }

        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
      });
    }
  }
}
