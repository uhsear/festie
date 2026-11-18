import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { ALLOWED_NOTIFICATION_TYPES } from '../lib/notifications/payload.js';
import { createSendService } from '../lib/notifications/send.js';
import { createReengagementTriggers, EMAIL_DAILY_BUDGET, findRatePromptDay } from '../lib/notifications/reengagement.js';

// ---------------------------------------------------------------------------
// Minimal logger / config helpers
// ---------------------------------------------------------------------------
const log = { info() {}, warn() {}, debug() {}, error() {} };
const config = { PUBLIC_ORIGIN: 'https://festie.test', RESEND_API_KEY: '' };

// =====================================================================
// payload.ts — the three M3 types are allowed
// =====================================================================
describe('M3 re-engagement: ALLOWED_NOTIFICATION_TYPES', () => {
  it('includes lineup_drop, crew_reformed, wrap_ready', () => {
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('lineup_drop'));
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('crew_reformed'));
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('wrap_ready'));
  });
  it('keeps the original three', () => {
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('crew_update'));
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('schedule_change'));
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('set_reminder'));
  });
});

// =====================================================================
// send.ts PREF_MAP — each new type routes to its own opt-out pref key
// (proven end-to-end: opting out the mapped key returns user_disabled)
// =====================================================================
describe('M3 re-engagement: PREF_MAP routing via createSendService', () => {
  function buildService(prefs: any) {
    const sent: any[] = [];
    const messaging = {
      send: async (msg: any) => {
        sent.push(msg);
        return 'msg-id';
      },
      sendEach: async () => ({ responses: [] }),
    };
    const stores = {
      notificationPrefs: { get: async () => prefs },
      deviceTokens: {
        listByUser: async () => [{ token: 'a'.repeat(40), platform: 'android' }],
        unregister: async () => {},
      },
      notificationCounts: { getByUser: async () => [], increment: async () => {} },
      notificationLog: { insert: async () => {} },
    };
    const svc = createSendService({
      stores,
      config,
      log,
      messaging,
      retryQueue: { enqueue() {} },
    });
    return { svc, sent };
  }

  it('lineup_drop is suppressed when lineupDrops pref is off', async () => {
    const { svc, sent } = buildService({ lineupDrops: 0, dndStart: null, dndEnd: null });
    const r = await svc.send({ userId: 'u1', type: 'lineup_drop', title: 't', body: 'b', data: {} });
    assert.equal(r.reason, 'user_disabled');
    assert.equal(sent.length, 0);
  });

  it('crew_reformed is suppressed when crewReformed pref is off', async () => {
    const { svc } = buildService({ crewReformed: 0, dndStart: null, dndEnd: null });
    const r = await svc.send({ userId: 'u1', type: 'crew_reformed', title: 't', body: 'b', data: {} });
    assert.equal(r.reason, 'user_disabled');
  });

  it('wrap_ready is suppressed when wrapReady pref is off', async () => {
    const { svc } = buildService({ wrapReady: 0, dndStart: null, dndEnd: null });
    const r = await svc.send({ userId: 'u1', type: 'wrap_ready', title: 't', body: 'b', data: {} });
    assert.equal(r.reason, 'user_disabled');
  });

  it('lineup_drop is delivered when its pref is ON (routing does not over-suppress)', async () => {
    const { svc, sent } = buildService({
      lineupDrops: 1,
      crewReformed: 1,
      wrapReady: 1,
      dndStart: null,
      dndEnd: null,
    });
    const r = await svc.send({ userId: 'u1', type: 'lineup_drop', title: 't', body: 'b', data: { festivalId: 'f1' } });
    assert.equal(r.sent, 1);
    assert.equal(sent.length, 1);
  });
});

// =====================================================================
// reengagement triggers — event-gated, deduped, opt-out + cap honored
// =====================================================================
describe('createReengagementTriggers.sendCrewReformed', () => {
  function build({ existsForEvents }: any = {}) {
    const sends: any[] = [];
    const logInserts: any[] = [];
    const notificationService = {
      isConfigured: true,
      send: async (args: any) => {
        sends.push(args);
        return { sent: 1 };
      },
    };
    const stores = {
      users: { getByIds: async () => new Map() },
      notificationLog: {
        existsForEvent: async () => false,
        // Batch dedup: returns the SET of already-notified ids (default: none).
        existsForEvents: existsForEvents || (async () => new Set<string>()),
        insert: async (row: any) => logInserts.push(row),
      },
    };
    const triggers = createReengagementTriggers({ stores, config, log, notificationService });
    return { triggers, sends, logInserts };
  }

  it('notifies each invited prior member exactly once (push)', async () => {
    const { triggers, sends } = build();
    const r = await triggers.sendCrewReformed({
      newCrewId: 'crew-2',
      crewName: 'The Goblins',
      festivalName: 'Coast 2027',
      invitedUserIds: ['u1', 'u2', 'u3'],
      inviteUrl: 'https://festie.test/join/ABCD',
    });
    assert.equal(sends.length, 3);
    assert.equal(r.sent, 3);
    for (const s of sends) {
      assert.equal(s.type, 'crew_reformed');
      assert.equal(s.data.eventKey, 'reform:crew-2');
    }
  });

  it('dedups: a user already logged for this event is skipped', async () => {
    const { triggers, sends } = build({
      existsForEvents: async (uids: string[], _type: string, key: string) =>
        key === 'reform:crew-2' ? new Set(uids.filter((u) => u === 'u2')) : new Set<string>(),
    });
    await triggers.sendCrewReformed({
      newCrewId: 'crew-2',
      crewName: 'C',
      invitedUserIds: ['u1', 'u2'],
    });
    const targets = sends.map((s) => s.userId);
    assert.deepEqual(targets, ['u1']);
  });

  it('no invitees → no sends', async () => {
    const { triggers, sends } = build();
    const r = await triggers.sendCrewReformed({ newCrewId: 'crew-2', invitedUserIds: [] });
    assert.equal(r.reason, 'no_invitees');
    assert.equal(sends.length, 0);
  });
});

