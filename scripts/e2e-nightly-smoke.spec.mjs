// Read-only production smoke for scripts/e2e-nightly.sh. Copied next to the
// provisioned Playwright so its ESM import of @playwright/test resolves.
import { test, expect } from '@playwright/test';

test('health endpoint reports ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(JSON.stringify(await res.json())).toContain('ok');
});

test('home page renders the app shell without page errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page.locator('#root')).not.toBeEmpty();
  expect(errors).toEqual([]);
});
