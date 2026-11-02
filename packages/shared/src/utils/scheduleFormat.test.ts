import { describe, it, expect } from 'vitest';
import {
  fmtCountdown,
  byStartTime,
  setLabel,
  formatDayChip,
  formatSetWhen,
  splitCardsByNow,
  reminderNoteSummary,
  formatSetTimeRange,
  buildListenList,
  listenListText,
} from './scheduleFormat';
import { zonedWallTimeToMs } from './setStatus';
import type { SetStatus } from './setStatus';
import type { FestivalSet } from '../types/domain';

// ---------------------------------------------------------------------------
// fmtCountdown
// ---------------------------------------------------------------------------

describe('fmtCountdown', () => {
  it('returns "now" when mins < 1', () => {
    expect(fmtCountdown(0)).toBe('now');
    expect(fmtCountdown(-1)).toBe('now');
  });

  it('returns "in Nm" for sub-hour countdowns', () => {
    expect(fmtCountdown(1)).toBe('in 1m');
    expect(fmtCountdown(25)).toBe('in 25m');
    expect(fmtCountdown(59)).toBe('in 59m');
  });

  it('returns "in Nh Nm" for countdowns with leftover minutes', () => {
    expect(fmtCountdown(90)).toBe('in 1h 30m');
    expect(fmtCountdown(75)).toBe('in 1h 15m');
    expect(fmtCountdown(125)).toBe('in 2h 5m');
  });

  it('omits the minutes component when it is exactly 0', () => {
    expect(fmtCountdown(60)).toBe('in 1h');
    expect(fmtCountdown(120)).toBe('in 2h');
    expect(fmtCountdown(180)).toBe('in 3h');
  });
});

// ---------------------------------------------------------------------------
// byStartTime
// ---------------------------------------------------------------------------

function makeSet(startTime: string | undefined): FestivalSet {
  return {
    id: 'x',
    festivalId: 'f',
    stageId: 's',
    startTime: startTime ?? '',
    endTime: '',
    createdAt: '',
    updatedAt: '',
  };
}

describe('byStartTime', () => {
  it('sorts earlier time before later time', () => {
    const a = makeSet('14:00');
    const b = makeSet('16:00');
    expect(byStartTime(a, b)).toBeLessThan(0);
    expect(byStartTime(b, a)).toBeGreaterThan(0);
  });

  it('returns 0 for equal times', () => {
    const a = makeSet('12:00');
    const b = makeSet('12:00');
    expect(byStartTime(a, b)).toBe(0);
  });

  it('sorts sets with a startTime before sets without one', () => {
    const withTime = makeSet('10:00');
    const noTime = makeSet(undefined);
    expect(byStartTime(withTime, noTime)).toBeLessThan(0);
    expect(byStartTime(noTime, withTime)).toBeGreaterThan(0);
  });

  it('returns 0 when both sets have no startTime', () => {
    const a = makeSet(undefined);
    const b = makeSet(undefined);
    expect(byStartTime(a, b)).toBe(0);
  });

  it('produces chronological order when used with Array.sort', () => {
    const sets = [makeSet('20:00'), makeSet('12:00'), makeSet('08:00'), makeSet('15:30')];
    const sorted = [...sets].sort(byStartTime);
    expect(sorted.map((s) => s.startTime)).toEqual(['08:00', '12:00', '15:30', '20:00']);
  });

  it('sorts an after-midnight start after the late-night sets of the same day', () => {
    const sorted = [makeSet('01:00'), makeSet('18:00'), makeSet('23:30')].sort(byStartTime);
    expect(sorted.map((s) => s.startTime)).toEqual(['18:00', '23:30', '01:00']);
  });
});

// ---------------------------------------------------------------------------
// setLabel
// ---------------------------------------------------------------------------

