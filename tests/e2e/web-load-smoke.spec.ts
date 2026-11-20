import { expect, test } from '@playwright/test';

// Anonymous load check: the SPA must mount and throw no uncaught error. A chunk that throws at
// load leaves the static boot shell ("Loading Festie…") on screen while /api/ready stays 200.
// Never logs in and never writes.
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';

for (const path of ['/', '/login']) {
  test(`web app mounts at ${path}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(new URL(path, BASE_URL).toString(), { waitUntil: 'networkidle' });

    await expect(page.locator('#root .boot-shell')).toHaveCount(0);
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(pageErrors).toEqual([]);
  });
}
