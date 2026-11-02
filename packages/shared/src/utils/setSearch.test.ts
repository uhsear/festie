import { describe, it, expect } from 'vitest';
import { setMatchesSearch, searchOtherDays } from './setSearch';
import type { FestivalSet, Stage } from '../types/domain';

const stages: Stage[] = [
  { id: 's1', name: 'Main Stage', festivalId: 'f1', createdAt: '', updatedAt: '' },
  { id: 's2', name: 'Circuit Grounds', festivalId: 'f1', createdAt: '', updatedAt: '' },
];

function mk(id: string, over: Partial<FestivalSet>): FestivalSet {
  return {
    id,
    festivalId: 'f1',
    stageId: 's1',
    startTime: '20:00',
    endTime: '21:00',
    dayIndex: 0,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('setMatchesSearch', () => {
  const set = mk('a', { artist: 'Daft Punk' });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(setMatchesSearch(set, 'DAFT', stages)).toBe(true);
    expect(setMatchesSearch(set, '  punk  ', stages)).toBe(true);
    expect(setMatchesSearch(set, 'justice', stages)).toBe(false);
  });

  it('matches every set for an empty or whitespace-only query', () => {
    expect(setMatchesSearch(set, '', stages)).toBe(true);
    expect(setMatchesSearch(set, '   ', stages)).toBe(true);
  });

  it('matches any B2B artist name', () => {
    const b2b = mk('b', { artist: undefined, artists: [{ name: 'Bob Moses' }, { name: 'Lane 8' }] });
    expect(setMatchesSearch(b2b, 'lane', stages)).toBe(true);
    expect(setMatchesSearch(b2b, 'moses', stages)).toBe(true);
    expect(setMatchesSearch(b2b, 'kaskade', stages)).toBe(false);
  });

  it('matches the stage name', () => {
    const onCircuit = mk('c', { artist: 'Someone', stageId: 's2' });
    expect(setMatchesSearch(onCircuit, 'circuit', stages)).toBe(true);
    expect(setMatchesSearch(onCircuit, 'main', stages)).toBe(false);
  });

  it('does not match an unknown stage', () => {
    expect(setMatchesSearch(mk('d', { artist: 'X', stageId: 'nope' }), 'stage', stages)).toBe(false);
  });
});

describe('searchOtherDays', () => {
  const sets = [
    mk('fri', { artist: 'Kaskade', dayIndex: 0 }),
    mk('sun-late', { artist: 'Kaskade b2b Deadmau5', dayIndex: 2, startTime: '01:00' }),
    mk('sun-tba', { artist: 'Kaskade (secret)', dayIndex: 2, startTime: '' }),
    mk('sun-early', { artist: 'Kaskade', dayIndex: 2, startTime: '22:00' }),
    mk('sat', { artist: 'kaskade', dayIndex: 1, stageId: 's2' }),
    mk('sat-other', { artist: 'Zedd', dayIndex: 1 }),
  ];

  it('groups matches on other days by ascending day, excluding the selected day', () => {
    const groups = searchOtherDays(sets, 'kaskade', 0, stages);
    expect(groups.map((g) => g.dayIndex)).toEqual([1, 2]);
    expect(groups[0]!.sets.map((s) => s.id)).toEqual(['sat']);
  });

  it('sorts within a day by festival start time, with TBA last', () => {
    const sunday = searchOtherDays(sets, 'kaskade', 0, stages).find((g) => g.dayIndex === 2)!;
    expect(sunday.sets.map((s) => s.id)).toEqual(['sun-early', 'sun-late', 'sun-tba']);
  });

  it('excludes whichever day is selected', () => {
    const groups = searchOtherDays(sets, 'kaskade', 2, stages);
    expect(groups.map((g) => g.dayIndex)).toEqual([0, 1]);
  });

  it('returns no groups for a blank query or no match', () => {
    expect(searchOtherDays(sets, '  ', 0, stages)).toEqual([]);
    expect(searchOtherDays(sets, 'nobody', 0, stages)).toEqual([]);
  });

  it('skips sets without a dayIndex', () => {
    const groups = searchOtherDays([mk('x', { artist: 'Kaskade', dayIndex: undefined })], 'kaskade', 0, stages);
    expect(groups).toEqual([]);
  });
});
