import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import express from 'express';
import { Pool } from 'pg';
import request from 'supertest';
import { createStores } from '../lib/db/index.js';
import { createReengagementTriggers } from '../lib/notifications/reengagement.js';
import createFestivalsRoutes from '../routes/festivals.js';
import { sanitizeFestivalPayload, schemas } from '../lib/schemas.js';

// Festival series (migration 111): the schema rule, the payload rule, the store round trip and
// the lineup-drop audience. The real-DB part is skip-gated like integration-festival-slug;
// run it only against a private test database on port 5434+.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

describe('series id validation and payload', () => {
  const parse = (seriesId: unknown) => schemas.festivalCreate.safeParse({ name: 'Fest', seriesId }).success;
  const run = (input: any, stored?: any) =>
    sanitizeFestivalPayload({ name: 'Fest', ...input }, stored, { MAX_STAGES: 20, MAX_DAYS: 10 }, () => 'x');

  test('accepts a lower-case slug, null and omitted', () => {
    assert.equal(parse('forbidden-kingdom'), true);
    assert.equal(parse(null), true);
    assert.equal(parse(undefined), true);
  });
  test('rejects upper case, spaces, an empty string and 61 characters', () => {
    for (const bad of ['Forbidden-Kingdom', 'forbidden kingdom', '', 'a'.repeat(61)]) assert.equal(parse(bad), false, bad);
  });
  test('update schema inherits the field', () => {
    assert.equal(schemas.festivalUpdate.safeParse({ seriesId: 'fk' }).success, true);
    assert.equal(schemas.festivalUpdate.safeParse({ seriesId: 'FK' }).success, false);
  });
  test('omitted keeps the stored value, null clears it, a value replaces it', () => {
    const stored = { id: 'f1', seriesId: 'fk' };
    assert.equal(run({}, stored).seriesId, 'fk');
    assert.equal(run({ seriesId: null }, stored).seriesId, null);
    assert.equal(run({ seriesId: 'other' }, stored).seriesId, 'other');
    assert.equal(run({}).seriesId, null);
  });
});

describe('festival detail exposes seriesId to admins only', () => {
  const pass = () => (req: any, _res: any, next: any) => {
    req.validatedParams = req.params;
    req.validatedQuery = {};
    next();
  };
  const build = (isAdmin: boolean) => {
    const deps: any = {
      express,
      config: {},
      log: { info() {}, warn() {}, error() {}, debug() {} },
      adminAuth: pass(),
      hasRecentAuth: () => true,
      requireRecentAuth: pass(),
      getFestivalById: async () => ({
        id: 'f-1',
        name: 'Fest',
        publishedAt: '2026-01-01T00:00:00.000Z',
        seriesId: 'fk',
        stages: [],
        days: [],
      }),
      publishChecklist: () => [],
      sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
      sendError: (res: any, status: number, message: string) => res.status(status).json({ data: null, error: { message } }),
      ErrorCodes: {},
      rateLimit: pass,
      stores: { festivals: { getEditor: async () => null } },
      schemas: {},
      validate: pass,
      validateQuery: pass,
      validateParams: pass,
    };
    const app = express();
    app.use((req: any, _res: any, next: any) => {
      req.isAdmin = isAdmin;
      next();
    });
    app.use(createFestivalsRoutes(deps));
    return app;
  };

  test('an anonymous GET has no seriesId', async () => {
    const res = await request(build(false)).get('/f-1').expect(200);
    assert.equal(res.body.data.name, 'Fest');
    assert.equal('seriesId' in res.body.data, false);
  });
  test('an admin GET has it', async () => {
    const res = await request(build(true)).get('/f-1').expect(200);
    assert.equal(res.body.data.seriesId, 'fk');
  });
});

