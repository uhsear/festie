import { describe, it, expect } from 'vitest';
import type { FestivalSet, Priority } from '../types/domain';
import type { SharedPicksPayload } from '../services/sharing';
import {
  parseSharedPicksRef,
  compareSharedPicks,
  planSharedPicksAdd,
  buildFriendPicksUrl,
  buildFriendPicksAppLink,
} from './sharedPicks';

const set = (id: string, startTime: string, stageId = 'st'): FestivalSet => ({
  id, festivalId: 'f', stageId, startTime, endTime: '', artist: id.toUpperCase(), createdAt: '', updatedAt: '',
});

function payload(picks: Record<string, Priority>): SharedPicksPayload {
  return {
    username: 'alice',
    festivalName: 'Fest',
    festivalId: 'f',
    picks,
    festival: {
      stages: [{ id: 'st', name: 'Main', color: '#abc', festivalId: 'f', createdAt: '', updatedAt: '' }],
      days: [
        { label: 'Saturday', date: '2026-09-05', sets: [set('a', '20:00'), set('b', ''), set('c', '21:00'), set('d', '19:00')] },
      ],
    },
  };
}

describe('parseSharedPicksRef', () => {
  it('accepts tokens and vanity refs', () => {
    expect(parseSharedPicksRef('abcdefghijklmnopqrstuv')).toBe('abcdefghijklmnopqrstuv');
    expect(parseSharedPicksRef(' u/Alice ')).toBe('u/alice');
  });
  it('rejects bad refs', () => {
    for (const bad of ['../x', 'u/', 'a b', 'a'.repeat(101), 5, null, undefined]) {
      expect(parseSharedPicksRef(bad)).toBeNull();
    }
  });
});

describe('compareSharedPicks', () => {
  const theirs: Record<string, Priority> = { a: 'must', b: 'maybe', c: 'want-to-see', zz: 'must' };
  it('buckets, counts, orders TBA last and counts missing', () => {
    const r = compareSharedPicks(payload(theirs), { a: 'must', c: 'must', d: 'maybe' });
    expect(r.counts).toEqual({ both: 2, theirsOnly: 1, mineOnly: 1 });
    expect(r.missing).toBe(1);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]!.label).toBe('Saturday');
    expect(r.days[0]!.rows.map((x) => x.setId)).toEqual(['d', 'a', 'c', 'b']);
    expect(r.days[0]!.rows.at(-1)!.time).toBe('TBA');
    const byId = Object.fromEntries(r.days[0]!.rows.map((x) => [x.setId, x]));
    expect(byId.a!.bucket).toBe('both');
    expect(byId.b!.bucket).toBe('theirs');
    expect(byId.d!.bucket).toBe('mine');
    expect(byId.a!.stageColor).toBe('#abc');
  });
  it('treats every row as theirs when mine is undefined', () => {
    const r = compareSharedPicks(payload(theirs), undefined);
    expect(r.days[0]!.rows.every((x) => x.bucket === 'theirs' && x.addable)).toBe(true);
  });
  it('is not addable when mine is stronger or equal', () => {
    const r = compareSharedPicks(payload(theirs), { a: 'must', c: 'must', b: 'want-to-see' });
    const byId = Object.fromEntries(r.days[0]!.rows.map((x) => [x.setId, x]));
    expect(byId.a!.addable).toBe(false);
    expect(byId.c!.addable).toBe(false);
    expect(byId.b!.addable).toBe(false);
    const r2 = compareSharedPicks(payload(theirs), { c: 'maybe' });
    expect(r2.days[0]!.rows.find((x) => x.setId === 'c')!.addable).toBe(true);
  });
});

describe('planSharedPicksAdd', () => {
  it('groups by priority, skips non-addable, keeps previous values', () => {
    const cmp = compareSharedPicks(payload({ a: 'must', b: 'maybe', c: 'want-to-see' }), { c: 'maybe', a: 'must' });
    const plan = planSharedPicksAdd(cmp, new Set(['a', 'b', 'c']));
    expect(plan.byPriority).toEqual({ maybe: ['b'], 'want-to-see': ['c'] });
    expect(plan.previous).toEqual({ b: undefined, c: 'maybe' });
    expect('b' in plan.previous).toBe(true);
    expect(plan.total).toBe(2);
  });
});

describe('links', () => {
  it('builds friend-picks urls', () => {
    expect(buildFriendPicksUrl('u/alice', { add: true })).toBe('https://festie.us/friend-picks?from=u%2Falice#add');
    expect(buildFriendPicksUrl('tok', { origin: 'http://localhost:5173' })).toBe('http://localhost:5173/friend-picks?from=tok');
    expect(buildFriendPicksAppLink('u/alice')).toBe('festie://friend-picks?from=u%2Falice');
  });
});
