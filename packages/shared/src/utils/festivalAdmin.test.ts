import { describe, it, expect } from 'vitest';
import {
  sortLineup,
  filterLineup,
  pickShiftTargets,
  shiftSetTimes,
  countFestivalChanges,
  describeVersionDifferences,
  festivalStatusLine,
  describeDeleteImpact,
  describeHeldChange,
  groupIssues,
  type EditableSet,
  describeShiftResult,
} from './festivalAdmin';

const stages = [
  { id: 'a', name: 'Main' },
  { id: 'b', name: 'Bass Pod' },
];
const set = (id: string, over: Partial<EditableSet> = {}): EditableSet => ({
  id,
  artist: id,
  stageId: 'a',
  startTime: '20:00',
  endTime: '21:00',
  ...over,
});

describe('sortLineup', () => {
  it('orders by stage, then start with after-midnight last, TBA last', () => {
    const sets = [
      set('tba', { startTime: 'TBA' }),
      set('late', { startTime: '01:00' }),
      set('b1', { stageId: 'b', startTime: '10:00' }),
      set('early', { startTime: '23:00' }),
    ];
    expect(sortLineup(sets, stages).map((s) => s.id)).toEqual(['early', 'late', 'tba', 'b1']);
    expect(sets[0]!.id).toBe('tba');
  });
});

describe('filterLineup', () => {
  it('matches stage names and B2B artist names', () => {
    const sets = [set('x', { artists: [{ name: 'Zed' }, { name: 'Kyle' }] }), set('y', { stageId: 'b' })];
    expect(filterLineup(sets, stages, 'kyle').map((s) => s.id)).toEqual(['x']);
    expect(filterLineup(sets, stages, ' bass ').map((s) => s.id)).toEqual(['y']);
    expect(filterLineup(sets, stages, ' ')).toBe(sets);
  });
});

describe('pickShiftTargets', () => {
  it('includes after-midnight sets when starting from 22:00', () => {
    const sets = [set('a1', { startTime: '21:00' }), set('a2', { startTime: '01:00' }), set('b1', { stageId: 'b', startTime: '23:00' })];
    expect(pickShiftTargets(sets, { stageId: 'a', fromTime: '22:00' })).toEqual(['a2']);
  });
});

describe('shiftSetTimes', () => {
  it('wraps past midnight', () => {
    const r = shiftSetTimes([set('x', { startTime: '23:45', endTime: '23:59' })], ['x'], 30);
    expect(r.sets[0]).toMatchObject({ startTime: '00:15', endTime: '00:29' });
    expect(r.crossedDayStart).toBe(1);
  });
  it('skips TBA and counts crossing 6 AM', () => {
    const r = shiftSetTimes([set('t', { startTime: 'TBA' }), set('c', { startTime: '05:45' })], ['t', 'c'], 30);
    expect(r).toMatchObject({ shifted: 1, skipped: 1, crossedDayStart: 1 });
  });
  it('rejects 0 and 721', () => {
    expect(() => shiftSetTimes([], [], 0)).toThrow(RangeError);
    expect(() => shiftSetTimes([], [], 721)).toThrow(RangeError);
  });
});

describe('countFestivalChanges', () => {
  it('counts a series-only edit as one change', () => {
    expect(countFestivalChanges({ name: 'FK' }, { name: 'FK', seriesId: 'forbidden-kingdom' }).total).toBe(1);
    expect(countFestivalChanges({ seriesId: 'a' }, { seriesId: null }).total).toBe(1);
    expect(countFestivalChanges({ name: 'FK' }, { name: 'FK', seriesId: null }).total).toBe(0);
  });

  it('counts a lineup change as one change, and an absent lineup equals an empty one', () => {
    const entry = (name: string, extra = {}) => ({ id: 'lu-1', artists: [{ name }], ...extra });
    expect(countFestivalChanges({ lineup: [] }, {}).total).toBe(0);
    expect(countFestivalChanges({ lineup: [entry('A')] }, { lineup: [entry('A')] }).total).toBe(0);
    expect(countFestivalChanges({ lineup: [entry('A')] }, { lineup: [entry('A', { tier: 2 })] }).total).toBe(1);
    expect(countFestivalChanges({ lineup: [entry('A')] }, { lineup: [entry('B'), { id: 'x', artists: [{ name: 'C' }] }] }).total).toBe(1);
  });
  it('treats empty and TBA as equal', () => {
    const f = (t: string) => ({ days: [{ sets: [set('x', { startTime: t, endTime: t })] }] });
    expect(countFestivalChanges(f(''), f('TBA')).total).toBe(0);
  });
  it('counts new, removed, edited and moved sets', () => {
    const before = {
      days: [{ sets: [set('e'), set('r'), set('m')] }, { sets: [] }],
    };
    const after = {
      days: [{ sets: [set('e', { artist: 'changed' }), set('n')] }, { sets: [set('m')] }],
    };
    const r = countFestivalChanges(before, after);
    expect(r.total).toBe(4);
    expect([...r.newSetIds]).toEqual(['n']);
    expect([...r.changedSetIds].sort()).toEqual(['e', 'm']);
  });
});

