/**
 * FU-P4: the persistent SOS dock keeps clear of everything else that floats in the bottom-right
 * corner: toasts, the /grid Now button, and the map's place card and way bar. Each check opens the
 * screen with the dock showing and asserts the two boxes do not intersect.
 */
import type { Locator, Page } from '@playwright/test';

import { test, expect, registerViaApi, createCrewViaApi, signIn } from './fixtures.js';

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function expectClearOfDock(page: Page, thing: Locator, name: string) {
  const dock = await boxOf(page.getByTestId('sos-control'));
  const box = await boxOf(thing);
  expect(intersects(dock, box), `${name} ${JSON.stringify(box)} overlaps the SOS dock ${JSON.stringify(dock)}`).toBe(false);
}

async function signedInWithCrew(page: Page, app: { baseUrl: string }, prefix: string) {
  const username = `${prefix}_${Date.now()}`;
  await registerViaApi(page.context(), app, username);
  await createCrewViaApi(page.context(), app, `${prefix} crew ${Date.now()}`);
  await signIn(page, app, username);
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test.describe(`SOS dock collisions at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('a toast stacks above the dock', async ({ app, page }) => {
      await signedInWithCrew(page, app, 'sostoast');
      await page.goto(`${app.baseUrl}/crew?tab=find`);
      await page.getByRole('switch', { name: 'Lock crew' }).click();
      const toast = page.locator('.glass', { hasText: 'Crew locked' });
      await expectClearOfDock(page, toast, 'the toast');
    });

    test('the /grid Now button stacks above the dock', async ({ app, page }) => {
      // Inside Friday of the fixture festival, so the grid draws its now line and the jump button.
      await page.clock.setFixedTime(new Date('2026-06-05T10:30:00'));
      await signedInWithCrew(page, app, 'sosnow');
      // The dock needs the active crew, which only the crew and map screens load today (a hard load of
      // /grid has no dock). Reach the grid by in-app navigation instead.
      await page.goto(`${app.baseUrl}/crew`);
      await expect(page.getByTestId('sos-control')).toBeVisible();
      await page.getByRole('link', { name: 'Lineup' }).first().click();
      await page.getByRole('navigation', { name: 'Schedule view' }).getByRole('link', { name: 'Grid' }).click();
      await expect(page.getByRole('region', { name: 'Schedule grid' })).toBeVisible();
      await expectClearOfDock(page, page.getByRole('button', { name: /^Jump to now/ }), 'the Now button');
    });

    test('the map place card and way bar keep out of the dock', async ({ app, page }) => {
      await signedInWithCrew(page, app, 'sosmap');
      await page.goto(`${app.baseUrl}/map`);
      await expect(page.getByRole('region', { name: 'Crew map with meeting points and live locations' })).toBeVisible();

      await page.getByRole('button', { name: /Main Stage/ }).first().click();
      const showWay = page.getByRole('button', { name: 'Show the way' });
      await expectClearOfDock(page, showWay.locator('xpath=ancestor::div[contains(@class,"absolute")][1]'), 'the place card');

      await showWay.click();
      await expectClearOfDock(page, page.locator('[aria-live="polite"]').locator('xpath=ancestor::div[contains(@class,"absolute")][1]'), 'the way bar');
    });
  });
}
