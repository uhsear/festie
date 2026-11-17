import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LineupEntry } from '../types/domain';
import { coverLineup, entryDayIndex, lineupEntryKey, lineupNameKey } from './lineupCover';

// The same file the backend suite (tests/lineup.test.ts) reads, so the two copies cannot drift.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../tests/fixtures/lineup-cover.json'), 'utf8'),
);

describe('lineupNameKey', () => {
  it.each(fixture.sameKey as string[][])('"%s" and "%s" share a key', (a, b) => {
    expect(lineupNameKey(a!)).toBe(lineupNameKey(b!));
  });
  it.each(fixture.differentKey as string[][])('"%s" and "%s" differ', (a, b) => {
    expect(lineupNameKey(a!)).not.toBe(lineupNameKey(b!));
  });
  it('strips marks on Latin letters only and keeps symbol-only names', () => {
    expect(lineupNameKey('Bacardí')).toBe(lineupNameKey('bacardi'));
    expect(lineupNameKey('ガ')).not.toBe(lineupNameKey('カ'));
    expect(lineupNameKey('!!!')).toBe('!!!');
  });
  it('lineupEntryKey ignores artist order', () => {
    expect(lineupEntryKey({ artists: [{ name: 'B' }, { name: 'A' }] })).toBe(
      lineupEntryKey({ artists: [{ name: 'A' }, { name: 'B' }] }),
    );
  });
});

describe('coverLineup (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const cover = coverLineup(c.lineup as LineupEntry[], c.days, c.separator);
      for (const [id, want] of Object.entries(c.expected)) expect(cover[id]).toEqual(want);
    });
  }
});

describe('entryDayIndex', () => {
  const days = [{ date: '2027-02-06' }, { date: '2027-02-05' }];
  it('follows the date when days are reordered, and gives -1 when the day is gone', () => {
    expect(entryDayIndex({ dayDate: '2027-02-05' }, days)).toBe(1);
    expect(entryDayIndex({ dayDate: '2027-02-05' }, [...days].reverse())).toBe(0);
    expect(entryDayIndex({ dayDate: '2027-02-07' }, days)).toBe(-1);
    expect(entryDayIndex({ dayDate: null }, days)).toBe(-1);
    // restoring the day restores the split
    expect(entryDayIndex({ dayDate: '2027-02-05' }, [...days, { date: '2027-02-05' }])).toBe(1);
  });
});
