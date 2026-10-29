import { describe, it, expect, afterEach, vi } from 'vitest';
import type { CrewMeetingPoint, FestivalDay, FestivalSet, SosEntry } from '../types/domain';
import {
  fmtStartsIn,
  fmtTimeLeft,
  fmtZonedClock,
  logicalDayIndexAt,
  selectActiveMeet,
  selectActiveSos,
  selectCrewWhereabouts,
  selectNowNext,
  sosHeadline,
  sosWhen,
} from './dayOf';

// All zoned: assertions hold in every host zone. New York is UTC-4 in September.
const TZ = 'America/New_York';
const ny = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  // 2026-09 is EDT (UTC-4).
  const [y, mo, d] = date.split('-').map(Number);
  return Date.UTC(y!, mo! - 1, d!, h! + 4, m!);
};

const DAYS = [
  { id: 'd0', festivalId: 'f', date: '2026-09-04', createdAt: '' },
  { id: 'd1', festivalId: 'f', date: '2026-09-05', createdAt: '' },
] as FestivalDay[];

function set(id: string, dayIndex: number, startTime: string, endTime: string): FestivalSet {
  return { id, festivalId: 'f', stageId: 's', dayIndex, startTime, endTime, artist: id, createdAt: '', updatedAt: '' };
}

const SETS = [
  set('early', 0, '18:00', '19:00'),
  set('late', 0, '23:30', '01:30'), // runs past midnight
  set('sat', 1, '20:00', '21:00'),
];

describe('logicalDayIndexAt', () => {
  it('keeps 01:00 after midnight on the previous festival day', () => {
    expect(logicalDayIndexAt(DAYS, ny('2026-09-05', '01:00'), TZ)).toBe(0);
    expect(logicalDayIndexAt(DAYS, ny('2026-09-05', '07:00'), TZ)).toBe(1);
    expect(logicalDayIndexAt(DAYS, ny('2026-09-04', '05:00'), TZ)).toBeNull();
  });
});

describe('selectNowNext', () => {
  const picks = { late: 'must', sat: 'maybe' } as const;

  it('reads a past-midnight pick as live at 00:30 in the festival zone', () => {
    const r = selectNowNext({ sets: SETS, days: DAYS, picks, nowMs: ny('2026-09-05', '00:30'), timeZone: TZ });
    expect(r.phase).toBe('during');
    expect(r.dayIndex).toBe(0);
    expect(r.current.map((s) => s.set.id)).toEqual(['late']);
    expect(r.current[0]!.priority).toBe('must');
    expect(r.upcoming.map((s) => s.set.id)).toEqual(['sat']);
    expect(r.todayCount).toBe(1);
  });

  it('uses the whole lineup for a guest (no picks)', () => {
    const r = selectNowNext({ sets: SETS, days: DAYS, nowMs: ny('2026-09-04', '18:30'), timeZone: TZ });
    expect(r.current.map((s) => s.set.id)).toEqual(['early']);
    expect(r.current[0]!.priority).toBeNull();
    expect(r.upcoming.map((s) => s.set.id)).toEqual(['late', 'sat']);
    expect(r.todayCount).toBe(2);
  });

  it('reports before, with the first set start', () => {
    const r = selectNowNext({ sets: SETS, days: DAYS, picks, nowMs: ny('2026-09-01', '12:00'), timeZone: TZ });
    expect(r.phase).toBe('before');
    expect(r.startsAt).toBe(ny('2026-09-04', '18:00'));
  });

  it('reports no picks today while other days still have picks', () => {
    const r = selectNowNext({ sets: SETS, days: DAYS, picks: { sat: 'must' }, nowMs: ny('2026-09-04', '19:30'), timeZone: TZ });
    expect(r.phase).toBe('during');
    expect(r.todayCount).toBe(0);
    expect(r.upcoming.map((s) => s.set.id)).toEqual(['sat']);
  });

  it('reports after once the last day is over, and none without days', () => {
    expect(selectNowNext({ sets: SETS, days: DAYS, picks, nowMs: ny('2026-09-07', '12:00'), timeZone: TZ }).phase).toBe(
      'after',
    );
    expect(selectNowNext({ sets: SETS, days: [], picks, nowMs: 0 }).phase).toBe('none');
  });
});

describe('time labels', () => {
  const now = ny('2026-09-04', '18:00');
  it('formats starts-in and time left', () => {
    expect(fmtStartsIn(now + 30_000, now, TZ)).toBe('starting now');
    expect(fmtStartsIn(now + 25 * 60_000, now, TZ)).toBe('in 25m');
    expect(fmtStartsIn(now + 190 * 60_000, now, TZ)).toBe('in 3h 10m');
    expect(fmtStartsIn(ny('2026-09-05', '20:00'), now, TZ)).toBe('Sat 8:00 PM');
    expect(fmtTimeLeft(now + 65 * 60_000, now)).toBe('1h 5m left');
    expect(fmtZonedClock(ny('2026-09-05', '00:30'), TZ)).toBe('12:30 AM');
  });
});

