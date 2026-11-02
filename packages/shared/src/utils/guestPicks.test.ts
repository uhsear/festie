import { describe, it, expect } from 'vitest';
import { mergeGuestPickMaps } from './guestPicks';

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
