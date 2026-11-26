import { test, expect, createCrewViaApi, loginAdminUi, openUserContext, registerViaApi, signIn } from './fixtures.js';

/**
 * Critical-flow browser E2E: sign in, join by invite, meeting point, SOS,
 * offline expense, admin lineup import. One test per flow, Chromium only.
 *
 * Each test seeds its own users through the API with a Date.now() suffix, so
 * flows never share state. Selectors use roles and accessible names; no
 * data-testid was added to app code for this suite.
 *
 * The service worker is blocked (playwright.config.cjs `serviceWorkers: 'block'`),
 * so the offline test exercises the in-page write queue, not the service worker.
 */

test.describe('critical flows', () => {
  // The auth limiter keeps its counters in Redis, outside the per-test server, so the whole
  // run shares one budget per address. Under the default 10 per 5 minutes the browser
  // matrix starved its later tests with "Too many tries" (nightly issue 190).
  test('the e2e server does not throttle repeated sign-ups from one address', async ({ app, page }) => {
    for (let i = 0; i < 15; i++) {
      await registerViaApi(page.context(), app, `burst_${i}_${Date.now()}`);
    }
  });

  test('sign in with an existing account shows the profile badge', async ({ app, page }) => {
    const username = `signin_${Date.now()}`;
    await registerViaApi(page.context(), app, username);

    await signIn(page, app, username);

    await expect(page).toHaveURL(/\/cards$/);
    await page.locator('[data-testid="profile-badge"]').click();
    await expect(page.locator('[data-testid="user-menu-profile"]')).toBeVisible();
  });

  test('a second user joins a crew by invite link and the owner sees them', async ({ app, page, browser }) => {
    const owner = `owner_${Date.now()}`;
    await registerViaApi(page.context(), app, owner);
    const crew = await createCrewViaApi(page.context(), app, `Invite Crew ${Date.now()}`);
    await signIn(page, app, owner);

    const joinerContext = await openUserContext(browser);
    try {
      const joiner = `joiner_${Date.now()}`;
      await registerViaApi(joinerContext, app, joiner);
      const joinerPage = await joinerContext.newPage();
      await signIn(joinerPage, app, joiner);

      await joinerPage.goto(`${app.baseUrl}/?joinCrew=${crew.inviteCode}`);
      await joinerPage.getByRole('button', { name: 'Join crew', exact: true }).click();
      await expect(joinerPage).toHaveURL(/\/crew\?tab=members/);

      await page.goto(`${app.baseUrl}/crew?tab=members`);
      await expect(page.getByRole('tabpanel')).toContainText(joiner);
    } finally {
      await joinerContext.close();
    }
  });

  test('a meeting point with a label and a time shows in the list and survives a reload', async ({ app, page }) => {
    const username = `meeter_${Date.now()}`;
    await registerViaApi(page.context(), app, username);
    const crew = await createCrewViaApi(page.context(), app, `Meet Crew ${Date.now()}`);
    await signIn(page, app, username);

    const label = `Main gate ${Date.now()}`;
    const meetAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);

    await page.goto(`${app.baseUrl}/crew?tab=find`);
    await page.getByRole('button', { name: 'Add meeting point', exact: true }).click();
    await page.getByLabel('Label', { exact: true }).fill(label);
    await page.getByLabel('Location', { exact: true }).fill('By the ticket booth');
    await page.getByLabel(/^Meet at/).fill(meetAt);
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // Exact: the crew activity feed also echoes the label as ": <label>".
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByText('By the ticket booth')).toBeVisible();

    await page.reload();
    await expect(page.getByText(label, { exact: true })).toBeVisible();

    const res = await page.context().request.get(`${app.baseUrl}/api/v1/crews/${crew.id}/meeting-points`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { data: unknown };
    const points = (Array.isArray(body.data) ? body.data : (body.data as { meetingPoints: unknown[] }).meetingPoints) as {
      label: string;
      meet_at?: string | null;
      meetAt?: string | null;
    }[];
    const saved = points.find((p) => p.label === label);
    const savedAt = saved?.meet_at ?? saved?.meetAt;
    expect(savedAt).toBeTruthy();
    expect(new Date(savedAt as string).getTime()).toBe(new Date(meetAt).getTime());
  });

  test('raising an SOS shows the alert and clearing it removes it', async ({ app, page }) => {
    const username = `sosraiser_${Date.now()}`;
    await registerViaApi(page.context(), app, username);
    await createCrewViaApi(page.context(), app, `SOS Crew ${Date.now()}`);
    await signIn(page, app, username);

    await page.goto(`${app.baseUrl}/crew?tab=find`);
    const panel = page.getByRole('tabpanel');
    // The one persistent control: Enter opens the confirm dialog, no press-and-hold needed.
    await page.getByRole('button', { name: 'Send SOS', exact: true }).press('Enter');
    await page.getByRole('dialog').getByRole('button', { name: 'Send SOS', exact: true }).click();

    await expect(panel.getByText('You raised an SOS')).toBeVisible();

    await panel.getByRole('button', { name: "I'm safe — clear SOS" }).click();
    await page.getByRole('dialog').getByRole('button', { name: "I'm safe", exact: true }).click();

    await expect(panel.getByText('You raised an SOS')).toHaveCount(0);
  });

  test('an SOS raised by one member shows for another member and clears for them', async ({ app, page, browser }) => {
    const raiser = `sosfrom_${Date.now()}`;
    await registerViaApi(page.context(), app, raiser);
    const crew = await createCrewViaApi(page.context(), app, `SOS Pair ${Date.now()}`);
    await signIn(page, app, raiser);

    const watcherContext = await openUserContext(browser);
    try {
      const watcher = `soswatch_${Date.now()}`;
      await registerViaApi(watcherContext, app, watcher);
      const watcherPage = await watcherContext.newPage();
      await signIn(watcherPage, app, watcher);
      await watcherPage.goto(`${app.baseUrl}/?joinCrew=${crew.inviteCode}`);
      await watcherPage.getByRole('button', { name: 'Join crew', exact: true }).click();
      await expect(watcherPage).toHaveURL(/\/crew\?tab=members/);
      await watcherPage.goto(`${app.baseUrl}/crew?tab=find`);
      const mainBefore = await watcherPage.locator('#main-content').boundingBox();

      await page.goto(`${app.baseUrl}/crew?tab=find`);
      await page.getByRole('button', { name: 'Send SOS', exact: true }).press('Enter');
      await page.getByRole('dialog').getByRole('button', { name: 'Send SOS', exact: true }).click();
      await expect(page.getByRole('tabpanel').getByText('You raised an SOS')).toBeVisible();

      const alert = watcherPage.getByTestId('sos-banner').filter({ hasText: `${raiser} raised an SOS` });
      await expect(alert).toBeVisible({ timeout: 30_000 });
      // The banner floats over the page, so its arrival moves nothing below it.
      expect(await watcherPage.locator('#main-content').boundingBox()).toEqual(mainBefore);

      await page.getByRole('tabpanel').getByRole('button', { name: "I'm safe — clear SOS" }).click();
      await page.getByRole('dialog').getByRole('button', { name: "I'm safe", exact: true }).click();
      await expect(alert).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await watcherContext.close();
    }
  });

  test('an expense added offline shows as pending, syncs once and is not duplicated', async ({ app, page }) => {
    const username = `spender_${Date.now()}`;
    await registerViaApi(page.context(), app, username);
    const crew = await createCrewViaApi(page.context(), app, `Money Crew ${Date.now()}`);
    await signIn(page, app, username);

    const description = `Gas ${Date.now()}`;
    await page.goto(`${app.baseUrl}/crew?tab=money`);
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    await page.getByLabel('Description').fill(description);
    await page.getByLabel('Amount').fill('42.50');

    await page.context().setOffline(true);
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(page.getByText(description)).toBeVisible();
    await expect(page.getByText('Not sent yet')).toBeVisible();

    await page.context().setOffline(false);
    // The replay is done when the pending marker is gone.
    await expect(page.getByText('Not sent yet')).toHaveCount(0, { timeout: 30_000 });

    const res = await page.context().request.get(`${app.baseUrl}/api/v1/crews/${crew.id}/expenses`);
    expect(res.ok()).toBe(true);
    const { data } = (await res.json()) as { data: { description: string; amount: string }[] };
    const saved = data.filter((e) => e.description === description);
    expect(saved).toHaveLength(1);
    expect(Number(saved[0]?.amount)).toBe(42.5);
  });

  test('expenses added across two offline cycles each sync once', async ({ app, page }) => {
    const username = `cycler_${Date.now()}`;
    await registerViaApi(page.context(), app, username);
    const crew = await createCrewViaApi(page.context(), app, `Cycle Crew ${Date.now()}`);
    await signIn(page, app, username);
    await page.goto(`${app.baseUrl}/crew?tab=money`);

    const descriptions = [`Ice ${Date.now()}`, `Water ${Date.now()}`];
    for (const description of descriptions) {
      await page.getByRole('button', { name: 'Add expense', exact: true }).click();
      await page.getByLabel('Description').fill(description);
      await page.getByLabel('Amount').fill('10');

      await page.context().setOffline(true);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByText(description)).toBeVisible();
      await expect(page.getByText('Not sent yet')).toBeVisible();

      await page.context().setOffline(false);
      await expect(page.getByText('Not sent yet')).toHaveCount(0, { timeout: 30_000 });
    }

    // A reconnect refetch can drop the "Not sent yet" row before the replay lands, so poll the server.
    for (const description of descriptions) {
      await expect
        .poll(
          async () => {
            const res = await page.context().request.get(`${app.baseUrl}/api/v1/crews/${crew.id}/expenses`);
            const { data } = (await res.json()) as { data: { description: string }[] };
            return data.filter((e) => e.description === description).length;
          },
          { timeout: 30_000 },
        )
        .toBe(1);
    }
  });

  test('an admin imports a pasted lineup and the sets appear in the schedule', async ({ app, page }) => {
    await loginAdminUi(page, app);

    await page.goto(`${app.baseUrl}/admin?tab=festivals&festival=fest-1&view=import`);
    await page
      .getByLabel(/Paste cells from Google Sheets/)
      .fill(
        [
          'artist,stage,day,date,start,end',
          'Zeta Wave,Main Stage,Friday,2026-06-05,15:00,16:00',
          'Omicron,Forest Stage,Friday,2026-06-05,16:30,17:30',
        ].join('\n'),
      );
    await page.getByRole('button', { name: 'Next: match columns' }).click();
    await page.getByRole('button', { name: 'Check rows' }).click();
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText(/Import done\./)).toBeVisible();

    await page.goto(`${app.baseUrl}/cards`);
    await expect(page.locator('[data-testid="set-card"][data-artist="Zeta Wave"]')).toBeVisible();
    await expect(page.locator('[data-testid="set-card"][data-artist="Omicron"]')).toBeVisible();
  });
});
