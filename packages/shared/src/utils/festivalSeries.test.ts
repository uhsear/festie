import { describe, it, expect } from 'vitest';
import { otherEditions, seriesIdsIn, suggestSeriesId } from './festivalSeries';

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
