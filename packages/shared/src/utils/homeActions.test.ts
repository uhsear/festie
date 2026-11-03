import { describe, it, expect } from 'vitest';
import { getHomeActions } from './homeActions';

const keys = (i: Parameters<typeof getHomeActions>[0]) => getHomeActions(i).map((a) => a.key);

describe('getHomeActions', () => {
  it('returns nothing for signed-out users or an unknown phase', () => {
    expect(keys({ phase: 'pre', signedIn: false, pickCount: 0, hasCrew: false })).toEqual([]);
    expect(keys({ phase: null, signedIn: true, pickCount: 0, hasCrew: false })).toEqual([]);
  });
  it('pre: first pick hint, then crew', () => {
    const actions = getHomeActions({ phase: 'pre', signedIn: true, pickCount: 0, hasCrew: false });
    expect(actions.map((a) => [a.key, a.kind])).toEqual([
      ['first-pick', 'hint'],
      ['crew', 'link'],
    ]);
    expect(keys({ phase: 'pre', signedIn: true, pickCount: 2, hasCrew: false })).toEqual(['crew']);
    expect(keys({ phase: 'pre', signedIn: true, pickCount: 2, hasCrew: true })).toEqual([]);
  });
  it('live: crew or find', () => {
    expect(keys({ phase: 'live', signedIn: true, pickCount: 0, hasCrew: false })).toEqual(['crew']);
    const [find] = getHomeActions({ phase: 'live', signedIn: true, pickCount: 0, hasCrew: true });
    expect(find).toMatchObject({ key: 'find', label: 'Find your crew', a11y: 'Find your crew on the map' });
  });
  it('post: wrap, plus settle with a crew', () => {
    expect(keys({ phase: 'post', signedIn: true, pickCount: 0, hasCrew: false })).toEqual(['wrap']);
    expect(keys({ phase: 'post', signedIn: true, pickCount: 0, hasCrew: true })).toEqual(['wrap', 'settle']);
  });
});