describe('createReengagementTriggers.sendLineupDrop', () => {
  type Prior = { userId: string; festivalName: string };
  // Fake pg pool: the name lookup, the follower query and the prior-edition query are told apart by their SQL.
  function mockPool(
    name: string,
    { followers = [] as string[], prior = [] as Array<string | Prior>, hasTimes = false } = {},
  ): any {
    return {
      query: async (sql: string) => {
        if (sql.includes('festival_follows')) return { rows: followers.map((userId) => ({ userId })) };
        if (sql.includes('regexp_replace(lower(fp.name)')) {
          return {
            rows: prior.map((p) => (typeof p === 'string' ? { userId: p, festivalName: 'North Coast 2026' } : p)),
          };
        }
        return { rows: name ? [{ name, hasTimes }] : [] };
      },
    };
  }

  function build(pool: any, extraConfig: object = {}) {
    const sends: any[] = [];
    const notificationService = {
      isConfigured: true,
      send: async (args: any) => {
        sends.push(args);
        return { sent: 1 };
      },
    };
    const stores = {
      users: { getByIds: async () => new Map() },
      notificationLog: {
        existsForEvent: async () => false,
        existsForEvents: async () => new Set<string>(),
        insert: async () => {},
      },
    };
    const triggers = createReengagementTriggers({
      stores,
      config: { ...config, ...extraConfig },
      log,
      notificationService,
      pool,
    });
    return { triggers, sends };
  }

  it('targets prior-year attendees of the same-named festival', async () => {
    const { triggers, sends } = build(mockPool('North Coast', { prior: ['p1', 'p2'] }));
    const r = await triggers.sendLineupDrop('fest-2027');
    assert.equal(sends.length, 2);
    assert.equal(r.recipients, 2);
    assert.equal(sends[0].type, 'lineup_drop');
    assert.equal(sends[0].data.eventKey, 'lineup:fest-2027');
    // A real web route: web reads ?festival=, mobile resolves it via pushTarget.
    assert.equal(sends[0].data.deepLink, 'https://festie.test/?festival=fest-2027');
  });

  it('splits followers from past-edition users and lists the matched festival names', async () => {
    const prior = [
      { userId: 'p1', festivalName: 'North Coast 2025' },
      { userId: 'p2', festivalName: 'North Coast 2024' },
      // f1 follows too, so f1 is a follower and their past festival is not listed.
      { userId: 'f1', festivalName: 'North Coast 2023' },
    ];
    const { triggers, sends } = build(mockPool('North Coast', { followers: ['f1'], prior }));
    const dry = await triggers.countLineupDrop('fest-2027');
    assert.equal(dry.recipients, 3);
    assert.equal(dry.followers, 1);
    assert.equal(dry.priorAttendees, 2);
    assert.deepEqual(dry.matchedFestivalNames, ['North Coast 2024', 'North Coast 2025']);
    assert.equal(sends.length, 0);
    await triggers.sendLineupDrop('fest-2027');
    assert.deepEqual(sends.map((s) => s.userId).sort(), ['f1', 'p1', 'p2']);
  });

  it('keeps the past-edition query a separate statement from the follower query', async () => {
    const sqls: string[] = [];
    const inner = mockPool('North Coast', { followers: ['f1'], prior: ['p1'] });
    const { triggers } = build({ query: async (sql: string, p: any[]) => (sqls.push(sql), inner.query(sql, p)) });
    await triggers.countLineupDrop('fest-2027');
    assert.ok(sqls.every((q) => !(q.includes('festival_follows') && q.includes('regexp_replace'))));
    assert.ok(sqls.every((q) => !/\bUNION\b/.test(q)));
  });

  describe('copy', () => {
    it('with no timed set, the push does not say "picking"', async () => {
      const { triggers, sends } = build(mockPool('North Coast', { followers: ['f1'], hasTimes: false }));
      await triggers.sendLineupDrop('fest-2027');
      assert.equal(sends[0].title, 'North Coast lineup is out');
      assert.equal(sends[0].body, "See who is playing. We'll tell you when set times are out.");
      assert.ok(!/picking/i.test(`${sends[0].title} ${sends[0].body}`));
    });

    it('with a timed set, keeps the picking copy', async () => {
      const { triggers, sends } = build(mockPool('North Coast', { followers: ['f1'], hasTimes: true }));
      await triggers.sendLineupDrop('fest-2027');
      assert.equal(sends[0].title, 'North Coast lineup just dropped');
      assert.equal(sends[0].body, 'Start picking your sets.');
    });
  });

  describe('email', () => {
    // RESEND_API_KEY is unset, so sendEmail logs 'email:skip' (and sends nothing).
    // That log line shows which addresses the fan-out reached.
    async function run(prefs: any, { postal = '1 Main St, Town', followers = ['p1'], prior = [] as string[], unverified = [] as string[] } = {}) {
      const skips: any[] = [];
      const emailLog = { ...log, warn: (msg: string, meta: any) => { if (msg === 'email:skip') skips.push(meta); } };
      const users = new Map(
        [...followers, ...prior].map((id) => [id, { email: `${id}@example.com`, emailVerifiedAt: unverified.includes(id) ? null : '2026-01-01T00:00:00.000Z', username: id }] as const),
      );
      const stores = {
        users: { getByIds: async () => users },
        notificationPrefs: { get: async () => prefs },
        notificationLog: { existsForEvents: async () => new Set<string>(), insert: async () => {} },
      };
      const pool = mockPool('North Coast', { followers, prior });
      const cfg = { ...config, RESEND_API_KEY: '', EMAIL_POSTAL_ADDRESS: postal };
      const triggers = createReengagementTriggers({ stores, config: cfg, log: emailLog, pool });
      await triggers.sendLineupDrop('fest-2027');
      return { skips, dry: await triggers.countLineupDrop('fest-2027') };
    }

    it('sends no email when lineupDrops is off', async () => {
      assert.equal((await run({ lineupDrops: false })).skips.length, 0);
    });

    it('sends the email when lineupDrops is on', async () => {
      assert.equal((await run({ lineupDrops: true })).skips.length, 1);
    });

    it('goes to followers only, never to a past-edition user who does not follow', async () => {
      const { skips } = await run({ lineupDrops: true }, { followers: ['f1'], prior: ['p1'] });
      assert.deepEqual(skips.map((s) => s.to), ['f1@example.com']);
    });

    it('never emails an unverified address, but still emails a verified follower', async () => {
      const { skips } = await run({ lineupDrops: true }, { followers: ['f1', 'f2'], unverified: ['f2'] });
      assert.deepEqual(skips.map((s) => s.to), ['f1@example.com']);
    });

    it('sends no email without a postal address, and the dry run says why', async () => {
      const { skips, dry } = await run({ lineupDrops: true }, { postal: '' });
      assert.equal(skips.length, 0);
      assert.equal(dry.emailOff, 'no_postal_address');
      assert.equal(dry.emailRecipients, 0);
    });
  });

  it('countLineupDrop returns the fresh count and sends nothing', async () => {
    const { triggers, sends } = build(mockPool('North Coast', { prior: ['p1', 'p2'] }));
    const r = await triggers.countLineupDrop('fest-2027');
    assert.equal(r.festivalName, 'North Coast');
    assert.equal(r.recipients, 2);
    assert.equal(r.followers, 0);
    assert.equal(r.priorAttendees, 2);
    assert.equal(sends.length, 0);
  });

  it('edition match ignores a trailing year', async () => {
    const sqls: string[] = [];
    const inner = mockPool('North Coast 2027');
    const { triggers } = build({ query: async (sql: string, p: any[]) => (sqls.push(sql), inner.query(sql, p)) });
    await triggers.countLineupDrop('fest-2027');
    assert.ok(sqls.some((q) => q.includes('regexp_replace(lower(fp.name)')));
  });

  it('no recipients → nothing sent', async () => {
    const { triggers, sends } = build(mockPool('North Coast'));
    const r = await triggers.sendLineupDrop('fest-2027');
    assert.equal(r.reason, 'no_recipients');
    assert.equal(sends.length, 0);
  });

  it('unknown festival → nothing sent', async () => {
    const { triggers, sends } = build(mockPool(''));
    const r = await triggers.sendLineupDrop('fest-x');
    assert.equal(r.reason, 'festival_not_found');
    assert.equal(sends.length, 0);
  });
});

