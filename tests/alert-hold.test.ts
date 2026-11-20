import 'dotenv/config';
/**
 * The hold on attendee alerts that an organizer's save would send (plan-v3 6.2, lib/alert-hold.ts).
 *
 * Mocked deps, no database: a member's PUT and a member's lineup import hold their alerts and send nothing,
 * an admin's still send, and `notify: false` holds nothing. The database half runs the held-change store:
 * the merge rule across saves, the moved-back drop, the claim that makes a release send once, and the
 * review state of a publish request. It skips without TEST_DATABASE_URL.
 */

import assert from 'node:assert/strict';
import { after, describe, mock, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import createFestivalsRoutes from '../routes/festivals.js';
import createLineupImportRoute from '../routes/lineup-import.js';
import { deliverScheduleAlert, isOrganizerRequest } from '../lib/alert-hold.js';
import { createFestivalReviewStore, heldRowsToAlert } from '../lib/db/stores/festival-review.js';
import { ensureTestSchema, TEST_DATABASE_URL, skip } from './_test-schema';

const pass = () => (req: any, _res: any, next: any) => {
  req.validatedBody = req.body;
  req.validatedParams = req.params;
  next();
};

const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const stages = [{ id: 'main', name: 'Main' }];
const sets = (shift: number) =>
  [0, 1].map((i) => ({ id: `s${i}`, artist: `Artist ${i}`, stageId: 'main', startTime: hhmm(720 + i * 120 + shift), endTime: hhmm(780 + i * 120 + shift) }));
const day = (shift: number) => [{ label: 'Sat', date: '2026-04-11', sets: sets(shift) }];

type Actor = 'admin' | 'editor';

// The festival router with a member or an admin behind festivalAccess, one picker on set s0.
function buildPut(actor: Actor) {
  const existing: any = { id: 'f-1', name: 'Fest', publishedAt: '2026-01-01T00:00:00.000Z', location: 'Field', latitude: 1, longitude: 1, stages, days: day(0) };
  const hold = mock.fn(async (_id: string, alert: any) => ({ held: alert.changes.length, people: 1 }));
  const scheduleChanged = mock.fn(async (_arg: any) => {});
  const audits: any[] = [];
  const deps: any = {
    express,
    config: {},
    log: { info() {}, warn() {}, error() {}, debug() {} },
    adminAuth: pass(),
    hasRecentAuth: () => true,
    requireRecentAuth: (_req: any, _res: any, next: any) => next(),
    getFestivalById: async () => existing,
    validateFestivalIssues: () => [],
    publishChecklist: () => [],
    sanitizeFestivalPayload: (body: any, current: any) => ({ ...current, ...body }),
    getRequestIp: () => '127.0.0.1',
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string, details?: any) =>
      res.status(status).json({ data: null, error: { message, code, ...details } }),
    ErrorCodes: { NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR', INVALID_INPUT: 'INVALID_INPUT', FORBIDDEN: 'FORBIDDEN' },
    rateLimit: pass,
    stores: {
      festivals: { countOnSets: async () => 0, update: async (id: string, data: any) => ({ ...existing, id, ...data }) },
      profiles: { pickersBySet: async () => new Map([['s0', ['u1']]]) },
      timeReleases: { releasedDates: async () => new Set<string>() },
      festivalReview: { hold },
      auditLog: { insert: async (row: any) => audits.push(row) },
    },
    emitter: { festivalCreated() {}, festivalUpdated() {}, scheduleChanged },
    schemas: {},
    validate: pass,
    validateQuery: pass,
    validateParams: pass,
    invalidateFestivalCache: () => {},
  };
  deps.festivalAccess = () => (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    req.festivalRole = actor;
    if (actor === 'admin') req.isAdmin = true;
    req.organizationId = actor === 'editor' ? 'org-a' : null;
    req.orgVerified = false;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(createFestivalsRoutes(deps));
  return { app, hold, scheduleChanged, audits };
}

describe('a save that moves a picked set', () => {
  const move = { days: day(30), expectedUpdatedAt: FAR_FUTURE };

  test('by an organization member is held: one hold, no alert, the response says so', async () => {
    const { app, hold, scheduleChanged, audits } = buildPut('editor');
    const res = await request(app).put('/f-1').send(move).expect(200);
    assert.equal(hold.mock.callCount(), 1);
    assert.equal(scheduleChanged.mock.callCount(), 0);
    const [festivalId, alert] = hold.mock.calls[0]!.arguments as [string, any];
    assert.equal(festivalId, 'f-1');
    assert.deepEqual(alert.changes.map((c: any) => [c.kind, c.setId]), [['moved', 's0'], ['moved', 's1']]);
    assert.deepEqual([...alert.pickersBySet], [['s0', ['u1']]]);
    assert.deepEqual(res.body.data.scheduleNotice, { changes: 2, people: 1, notified: false, held: true });
    assert.ok(audits.some((row) => row.action === 'festival.alert_held'), 'the hold is audited');
    assert.equal(audits.find((row) => row.action === 'festival.updated')?.actorType, 'organizer');
  });

  test('by a platform admin still sends and holds nothing', async () => {
    const { app, hold, scheduleChanged } = buildPut('admin');
    const res = await request(app).put('/f-1').send(move).expect(200);
    assert.equal(hold.mock.callCount(), 0);
    assert.equal(scheduleChanged.mock.callCount(), 1);
    assert.deepEqual(res.body.data.scheduleNotice, { changes: 2, people: 1, notified: true });
  });

  test('with notify off, a member holds nothing: nobody asked for the alert', async () => {
    const { app, hold, scheduleChanged } = buildPut('editor');
    await request(app).put('/f-1').send({ ...move, notify: false }).expect(200);
    assert.equal(hold.mock.callCount() + scheduleChanged.mock.callCount(), 0);
  });

  test('a failed hold does not fail the committed save', async () => {
    const { app, hold } = buildPut('editor');
    hold.mock.mockImplementation(async () => {
      throw new Error('db blip');
    });
    await request(app).put('/f-1').send(move).expect(200);
  });
});

describe('a member save needs the version it started from, and obeys the live-edit rule', () => {
  test('a save with no expectedUpdatedAt is 400, an admin save is not asked for one', async () => {
    const member = await request(buildPut('editor').app).put('/f-1').send({ days: day(0) });
    assert.equal(member.status, 400);
    assert.match(member.body.error.message, /Reload this festival/);
    await request(buildPut('admin').app).put('/f-1').send({ days: day(0) }).expect(200);
  });

  test('an unverified organization cannot rename or move a live festival; an unchanged name passes', async () => {
    const { app } = buildPut('editor');
    const renamed = await request(app).put('/f-1').send({ name: 'Other Name', expectedUpdatedAt: FAR_FUTURE });
    assert.equal(renamed.status, 403);
    assert.match(renamed.body.error.message, /Ask Festie/);
    assert.equal((await request(app).put('/f-1').send({ location: 'Elsewhere', expectedUpdatedAt: FAR_FUTURE })).status, 403);
    assert.equal((await request(app).put('/f-1').send({ name: 'Fest', location: 'Field', expectedUpdatedAt: FAR_FUTURE })).status, 200);
  });
});

// ── lineup import ─────────────────────────────────────────────────────────
describe('a lineup import that gives a set its first time on a released date', () => {
  const festivalWith = (startTime: string | null) => ({
    id: 'f-1',
    name: 'Fest',
    publishedAt: '2026-01-01T00:00:00.000Z',
    stages,
    days: [{ label: 'Fri', date: '2026-06-05', sets: [{ id: 's1', artist: 'Alpha', stageId: 'main', startTime, endTime: startTime && '21:00' }] }],
    b2bSeparator: 'b2b',
  });

  function build(actor: Actor) {
    const hold = mock.fn(async (_id: string, alert: any) => ({ held: alert.changes.length, people: 1 }));
    const scheduleChanged = mock.fn(async (_arg: any) => {});
    const reads = [festivalWith(null), festivalWith('20:00')];
    const audits: any[] = [];
    const deps: any = {
      express,
      log: { info() {}, warn() {}, error() {}, debug() {} },
      config: {},
      rateLimit: pass,
      sanitizeIdentifier: (v: string) => v,
      sendSuccess: (res: any, data: unknown) => res.json({ data, error: null }),
      sendError: (res: any, status: number, message: string) => res.status(status).json({ data: null, error: { message } }),
      ErrorCodes: { INVALID_INPUT: 'INVALID_INPUT', VALIDATION_ERROR: 'VALIDATION_ERROR', NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR' },
      setNoStore: () => {},
      stores: {
        festivals: { getById: async () => reads.shift() ?? festivalWith('20:00') },
        profiles: { pickersBySet: async (_id: string, ids: string[]) => new Map(ids.map((id) => [id, ['picker-1']])) },
        timeReleases: { releasedDates: async () => new Set(['2026-06-05']) },
        lineupImports: {
          lookupArtists: async () => ({ byKey: new Map(), byId: new Map() }),
          commit: async () => ({
            committed: true,
            plan: { rows: [], counts: { error: 0 }, problems: [] },
            importId: 'imp-1',
            writes: { inserts: [], updates: [], announced: { inserts: [], updates: [] }, newStages: [], newDays: [], spotifyMatched: 0 },
          }),
        },
        festivalReview: { hold },
        auditLog: { insert: async (row: any) => audits.push(row) },
      },
      invalidateFestivalCache: () => {},
      getRequestIp: () => '127.0.0.1',
      emitter: { scheduleChanged },
    };
    deps.festivalAccess = () => (req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1' };
      req.festivalId = req.params.id;
      req.festivalRole = actor;
      req.organizationId = actor === 'editor' ? 'org-a' : null;
      next();
    };
    const app = express();
    app.use(express.json());
    app.use(createLineupImportRoute(deps));
    return { app, hold, scheduleChanged, audits };
  }
  const body = { rows: [{ row: 2, artist: 'Alpha', startTime: '20:00' }], skipSpotify: true };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  test('is held for a member, with an audit row and no alert', async () => {
    const { app, hold, scheduleChanged, audits } = build('editor');
    await request(app).post('/f-1/import-lineup').send(body).expect(200);
    await settle();
    assert.equal(hold.mock.callCount(), 1);
    assert.equal(scheduleChanged.mock.callCount(), 0);
    assert.deepEqual((hold.mock.calls[0]!.arguments as any[])[1].changes.map((c: any) => c.setId), ['s1']);
    assert.ok(audits.some((row) => row.action === 'festival.alert_held' && row.actorType === 'organizer' && row.organizationId === 'org-a'));
  });

  test('still alerts the pickers when an admin imports', async () => {
    const { app, hold, scheduleChanged } = build('admin');
    await request(app).post('/f-1/import-lineup').send(body).expect(200);
    await settle();
    assert.equal(hold.mock.callCount(), 0);
    assert.equal(scheduleChanged.mock.callCount(), 1);
  });
});

describe('the gate itself', () => {
  const alert = { changes: [{ kind: 'removed' as const, setId: 's1', artist: 'A' }], pickersBySet: new Map([['s1', ['u1']]]) };

  test('an organizer request holds and never reaches the emitter; an admin request sends', async () => {
    const hold = mock.fn(async () => ({ held: 1, people: 1 }));
    const scheduleChanged = mock.fn(async () => {});
    const args = { stores: { festivalReview: { hold } }, emitter: { scheduleChanged }, festival: { id: 'f-1', name: 'F' }, alert };
    assert.deepEqual(await deliverScheduleAlert({ ...args, organizer: true }), { held: true, changes: 1, people: 1 });
    assert.equal(scheduleChanged.mock.callCount(), 0);
    assert.equal((await deliverScheduleAlert({ ...args, organizer: false })).held, false);
    assert.equal(scheduleChanged.mock.callCount(), 1);
  });

  test('every role of an organization member is an organizer request, an admin and a plain request are not', () => {
    assert.equal(isOrganizerRequest({ festivalRole: 'viewer' }), true);
    assert.equal(isOrganizerRequest({ festivalRole: 'editor' }), true);
    assert.equal(isOrganizerRequest({ festivalRole: 'owner' }), true);
    assert.equal(isOrganizerRequest({ festivalRole: 'admin' }), false);
    assert.equal(isOrganizerRequest({}), false);
  });

  test('rows rebuild into the alert, and a set that moved back leaves nothing to send', () => {
    const slot = (start: string) => ({ dayKey: '2026-06-05', dayLabel: 'Fri', startTime: start, endTime: null, stageId: 'main', stageName: 'Main' });
    const row = (over: any) => ({ set_id: 's1', kind: 'moved', artist: 'A', before_slot: slot('20:00'), after_slot: slot('21:00'), picker_ids: ['u1'], interest_holder_ids: [], covered_set_ids: [], ...over });
    assert.equal(heldRowsToAlert([row({ after_slot: slot('20:00') })]), null);
    const rebuilt = heldRowsToAlert([row({}), row({ set_id: 's2', kind: 'removed', before_slot: null, after_slot: null, picker_ids: ['u2'] }), row({ set_id: 'entry:e1', kind: 'entry_cancelled', before_slot: null, after_slot: null, picker_ids: [], interest_holder_ids: ['u3'], covered_set_ids: ['s9'] })])!;
    assert.deepEqual(rebuilt.changes.map((c: any) => [c.kind, c.setId ?? c.entryId]), [['moved', 's1'], ['removed', 's2'], ['entry_cancelled', 'e1']]);
    assert.deepEqual([...rebuilt.pickersBySet], [['s1', ['u1']], ['s2', ['u2']]]);
    assert.deepEqual([...rebuilt.interestedByEntry!], [['e1', ['u3']]]);
    assert.deepEqual((rebuilt.changes[2] as any).setIds, ['s9']);
  });
});

// ── the store, on a database ───────────────────────────────────────────────
describe('held changes in the database', { skip }, () => {
  let pool: Pool;
  const stamp = Date.now();
  const festivalId = `hold-${stamp}`;
  const slot = (start: string) => ({ dayKey: '2026-06-05', dayLabel: 'Fri', startTime: start, endTime: null, stageId: 'main', stageName: 'Main' });
  const moved = (setId: string, from: string, to: string) => ({ kind: 'moved' as const, setId, artist: `Artist ${setId}`, before: slot(from), after: slot(to) });

  const setup = async () => {
    await ensureTestSchema(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query("INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, 'Hold Fest', 'x', NOW(), NOW())", [festivalId]);
    return createFestivalReviewStore(pool);
  };

  after(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM festivals WHERE id = $1', [festivalId]);
    await pool.end();
  });

  test('a second save merges: first before-slot, latest after-slot, united pickers; a move back drops at release', async () => {
    const store = await setup();
    await store.hold(festivalId, { changes: [moved('s1', '20:00', '21:00'), moved('s2', '20:00', '21:00')], pickersBySet: new Map([['s1', ['u1']], ['s2', ['u2']]]) });
    await store.hold(festivalId, { changes: [moved('s1', '21:00', '22:00'), moved('s2', '21:00', '20:00')], pickersBySet: new Map([['s1', ['u3']], ['s2', ['u2']]]) });
    const [queued] = await store.listHeld();
    assert.deepEqual([queued.festivalId, queued.changes, queued.people, queued.organizationId], [festivalId, 2, 3, null]);

    const { rows, alert } = await store.claimHeld(festivalId);
    assert.equal(rows, 2);
    // s2 went 20:00 to 21:00 to 20:00, so only s1 is left, from 20:00 to 22:00, for both of its pickers.
    assert.deepEqual(alert!.changes.map((c: any) => [c.setId, c.before.startTime, c.after.startTime]), [['s1', '20:00', '22:00']]);
    assert.deepEqual([...alert!.pickersBySet.get('s1')!].sort(), ['u1', 'u3']);
  });

  test('the claim empties the table, so a second release finds nothing to send', async () => {
    const store = createFestivalReviewStore(pool);
    await store.hold(festivalId, { changes: [moved('s1', '20:00', '21:00')], pickersBySet: new Map([['s1', ['u1']]]) });
    assert.equal((await store.claimHeld(festivalId)).rows, 1);
    assert.deepEqual(await store.claimHeld(festivalId), { rows: 0, alert: null });
  });

  test('a change nobody picked is not held, and a cancelled act holds its interest holders', async () => {
    const store = createFestivalReviewStore(pool);
    const none = await store.hold(festivalId, { changes: [moved('s9', '20:00', '21:00')], pickersBySet: new Map() });
    assert.deepEqual(none, { held: 0, people: 0 });
    await store.hold(festivalId, {
      changes: [{ kind: 'entry_cancelled', entryId: 'e1', artist: 'Mira', setIds: ['s5'] }, { kind: 'removed', setId: 's5', artist: 'Mira' }],
      pickersBySet: new Map([['s5', ['u1']]]),
      interestedByEntry: new Map([['e1', ['u1', 'u2']]]),
    });
    const { alert } = await store.claimHeld(festivalId);
    assert.deepEqual(alert!.changes.map((c: any) => c.kind).sort(), ['entry_cancelled', 'removed']);
    assert.deepEqual(alert!.interestedByEntry!.get('e1'), ['u1', 'u2']);
    assert.deepEqual((alert!.changes.find((c: any) => c.kind === 'entry_cancelled') as any).setIds, ['s5']);
  });

  test('a festival that is deleted for good takes its held rows with it', async () => {
    const store = createFestivalReviewStore(pool);
    await store.hold(festivalId, { changes: [moved('s1', '20:00', '21:00')], pickersBySet: new Map([['s1', ['u1']]]) });
    await pool.query('DELETE FROM festivals WHERE id = $1', [festivalId]);
    assert.equal((await pool.query('SELECT 1 FROM festival_held_schedule_changes WHERE festival_id = $1', [festivalId])).rowCount, 0);
  });
});