describe('setLabel', () => {
  const base: FestivalSet = {
    id: 'abc123',
    festivalId: 'f',
    stageId: 's',
    startTime: '14:00',
    endTime: '15:00',
    artist: 'Daft Punk',
    createdAt: '',
    updatedAt: '',
  };

  it('returns "Artist — HH:MM" when set has artist + startTime', () => {
    expect(setLabel(base, base.id)).toBe('Daft Punk — 14:00');
  });

  it('falls back to first artist in artists array when artist field absent', () => {
    const set = { ...base, artist: undefined, artists: [{ name: 'Bicep' }] };
    expect(setLabel(set, set.id)).toBe('Bicep — 14:00');
  });

  it('omits the time part when startTime is empty', () => {
    const set = { ...base, startTime: '' };
    expect(setLabel(set, set.id)).toBe('Daft Punk');
  });

  it('falls back to truncated id when set is undefined', () => {
    expect(setLabel(undefined, 'abc123xyz')).toBe('Set abc123');
  });

  it('falls back to truncated id + time when neither artist nor artists present', () => {
    // The fallback id is still combined with the startTime when present.
    const set = { ...base, artist: undefined, artists: undefined };
    expect(setLabel(set, 'abc123xyz')).toBe('Set abc123 — 14:00');
  });

  it('falls back to truncated id only when no artist, no artists, and no startTime', () => {
    const set = { ...base, artist: undefined, artists: undefined, startTime: '' };
    expect(setLabel(set, 'abc123xyz')).toBe('Set abc123');
  });
});

// ---------------------------------------------------------------------------
// T19 helpers
// ---------------------------------------------------------------------------

const TZ = 'America/New_York';
const days = [
  { id: 'd0', festivalId: 'f', date: '2026-11-07', label: 'Saturday', createdAt: '' },
  { id: 'd1', festivalId: 'f', date: '2026-11-08', label: 'Day 2', createdAt: '' },
];
const at = (date: string, hh: number, mm = 0) => zonedWallTimeToMs(date, hh, mm, TZ);
const mk = (id: string, startTime: string, endTime: string, dayIndex = 0, artist = id): FestivalSet => ({
  id,
  festivalId: 'f',
  stageId: 's',
  dayIndex,
  startTime,
  endTime,
  artist,
  createdAt: '',
  updatedAt: '',
});
const status = (s: SetStatus, label: string) => ({ status: s, label, minutesUntil: 0, progress: 0 });

describe('formatDayChip', () => {
  it('adds the date beside a weekday label', () => {
    expect(formatDayChip({ date: '2026-11-07', label: 'Saturday' })).toEqual({
      label: 'Saturday',
      date: 'Nov 7',
      a11y: 'Saturday, November 7',
    });
  });
  it('keeps an admin label and falls back to the weekday', () => {
    expect(formatDayChip({ date: '2026-11-07', label: 'Day 1' }).label).toBe('Day 1');
    expect(formatDayChip({ date: '2026-11-07' }).label).toBe('Saturday');
  });
  it('omits the date when the label has it or the date is invalid', () => {
    expect(formatDayChip({ date: '2026-11-07', label: 'Sat Nov 7' })).toEqual({
      label: 'Sat Nov 7',
      date: null,
      a11y: 'Sat Nov 7',
    });
    expect(formatDayChip({ date: 'soon' })).toEqual({ label: 'soon', date: null, a11y: 'soon' });
    expect(formatDayChip({ date: '' }).label).toBe('Day');
  });
});

describe('formatSetWhen', () => {
  it('joins day, time and status', () => {
    const set = mk('a', '15:00', '15:55');
    expect(formatSetWhen(set, days, status('upcoming', 'In 2h'))).toBe('Saturday, Nov 7 · 3:00 PM - 3:55 PM · In 2h');
    expect(formatSetWhen(set, days, status('live', 'LIVE'))).toBe('Saturday, Nov 7 · 3:00 PM - 3:55 PM · Live now');
    expect(formatSetWhen(set, days, status('past', 'Ended'))).toBe('Saturday, Nov 7 · 3:00 PM - 3:55 PM · Ended');
    expect(formatSetWhen(set, days, status('later', '3:00 PM'))).toBe('Saturday, Nov 7 · 3:00 PM - 3:55 PM');
  });
  it('handles TBA and a missing day', () => {
    expect(formatSetWhen(mk('a', '', ''), days, status('tba', 'TBA'))).toBe('Saturday, Nov 7 · Time TBA');
    expect(formatSetWhen({ ...mk('a', '15:00', ''), dayIndex: undefined }, days, null)).toBe('3:00 PM');
  });
});

