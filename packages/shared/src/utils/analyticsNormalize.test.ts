import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeAnalytics,
  ANALYTICS_DEFAULTS,
  formatDate,
  timeAgoFromIso,
  pct,
  analyticsQuestions,
  analyticsScopeLine,
  funnelSteps,
} from './analyticsNormalize';

// ---------------------------------------------------------------------------
// normalizeAnalytics
// ---------------------------------------------------------------------------

describe('normalizeAnalytics', () => {
  it('returns empty defaults for null input', () => {
    expect(normalizeAnalytics(null)).toEqual(ANALYTICS_DEFAULTS);
  });

  it('returns empty defaults for undefined input', () => {
    expect(normalizeAnalytics(undefined)).toEqual(ANALYTICS_DEFAULTS);
  });

  it('returns empty defaults for empty object', () => {
    expect(normalizeAnalytics({})).toEqual(ANALYTICS_DEFAULTS);
  });

  it('passes generatedAt through when it is a string', () => {
    const result = normalizeAnalytics({ generatedAt: '2026-06-01T12:00:00Z' });
    expect(result.generatedAt).toBe('2026-06-01T12:00:00Z');
  });

  it('sets generatedAt to null when missing', () => {
    expect(normalizeAnalytics({}).generatedAt).toBeNull();
  });

  it('sets generatedAt to null when non-string', () => {
    expect(normalizeAnalytics({ generatedAt: 42 }).generatedAt).toBeNull();
  });

  describe('topSets coercion', () => {
    it('normalizes a fully-populated set row', () => {
      const raw = {
        topSets: [
          {
            artist: 'Bonobo',
            stageId: 'stage-1',
            dayIndex: 2,
            festivalId: 'fest-1',
            startTime: '20:00',
            endTime: '22:00',
            pickCount: '15',
            mustCount: '7',
            wantCount: '5',
            maybeCount: '3',
          },
        ],
      };
      const [set] = normalizeAnalytics(raw).topSets;
      expect(set).toEqual({
        artist: 'Bonobo',
        stageId: 'stage-1',
        dayIndex: 2,
        festivalId: 'fest-1',
        startTime: '20:00',
        endTime: '22:00',
        pickCount: 15,
        mustCount: 7,
        wantCount: 5,
        maybeCount: 3,
        festivalName: '',
        dayLabel: null,
      });
    });

    it('coerces numeric-string counts to numbers', () => {
      const raw = { topSets: [{ artist: 'X', festivalId: 'f', pickCount: '99', mustCount: '0', wantCount: '0', maybeCount: '0' }] };
      expect(normalizeAnalytics(raw).topSets[0]!.pickCount).toBe(99);
    });

    it('defaults null-ish numeric fields to 0', () => {
      const raw = { topSets: [{ artist: 'X', festivalId: 'f' }] };
      const [set] = normalizeAnalytics(raw).topSets;
      expect(set!.pickCount).toBe(0);
      expect(set!.mustCount).toBe(0);
      expect(set!.wantCount).toBe(0);
      expect(set!.maybeCount).toBe(0);
    });

    it('sets stageId/startTime/endTime to null when absent', () => {
      const raw = { topSets: [{ artist: 'X', festivalId: 'f' }] };
      const [set] = normalizeAnalytics(raw).topSets;
      expect(set!.stageId).toBeNull();
      expect(set!.startTime).toBeNull();
      expect(set!.endTime).toBeNull();
      expect(set!.dayIndex).toBeNull();
    });

    it('treats non-array topSets as empty', () => {
      expect(normalizeAnalytics({ topSets: 'bad' }).topSets).toEqual([]);
    });

    it('returns empty array for missing topSets', () => {
      expect(normalizeAnalytics({}).topSets).toEqual([]);
    });

    it('collapses non-finite numeric-string to 0', () => {
      const raw = { topSets: [{ artist: 'X', festivalId: 'f', pickCount: 'NaN' }] };
      expect(normalizeAnalytics(raw).topSets[0]!.pickCount).toBe(0);
    });
  });

  describe('activeUsers coercion', () => {
    it('normalizes a user row with string numeric fields', () => {
      const raw = {
        activeUsers: [
          { id: 'u1', username: 'alice', profileCount: '3', totalPicks: '42', lastActive: '2026-06-01T10:00:00Z' },
        ],
      };
      expect(normalizeAnalytics(raw).activeUsers[0]).toEqual({
        id: 'u1',
        username: 'alice',
        profileCount: 3,
        totalPicks: 42,
        lastActive: '2026-06-01T10:00:00Z',
      });
    });

    it('defaults missing fields to empty string / 0', () => {
      const raw = { activeUsers: [{}] };
      const [u] = normalizeAnalytics(raw).activeUsers;
      expect(u!.id).toBe('');
      expect(u!.username).toBe('');
      expect(u!.profileCount).toBe(0);
      expect(u!.totalPicks).toBe(0);
      expect(u!.lastActive).toBe('');
    });

    it('treats non-array activeUsers as empty', () => {
      expect(normalizeAnalytics({ activeUsers: null }).activeUsers).toEqual([]);
    });
  });

  describe('crews coercion', () => {
    it('normalizes a crew row with string memberCount', () => {
      const raw = {
        crews: [{ id: 'c1', name: 'Goons', festivalId: 'f', memberCount: '8', createdAt: '2026-01-01' }],
      };
      expect(normalizeAnalytics(raw).crews[0]).toEqual({
        id: 'c1',
        name: 'Goons',
        festivalId: 'f',
        memberCount: 8,
        createdAt: '2026-01-01',
        festivalName: '',
      });
    });

    it('treats non-array crews as empty', () => {
      expect(normalizeAnalytics({ crews: 42 }).crews).toEqual([]);
    });
  });

  describe('festivalStats coercion', () => {
    it('normalizes stat fields', () => {
      const raw = {
        festivalStats: [
          { id: 'f1', name: 'Fest', profileCount: '100', uniqueSetsPicked: '50', totalPicks: '300' },
        ],
      };
      expect(normalizeAnalytics(raw).festivalStats[0]).toEqual({
        id: 'f1',
        name: 'Fest',
        profileCount: 100,
        uniqueSetsPicked: 50,
        totalPicks: 300,
      });
    });

    it('treats non-array festivalStats as empty', () => {
      expect(normalizeAnalytics({ festivalStats: false }).festivalStats).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// ANALYTICS_DEFAULTS
// ---------------------------------------------------------------------------

describe('ANALYTICS_DEFAULTS', () => {
  it('has all empty arrays and null generatedAt', () => {
    expect(ANALYTICS_DEFAULTS).toMatchObject({
      topSets: [],
      activeUsers: [],
      crews: [],
      festivalStats: [],
      generatedAt: null,
    });
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('returns "—" for empty string', () => {
    expect(formatDate('')).toBe('—');
  });

  it('formats an ISO datetime to YYYY-MM-DD', () => {
    expect(formatDate('2026-06-01T12:00:00Z')).toBe('2026-06-01');
  });

  it('passes through a bare YYYY-MM-DD unchanged', () => {
    expect(formatDate('2026-06-01')).toBe('2026-06-01');
  });

  it('returns the original string for an unparseable value', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

// ---------------------------------------------------------------------------
// timeAgoFromIso
// ---------------------------------------------------------------------------

const NOW_ISO = '2026-06-21T15:00:00Z';
const NOW_MS = new Date(NOW_ISO).getTime();

afterEach(() => {
  vi.useRealTimers();
});

function freeze(msAgo: number): string {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  return new Date(NOW_MS - msAgo).toISOString();
}

describe('timeAgoFromIso', () => {
  it('returns "—" for empty string', () => {
    expect(timeAgoFromIso('')).toBe('—');
  });

  it('returns the raw string for an unparseable ISO value', () => {
    expect(timeAgoFromIso('not-a-date')).toBe('not-a-date');
  });

  it('returns "just now" for a timestamp under 60 seconds ago', () => {
    expect(timeAgoFromIso(freeze(30_000))).toBe('just now');
    expect(timeAgoFromIso(freeze(59_000))).toBe('just now');
  });

  it('returns minutes for 1m–59m ago', () => {
    expect(timeAgoFromIso(freeze(60_000))).toBe('1m ago');
    expect(timeAgoFromIso(freeze(59 * 60_000))).toBe('59m ago');
  });

  it('returns hours for 1h–23h ago', () => {
    expect(timeAgoFromIso(freeze(60 * 60_000))).toBe('1h ago');
    expect(timeAgoFromIso(freeze(23 * 60 * 60_000))).toBe('23h ago');
  });

  it('returns days at/after 24h', () => {
    expect(timeAgoFromIso(freeze(24 * 60 * 60_000))).toBe('1d ago');
    expect(timeAgoFromIso(freeze(3 * 24 * 60 * 60_000))).toBe('3d ago');
  });
});

describe('admin analytics copy', () => {
  const raw = {
    scope: { festivalId: null, festivalName: null },
    totals: {
      signedUp: '10',
      usersWithPlan: '8',
      plans: '9',
      plansWithPicks: '4',
      usersWithPick: '6',
      picks: '10',
      crews: '3',
      crewMembers: '7',
      usersInCrews: '4',
      crewsWithTwoPlus: '2',
    },
    pickDistribution: { must: '1', want: '2', maybe: '3' },
    install: { days: 30, shown: '5', accepted: '2', dismissed: '3' },
    topSets: [{ artist: 'A', pickCount: '2', festivalName: 'F', dayLabel: 'Fri' }],
    crews: [{ id: 'c', festivalName: 'F' }],
    festivalStats: [{}, {}],
  };

  it('normalizes new fields from strings', () => {
    const d = normalizeAnalytics(raw);
    expect(d.totals.signedUp).toBe(10);
    expect(d.pickDistribution).toEqual({ must: 1, want: 2, maybe: 3 });
    expect(d.install).toEqual({ days: 30, shown: 5, accepted: 2, dismissed: 3 });
    expect(d.topSets[0]).toMatchObject({ festivalName: 'F', dayLabel: 'Fri', pickCount: 2 });
    expect(d.crews[0].festivalName).toBe('F');
  });

  it('turns missing objects into zeros', () => {
    const d = normalizeAnalytics({});
    expect(d.scope).toEqual({ festivalId: null, festivalName: null });
    expect(d.totals.picks).toBe(0);
    expect(d.install).toEqual({ days: 30, shown: 0, accepted: 0, dismissed: 0 });
    expect(d).toEqual({ ...ANALYTICS_DEFAULTS });
  });

  it('pct rounds and handles zero', () => {
    expect(pct(1, 3)).toBe('33%');
    expect(pct(1, 0)).toBe('0%');
  });

  it('answers every question', () => {
    const answers = Object.fromEntries(analyticsQuestions(normalizeAnalytics(raw)).map((q) => [q.id, q.answer]));
    expect(answers).toEqual({
      picked: '6 of 8 people with a plan (75%).',
      crewed: '4 of 8 people with a plan (50%).',
      crewSize: '2 of 3 crews. The average crew has 2.3 members.',
      picksPerPlan: '2.5 on average, across 4 plans with at least one pick.',
      install: 'In the last 30 days the install button was offered 5 times: 2 installed and 3 said no.',
    });
  });

  it('gives the zero form of every answer', () => {
    const answers = Object.fromEntries(analyticsQuestions(normalizeAnalytics({})).map((q) => [q.id, q.answer]));
    expect(answers).toEqual({
      picked: 'No one has a plan yet.',
      crewed: 'No one has a plan yet.',
      crewSize: 'No crews yet.',
      picksPerPlan: 'No plan has a pick yet.',
      install: 'The install button was not offered in the last 30 days.',
    });
  });

  it('leaves out install in festival scope and words the scope line', () => {
    const d = normalizeAnalytics({ ...raw, scope: { festivalId: 'f1', festivalName: 'Fest One' } });
    expect(analyticsQuestions(d).map((q) => q.id)).not.toContain('install');
    expect(analyticsScopeLine(d)).toBe('At Fest One: 8 people with a plan.');
    expect(analyticsScopeLine(normalizeAnalytics(raw))).toBe('Across all 2 festivals and 10 accounts.');
  });

  it('builds funnel steps', () => {
    expect(funnelSteps(normalizeAnalytics(raw))).toEqual([
      { label: 'Signed up', count: 10, pctOfStart: '100%' },
      { label: 'Joined a festival', count: 8, pctOfStart: '80%' },
      { label: 'Picked a set', count: 6, pctOfStart: '60%' },
      { label: 'Joined a crew', count: 4, pctOfStart: '40%' },
    ]);
  });
});
