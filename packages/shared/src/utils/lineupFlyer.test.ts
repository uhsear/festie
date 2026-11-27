import { describe, expect, it } from 'vitest';
import type { Festival, FestivalDay, FestivalSet, LineupEntry } from '../types/domain';
import { lineupFlyerModel } from './lineupFlyer';

const entry = (id: string, name: string, tier: number | null, extra: Partial<LineupEntry> = {}): LineupEntry => ({
  id,
  artists: [{ name }],
  displayName: null,
  tier,
  dayDate: null,
  status: 'announced',
  announcedAt: '2026-11-01',
  linkedSetIds: [],
  ...extra,
});
const set = (id: string, artist: string, startTime = ''): FestivalSet => ({
  id,
  festivalId: 'f',
  stageId: 'main',
  artist,
  dayIndex: 0,
  startTime,
  endTime: '',
  createdAt: '',
  updatedAt: '',
});
const days = [{ id: 'd', festivalId: 'f', date: '2026-12-05', label: 'Fri', createdAt: '', updatedAt: '' }] as FestivalDay[];
const festival = (lineup: LineupEntry[], extra: Partial<Festival> = {}) =>
  ({
    id: 'f',
    name: 'Test Fest',
    startDate: '2026-12-05',
    endDate: '2026-12-06',
    publishedAt: '2026-11-10T00:00:00.000Z',
    lineup,
    ...extra,
  }) as Festival;
const NOW = Date.UTC(2026, 10, 20, 12);

describe('lineupFlyerModel', () => {
  it('lists acts by tier with descending sizes, then sets no entry covers', () => {
    const lineup = [entry('c', 'Carol', 3), entry('a', 'Alice', 1), entry('b', 'Bob', 2), entry('n', 'Nora', null)];
    const model = lineupFlyerModel(festival(lineup), days, [set('s1', 'Alice'), set('s2', 'Zed')], NOW);
    expect(model?.rows.map((r) => [r.name, r.size])).toEqual([
      ['Alice', 'headliner'],
      ['Bob', 'support'],
      ['Carol', 'rest'],
      ['Nora', 'rest'],
      ['Zed', 'rest'],
    ]);
  });

  it('names the sets when the festival has no lineup entries', () => {
    const model = lineupFlyerModel(festival([]), days, [set('s1', 'Zed'), set('s2', 'Yan')], NOW);
    expect(model?.rows.map((r) => r.name)).toEqual(['Zed', 'Yan']);
  });

  it('skips cancelled acts', () => {
    const lineup = [entry('a', 'Alice', 1, { status: 'cancelled' }), entry('b', 'Bob', 1)];
    expect(lineupFlyerModel(festival(lineup), days, [set('s', 'Other')], NOW)?.rows.map((r) => r.name)).toEqual([
      'Bob',
      'Other',
    ]);
  });

  it('is null once any set has a time, so the cards return', () => {
    expect(lineupFlyerModel(festival([]), days, [set('s1', 'Zed'), set('s2', 'Yan', '20:00')], NOW)).toBeNull();
  });

  it('is null for a draft, an ended festival, and a festival with no sets', () => {
    expect(lineupFlyerModel(festival([], { publishedAt: null }), days, [set('s', 'Zed')], NOW)).toBeNull();
    expect(lineupFlyerModel(festival([]), days, [set('s', 'Zed')], Date.UTC(2027, 0, 1))).toBeNull();
    expect(lineupFlyerModel(festival([entry('a', 'Alice', 1)]), days, [], NOW)).toBeNull();
    expect(lineupFlyerModel(null, days, [set('s', 'Zed')], NOW)).toBeNull();
  });
});
