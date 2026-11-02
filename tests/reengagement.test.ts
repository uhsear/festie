import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ALLOWED_NOTIFICATION_TYPES } from '../lib/notifications/payload.js';
import { createSendService } from '../lib/notifications/send.js';
import { createReengagementTriggers, findRatePromptDay } from '../lib/notifications/reengagement.js';

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
  // Mock pg pool returning: [name lookup], [prior-attendee query]
  function mockPool(name: string, priorUserIds: string[]): any {
    let call = 0;
    return {
      query: async () => {
        call += 1;
        if (call === 1) return { rows: name ? [{ name }] : [] };
        return { rows: priorUserIds.map((userId) => ({ userId })) };
      },
    };
  }

  function build(pool: any) {
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
    const triggers = createReengagementTriggers({ stores, config, log, notificationService, pool });
    return { triggers, sends };
  }

  it('targets prior-year attendees of the same-named festival', async () => {
    const { triggers, sends } = build(mockPool('North Coast', ['p1', 'p2']));
    const r = await triggers.sendLineupDrop('fest-2027');
    assert.equal(sends.length, 2);
    assert.equal(r.priorAttendees, 2);
    assert.equal(sends[0].type, 'lineup_drop');
    assert.equal(sends[0].data.eventKey, 'lineup:fest-2027');
    // A real web route: web reads ?festival=, mobile resolves it via pushTarget.
    assert.equal(sends[0].data.deepLink, 'https://festie.test/?festival=fest-2027');
  });

  describe('email opt-out', () => {
    // RESEND_API_KEY is unset, so sendEmail logs 'email:skip' (and sends nothing).
    // That log line shows whether the fan-out reached the email sender.
    async function run(prefs: any) {
      const skips: any[] = [];
      const emailLog = { ...log, warn: (msg: string) => { if (msg === 'email:skip') skips.push(msg); } };
      const stores = {
        users: { getByIds: async () => new Map([['p1', { email: 'p1@example.com', username: 'p1' }]]) },
        notificationPrefs: { get: async () => prefs },
        notificationLog: { existsForEvents: async () => new Set<string>(), insert: async () => {} },
      };
      const pool = { query: async (_sql: string) => ({ rows: _sql.includes('SELECT name') ? [{ name: 'North Coast' }] : [{ userId: 'p1' }] }) };
      const triggers = createReengagementTriggers({ stores, config: { ...config, RESEND_API_KEY: '' }, log: emailLog, pool });
      await triggers.sendLineupDrop('fest-2027');
      return skips.length;
    }

    it('sends no email when lineupDrops is off', async () => {
      assert.equal(await run({ lineupDrops: false }), 0);
    });

    it('sends the email when lineupDrops is on', async () => {
      assert.equal(await run({ lineupDrops: true }), 1);
    });
  });

  it('countLineupDrop returns the fresh count and sends nothing', async () => {
    const { triggers, sends } = build(mockPool('North Coast', ['p1', 'p2']));
    const r = await triggers.countLineupDrop('fest-2027');
    assert.deepEqual(r, { festivalName: 'North Coast', recipients: 2 });
    assert.equal(sends.length, 0);
  });

  it('edition match ignores a trailing year', async () => {
    const sqls: string[] = [];
    const pool = {
      query: async (sql: string) => {
        sqls.push(sql);
        return { rows: sql.includes('SELECT name') ? [{ name: 'North Coast 2027' }] : [] };
      },
    };
    const { triggers } = build(pool);
    await triggers.countLineupDrop('fest-2027');
    assert.ok(sqls.some((q) => q.includes('regexp_replace(lower(fp.name)')));
  });

  it('no prior attendees → nothing sent', async () => {
    const { triggers, sends } = build(mockPool('North Coast', []));
    const r = await triggers.sendLineupDrop('fest-2027');
    assert.equal(r.reason, 'no_prior_attendees');
    assert.equal(sends.length, 0);
  });

  it('unknown festival → nothing sent', async () => {
    const { triggers, sends } = build(mockPool('', []));
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
        existsForEvents: async (uids: string[]) => {
          if (existsThrows) throw new Error('dedup read down');
          return new Set(uids.filter((u) => seen.has(u)));
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