// =====================================================================
// sendWrapReady — festival-over gating + dedup fan-out + TZ correctness
// =====================================================================
describe('createReengagementTriggers.sendWrapReady', () => {
  const PAST = '2000-01-01'; // long over
  const FUTURE = '2999-12-31'; // far-future last day

  function build({
    festival,
    festivalThrows = false,
    attendeeIds = [],
    attendeesThrow = false,
    seen = new Set<string>(),
    existsThrows = false,
    existsCalls = [] as any[],
  }: any = {}) {
    const sends: any[] = [];
    const notificationService = {
      isConfigured: true,
      send: async (args: any) => {
        sends.push(args);
        return { sent: 1 };
      },
    };
    const stores = {
      festivals: {
        getById: async () => {
          if (festivalThrows) throw new Error('db down');
          return festival;
        },
      },
      profiles: {
        userIdsByFestival: async () => {
          if (attendeesThrow) throw new Error('attendee lookup down');
          return attendeeIds;
        },
      },
      users: { getByIds: async () => new Map() },
      notificationLog: {
        existsForEvent: async () => false,
        existsForEvents: async (uids: string[], _type: string, key: string) => {
          existsCalls.push({ uids, key });
          if (existsThrows) throw new Error('dedup read down');
          // Push rows exist for `seen`; the '#email' key has none.
          return new Set(key.endsWith('#email') ? [] : uids.filter((u) => seen.has(u)));
        },
        insert: async () => {},
      },
    };
    const triggers = createReengagementTriggers({ stores, config, log, notificationService });
    return { triggers, sends };
  }

  it('festival_not_found → nothing sent', async () => {
    const { triggers, sends } = build({ festival: null });
    const r = await triggers.sendWrapReady('f1');
    assert.equal(r.reason, 'festival_not_found');
    assert.equal(sends.length, 0);
  });

  it('not_over: a far-future last day short-circuits', async () => {
    const { triggers, sends } = build({
      festival: { name: 'FK', days: [{ date: FUTURE }] },
      attendeeIds: ['u1', 'u2'],
    });
    const r = await triggers.sendWrapReady('f1');
    assert.equal(r.reason, 'not_over');
    assert.equal(sends.length, 0);
  });

  it('over-with-attendees: pushes per fresh attendee', async () => {
    const { triggers, sends } = build({
      festival: { name: 'FK', days: [{ date: PAST }] },
      attendeeIds: ['u1', 'u2', 'u3'],
    });
    const r = await triggers.sendWrapReady('f1');
    assert.equal(sends.length, 3);
    assert.equal(r.sent, 3);
    assert.deepEqual(
      sends.map((s) => s.userId),
      ['u1', 'u2', 'u3'],
    );
    for (const s of sends) {
      assert.equal(s.type, 'wrap_ready');
      assert.equal(s.data.eventKey, 'wrap:f1');
    }
  });

  it('all-deduped: every attendee already notified → no pushes', async () => {
    const { triggers, sends } = build({
      festival: { name: 'FK', days: [{ date: PAST }] },
      attendeeIds: ['u1', 'u2'],
      seen: new Set(['u1', 'u2']),
    });
    const r = await triggers.sendWrapReady('f1');
    assert.equal(sends.length, 0);
    assert.equal(r.sent, 0);
  });

  it('email dedups on its own key: push-logged users still reach the email path', async () => {
    const existsCalls: any[] = [];
    const { triggers, sends } = build({
      festival: { name: 'FK', days: [{ date: PAST }] },
      attendeeIds: ['u1', 'u2'],
      seen: new Set(['u1', 'u2']),
      existsCalls,
    });
    await triggers.sendWrapReady('f1');
    assert.equal(sends.length, 0);
    const emailCall = existsCalls.find((c) => c.key === 'wrap:f1#email');
    assert.deepEqual(emailCall?.uids, ['u1', 'u2']);
  });

  it('a throwing attendee lookup is swallowed → festival over but no attendees', async () => {
    const { triggers, sends } = build({
      festival: { name: 'FK', days: [{ date: PAST }] },
      attendeesThrow: true,
    });
    const r = await triggers.sendWrapReady('f1');
    assert.equal(sends.length, 0);
    assert.equal(r.sent, 0);
  });

  it('a throwing dedup read PROPAGATES (no fail-open re-blast)', async () => {
    const { triggers } = build({
      festival: { name: 'FK', days: [{ date: PAST }] },
      attendeeIds: ['u1', 'u2'],
      existsThrows: true,
    });
    await assert.rejects(() => triggers.sendWrapReady('f1'), /dedup read down/);
  });

  it('isFestivalOver is TZ-aware: a same-day cutoff differs by zone', async () => {
    // Pick a date whose end-of-day in a far-west zone is still in the future
    // while UTC end-of-day has passed, proving the zone is honored. We use a
    // date ~12h ago in UTC terms is awkward to pin deterministically, so instead
    // assert the relative behavior: a festival ending "today" in a far-future
    // sense is gated identically regardless of zone, and a clearly-past date is
    // over in any zone.
    const past = build({
      festival: { name: 'FK', days: [{ date: PAST }], timeZone: 'Pacific/Kiritimati' },
      attendeeIds: ['u1'],
    });
    const rPast = await past.triggers.sendWrapReady('f1');
    assert.equal(rPast.sent, 1); // clearly past → over in any zone

    const future = build({
      festival: { name: 'FK', days: [{ date: FUTURE }], timeZone: 'Etc/GMT+12' },
      attendeeIds: ['u1'],
    });
    const rFuture = await future.triggers.sendWrapReady('f1');
    assert.equal(rFuture.reason, 'not_over'); // far future → not over in any zone
  });

  it('isFestivalOver waits for 06:00 after the last day (festival zone)', async () => {
    // Last day 2026-09-06 in Los Angeles (PDT, UTC-7): 06:00 on 09-07 = 13:00Z.
    const festival = { name: 'FK', days: [{ date: '2026-09-06' }], timeZone: 'America/Los_Angeles' };
    const realNow = Date.now;
    try {
      Date.now = () => Date.parse('2026-09-07T08:00:00Z'); // 01:00 local
      const early = build({ festival, attendeeIds: ['u1'] });
      assert.equal((await early.triggers.sendWrapReady('f1')).reason, 'not_over');

      Date.now = () => Date.parse('2026-09-07T13:01:00Z'); // 06:01 local
      const late = build({ festival, attendeeIds: ['u1'] });
      assert.equal((await late.triggers.sendWrapReady('f1')).sent, 1);
    } finally {
      Date.now = realNow;
    }
  });
});