describe('splitCardsByNow', () => {
  const sets = [mk('late', '22:00', '23:00'), mk('early', '12:00', '13:00'), mk('mid', '15:00', '16:00')];
  it('puts ended sets of today in earlier, in time order', () => {
    const r = splitCardsByNow(sets, { days, nowMs: at('2026-11-07', 15, 30), timeZone: TZ });
    expect(r.earlier.map((s) => s.id)).toEqual(['early']);
    expect(r.rest.map((s) => s.id)).toEqual(['mid', 'late']);
  });
  it('has no earlier group before the festival or between days', () => {
    expect(splitCardsByNow(sets, { days, nowMs: at('2026-11-05', 15), timeZone: TZ }).earlier).toEqual([]);
    const r = splitCardsByNow(sets, { days, nowMs: at('2026-11-08', 15), timeZone: TZ });
    expect(r.earlier).toEqual([]);
    expect(r.rest.map((s) => s.id)).toEqual(['early', 'mid', 'late']);
  });
  it('breaks start-time ties by name', () => {
    const r = splitCardsByNow([mk('b', '12:00', '13:00', 0, 'Bee'), mk('a', '12:00', '13:00', 0, 'ant')], {
      days,
      nowMs: at('2026-11-05', 15),
      timeZone: TZ,
    });
    expect(r.rest.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('reminderNoteSummary', () => {
  it('describes each state', () => {
    expect(reminderNoteSummary(15, false, true)).toBe('Reminder 15m before · Add a note');
    expect(reminderNoteSummary(60, true, true)).toBe('Reminder 1h before · Note added');
    expect(reminderNoteSummary(null, false, true)).toBe('Remind me · Add a note');
    expect(reminderNoteSummary(15, true, false)).toBe('Note added');
  });
});

describe('formatSetTimeRange', () => {
  it('shows start - end, the start alone, or nothing', () => {
    expect(formatSetTimeRange(mk('a', '15:00', '15:55'))).toBe('3:00 PM - 3:55 PM');
    expect(formatSetTimeRange(mk('a', '15:00', ''))).toBe('3:00 PM');
    expect(formatSetTimeRange(mk('a', '', '15:55'))).toBe('');
  });
});

describe('buildListenList / listenListText', () => {
  const spotify = (set: FestivalSet, url: string): FestivalSet => ({
    ...set,
    artists: [{ name: set.artist ?? '', links: { spotify: url } }],
  });
  const sets = [
    spotify(mk('late', '22:00', '23:00', 0, 'Late'), 'https://open.spotify.com/artist/abc123'),
    mk('d2', '14:00', '15:00', 1, 'Second'),
    spotify(mk('early', '13:00', '14:00', 0, 'Early'), 'javascript:alert(1)//artist/x1'),
    { ...mk('tba', '', '', 0, 'Unplaced'), dayIndex: undefined },
  ];

  it('groups by day in time order, unscheduled last, https links only', () => {
    expect(buildListenList(sets, days)).toEqual([
      {
        label: 'Saturday, Nov 7',
        rows: [
          { setId: 'early', name: 'Early', spotifyUrl: null },
          { setId: 'late', name: 'Late', spotifyUrl: 'https://open.spotify.com/artist/abc123' },
        ],
      },
      { label: 'Day 2, Nov 8', rows: [{ setId: 'd2', name: 'Second', spotifyUrl: null }] },
      { label: 'Unscheduled', rows: [{ setId: 'tba', name: 'Unplaced', spotifyUrl: null }] },
    ]);
  });

  it('formats copyable text', () => {
    expect(listenListText('Fest', buildListenList(sets.slice(0, 2), days))).toBe(
      [
        'Listen before you go: Fest',
        '',
        'Saturday, Nov 7',
        '- Late: https://open.spotify.com/artist/abc123',
        '',
        'Day 2, Nov 8',
        '- Second',
      ].join('\n'),
    );
  });
});
