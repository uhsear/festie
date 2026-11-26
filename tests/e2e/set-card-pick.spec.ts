import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { test, expect, DEFAULT_PASSWORD, FIXTURE_NOW } from './fixtures.js';

async function openSchedule(page: Page, app: { baseUrl: string }) {
  const headers = { 'content-type': 'application/json', 'x-festie-request': '1' };
  const username = `setcard_${Date.now()}`;
  const register = await page.context().request.post(`${app.baseUrl}/api/v1/auth/register`, {
    headers,
    data: {
      username,
      password: DEFAULT_PASSWORD,
      confirmPassword: DEFAULT_PASSWORD,
      dateOfBirth: '1995-01-01',
      tosAccepted: true,
      email: `${username}@example.com`,
    },
  });
  expect(register.ok(), `registration failed (${register.status()})`).toBe(true);
  const join = await page.context().request.post(`${app.baseUrl}/api/v1/profiles`, { headers, data: { festivalId: 'fest-1' } });
  expect(join.ok(), `festival join failed (${join.status()})`).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(FIXTURE_NOW);
  await page.goto(`${app.baseUrl}/cards`);
  await expect(page.locator('[data-testid="set-card"][data-artist="Alpha"]')).toBeVisible();
}

test.describe('set card pick control, touch at 390 by 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('sets Must in two taps', async ({ app, page }) => {
    await openSchedule(page, app);
    const card = page.locator('[data-testid="set-card"][data-artist="Alpha"]');
    await card.getByRole('button', { name: /^Set priority for Alpha/ }).tap();
    await card.getByRole('button', { name: /^Must See: Alpha/ }).tap();
    await expect(card.getByRole('button', { name: /^Must See: Alpha.*Change priority/ })).toBeVisible();
    await expect(card.getByRole('button', { name: /^Maybe: Alpha/ })).toHaveCount(0);
  });
});

test.describe('set card pick control, keyboard at 1440 by 900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('sets each priority in one step after focus, and axe passes', async ({ app, page }) => {
    await openSchedule(page, app);
    const card = page.locator('[data-testid="set-card"][data-artist="Alpha"]');
    // A keyboard user tabs into the card first: focus inside it reveals the trio.
    await card.getByRole('button', { name: /^Alpha — / }).focus();
    for (const name of ['Must See', 'Want to See', 'Maybe']) {
      const button = card.getByRole('button', { name: new RegExp(`^${name}: Alpha`) });
      await button.focus();
      await expect(button).toBeVisible();
      // The card ignores a press while the previous pick is still saving.
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    }
    const results = await new AxeBuilder({ page }).include('[data-testid="set-card"]').analyze();
    expect(results.violations).toEqual([]);
  });
});
