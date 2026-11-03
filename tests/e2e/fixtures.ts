import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { test as base, expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { Pool } from 'pg';

import { createFestivalPlanner } from '../../server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'test-admin-password';
const DEFAULT_PASSWORD = 'Str0ngTest!Pw';

// The functional E2E server is Postgres-backed (Festie has no JSON data layer —
// see lib/app-context). The e2e-web.yml CI job provides a `festie_test` database
// via the postgres service and runs the migrations before Playwright starts, so
// the schema already exists here; we connect only through TEST_DATABASE_URL,
// then TRUNCATE + seed a deterministic two-festival
// fixture (mirrors tests/_integration-helpers.ts). The fixture data — fest-1
// "Test Fest" (Alpha/Beta/Gamma/Delta) and fest-2 "Campfire Fest" (Omega) — is
// what every assertion in festival-planner.spec.ts reads back through the SPA.
//
// The mirror is deliberate — do not replace it with an import. fest-2 exists
// only here because festival-planner.spec.ts switches to it, while
// integration-festivals.test.ts asserts its own baseline is exactly one
// festival, so one shared factory cannot satisfy both. Importing
// tests/_integration-helpers.ts is also unsafe: it calls process.exit(1) at
// module scope and enforces a looser database-name contract (any URL containing
// "_test") than resolveTestDatabaseUrl below (exactly "festie_test"). Drift risk
// is accepted and bounded: keep the shared fest-1 object in sync by hand; both
// suites assert its artists by name, so a divergence fails loudly.
function createFestivalFixture() {
  return [
    {
      id: 'fest-1',
      name: 'Test Fest',
      location: 'Test Grounds',
      stages: [
        { id: 'main', name: 'Main Stage', color: '#ff3366' },
        { id: 'forest', name: 'Forest Stage', color: '#00e8d0' },
      ],
      days: [
        {
          label: 'Friday',
          date: '2026-06-05',
          sets: [
            { id: 'set-a', artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' },
            { id: 'set-b', artist: 'Beta', stageId: 'forest', startTime: '10:30', endTime: '11:30' },
            { id: 'set-c', artist: 'Gamma', stageId: 'main', startTime: '12:00', endTime: '13:00' },
          ],
        },
        {
          label: 'Saturday',
          date: '2026-06-06',
          sets: [{ id: 'set-d', artist: 'Delta', stageId: 'forest', startTime: '14:00', endTime: '15:00' }],
        },
      ],
      createdAt: '2026-03-09T00:00:00.000Z',
      updatedAt: '2026-03-09T00:00:00.000Z',
    },
    {
      id: 'fest-2',
      name: 'Campfire Fest',
      location: 'Lakeside',
      stages: [{ id: 'ember', name: 'Ember Stage', color: '#ff8c00' }],
      days: [
        {
          label: 'Sunday',
          date: '2026-06-07',
          sets: [{ id: 'set-o', artist: 'Omega', stageId: 'ember', startTime: '16:00', endTime: '17:00' }],
        },
      ],
      createdAt: '2026-03-09T00:00:00.000Z',
      updatedAt: '2026-03-09T00:00:00.000Z',
    },
  ];
}

// Resolve the disposable database the in-process server will use. Never fall
// back to DATABASE_URL: developers commonly keep their real app database there.
// Requiring the exact database name makes the destructive fixture fail closed.
export function resolveTestDatabaseUrl(
  env: { TEST_DATABASE_URL?: string } = process.env,
): string {
  const rawUrl = env.TEST_DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      'E2E fixture requires explicit TEST_DATABASE_URL ending in /festie_test. DATABASE_URL is never used.',
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(rawUrl).pathname.replace(/^\/+/, ''));
  } catch {
    throw new Error('E2E fixture requires TEST_DATABASE_URL to be a valid Postgres URL.');
  }

  if (databaseName !== 'festie_test') {
    throw new Error(
      `SAFETY: refusing to seed/truncate database "${databaseName || '(missing)'}"; ` +
        'TEST_DATABASE_URL must name the disposable database exactly "festie_test".',
    );
  }
  return rawUrl;
}

async function truncateAllTables(pool: InstanceType<typeof Pool>) {
  // CASCADE drops dependent rows (profiles/picks/crews/etc.) so each test run
  // starts from a clean slate. Wrapped in a try so a missing table (older
  // schema) doesn't abort the whole run.
  await pool.query(`
    TRUNCATE TABLE
      festival_profile_notes, festival_profile_picks, festival_profiles,
      festival_sets, festival_days, festival_stages, festivals,
      crew_members, crews,
      user_sessions, users
    RESTART IDENTITY CASCADE
  `);
}

async function seedFestivals(pool: InstanceType<typeof Pool>, festivals = createFestivalFixture()) {
  for (const festival of festivals) {
    await pool.query(
      'INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
      [festival.id, festival.name, festival.location, festival.createdAt, festival.updatedAt],
    );
    for (let si = 0; si < festival.stages.length; si++) {
      const stage = festival.stages[si]!;
      await pool.query(
        'INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, $3, $4, $5)',
        [festival.id, stage.id, stage.name, stage.color, si],
      );
    }
    for (let di = 0; di < festival.days.length; di++) {
      const day = festival.days[di]!;
      await pool.query('INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, $2, $3, $4)', [
        festival.id,
        di,
        day.label,
        day.date,
      ]);
      for (let sei = 0; sei < day.sets.length; sei++) {
        const set = day.sets[sei]!;
        await pool.query(
          'INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [set.id, festival.id, di, set.artist, set.stageId, set.startTime, set.endTime, sei],
        );
      }
    }
  }
}