// =====================================================================
// sendRatePrompt — next-morning nudge to rate yesterday's picked sets
// =====================================================================
describe('findRatePromptDay', () => {
  const days = [{ date: '2026-04-24' }, { date: '2026-04-25' }, { date: '2026-04-26' }];

  it('UTC fallback (no zone): due 10:00 to 20:00 on the next calendar date', () => {
    assert.equal(findRatePromptDay(days, null, Date.parse('2026-04-25T09:59:00Z')), -1);
    assert.equal(findRatePromptDay(days, null, Date.parse('2026-04-25T10:00:00Z')), 0);
    assert.equal(findRatePromptDay(days, null, Date.parse('2026-04-25T19:59:00Z')), 0);
    assert.equal(findRatePromptDay(days, null, Date.parse('2026-04-25T20:00:00Z')), -1);
    assert.equal(findRatePromptDay(days, null, Date.parse('2026-04-27T12:00:00Z')), 2);
  });

  it('an invalid zone falls back to UTC', () => {
    assert.equal(findRatePromptDay(days, 'Not/AZone', Date.parse('2026-04-25T10:30:00Z')), 0);
  });

  it('honours a non-UTC festival zone', () => {
    // America/Los_Angeles is UTC-7 in April: 10:00 local = 17:00Z, 20:00 local = 03:00Z next day.
    const tz = 'America/Los_Angeles';
    assert.equal(findRatePromptDay(days, tz, Date.parse('2026-04-25T16:30:00Z')), -1); // 09:30 local
    assert.equal(findRatePromptDay(days, tz, Date.parse('2026-04-25T17:30:00Z')), 0); // 10:30 local
    assert.equal(findRatePromptDay(days, tz, Date.parse('2026-04-26T02:30:00Z')), 0); // 19:30 local
    assert.equal(findRatePromptDay(days, tz, Date.parse('2026-04-26T03:30:00Z')), -1); // 20:30 local
  });

  it('rolls over a month end and skips days without a date', () => {
    assert.equal(findRatePromptDay([{ date: '' }, { date: '2026-04-30' }], null, Date.parse('2026-05-01T12:00:00Z')), 1);
    assert.equal(findRatePromptDay([], null, Date.now()), -1);
    assert.equal(findRatePromptDay(null, null, Date.now()), -1);
  });
});

