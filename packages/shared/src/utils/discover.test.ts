import { describe, it, expect } from 'vitest';
import type { FestivalDay, FestivalSet } from '../types/domain';
import { setGenres, festivalGenres, topPickedGenres, discoverSets, pickAlsoPicked } from './discover';

function mk(id: string, genres: string[][], o: Partial<FestivalSet> = {}): FestivalSet {
  return {
    id,
    festivalId: 'f1',
    stageId: 'st1',
    dayIndex: 0,
    startTime: '20:00',
    endTime: '21:00',
    artists: genres.map((g, i) => ({ name: `Artist ${id}${i}`, genres: g })),
    createdAt: '',
    updatedAt: '',
    ...o,
  };
}
const days: FestivalDay[] = [{ id: 'd1', festivalId: 'f1', date: '2026-06-05', createdAt: '', updatedAt: '' }];

describe('setGenres', () => {
  it('dedups case-insensitively across B2B artists, keeping first spelling and order', () => {
    expect(setGenres(mk('a', [['House', 'Techno'], ['house', 'Trance']]))).toEqual(['House', 'Techno', 'Trance']);
  });
  it('is empty without genres', () => {
    expect(setGenres(mk('a', [[]]))).toEqual([]);
  });
});

describe('festivalGenres', () => {
  const three = (g: string) => [mk(`${g}1`, [[g]]), mk(`${g}2`, [[g]]), mk(`${g}3`, [[g]])];
  it('keeps genres on 3+ sets, by count then name', () => {
    const sets = [...three('techno'), ...three('house'), mk('x', [['house']]), mk('y', [['rare']])];
    expect(festivalGenres(sets)).toEqual(['house', 'techno']);
  });
  it('is empty when only one genre qualifies', () => {
    expect(festivalGenres([...three('techno'), mk('y', [['house']])])).toEqual([]);
  });
  it('honours the limit', () => {
    const sets = [...three('a'), ...three('b'), ...three('c')];
    expect(festivalGenres(sets, 2)).toEqual(['a', 'b']);
  });
});

describe('topPickedGenres', () => {
  it('weights by priority', () => {
    const sets = [mk('a', [['house']]), mk('b', [['techno']]), mk('c', [['techno']]), mk('d', [['trance']])];
    const picks = { a: 'must', b: 'maybe', c: 'maybe', d: 'maybe' } as const;
    expect(topPickedGenres(sets, picks)).toEqual(['house', 'techno', 'trance']);
  });
  it('is empty with fewer than 3 picked sets that have genres', () => {
    const sets = [mk('a', [['house']]), mk('b', [['techno']]), mk('c', [[]])];
    expect(topPickedGenres(sets, { a: 'must', b: 'must', c: 'must' })).toEqual([]);
  });
});

describe('discoverSets', () => {
  const base = { days, timeZone: 'America/Los_Angeles' };
  // 2026-06-05 21:30 local (PDT, UTC-7) = 2026-06-06 04:30 UTC
  const nowMs = Date.UTC(2026, 5, 6, 4, 30);
  it('excludes picked and ended sets and sorts by score, day, time', () => {
    const sets = [
      mk('picked', [['house']]),
      mk('ended', [['house']], { startTime: '18:00', endTime: '19:00' }),
      mk('both', [['house', 'techno']], { startTime: '23:00', endTime: '23:59' }),
      mk('techno', [['techno']], { startTime: '22:00', endTime: '23:00' }),
      mk('house', [['house']], { startTime: '22:30', endTime: '23:30' }),
      mk('tba', [['house']], { startTime: '', endTime: '' }),
      mk('other', [['jazz']]),
    ];
    const out = discoverSets({ ...base, sets, picks: { picked: 'must' }, genres: ['house', 'techno'], nowMs });
    expect(out.map((s) => s.id)).toEqual(['both', 'house', 'tba', 'techno']);
  });
  it('applies the limit', () => {
    const sets = [mk('a', [['house']]), mk('b', [['house']]), mk('c', [['house']])];
    expect(discoverSets({ ...base, sets, picks: {}, genres: ['house'], nowMs: 0, limit: 2 })).toHaveLength(2);
  });
  it('does not match by substring', () => {
    const sets = [mk('deep', [['deep house']])];
    expect(discoverSets({ ...base, sets, picks: {}, genres: ['house'], nowMs: 0 })).toEqual([]);
  });
});

describe('pickAlsoPicked', () => {
  it('keeps server order and drops picked and unknown ids', () => {
    const sets = [mk('a', []), mk('b', []), mk('c', []), mk('d', [])];
    expect(pickAlsoPicked(['d', 'zz', 'b', 'a', 'c'], sets, { b: 'maybe' }).map((s) => s.id)).toEqual(['d', 'a', 'c']);
    expect(pickAlsoPicked(['d', 'a', 'c'], sets, {}, 2).map((s) => s.id)).toEqual(['d', 'a']);
  });
});
