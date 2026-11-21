import { describe, it, expect } from 'vitest';
import type { Festival } from '../types';
import { otherEditions, partitionSeriesBlocks, seriesIdsIn, slugifySeriesInput, splitBySeries, suggestSeriesId } from './festivalSeries';

describe('suggestSeriesId', () => {
  it('strips a trailing year and slugifies', () => {
    expect(suggestSeriesId('Forbidden Kingdom 2027')).toBe('forbidden-kingdom');
    expect(suggestSeriesId('  North Coast  2026 ')).toBe('north-coast');
  });
  it('keeps a year that is not trailing', () => {
    expect(suggestSeriesId('Summer 2026 Fest')).toBe('summer-2026-fest');
  });
  it('drops accents and punctuation', () => {
    expect(suggestSeriesId("Tomorrowland: Café d'Été")).toBe('tomorrowland-cafe-d-ete');
  });
  it('caps at 60 characters without a trailing hyphen', () => {
    const id = suggestSeriesId(`${'a'.repeat(59)} bbb`);
    expect(id).toBe('a'.repeat(59));
    expect(id).toMatch(/^[a-z0-9-]{1,60}$/);
  });
  it('returns an empty string when nothing is left', () => {
    expect(suggestSeriesId('2027')).toBe('');
    expect(suggestSeriesId('!!!')).toBe('');
  });
});

describe('slugifySeriesInput', () => {
  it('replaces characters outside the server pattern and keeps edge hyphens', () => {
    expect(slugifySeriesInput('Café_Fest.2027')).toBe('cafe-fest-2027');
    expect(slugifySeriesInput('forbidden-')).toBe('forbidden-');
    expect(slugifySeriesInput('a'.repeat(70))).toHaveLength(60);
  });
});

describe('seriesIdsIn / otherEditions', () => {
  const list = [
    { id: 'fk-2026', name: 'FK 2026', seriesId: 'forbidden-kingdom' },
    { id: 'fk-2027', name: 'FK 2027', seriesId: 'forbidden-kingdom' },
    { id: 'nc-2026', name: 'NC 2026', seriesId: null },
    { id: 'edc', name: 'EDC' },
    { id: 'wl', name: 'WL', seriesId: 'wasteland' },
  ];
  it('lists distinct ids, sorted', () => {
    expect(seriesIdsIn(list)).toEqual(['forbidden-kingdom', 'wasteland']);
  });
  it('lists the other editions of a series', () => {
    expect(otherEditions(list, 'forbidden-kingdom', 'fk-2027').map((f) => f.id)).toEqual(['fk-2026']);
    expect(otherEditions(list, 'forbidden-kingdom', null)).toHaveLength(2);
  });
  it('returns nothing without a series id', () => {
    expect(otherEditions(list, null, 'x')).toEqual([]);
    expect(otherEditions(list, '', 'x')).toEqual([]);
  });
});

describe('splitBySeries', () => {
  const fest = (id: string, name: string, startDate: string | null, seriesId: string | null = null) => ({
    id,
    name,
    startDate,
    seriesId,
  });

  it('groups FK 2026 and FK 2027 under one series by name when the public list hides seriesId', () => {
    const list = [
      fest('nc-2026', 'North Coast 2026', '2026-09-04'),
      fest('fk-2027', 'Forbidden Kingdom 2027', '2027-08-01'),
      fest('fk-2026', 'Forbidden Kingdom 2026', '2026-08-01'),
    ];
    const { series, standalone } = splitBySeries(list);
    expect(series).toHaveLength(1);
    expect(series[0]!.label).toBe('Forbidden Kingdom');
    expect(series[0]!.editions.map((f) => f.id)).toEqual(['fk-2027', 'fk-2026']);
    expect(standalone.map((f) => f.id)).toEqual(['nc-2026']);
  });

  it('uses seriesId over the name, so a renamed edition still joins', () => {
    const list = [
      fest('a', 'Wasteland Weekend 2026', '2026-09-01', 'wasteland'),
      fest('b', 'Wasteland Orlando 2027', '2027-02-01', 'wasteland'),
    ];
    const { series, standalone } = splitBySeries(list);
    expect(series.map((s) => s.key)).toEqual(['wasteland']);
    expect(standalone).toEqual([]);
  });

  it('leaves a festival with no sibling standalone and orders blocks by first appearance', () => {
    const list = [
      fest('x1', 'X Fest 2026', '2026-01-01'),
      fest('y1', 'Y Fest 2026', '2026-02-01'),
      fest('y2', 'Y Fest 2027', '2027-02-01'),
      fest('x2', 'X Fest 2027', '2027-01-01'),
      fest('solo', 'Solo', null),
    ];
    const { series, standalone } = splitBySeries(list);
    expect(series.map((s) => s.label)).toEqual(['X Fest', 'Y Fest']);
    expect(standalone.map((f) => f.id)).toEqual(['solo']);
  });
});

describe('splitBySeries edition order', () => {
  it('lists an edition with no dates first, as the newest', () => {
    const { series } = splitBySeries([
      { id: 'a', name: 'FK 2026', startDate: '2026-08-01' },
      { id: 'b', name: 'FK 2028', startDate: null },
      { id: 'c', name: 'FK 2027', startDate: '2027-08-01' },
    ]);
    expect(series[0]!.editions.map((f) => f.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('partitionSeriesBlocks', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  // Festival types the dates as non-null; the undated cases need null, so the cast is deliberate.
  const fest = (id: string, name: string, startDate: string | null, endDate: string | null) =>
    ({
      id,
      name,
      startDate,
      endDate,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }) as unknown as Festival;

  it('puts a block with an edition that has not ended in current, and an all-past block in ended', () => {
    const { series } = splitBySeries([
      fest('o1', 'Old 2024', '2024-05-01', '2024-05-03'),
      fest('o2', 'Old 2025', '2025-05-01', '2025-05-03'),
      fest('k1', 'Kept 2026', '2026-05-01', '2026-05-03'),
      fest('k2', 'Kept 2027', '2027-05-01', '2027-05-03'),
      fest('u1', 'Undated 2026', null, null),
      fest('u2', 'Undated 2027', null, null),
    ]);
    const { current, ended } = partitionSeriesBlocks(series, now);
    expect(current.map((b) => b.label)).toEqual(['Kept', 'Undated']);
    expect(ended.map((b) => b.label)).toEqual(['Old']);
  });
});
