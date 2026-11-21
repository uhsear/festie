/**
 * The organizer platform through the real SPA: an admin creates an organization and adds the owner by email,
 * the owner opens /manage, creates a draft, imports a list of names, submits for review, is declined once,
 * fixes it, is approved, and shares the public link. A viewer sees the same festival read-only.
 */
import { Pool } from 'pg';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, loginAdminUi, registerViaApi, signIn, openUserContext, DEFAULT_PASSWORD } from './fixtures';

const OWNER_EMAIL_DOMAIN = 'example.com';

async function sql(databaseUrl: string, text: string, params: unknown[] = []) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return await pool.query(text, params);
  } finally {
    await pool.end();
  }
}

test.use({ actionTimeout: 15_000 });

// The same gate as accessibility.spec.ts: serious and critical axe violations fail the run.
async function expectAxeClean(page: Page, where: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const gating = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html.slice(0, 120)) }));
  expect(gating, `serious or critical a11y violations ${where}`).toEqual([]);
}

// A phone-width page must not scroll sideways.
async function expectFitsPhone(page: Page, where: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow ${where}`).toBeLessThanOrEqual(0);
}

test('organizer journey: create, submit, decline, fix, approve and share', async ({ page, browser, app }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const orgName = `E2E Venue ${stamp}`;
  const festivalName = `E2E Fest ${stamp}`;
  const ownerName = `e2eowner${stamp}`;
  const viewerName = `e2eview${stamp}`;
  const ownerEmail = `${ownerName}@${OWNER_EMAIL_DOMAIN}`;

  // The owner has an account but has not confirmed the email yet, so the membership stays pending.
  const ownerContext = await openUserContext(browser);
  await registerViaApi(ownerContext, app, ownerName);
  const viewerContext = await openUserContext(browser);
  await registerViaApi(viewerContext, app, viewerName);

  // 1. The admin creates the organization, adds the owner by email and activates it.
  await loginAdminUi(page, app);
  await page.goto(`${app.baseUrl}/admin?tab=organizations`);
  await page.getByLabel('Organization name').fill(orgName);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { name: orgName })).toBeVisible();
  await page.getByLabel('Member email').fill(ownerEmail);
  await page.getByLabel(/^Role/).selectOption('owner');
  await page.getByRole('button', { name: 'Add member' }).click();
  // Member changes need a recent password.
  await page.getByPlaceholder('Password').fill(DEFAULT_PASSWORD);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await expect(page.getByText(/Joins when they sign in with this email and confirm it/)).toBeVisible();
  await expectAxeClean(page, 'on the admin organization page');
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(page.getByText(/Status: Active/)).toBeVisible();

  // 2. The owner confirms the email, signs in and finds the organization on /manage.
  await sql(app.databaseUrl!, 'UPDATE users SET email_verified_at = NOW() WHERE username = $1', [ownerName]);
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, app, ownerName);
  await ownerPage.goto(`${app.baseUrl}/manage`);
  await expect(ownerPage.getByRole('heading', { name: 'Manage your festivals' })).toBeVisible();
  await expect(ownerPage.getByText('No festivals yet')).toBeVisible();
  await expectAxeClean(ownerPage, 'on /manage');
  await ownerPage.getByRole('button', { name: 'New festival' }).click();
  await ownerPage.getByLabel('Festival Name').fill(festivalName);
  await ownerPage.getByLabel('Location').fill('Orlando, FL');
  await expect(ownerPage.getByLabel('Festival time zone')).not.toHaveValue('');
  await ownerPage.getByRole('button', { name: 'Create festival' }).click();
  await expect(ownerPage.getByText('Festival created as a draft. Only your team and Festie can see it.').first()).toBeVisible();
  await expect(ownerPage.getByRole('heading', { name: festivalName })).toBeVisible();
  await expect(ownerPage.getByText('Draft', { exact: true })).toBeVisible();
  // Admin-only controls are not on the page.
  await expect(ownerPage.getByText('Tell people whose picks changed')).toHaveCount(0);
  await expect(ownerPage.getByRole('button', { name: 'Publish festival' })).toHaveCount(0);

  // 3. A list of names is the fast path to a lineup.
  await ownerPage.getByRole('button', { name: 'Import lineup', exact: true }).first().click();
  await ownerPage.getByLabel(/Paste cells from Google Sheets/).fill('Kai\nMira\nNoor');
  await ownerPage.getByRole('button', { name: 'Check as a list of names' }).click();
  await ownerPage.getByRole('button', { name: 'Approve', exact: true }).click();
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(ownerPage.getByText(/Announced lineup: 3 added/)).toBeVisible();
  // An organizer never sees the announcement controls.
  await expect(ownerPage.getByText('Announce lineup')).toHaveCount(0);

  // 4. A names-only draft can be submitted.
  await ownerPage.getByRole('button', { name: 'Details', exact: true }).click();
  await ownerPage.getByRole('button', { name: 'Submit for review' }).click();
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(ownerPage.getByText('Sent. Festie usually reviews within 2 working days. We will email you.').first()).toBeVisible();
  await expect(ownerPage.getByText('Waiting for review', { exact: true })).toBeVisible();

  // 5. The admin declines with a note.
  await page.goto(`${app.baseUrl}/admin?tab=organizations`);
  await page.getByRole('button', { name: /^Review queue \(1\)/ }).click();
  await page.getByRole('button', { name: `Decline ${festivalName}` }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Add the festival days.');
  await page.getByRole('dialog').getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(page.getByText('Nothing is waiting for review.')).toBeVisible();

  // 6. The owner reads the note, adds a dated day and submits again.
  await ownerPage.goto(`${app.baseUrl}/manage`);
  await expect(ownerPage.getByText('Festie asked for changes: Add the festival days.')).toBeVisible();
  await ownerPage.getByRole('button', { name: festivalName, exact: true }).click();
  await expect(ownerPage.getByText('Changes requested', { exact: true })).toBeVisible();
  await expectAxeClean(ownerPage, 'in the organizer festival editor');
  await expectFitsPhone(ownerPage, 'in the organizer festival editor');
  await ownerPage.getByRole('button', { name: '+ Add Day' }).click();
  await ownerPage.getByLabel('Day label').fill('Friday');
  await ownerPage.getByLabel('Day date').fill('2026-12-04');
  await ownerPage.getByRole('button', { name: /^Save 1 change/ }).click();
  await expect(ownerPage.getByText(/Changes are saved|Saved|Festival updated/).first()).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Submit again' }).click();
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(ownerPage.getByText('Waiting for review', { exact: true })).toBeVisible();

  // 7. The viewer, added by the admin, sees the festival read-only.
  await sql(
    app.databaseUrl!,
    `INSERT INTO organization_members (organization_id, user_id, role)
     SELECT o.id, u.id, 'viewer' FROM organizations o, users u WHERE o.name = $1 AND u.username = $2`,
    [orgName, viewerName],
  );
  await sql(app.databaseUrl!, 'UPDATE users SET email_verified_at = NOW() WHERE username = $1', [viewerName]);
  const viewerPage = await viewerContext.newPage();
  await signIn(viewerPage, app, viewerName);
  await viewerPage.goto(`${app.baseUrl}/manage`);
  await expect(viewerPage.getByRole('button', { name: 'New festival' })).toHaveCount(0);
  await viewerPage.getByRole('button', { name: festivalName, exact: true }).click();
  await expect(viewerPage.getByText(/You can look at this festival but not change it/)).toBeVisible();
  await expect(viewerPage.getByLabel('Festival Name')).toBeDisabled();
  await expectAxeClean(viewerPage, 'in the read-only editor');
  await expect(viewerPage.getByRole('button', { name: /^Save/ })).toHaveCount(0);
  await expect(viewerPage.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);
  await expect(viewerPage.getByRole('button', { name: 'Import lineup', exact: true })).toHaveCount(0);

  // 8. The admin approves it. The festival goes live.
  await page.goto(`${app.baseUrl}/admin?tab=organizations`);
  await page.getByRole('button', { name: /^Review queue \(1\)/ }).click();
  await expectAxeClean(page, 'on the review queue');
  await page.getByRole('button', { name: `Approve ${festivalName}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(`${festivalName} is live. The owners get an email.`).first()).toBeVisible();

  // 9. The owner sees the live status and the public link, and the link opens the festival.
  await ownerPage.goto(`${app.baseUrl}/manage`);
  const link = ownerPage.getByRole('link', { name: /\/f\// });
  await expect(link).toBeVisible();
  await expect(ownerPage.getByText('Live', { exact: true })).toBeVisible();
  await expect(ownerPage.getByRole('button', { name: new RegExp(`^Copy link to ${festivalName}`) })).toBeVisible();
  const href = await link.getAttribute('href');
  const response = await ownerPage.request.get(href!);
  expect(response.status()).toBe(200);

  // 10. The account menu offers /manage to a member, and not to someone outside every organization.
  await ownerPage.goto(`${app.baseUrl}/cards`);
  await ownerPage.getByTestId('profile-badge').click();
  await expect(ownerPage.getByRole('button', { name: 'Manage your festivals' })).toBeVisible();
  const outsider = `e2eout${stamp}`;
  const outsiderContext = await openUserContext(browser);
  await registerViaApi(outsiderContext, app, outsider);
  const outsiderPage = await outsiderContext.newPage();
  await signIn(outsiderPage, app, outsider);
  await outsiderPage.getByTestId('profile-badge').click();
  await expect(outsiderPage.getByRole('button', { name: 'Account settings' })).toBeVisible();
  await expect(outsiderPage.getByRole('button', { name: 'Manage your festivals' })).toHaveCount(0);
  await outsiderPage.goto(`${app.baseUrl}/manage`);
  await expect(outsiderPage.getByText('You are not part of an organization on Festie yet.')).toBeVisible();

  await ownerContext.close();
  await viewerContext.close();
  await outsiderContext.close();
});