describe('Integration: festival series', { skip, concurrency: 1 }, () => {
  let pool: Pool;
  let stores: any;

  before(async () => {
    const { ensureTestSchema } = await import('./_test-schema.js');
    await ensureTestSchema(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    stores = createStores(pool);
  });

  after(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE festival_follows, festival_profiles, festival_sets, festival_days, festival_stages, festivals, users CASCADE',
    );
  });

  const festival = (id: string, name: string, seriesId: string | null = null) => ({
    id,
    name,
    location: 'Somewhere',
    seriesId,
    stages: [],
    days: [],
    publishedAt: new Date().toISOString(),
  });

  async function attend(userId: string, festivalId: string) {
    await pool.query('INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING', [
      userId,
      userId,
      'x',
    ]);
    await pool.query(
      'INSERT INTO festival_profiles (id, festival_id, user_id, created_at) VALUES ($1, $2, $3, NOW())',
      [`${festivalId}-${userId}`, festivalId, userId],
    );
  }

  /** How many people sendLineupDrop would email for this festival. */
  async function priorAttendees(festivalId: string): Promise<number> {
    const triggers = createReengagementTriggers({
      stores: {
        users: { getByIds: async () => new Map() },
        notificationLog: { existsForEvent: async () => false, existsForEvents: async () => new Set<string>() },
      },
      config: { PUBLIC_ORIGIN: 'https://festie.test', RESEND_API_KEY: '' },
      log: { info() {}, warn() {}, debug() {}, error() {} },
      notificationService: { isConfigured: false },
      pool,
    } as any);
    const dry: any = await triggers.countLineupDrop(festivalId);
    assert.equal(dry.reason, undefined);
    return dry.priorAttendees;
  }

  test('store create and getById round trip seriesId; update sets and clears it', async () => {
    await stores.festivals.create(festival('fk-2026', 'Forbidden Kingdom 2026', 'forbidden-kingdom'));
    assert.equal((await stores.festivals.getById('fk-2026')).seriesId, 'forbidden-kingdom');
    await stores.festivals.update('fk-2026', { name: 'Forbidden Kingdom 2026' });
    assert.equal((await stores.festivals.getById('fk-2026')).seriesId, 'forbidden-kingdom');
    await stores.festivals.update('fk-2026', { seriesId: null });
    assert.equal((await stores.festivals.getById('fk-2026')).seriesId, null);
    await stores.festivals.update('fk-2026', { seriesId: 'fk' });
    const listed = (await stores.festivals.readAll()).find((f: any) => f.id === 'fk-2026');
    assert.equal(listed.seriesId, 'fk');
  });

  test('replaceAll keeps seriesId', async () => {
    await stores.festivals.create(festival('fk-2026', 'Forbidden Kingdom 2026', 'forbidden-kingdom'));
    const all = await stores.festivals.readAll();
    await stores.festivals.replaceAll(all);
    assert.equal((await stores.festivals.getById('fk-2026')).seriesId, 'forbidden-kingdom');
  });

  test('a series edition still reaches an older edition that has no series id', async () => {
    await stores.festivals.create(festival('fk-2026', 'Forbidden Kingdom 2026'));
    await stores.festivals.create(festival('fk-2027', 'Forbidden Kingdom 2027', 'forbidden-kingdom'));
    await attend('old-fan', 'fk-2026');
    assert.equal(await priorAttendees('fk-2027'), 1);
  });

  test('a renamed edition that shares a series id is reached', async () => {
    await stores.festivals.create(festival('fk-2026', 'Forbidden Kingdom 2026', 'forbidden-kingdom'));
    await stores.festivals.create(festival('fk-2027', 'Forbidden Kingdom: Rebirth 2027', 'forbidden-kingdom'));
    await attend('old-fan', 'fk-2026');
    assert.equal(await priorAttendees('fk-2027'), 1);
  });

  test('a festival without a series keeps the name heuristic, and a different festival is not reached', async () => {
    await stores.festivals.create(festival('nc-2026', 'North Coast 2026'));
    await stores.festivals.create(festival('nc-2027', 'North Coast 2027'));
    await stores.festivals.create(festival('other-2026', 'Other Fest 2026', 'other'));
    await attend('nc-fan', 'nc-2026');
    await attend('other-fan', 'other-2026');
    assert.equal(await priorAttendees('nc-2027'), 1);
  });

  test('a user already in the new edition is not counted', async () => {
    await stores.festivals.create(festival('fk-2026', 'Forbidden Kingdom 2026', 'forbidden-kingdom'));
    await stores.festivals.create(festival('fk-2027', 'Forbidden Kingdom 2027', 'forbidden-kingdom'));
    await attend('both', 'fk-2026');
    await attend('both', 'fk-2027');
    assert.equal(await priorAttendees('fk-2027'), 0);
  });
});
