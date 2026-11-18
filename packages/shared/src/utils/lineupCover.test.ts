import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LineupEntry } from '../types/domain';
import { coverLineup, entryDayIndex, lineupEntryKey, lineupNameKey, lineupNotices, matchCandidateSets } from './lineupCover';

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

describe('lineupNotices', () => {
  const entry = (id: string, name: string, status = 'announced') =>
    ({ id, artists: [{ name }], displayName: null, tier: null, dayDate: null, status, announcedAt: '2026-11-01', linkedSetIds: [] }) as LineupEntry;
  const day = (label: string, names: string[]) => ({ label, date: '2027-02-05', sets: names.map((n, i) => ({ id: `${label}${i}`, artist: n })) });

  it('stays quiet while no day has sets', () => {
    expect(lineupNotices([entry('1', 'A')], [day('Fri', [])], 'b2b')).toEqual([]);
  });
  it('names acts with no matching set once sets exist', () => {
    const out = lineupNotices([entry('1', 'A'), entry('2', 'B'), entry('3', 'C'), entry('4', 'D'), entry('5', 'E')], [day('Fri', ['A'])], 'b2b');
    expect(out).toEqual(['4 announced acts have no matching set: B, C, D and 1 more. Fix the spelling, or link the set by hand.']);
  });
  it('names acts that a removed set unschedules, and cancelled acts that still have a set', () => {
    const saved = [day('Fri', ['A', 'X'])];
    const out = lineupNotices([entry('1', 'A'), entry('2', 'X', 'cancelled')], [day('Fri', ['X'])], 'b2b', saved);
    expect(out).toEqual([
      '1 announced act has no matching set: A. Fix the spelling, or link the set by hand.',
      'This save removes the set for A. They go back to "Announced".',
      'X is cancelled but still has 1 set on Fri.',
    ]);
  });
});

describe('matchCandidateSets', () => {
  const days = [
    { date: '2027-02-05', sets: [{ id: 's1', artist: 'Kai', artists: [{ name: 'Kai' }] }, { id: 's2', artist: 'Other', artists: [{ name: 'Other' }] }] },
    { date: '2027-02-06', sets: [{ id: 's3', artist: 'Zeds Dead vs Mira' }] },
  ];

  it('lists every set that shares at least one artist name key, with its day and names', () => {
    const entry = { artists: [{ name: 'KAI' }, { name: "Zed's Dead" }] };
    expect(matchCandidateSets(entry, days, 'vs')).toEqual([
      { setId: 's1', dayIndex: 0, names: ['Kai'] },
      { setId: 's3', dayIndex: 1, names: ['Zeds Dead', 'Mira'] },
    ]);
  });

  it('is empty when no set shares a name', () => {
    expect(matchCandidateSets({ artists: [{ name: 'Nobody' }] }, days, 'b2b')).toEqual([]);
  });
});
