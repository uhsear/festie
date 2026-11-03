import { describe, it, expect } from 'vitest';
import { crewPosterContent } from './crewWrapPoster';
import type { CrewWrapData } from '../types/crewWrap';

const seen = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ setId: `s${i}`, artist: i === 1 ? null : `Artist ${i}`, count: 3 }));

const wrap = (over: Partial<CrewWrapData> = {}): CrewWrapData => ({
  crewId: 'c',
  festivalId: 'f',
  memberCount: 4,
  members: [],
  topOverlap: null,
  overlapMatrix: [],
  setsSeenTogether: seen(8),
  totalSplit: 123.45,
  biggestSpender: { userId: 'u', name: 'Sam', amount: 99.5 },
  perMember: [],
  currency: 'EUR',
  ...over,
});

describe('crewPosterContent', () => {
  it('shows money in the wrap currency when on', () => {
    const c = crewPosterContent(wrap(), { showMoney: true });
    expect(c.spotlight).toEqual({ label: 'Biggest spender', value: 'Sam', sub: 'fronted €99.50' });
    expect(c.stats.find((s) => s.label === 'Split')?.value).toBe('€123.45');
    expect(c.seenTogether).toHaveLength(5);
    expect(crewPosterContent(wrap({ biggestSpender: null }), { showMoney: true }).spotlight.value).toBe(
      'No expenses yet',
    );
  });

  it('shows no amount anywhere when money is off, and does not list the favourite twice', () => {
    const c = crewPosterContent(wrap(), { showMoney: false });
    const strings = JSON.stringify([c.spotlight, c.stats, c.seenTogether.map((s) => s.artist)]);
    expect(strings).not.toMatch(/[$€£]|\d\.\d/);
    expect(c.spotlight).toEqual({ label: 'Crew favourite', value: 'Artist 0', sub: '3 of you loved it' });
    expect(c.stats.map((s) => s.label)).toEqual(['Crew', 'Seen together']);
    expect(c.seenTogether.map((s) => s.setId)).toEqual(['s1', 's2', 's3', 's4', 's5']);
  });

  it('handles an unnamed favourite and no seen-together sets', () => {
    const unnamed = wrap({ setsSeenTogether: [{ setId: 'x', artist: null, count: 2 }] });
    expect(crewPosterContent(unnamed, { showMoney: false }).spotlight.value).toBe('A set you all loved');
    expect(crewPosterContent(wrap({ setsSeenTogether: [] }), { showMoney: false }).spotlight).toEqual({
      label: 'Crew favourite',
      value: 'Rate sets together to find yours',
    });
  });
});