describe('festivalStatusLine', () => {
  const now = Date.parse('2026-11-01T12:03:00Z');
  const updatedAt = '2026-11-01T12:00:00Z';
  it('names the editor when known', () => {
    expect(festivalStatusLine({ publishedAt: null, updatedAt, updatedByUsername: 'asir' }, now)).toEqual({
      state: 'draft',
      chip: 'Draft',
      edited: 'Edited 3m ago by asir',
    });
  });
  it('omits the name when unknown', () => {
    const r = festivalStatusLine({ publishedAt: '2026-10-01T00:00:00Z', updatedAt }, now);
    expect(r).toMatchObject({ chip: 'Published', edited: 'Edited 3m ago' });
  });
});

describe('describeDeleteImpact', () => {
  it('covers singular, plural, zero and null', () => {
    expect(describeDeleteImpact({ profiles: 1, crews: 1, picks: 4 })).toBe(
      '1 person joined this festival and 1 crew uses it. They lose access until you restore it from Archived. Their picks are kept.',
    );
    expect(describeDeleteImpact({ profiles: 5, crews: 2, picks: 0 })).toContain('5 people joined this festival and 2 crews use it.');
    expect(describeDeleteImpact({ profiles: 3, crews: 0, picks: 0 })).toContain('3 people joined this festival and no crews use it.');
    expect(describeDeleteImpact({ profiles: 0, crews: 0, picks: 0 })).toBe(
      'Nobody has joined this festival yet. You can restore it later from Archived.',
    );
    expect(describeDeleteImpact(null)).toBe('People who joined this festival lose access until you restore it from Archived.');
  });

  it('tells an organizer that only Festie can restore, never pointing at Archived', () => {
    const texts = [
      describeDeleteImpact(null, 'manage'),
      describeDeleteImpact({ profiles: 0, crews: 0, picks: 0 }, 'manage'),
      describeDeleteImpact({ profiles: 2, crews: 1, picks: 0 }, 'manage'),
    ];
    for (const t of texts) {
      expect(t).toContain('Festie can restore it if you ask. Contact support.');
      expect(t).not.toContain('Archived');
    }
  });
});

describe('describeHeldChange', () => {
  const slot = (startTime: string | null) => ({ dayLabel: 'Saturday', startTime, stageName: 'Main' });
  it('names a move, a removal and a cancelled act', () => {
    expect(describeHeldChange({ kind: 'moved', artist: 'Kai', before: slot('20:00'), after: slot('21:30') })).toBe(
      'Kai: Saturday, 8:00 PM, Main to Saturday, 9:30 PM, Main',
    );
    expect(describeHeldChange({ kind: 'moved', artist: 'Kai', before: slot(null), after: slot('21:30') })).toContain('Time TBA');
    expect(describeHeldChange({ kind: 'removed', artist: 'Dim', before: null, after: null })).toBe('Dim: removed');
    expect(describeHeldChange({ kind: 'entry_cancelled', artist: 'Zed', before: null, after: null })).toBe('Zed: cancelled');
  });
});

describe('groupIssues', () => {
  it('puts an overlap message under both set keys', () => {
    const g = groupIssues([
      { code: 'stage_overlap', message: 'overlap', target: { kind: 'set', setId: 'late', relatedSetId: 'early', field: 'startTime' } },
    ]);
    expect(g.get('set:late')).toEqual(['overlap']);
    expect(g.get('set:early')).toEqual(['overlap']);
  });
});

describe('describeVersionDifferences', () => {
  const base = { name: 'Fest', location: 'Orlando', timeZone: 'America/New_York', stages: [{ id: 'a', name: 'Main' }], days: [{ label: 'Fri', date: '2027-06-04', sets: [set('s1')] }] };

  it('is empty when both copies match', () => {
    expect(describeVersionDifferences(base, { ...base })).toEqual([]);
  });

  it('names each field and count that differs, theirs first', () => {
    const mine = { ...base, name: 'Fest 2', stages: [...base.stages, { id: 'b', name: 'Pod' }], days: [{ ...base.days[0]!, sets: [set('s1'), set('s2')] }] };
    expect(describeVersionDifferences(base, mine)).toEqual([
      'Name: theirs "Fest", yours "Fest 2".',
      'Stages: theirs 1, yours 2.',
      'Sets: theirs 1, yours 2.',
    ]);
  });

  it('still reports a change that keeps every count the same', () => {
    const mine = { ...base, days: [{ ...base.days[0]!, sets: [set('s1', { artist: 'Renamed' })] }] };
    expect(describeVersionDifferences(base, mine)).toEqual(['1 detail differs inside the stages, days or sets.']);
  });
});

describe('describeShiftResult', () => {
  it('uses the singular for one set', () => {
    expect(describeShiftResult({ shifted: 1, skipped: 0, crossedDayStart: 0 }, 15)).toBe('Shifted 1 set by +15 min.');
    expect(describeShiftResult({ shifted: 3, skipped: 0, crossedDayStart: 0 }, -10)).toBe('Shifted 3 sets by -10 min.');
  });
});