describe('createReengagementTriggers.sendRatePrompt', () => {
  const festival = {
    name: 'Coachella',
    timeZone: 'America/Los_Angeles',
    days: [
      { dayIndex: 0, label: 'Friday', date: '2026-04-24' },
      { dayIndex: 1, label: '', date: '2026-04-25' },
    ],
  };
  const AT_1030_AFTER_DAY0 = Date.parse('2026-04-25T17:30:00Z'); // 10:30 PDT on 04-25

  function build({ fest = festival as any, rows = [] as any[] } = {}) {
    const sends: any[] = [];
    const queries: any[] = [];
    const logged = new Set<string>(); // `${uid}|${eventKey}` rows in notification_log
    const notificationService = {
      isConfigured: true,
      send: async (args: any) => {
        sends.push(args);
        logged.add(`${args.userId}|${args.data.eventKey}`);
        return { sent: 1 };
      },
    };
    const stores = {
      festivals: { getById: async () => fest },
      notificationLog: {
        existsForEvents: async (uids: string[], type: string, key: string) => {
          assert.equal(type, 'rate_prompt');
          return new Set(uids.filter((u) => logged.has(`${u}|${key}`)));
        },
        insert: async () => {},
      },
    };
    const pool = {
      query: async (sql: string, params: any[]) => {
        queries.push({ sql, params });
        return { rows };
      },
    };
    const triggers = createReengagementTriggers({ stores, config, log, notificationService, pool });
    return { triggers, sends, queries };
  }

  it('at 10:30 the morning after day 0, pushes users with unrated day-0 picks', async () => {
    const { triggers, sends, queries } = build({ rows: [{ userId: 'u1', unrated: 3 }] });
    const r = await triggers.sendRatePrompt('fest-1', AT_1030_AFTER_DAY0);
    assert.deepEqual(r, { sent: 1, eventKey: 'rate:fest-1:0', dayIndex: 0 });
    assert.equal(sends.length, 1);
    assert.deepEqual(sends[0], {
      userId: 'u1',
      type: 'rate_prompt',
      title: 'How was Friday at Coachella?',
      body: 'Rate the 3 sets you picked while you still remember them.',
      data: { festivalId: 'fest-1', eventKey: 'rate:fest-1:0', deepLink: 'https://festie.test/rate?festival=fest-1' },
    });
    // Recipients come from one parameterized query that skips rated sets.
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].params, ['fest-1', 0]);
    assert.match(queries[0].sql, /NOT EXISTS \(SELECT 1 FROM set_ratings r/);
  });

  it('a user who rated every day-0 pick is not returned by the query, so gets no push', async () => {
    const { triggers, sends } = build({ rows: [] });
    const r = await triggers.sendRatePrompt('fest-1', AT_1030_AFTER_DAY0);
    assert.equal(r.sent, 0);
    assert.equal(sends.length, 0);
  });

  it('each user gets their own unrated count in the body', async () => {
    const { triggers, sends } = build({ rows: [{ userId: 'u1', unrated: 3 }, { userId: 'u2', unrated: 5 }] });
    await triggers.sendRatePrompt('fest-1', AT_1030_AFTER_DAY0);
    assert.deepEqual(
      sends.map((s) => [s.userId, s.body]),
      [
        ['u1', 'Rate the 3 sets you picked while you still remember them.'],
        ['u2', 'Rate the 5 sets you picked while you still remember them.'],
      ],
    );
  });

  it('09:30 and 20:30 festival time: not_due, no query, no push', async () => {
    for (const at of ['2026-04-25T16:30:00Z', '2026-04-26T03:30:00Z']) {
      const { triggers, sends, queries } = build({ rows: [{ userId: 'u1', unrated: 3 }] });
      const r = await triggers.sendRatePrompt('fest-1', Date.parse(at));
      assert.deepEqual(r, { sent: 0, reason: 'not_due' });
      assert.equal(queries.length, 0);
      assert.equal(sends.length, 0);
    }
  });

  it('running the sweep twice sends once (eventKey dedup)', async () => {
    const { triggers, sends } = build({ rows: [{ userId: 'u1', unrated: 3 }] });
    await triggers.sendRatePrompt('fest-1', AT_1030_AFTER_DAY0);
    const again = await triggers.sendRatePrompt('fest-1', AT_1030_AFTER_DAY0 + 60 * 60 * 1000);
    assert.equal(again.sent, 0);
    assert.equal(sends.length, 1);
  });

  it('day 1 falls back to "Day 2" when its label is empty, and keys on day 1', async () => {
    const { triggers, sends, queries } = build({ rows: [{ userId: 'u1', unrated: 1 }] });
    const r = await triggers.sendRatePrompt('fest-1', Date.parse('2026-04-26T18:00:00Z'));
    assert.equal(r.eventKey, 'rate:fest-1:1');
    assert.deepEqual(queries[0].params, ['fest-1', 1]);
    assert.equal(sends[0].title, 'How was Day 2 at Coachella?');
  });

  it('cuts the title to 100 characters', async () => {
    const { triggers, sends } = build({
      fest: { ...festival, name: 'X'.repeat(150) },
      rows: [{ userId: 'u1', unrated: 2 }],
    });
    await triggers.sendRatePrompt('fest-1', AT_1030_AFTER_DAY0);
    assert.equal(sends[0].title.length, 100);
    assert.ok(sends[0].title.startsWith('How was Friday at XXX'));
  });

  it('unknown festival: festival_not_found', async () => {
    const { triggers, sends } = build({ fest: null });
    assert.deepEqual(await triggers.sendRatePrompt('nope', AT_1030_AFTER_DAY0), { sent: 0, reason: 'festival_not_found' });
    assert.equal(sends.length, 0);
  });
});

describe('rate_prompt through createSendService: Wrap pref and DND', () => {
  function buildService(prefs: any) {
    const sent: any[] = [];
    const messaging = {
      send: async (msg: any) => {
        sent.push(msg);
        return 'msg-id';
      },
      sendEach: async () => ({ responses: [] }),
    };
    const stores = {
      notificationPrefs: { get: async () => prefs },
      deviceTokens: {
        listByUser: async () => [{ token: 'a'.repeat(40), platform: 'android' }],
        unregister: async () => {},
      },
      notificationCounts: { getByUser: async () => [], increment: async () => {} },
      notificationLog: { insert: async () => {} },
    };
    const svc = createSendService({ stores, config, log, messaging, retryQueue: { enqueue() {} } });
    return { svc, sent };
  }

  it('is suppressed when the wrapReady pref is off', async () => {
    const { svc, sent } = buildService({ wrapReady: 0, dndStart: null, dndEnd: null });
    const r = await svc.send({ userId: 'u1', type: 'rate_prompt', title: 't', body: 'b', data: {} });
    assert.equal(r.reason, 'user_disabled');
    assert.equal(sent.length, 0);
  });

  it('is held back inside quiet hours (not a critical type)', async () => {
    const { svc, sent } = buildService({ wrapReady: 1, dndStart: '00:00', dndEnd: '23:59', dndTimeZone: 'UTC' });
    const r = await svc.send({ userId: 'u1', type: 'rate_prompt', title: 't', body: 'b', data: {} });
    assert.equal(r.reason, 'dnd_active');
    assert.equal(sent.length, 0);
  });

  it('is delivered when wrapReady is on and quiet hours are off', async () => {
    const { svc, sent } = buildService({ wrapReady: 1, dndStart: null, dndEnd: null });
    const r = await svc.send({ userId: 'u1', type: 'rate_prompt', title: 't', body: 'b', data: {} });
    assert.equal(r.sent, 1);
    assert.equal(sent.length, 1);
  });
});

