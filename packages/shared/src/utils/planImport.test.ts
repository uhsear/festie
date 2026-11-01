import { describe, it, expect } from 'vitest';
import { previewPlanImport } from './planImport';
import { PLAN_SNAPSHOT_VERSION, type PlanSnapshot } from './planSnapshot';

function snapshot(picks: PlanSnapshot['picks'], festivalId = 'f1'): PlanSnapshot {
  return { v: PLAN_SNAPSHOT_VERSION, festivalId, festivalName: 'Fest', picks };
}

const setIds = new Set(['a', 'b', 'c', 'd']);

describe('previewPlanImport', () => {
  it('adds a new pick and records its previous value as undefined', () => {
    const p = previewPlanImport(snapshot([{ setId: 'a', priority: 'want' }]), {
      currentFestivalId: 'f1',
      picks: {},
      setIds,
    });
    expect(p.festivalMismatch).toBe(false);
    expect(p.toAdd).toEqual([{ setId: 'a', priority: 'want-to-see' }]);
    expect(p.total).toBe(1);
    expect('a' in p.previous).toBe(true);
    expect(p.previous.a).toBeUndefined();
  });

  it('upgrades a weaker pick and records the old value', () => {
    const p = previewPlanImport(snapshot([{ setId: 'b', priority: 'must' }]), {
      currentFestivalId: 'f1',
      picks: { b: 'maybe' },
      setIds,
    });
    expect(p.toAdd).toEqual([{ setId: 'b', priority: 'must' }]);
    expect(p.previous).toEqual({ b: 'maybe' });
  });

  it('counts an equal or stronger existing pick as already have', () => {
    const p = previewPlanImport(
      snapshot([
        { setId: 'a', priority: 'maybe' },
        { setId: 'b', priority: 'want' },
      ]),
      { currentFestivalId: 'f1', picks: { a: 'must', b: 'want-to-see' }, setIds },
    );
    expect(p.toAdd).toEqual([]);
    expect(p.alreadyHave).toBe(2);
    expect(p.previous).toEqual({});
  });

  it('counts a set id that is not in the lineup', () => {
    const p = previewPlanImport(
      snapshot([
        { setId: 'zzz', priority: 'must' },
        { setId: 'c', priority: 'maybe' },
      ]),
      { currentFestivalId: 'f1', picks: {}, setIds },
    );
    expect(p.notInLineup).toBe(1);
    expect(p.toAdd).toEqual([{ setId: 'c', priority: 'maybe' }]);
    expect(p.total).toBe(2);
  });

  it('returns festivalMismatch and nothing to add for another festival', () => {
    const p = previewPlanImport(snapshot([{ setId: 'a', priority: 'must' }], 'other'), {
      currentFestivalId: 'f1',
      picks: {},
      setIds,
    });
    expect(p.festivalMismatch).toBe(true);
    expect(p.toAdd).toEqual([]);
    expect(p.total).toBe(1);
  });

  it('returns festivalMismatch when there is no profile', () => {
    const p = previewPlanImport(snapshot([{ setId: 'a', priority: 'must' }]), {
      currentFestivalId: 'f1',
      picks: undefined,
      setIds,
    });
    expect(p.festivalMismatch).toBe(true);
    expect(p.toAdd).toEqual([]);
  });

  it('keeps the strongest priority when the snapshot repeats a set', () => {
    const p = previewPlanImport(
      snapshot([
        { setId: 'd', priority: 'maybe' },
        { setId: 'd', priority: 'must' },
      ]),
      { currentFestivalId: 'f1', picks: {}, setIds },
    );
    expect(p.toAdd).toEqual([{ setId: 'd', priority: 'must' }]);
  });
});
