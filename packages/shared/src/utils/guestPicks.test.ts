import { describe, it, expect } from 'vitest';
import { guestInterestIdsToMerge, mergeGuestPickMaps, newlyConvertedCount, planInterestConversion } from './guestPicks';
import type { LineupCover } from './lineupCover';

const valid = new Set(['a', 'b', 'c']);

describe('mergeGuestPickMaps', () => {
  it('keeps the account pick on a set both picked', () => {
    const { merged, added } = mergeGuestPickMaps({ a: 'must' }, { a: 'maybe' }, valid);
    expect(merged).toEqual({ a: 'must' });
    expect(added).toBe(0);
  });

  it('drops a set id that is not in the festival', () => {
    const { merged, added } = mergeGuestPickMaps({}, { gone: 'must', b: 'want-to-see' }, valid);
    expect(merged).toEqual({ b: 'want-to-see' });
    expect(added).toBe(1);
  });

  it('counts only new entries', () => {
    const { merged, added } = mergeGuestPickMaps({ a: 'must' }, { a: 'maybe', b: 'maybe', c: 'must' }, valid);
    expect(merged).toEqual({ a: 'must', b: 'maybe', c: 'must' });
    expect(added).toBe(2);
  });

  it('returns added 0 for empty input', () => {
    expect(mergeGuestPickMaps({}, {}, valid)).toEqual({ merged: {}, added: 0 });
  });
});

const NOW = '2027-01-05T12:00:00.000Z';
const cover = (state: LineupCover['state'], setIds: string[] = []): LineupCover => ({ setIds, state, dayIndex: 0 });
const plan = (input: Partial<Parameters<typeof planInterestConversion>[0]>) =>
  planInterestConversion({ marks: {}, picks: {}, cover: {}, existingSetIds: new Set<string>(), maxPicks: 500, now: NOW, ...input });

// The same cases as tests/lineup-interest.test.ts: this is the device copy of the server rule.
describe('planInterestConversion', () => {
  it('converts an open mark on a covered act onto every covering set', () => {
    const r = plan({ marks: { a: { state: 'open' } }, cover: { a: cover('scheduled', ['s1', 's2']) }, existingSetIds: new Set(['s1', 's2']) });
    expect(r.added).toEqual({ s1: 'want-to-see', s2: 'want-to-see' });
    expect(r.marks.a).toEqual({ state: 'converted', sets: ['s1', 's2'], added: ['s1', 's2'], at: NOW });
  });

  it('leaves an act with no set or a cancelled act open', () => {
    const r = plan({
      marks: { a: { state: 'open' }, b: { state: 'open' } },
      cover: { a: cover('announced'), b: cover('cancelled', ['s9']) },
      existingSetIds: new Set(['s9']),
    });
    expect(r.changed).toBe(false);
  });

  it('never touches an existing pick', () => {
    const r = plan({
      marks: { a: { state: 'open' } },
      picks: { s1: 'must' },
      cover: { a: cover('scheduled', ['s1', 's2']) },
      existingSetIds: new Set(['s1', 's2']),
    });
    expect(r.added).toEqual({ s2: 'want-to-see' });
  });

  it('keeps a converted mark while one of its sets exists, and reopens it when none does', () => {
    const kept = plan({
      marks: { a: { state: 'converted', sets: ['s1', 's2'], at: NOW } },
      cover: { a: cover('scheduled', ['s1', 's2']) },
      existingSetIds: new Set(['s2']),
    });
    expect(kept.changed).toBe(false);
    const reopened = plan({
      marks: { a: { state: 'converted', sets: ['old'], at: NOW } },
      cover: { a: cover('scheduled', ['new']) },
      existingSetIds: new Set(['new']),
    });
    expect(reopened.added).toEqual({ new: 'want-to-see' });
    expect(reopened.marks.a?.sets).toEqual(['new']);
  });

  it('stops at maxPicks and keeps the act that does not fit open', () => {
    const r = plan({
      marks: { a: { state: 'open' }, b: { state: 'open' } },
      picks: { x: 'must' },
      cover: { a: cover('scheduled', ['s1']), b: cover('scheduled', ['s2', 's3']) },
      existingSetIds: new Set(['s1', 's2', 's3']),
      maxPicks: 3,
    });
    expect(r.added).toEqual({ s1: 'want-to-see' });
    expect(r.marks.b).toEqual({ state: 'open' });
  });
});

describe('guestInterestIdsToMerge', () => {
  const lineup = new Set(['a', 'b', 'c']);
  it('sends open ids that are in the lineup and not on the account', () => {
    const ids = guestInterestIdsToMerge(
      { a: { state: 'open' }, b: { state: 'open' }, gone: { state: 'open' }, c: { state: 'converted', sets: ['s1'] } },
      { b: { state: 'converted', sets: ['s2'] } },
      lineup,
    );
    expect(ids).toEqual(['a']);
  });
});

describe('newlyConvertedCount', () => {
  it('counts marks that went from open to converted', () => {
    expect(
      newlyConvertedCount(
        { a: { state: 'open' }, b: { state: 'open' }, c: { state: 'converted' } },
        { a: { state: 'converted' }, b: { state: 'open' }, c: { state: 'converted' } },
      ),
    ).toBe(1);
    expect(newlyConvertedCount(undefined, { a: { state: 'converted' } })).toBe(0);
  });
});