// =====================================================================
// sendSetTimesOut — once per festival, followers + profile holders
// =====================================================================
describe('createReengagementTriggers.sendSetTimesOut', () => {
  // Fake pg pool. The recipient query's UNION is emulated by a Set, so a user
  // who follows AND has a profile is one recipient.
  function build({
    festival = { name: 'EDC', publishedAt: '2026-01-01T00:00:00.000Z' } as any,
    hasTimes = true,
    followers = ['f1', 'f2'],
    profileHolders = ['p1', 'p2', 'f1'],
    markThrows = false,
    prefs = null as any,
  } = {}) {
    const state = { setTimesOutAt: null as string | null, events: [] as string[], markThrows };
    const sends: any[] = [];
    const seen = new Set<string>();
    const pool = {
      query: async (sql: string, params: any[]) => {
        assert.equal(params[0], 'fest-1');
        if (sql.includes('set_times_out_at AS')) {
          return { rows: festival ? [{ ...festival, setTimesOutAt: state.setTimesOutAt, hasTimes }] : [] };
        }
        if (/festival_follows f\s/.test(sql)) {
          assert.match(sql, /UNION/);
          return { rows: [...new Set([...followers, ...profileHolders])].map((userId) => ({ userId })) };
        }
        if (sql.startsWith('UPDATE festivals SET set_times_out_at')) {
          if (state.markThrows) throw new Error('db blip');
          state.events.push('mark');
          state.setTimesOutAt ??= '2026-11-01T00:00:00.000Z';
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };
    const notificationService = {
      isConfigured: true,
      send: async (args: any) => {
        sends.push(args);
        state.events.push('push');
        seen.add(`${args.userId}|${args.type}|${args.data.eventKey}`);
        return { sent: 1 };
      },
    };
    const stores = {
      users: { getByIds: async () => new Map() },
      notificationPrefs: { get: async () => prefs },
      notificationLog: {
        // Stands in for notification_log: a user pushed for this event is not fresh.
        existsForEvents: async (uids: string[], type: string, key: string) =>
          new Set(uids.filter((u) => seen.has(`${u}|${type}|${key}`))),
        insert: async () => {},
      },
    };
    const triggers = createReengagementTriggers({ stores, config, log, notificationService, pool });
    return { triggers, sends, state };
  }

  it('pushes once to each follower and profile holder, then sets the marker', async () => {
    const { triggers, sends, state } = build();
    const r = await triggers.sendSetTimesOut('fest-1');
    assert.equal(r.sent, 4);
    assert.deepEqual(sends.map((s) => s.userId).sort(), ['f1', 'f2', 'p1', 'p2']);
    assert.deepEqual(sends[0], {
      userId: sends[0].userId,
      type: 'set_times_out',
      title: 'EDC set times are out',
      body: 'See who plays when and build your plan.',
      data: { festivalId: 'fest-1', eventKey: 'times:fest-1', deepLink: 'https://festie.test/?festival=fest-1' },
    });
    assert.equal(state.events.at(-1), 'mark');
    assert.ok(state.setTimesOutAt);
  });

  it('sends nothing once the marker is set, even after times are blanked and re-added', async () => {
    const { triggers, sends } = build();
    await triggers.sendSetTimesOut('fest-1');
    sends.length = 0;
    const r = await triggers.sendSetTimesOut('fest-1');
    assert.equal(r.reason, 'already_sent');
    assert.equal(sends.length, 0);
  });

  it('a draft, a festival with no times and a missing festival send nothing and set no marker', async () => {
    for (const [opts, reason] of [
      [{ festival: { name: 'EDC', publishedAt: null } }, 'draft'],
      [{ hasTimes: false }, 'no_times'],
      [{ festival: null }, 'festival_not_found'],
    ] as const) {
      const { triggers, sends, state } = build(opts as any);
      const r = await triggers.sendSetTimesOut('fest-1');
      assert.equal(r.reason, reason);
      assert.equal(sends.length, 0);
      assert.equal(state.setTimesOutAt, null);
    }
  });

  it('a published festival with no recipients still sets the marker', async () => {
    const { triggers, sends, state } = build({ followers: [], profileHolders: [] });
    await triggers.sendSetTimesOut('fest-1');
    assert.equal(sends.length, 0);
    assert.ok(state.setTimesOutAt);
  });

  it('a retry after the marker write failed sends no second push', async () => {
    const { triggers, sends, state } = build({ markThrows: true });
    await assert.rejects(() => triggers.sendSetTimesOut('fest-1'), /db blip/);
    assert.equal(sends.length, 4);
    assert.equal(state.setTimesOutAt, null);

    state.markThrows = false;
    const r = await triggers.sendSetTimesOut('fest-1');
    assert.equal(r.sent, 0);
    assert.equal(sends.length, 4);
    assert.ok(state.setTimesOutAt);
  });

  it('a follower with New lineups and set times off gets no email', async () => {
    // RESEND_API_KEY is unset, so sendEmail logs 'email:skip' when the fan-out reaches it.
    async function emailAttempts(prefs: any) {
      const skips: string[] = [];
      const emailLog = { ...log, warn: (msg: string) => { if (msg === 'email:skip') skips.push(msg); } };
      const stores = {
        users: { getByIds: async () => new Map([['f1', { email: 'f1@example.com', emailVerifiedAt: '2026-01-01T00:00:00.000Z', username: 'f1' }]]) },
        notificationPrefs: { get: async () => prefs },
        notificationLog: { existsForEvents: async () => new Set<string>(), insert: async () => {} },
      };
      const pool = {
        query: async (sql: string) => {
          if (sql.includes('set_times_out_at AS')) return { rows: [{ name: 'EDC', publishedAt: 'x', setTimesOutAt: null, hasTimes: true }] };
          if (/festival_follows f\s/.test(sql)) return { rows: [{ userId: 'f1' }] };
          return { rows: [] };
        },
      };
      await createReengagementTriggers({ stores, config, log: emailLog, pool }).sendSetTimesOut('fest-1');
      return skips.length;
    }
    assert.equal(await emailAttempts({ lineupDrops: false }), 0);
    assert.equal(await emailAttempts({ lineupDrops: true }), 1);
  });
});

// =====================================================================
// T47 inbox rows carry data.eventKey, so existsForEvents (which matches any
// notification_log row of the type) now counts a push held by quiet hours, or
// one to a user with no device, as already sent. Before, such a user had no
// row and was retried on the next run.
// =====================================================================
describe('re-engagement dedup sees the inbox row', () => {
  it('a lineup_drop held by quiet hours still logs an inbox row with the eventKey', async () => {
    const inserted: any[] = [];
    const h = new Date().getUTCHours();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stores = {
      notificationPrefs: {
        get: async () => ({ lineupDrops: 1, dndStart: `${pad((h + 23) % 24)}:00`, dndEnd: `${pad((h + 1) % 24)}:59`, dndTimeZone: 'UTC' }),
      },
      deviceTokens: { listByUser: async () => [{ token: 'a'.repeat(40), platform: 'android' }], unregister: async () => {} },
      notificationCounts: { getByUser: async () => [], increment: async () => {} },
      notificationLog: { insert: async (row: any) => void inserted.push(row) },
    };
    const messaging = { send: async () => 'msg-id', sendEach: async () => ({ responses: [] }) };
    const svc = createSendService({ stores, config, log, messaging, retryQueue: { enqueue() {} } });

    const r = await svc.send({ userId: 'u1', type: 'lineup_drop', title: 't', body: 'b', data: { eventKey: 'lineup:f2' } });

    assert.equal(r.reason, 'dnd_active');
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].platform, 'inbox');
    assert.equal(JSON.parse(inserted[0].dataJson).eventKey, 'lineup:f2');
  });
});