async function startServer() {
  const databaseUrl = resolveTestDatabaseUrl();

  // Seed BEFORE the server boots so the very first GET /festivals (fired by the
  // SPA's useFestivalLoader on page load) already sees the fixture.
  const seedPool = new Pool({ connectionString: databaseUrl });
  try {
    await truncateAllTables(seedPool);
    await seedFestivals(seedPool);
  } finally {
    await seedPool.end();
  }

  const planner = await createFestivalPlanner({
    ADMIN_USER,
    ADMIN_PASSWORD,
    DATABASE_URL: databaseUrl,
    PUBLIC_DIR,
    NODE_ENV: 'test',
    // Redis is optional for the functional suite; disable so a missing/locked
    // Redis can't fail server boot (presence/rate-limit fall back to memory).
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
  });

  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  const address = planner.server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    databaseUrl,
    planner,
    async close() {
      await planner.close();
    },
  };
}

// Sanity-check that the React SPA build exists where routes/pages.ts looks for
// it. Without it the server serves the public/ fallback stub (empty #root) and
// every test would mysteriously time out waiting for #app. Surfacing this as a
// clear error beats a wall of unexplained timeouts.
function assertSpaBuilt() {
  const reactIndex = path.join(PUBLIC_DIR, '..', 'packages', 'web', 'dist', 'index.html');
  if (!fs.existsSync(reactIndex)) {
    throw new Error(
      `React SPA build missing at ${reactIndex}. Run \`pnpm --filter @festie/web build\` before the E2E suite ` +
        '(the e2e-web.yml CI job does this in the "Build web frontend" step).',
    );
  }
}

// The fixture festivals are dated June 2026. Once both are past, the picker opens the
// newest one (fest-2), so every page starts its clock before them to keep fest-1 the
// default. setSystemTime shifts the clock but lets it run, so timers, retry backoff and
// relative times still advance.
export const FIXTURE_NOW = new Date('2026-06-01T12:00:00');

export const test = base.extend<{ app: Awaited<ReturnType<typeof startServer>> }>({
  app: async ({}, use) => {
    assertSpaBuilt();
    const app = await startServer();
    await use(app);
    await app.close();
  },
  // The first-run onboarding modal (Onboarding.tsx, aria-modal) overlays the
  // whole page and intercepts every pointer event, timing out any test that
  // clicks the app. Pre-mark it completed so specs exercise the real flows;
  // onboarding itself gets dedicated coverage by clearing this key.
  page: async ({ page }, use) => {
    await page.clock.setSystemTime(FIXTURE_NOW);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('festie_onboarding_completed', 'true');
      } catch {
        /* storage unavailable — onboarding will just show */
      }
    });
    await use(page);
  },
});

// ── Helpers for the critical-flow specs ──────────────────────────────────────

const API_HEADERS = { 'content-type': 'application/json', 'x-festie-request': '1' };

type AppRef = { baseUrl: string; databaseUrl?: string };

// Register through the API. The session cookie lands in `context`, so the same
// context can seed data (crews) before the user signs in through the form.
export async function registerViaApi(context: BrowserContext, app: AppRef, username: string) {
  const res = await context.request.post(`${app.baseUrl}/api/v1/auth/register`, {
    headers: API_HEADERS,
    data: {
      username,
      password: DEFAULT_PASSWORD,
      confirmPassword: DEFAULT_PASSWORD,
      dateOfBirth: '1995-01-01',
      tosAccepted: true,
    },
  });
  expect(res.ok(), `registration failed (${res.status()})`).toBe(true);
}

// Sign in through the real /login form and wait for the profile badge. Cookies
// are cleared first so a session left by registerViaApi cannot skip the form.
export async function signIn(page: Page, app: AppRef, username: string, password = DEFAULT_PASSWORD) {
  await page.context().clearCookies();
  await page.goto(`${app.baseUrl}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('[data-testid="profile-badge"]')).toBeVisible();
}

// Create a crew in fest-1 as the user whose cookie `context` holds. Returns the id and invite code.
export async function createCrewViaApi(context: BrowserContext, app: AppRef, name: string, festivalId = 'fest-1') {
  const res = await context.request.post(`${app.baseUrl}/api/v1/crews`, {
    headers: API_HEADERS,
    data: { name, festivalId },
  });
  expect(res.ok(), `crew creation failed (${res.status()})`).toBe(true);
  const { data } = (await res.json()) as { data: { id: string; inviteCode: string } };
  return { id: data.id, inviteCode: data.inviteCode };
}

// A second browser context for a second user. It carries the same clock, pre-set
// onboarding flag and service-worker block as the default `page` fixture.
export async function openUserContext(browser: Browser) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.clock.setSystemTime(FIXTURE_NOW);
  await context.addInitScript(() => {
    try {
      localStorage.setItem('festie_onboarding_completed', 'true');
    } catch {
      /* storage unavailable — onboarding will just show */
    }
  });
  return context;
}

// Admin is a database role, not a configured username: register a fresh user,
// grant the `admin` role directly (as tests/integration-auth.test.ts does), then
// sign in through the form so the SPA loads with isAdmin set.
export async function loginAdminUi(page: Page, app: AppRef) {
  if (!app.databaseUrl) throw new Error('loginAdminUi needs app.databaseUrl from the app fixture.');
  const username = `admin_${Date.now()}`;
  await registerViaApi(page.context(), app, username);
  const pool = new Pool({ connectionString: app.databaseUrl });
  try {
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
       SELECT u.id, r.id, NULL, NOW() FROM users u, roles r
       WHERE u.username = $1 AND r.name = 'admin'
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [username],
    );
  } finally {
    await pool.end();
  }
  await signIn(page, app, username);
  return username;
}

export { expect, ADMIN_USER, ADMIN_PASSWORD, DEFAULT_PASSWORD };