describe('SOS', () => {
  afterEach(() => vi.useRealTimers());
  const sos = (userId: string, username: string, raisedAt: string, crewId = 'c1'): SosEntry => ({
    crewId,
    userId,
    username,
    raisedAt,
  });

  it('selects the open crew, newest first', () => {
    const list = [
      sos('a', 'Ana', '2026-09-04T20:00:00Z'),
      sos('b', 'Ben', '2026-09-04T21:00:00Z'),
      sos('x', 'Xi', '2026-09-04T22:00:00Z', 'other'),
    ];
    expect(selectActiveSos(list, 'c1').map((e) => e.userId)).toEqual(['b', 'a']);
    expect(selectActiveSos([], 'c1')).toEqual([]);
  });

  it('names who and when', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T21:04:00Z'));
    const ben = sos('b', 'Ben', '2026-09-04T21:00:00Z');
    expect(sosHeadline([ben], 'me')).toBe('Ben needs help');
    expect(sosHeadline([ben], 'b')).toBe('You sent an SOS');
    expect(sosHeadline([ben, sos('a', 'Ana', '2026-09-04T20:00:00Z')], 'me')).toBe('Ben and 1 other need help');
    expect(sosWhen([ben])).toBe('SOS 4m ago');
  });
});

describe('selectCrewWhereabouts', () => {
  it('orders SOS, then live, then status; excludes self', () => {
    const nowMs = Date.parse('2026-09-04T21:00:00Z');
    const rows = selectCrewWhereabouts({
      members: [{ userId: 'me' }, { userId: 'a', name: 'Ana' }, { userId: 'b', name: 'Ben' }, { userId: 'c', username: 'cat' }, { userId: 'd', name: 'Dee' }],
      statuses: [
        {
          crew_id: 'c1',
          user_id: 'a',
          status: 'here',
          target_meeting_point_id: 'mp1',
          eta_minutes: null,
          note: null,
          updated_at: '2026-09-04T20:50:00Z',
        },
      ],
      peers: {
        b: { crewId: 'c1', userId: 'b', username: 'Ben', lat: 0, lng: 0, capturedAt: '', serverAt: '2026-09-04T20:59:50Z' },
      },
      sos: [{ crewId: 'c1', userId: 'c', username: 'cat', raisedAt: '2026-09-04T20:58:00Z' }],
      meetingPoints: [{ id: 'mp1', label: 'Big tree' }],
      selfUserId: 'me',
      nowMs,
    });
    expect(rows.map((r) => r.userId)).toEqual(['c', 'b', 'a', 'd']);
    expect(rows[0]!.name).toBe('cat');
    expect(rows[1]!.live).toBe('live');
    expect(rows[2]!.statusLabel).toBe('Here · Big tree');
    expect(rows[3]!.statusLabel).toBeNull();
  });
});

describe('selectActiveMeet', () => {
  const mp = (id: string, meet_at: string | null, extra: Partial<CrewMeetingPoint> = {}): CrewMeetingPoint => ({
    id,
    crew_id: 'c1',
    created_by: 'u',
    label: id,
    location: `${id} spot`,
    type: 'meet',
    meet_at,
    stage_reference: null,
    active: true,
    created_at: '2026-09-01T00:00:00Z',
    ...extra,
  });
  const nowMs = Date.parse('2026-09-04T22:00:00Z');

  it('picks the soonest upcoming point, keeping one that passed under 30 min ago', () => {
    const r = selectActiveMeet({
      meetingPoints: [mp('later', '2026-09-04T23:00:00Z'), mp('just-passed', '2026-09-04T21:45:00Z'), mp('old', '2026-09-04T20:00:00Z')],
      crew: null,
      days: DAYS,
      nowMs,
    });
    expect(r?.id).toBe('just-passed');
  });

  it('falls back to an untimed point, then Home Base', () => {
    expect(selectActiveMeet({ meetingPoints: [mp('pin', null)], crew: null, days: DAYS, nowMs })?.id).toBe('pin');
    const hb = selectActiveMeet({
      meetingPoints: [mp('off', null, { active: false })],
      crew: { homeBaseLocation: 'Camp B12', homeBaseTime: '23:30' },
      days: DAYS,
      nowMs,
    });
    expect(hb).toMatchObject({ kind: 'home-base', location: 'Camp B12', timeText: '23:30' });
    expect(selectActiveMeet({ meetingPoints: [], crew: null, days: DAYS, nowMs })).toBeNull();
  });
});