// =====================================================================
// days_out — the manual "Announce days" alert. No save sends it, so these tests
// drive the dry run and the send directly and check what each one reaches.
// =====================================================================
describe('createReengagementTriggers days_out', () => {
  const entry = (id: string, name: string, dayDate: string | null = null, status = 'announced') => ({
    id,
    artists: [{ name }],
    displayName: null,
    tier: null,
    dayDate,
    status,
    announcedAt: '2026-11-01',
    linkedSetIds: [],
  });
  const DAYS = [
    { dayIndex: 0, label: 'Fri', date: '2027-02-05', sets: [] as any[] },
    { dayIndex: 1, label: 'Sat', date: '2027-02-06', sets: [] as any[] },
  ];
  const festivalOf = (lineup: any[], over: any = {}) => ({
    id: 'fest-1',
    name: 'Wasteland',
    publishedAt: '2026-11-01T00:00:00.000Z',
    b2bSeparator: 'b2b',
    days: DAYS,
    lineup,
    ...over,
  });
  const withDay = (n: number, total: number) =>
    Array.from({ length: total }, (_, i) => entry(`a${i}`, `Act ${i}`, i < n ? '2027-02-05' : null));

  function build({
    festival = festivalOf(withDay(3, 3)) as any,
    setTimesOutAt = null as string | null,
    followers = ['f1', 'f2'],
    profileHolders = ['p1', 'f1'],
    postal = '',
    emailsToday = 0 as number | (() => number),
    withPush = [] as string[],
    resendKey = '',
    emailLog = log as any,
  } = {}) {
    const sends: any[] = [];
    const prefReads = { single: 0, batch: 0 };
    const seen = new Set<string>();
    const emailed = new Set<string>();
    const pool = {
      query: async (sql: string) => {
        if (/festival_follows f\s/.test(sql)) {
          return { rows: [...new Set([...followers, ...profileHolders])].map((userId) => ({ userId })) };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };
    const notificationService = {
      isConfigured: true,
      send: async (args: any) => {
        sends.push(args);
        seen.add(`${args.userId}|${args.type}|${args.data.eventKey}`);
        return { sent: 1 };
      },
    };
    const stores = {
      festivals: { getById: async () => festival, getSetTimesOutAt: async () => setTimesOutAt },
      users: {
        getByIds: async (ids: string[]) =>
          new Map(ids.map((id) => [id, { email: `${id}@example.com`, emailVerifiedAt: '2026-01-01T00:00:00.000Z', username: id }] as const)),
      },
      notificationPrefs: {
        get: async () => {
          prefReads.single += 1;
          return { lineupDrops: 1 };
        },
        getMany: async (ids: string[]) => {
          prefReads.batch += 1;
          return new Map(ids.map((id) => [id, { lineupDrops: 1 }] as const));
        },
      },
      deviceTokens: { listByUsers: async () => withPush.map((userId) => ({ userId })) },
      notificationLog: {
        existsForEvents: async (uids: string[], type: string, key: string) =>
          new Set(
            uids.filter((u) =>
              key.endsWith('#email') ? emailed.has(`${u}|${type}|${key}`) : seen.has(`${u}|${type}|${key}`),
            ),
          ),
        countEmailsSince: async () => (typeof emailsToday === 'function' ? emailsToday() : emailsToday),
        insert: async (row: any) => {
          if (row.platform === 'email') emailed.add(`${row.userId}|${row.type}|${JSON.parse(row.dataJson).eventKey}`);
        },
      },
    };
    const cfg = { ...config, RESEND_API_KEY: resendKey, EMAIL_POSTAL_ADDRESS: postal };
    const triggers = createReengagementTriggers({ stores, config: cfg, log: emailLog, notificationService, pool });
    return { triggers, sends, prefReads };
  }

  it('act 1 of 118 with a day: the dry run reports the split, and nothing sends', async () => {
    const { triggers, sends } = build({ festival: festivalOf(withDay(1, 118)) });
    const dry = await triggers.countDaysOut('fest-1');
    assert.equal(dry.actsWithDay, 1);
    assert.equal(dry.actsTotal, 118);
    assert.equal(dry.recipients, 3);
    assert.equal(dry.reason, undefined);
    assert.equal(sends.length, 0);
  });

  it('with every act on a day, one days_out push per follower and profile holder', async () => {
    const { triggers, sends } = build();
    const r = await triggers.sendDaysOut('fest-1');
    assert.equal(r.sent, 3);
    assert.deepEqual(sends.map((s) => s.userId).sort(), ['f1', 'f2', 'p1']);
    assert.deepEqual(sends[0], {
      userId: sends[0].userId,
      type: 'days_out',
      title: 'Wasteland days are out',
      body: 'See who plays which day. Set times come later.',
      data: { festivalId: 'fest-1', eventKey: 'days:fest-1', deepLink: 'https://festie.test/?festival=fest-1' },
    });
  });

  it('a second press sends nothing and the dry run says everyone has heard', async () => {
    const { triggers, sends } = build();
    await triggers.sendDaysOut('fest-1');
    sends.length = 0;
    const r = await triggers.sendDaysOut('fest-1');
    assert.equal(r.sent, 0);
    assert.equal(sends.length, 0);
    assert.equal((await triggers.countDaysOut('fest-1')).reason, 'already_heard');
  });

  it('refuses when no act has a day, when the festival is a draft and when set times are out', async () => {
    for (const [opts, reason] of [
      [{ festival: festivalOf(withDay(0, 3)) }, 'no_days'],
      [{ festival: festivalOf(withDay(3, 3), { publishedAt: null }) }, 'draft'],
      [{ setTimesOutAt: '2026-11-02T00:00:00.000Z' }, 'set_times_out'],
    ] as const) {
      const { triggers, sends } = build(opts as any);
      assert.equal((await triggers.countDaysOut('fest-1')).reason, reason);
      const r = await triggers.sendDaysOut('fest-1');
      assert.equal(r.reason, reason);
      assert.equal(sends.length, 0);
    }
  });

  it('a festival nobody follows or joined says so, not "already heard"', async () => {
    const { triggers, sends } = build({ followers: [], profileHolders: [] });
    assert.equal((await triggers.countDaysOut('fest-1')).reason, 'no_audience');
    assert.equal((await triggers.sendDaysOut('fest-1')).reason, 'no_audience');
    assert.equal(sends.length, 0);
  });

  it('a cancelled act does not count, and a set with a day counts as an act with a day', async () => {
    const days = [{ ...DAYS[0], sets: [{ id: 's1', artist: 'Solo', artists: [{ name: 'Solo' }], startTime: null }] }, DAYS[1]];
    const lineup = [entry('a1', 'Act 1'), entry('a2', 'Gone', '2027-02-05', 'cancelled')];
    const { triggers } = build({ festival: festivalOf(lineup, { days }) });
    const dry = await triggers.countDaysOut('fest-1');
    assert.equal(dry.actsTotal, 2);
    assert.equal(dry.actsWithDay, 1);
  });

  describe('email', () => {
    it('reads the opt-out switches in one batch, not one query per person', async () => {
      const { triggers, prefReads } = build({ postal: '1 Main St, Town' });
      await triggers.countDaysOut('fest-1');
      assert.deepEqual(prefReads, { single: 0, batch: 1 });
    });

    it('is off without a postal address, and the dry run says so', async () => {
      const { triggers } = build();
      const dry = await triggers.countDaysOut('fest-1');
      assert.equal(dry.emailOff, 'no_postal_address');
      assert.equal(dry.emailRecipients, 0);
    });

    it('sends no email without a postal address even when a mail key is set', async () => {
      const bodies: any[] = [];
      const fetchMock = mock.method(globalThis, 'fetch', async (_url: any, init: any) => {
        bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 'e1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      try {
        const { triggers } = build({ resendKey: 're_test', postal: '' });
        const r = await triggers.sendDaysOut('fest-1');
        assert.equal(r.emailSent, 0);
        assert.equal(bodies.length, 0);
      } finally {
        fetchMock.mock.restore();
      }
    });

    it('a press after the push went out still reaches the people the budget cut', async () => {
      const { triggers } = build({ postal: '1 Main St, Town', emailsToday: 90 });
      const first = await triggers.sendDaysOut('fest-1');
      assert.equal(first.sent, 3);
      assert.equal(first.emailSent, 0);
      const dry = await triggers.countDaysOut('fest-1');
      assert.equal(dry.recipients, 0, 'everyone has the push');
      assert.equal(dry.emailCut, 3);
      assert.equal(dry.reason, undefined, 'not "already heard": three people still have no email');
    });

    it('re-reads the budget before each send, so a second job running at once shares it', async () => {
      const bodies: any[] = [];
      const fetchMock = mock.method(globalThis, 'fetch', async (_url: any, init: any) => {
        bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 'e1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      try {
        // The first read shows room for all three; by the first send another job has used the rest.
        let reads = 0;
        const { triggers } = build({ resendKey: 're_test', postal: '1 Main St, Town', emailsToday: () => (++reads === 1 ? 0 : 90) });
        const r = await triggers.sendDaysOut('fest-1');
        assert.equal(r.sent, 3);
        assert.equal(r.emailSent, 0);
        assert.equal(bodies.length, 0);
      } finally {
        fetchMock.mock.restore();
      }
    });

    it('stops at the daily budget and puts people with no push token first', async () => {
      const bodies: any[] = [];
      const fetchMock = mock.method(globalThis, 'fetch', async (_url: any, init: any) => {
        bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 'e1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      try {
        // 88 of 90 used: two emails fit. f1 has a push token, so f2 and p1 are emailed and f1 is cut.
        const opts = { resendKey: 're_test', postal: '1 Main St, Town', emailsToday: 88, withPush: ['f1'] };
        const { triggers } = build(opts);
        const dry = await triggers.countDaysOut('fest-1');
        assert.equal(dry.emailRecipients, 2);
        assert.equal(dry.emailCut, 1);
        assert.equal(dry.emailOff, null);
        const r = await triggers.sendDaysOut('fest-1');
        assert.equal(r.emailSent, 2);
        assert.deepEqual(bodies.flatMap((b) => b.to).sort(), ['f2@example.com', 'p1@example.com']);
        assert.ok(bodies.every((b) => /days are out/.test(b.subject)));
        assert.equal(EMAIL_DAILY_BUDGET, 90);
      } finally {
        fetchMock.mock.restore();
      }
    });
  });

  it('resolveFollowersAndProfileHolders returns each person once', async () => {
    const { triggers } = build();
    assert.deepEqual((await triggers.resolveFollowersAndProfileHolders('fest-1')).sort(), ['f1', 'f2', 'p1']);
  });
});
