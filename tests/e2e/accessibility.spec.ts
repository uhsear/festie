import { test, expect, createCrewViaApi, registerViaApi, signIn } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * Automated accessibility scan (axe-core) over the key guest-reachable routes,
 * then over the signed-in surfaces: crew tabs, account, inbox, wrap and the set
 * detail panel.
 *
 * Runs the real WCAG rule engine against the in-process, Postgres-seeded app
 * from ./fixtures (same harness as festival-planner.spec). This is the
 * "prevention-side detector" complement to the author-time `jsx-a11y` eslint
 * rules: eslint catches static JSX defects, axe catches rendered-DOM defects
 * (roles, names, contrast, landmarks) the linter can't see.
 *
 * Gate policy: fail on `serious` + `critical` violations (the impactful,
 * unambiguous ones); `minor`/`moderate` are logged for visibility but do not
 * fail the run yet. Ratchet the gate down (include moderate) once the routes
 * are clean — see the filter below.
 */

// Guest-renderable routes (no auth needed): fest-1 auto-loads on '/', the auth
// screens render standalone, and /picks renders the GuestTeaser in place.
const ROUTES = ['/', '/login', '/register', '/picks'] as const;

const GATE_IMPACTS = new Set(['serious', 'critical']);

async function waitForShell(page: Page) {
  // '/' mounts #app; /login and /register mount .auth-screen. Wait for whichever
  // this route renders, then let async content settle before scanning.
  await page.locator('#app, .auth-screen').first().waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle');
}

// Scan the page as rendered right now and fail on serious/critical violations.
// `baselineRules` lists rule ids that are a known, documented defect on this page: they are still
// logged but do not fail the run. Every entry needs a reason at its call site and leaves the list
// when the defect is fixed.
async function expectNoGatingViolations(page: Page, label: string, baselineRules: readonly string[] = []) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  // Surface everything axe found for this route (helps triage the tail).
  if (results.violations.length) {
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({ target: n.target, html: n.html })),
      help: v.helpUrl,
    }));
    // eslint-disable-next-line no-console
    console.log(`axe violations on ${label}:
${JSON.stringify(summary, null, 2)}`);
  }

  const gating = results.violations.filter((v) => GATE_IMPACTS.has(v.impact ?? '') && !baselineRules.includes(v.id));
  expect(gating, `serious/critical a11y violations on ${label}`).toEqual([]);
}

test.describe('accessibility (axe) — key routes', () => {
  for (const route of ROUTES) {
    test(`no serious/critical a11y violations on ${route}`, async ({ app, page }) => {
      await page.goto(`${app.baseUrl}${route}`);
      await waitForShell(page);
      await expectNoGatingViolations(page, route);
    });
  }
});

// Signed-in surfaces. The user owns a crew so the crew tabs render their real content, not the empty state.
const SIGNED_IN_ROUTES = [
  '/crew?tab=find',
  '/crew?tab=members',
  '/crew?tab=plan',
  '/crew?tab=money',
  '/account',
  '/inbox',
  '/wrap',
] as const;

test.describe('accessibility (axe) — signed-in routes', () => {
  test.beforeEach(async ({ app, page }) => {
    const username = `a11y_${Date.now()}`;
    await registerViaApi(page.context(), app, username);
    await createCrewViaApi(page.context(), app, `A11y Crew ${Date.now()}`);
    await signIn(page, app, username);
  });

  for (const route of SIGNED_IN_ROUTES) {
    test(`no serious/critical a11y violations on ${route}`, async ({ app, page }) => {
      await page.goto(`${app.baseUrl}${route}`);
      await waitForShell(page);
      await expectNoGatingViolations(page, route);
    });
  }

  test('no serious/critical a11y violations in the set detail panel', async ({ page }) => {
    const card = page.locator('[data-testid="set-card"][data-artist="Alpha"]');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /^Alpha — / }).click();
    await expect(page.locator('[aria-label="Set detail panel"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    // Baseline: the related-set buttons ("Gamma", "Beta") use an aria-label that starts with the
    // artist but does not contain the visible text as one phrase (WCAG 2.5.3 label in name).
    // Fix in packages/web/src/components/features/AlsoPlaysSection.tsx, then drop this entry.
    await expectNoGatingViolations(page, 'the set detail panel', ['label-content-name-mismatch']);
  });
});

test.describe('accessibility (axe) — open dialog', () => {
  test('no serious/critical a11y violations in the Create Crew dialog', async ({ app, page }) => {
    await registerViaApi(page.context(), app, `a11ydialog_${Date.now()}`);
    await page.goto(`${app.baseUrl}/crew`);
    await page.getByRole('button', { name: 'Create Crew' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoGatingViolations(page, 'the Create Crew dialog');
  });
});
