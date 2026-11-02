import { describe, it, expect } from 'vitest';
import {
  GRID_ZOOM_LEVELS, buildClashMarks, defaultZoomIndex, gridNeighbour, groupUntimedByStage,
  nextPickInCycle, pickClashTarget, twoUpColumnWidth,
} from './scheduleGrid';
import type { ConflictGroup, ConflictPick } from './pickConflicts';
import type { FestivalSet, Stage } from '../types/domain';

const T0 = Date.UTC(2026, 5, 15, 10, 0);
const MIN = 60000;

function makeSet(id: string, extra: Partial<FestivalSet> = {}): FestivalSet {
  return {
    id, festivalId: 'f', stageId: 'main', artist: id.toUpperCase(),
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra,
  } as FestivalSet;
}

/** Pick from `startMin` to `endMin` minutes after 10:00. */
function pick(id: string, startMin: number, endMin: number, extra: Partial<FestivalSet> = {}): ConflictPick {
  return {
    set: makeSet(id, extra), priority: 'want-to-see',
    startMs: T0 + startMin * MIN, endMs: T0 + endMin * MIN, durationMin: endMin - startMin,
  };
}

function group(...picks: ConflictPick[]): ConflictGroup {
  return { picks, recommendedKeepId: picks[0]!.set.id, overlapMin: 0 };
}

const label = (s: FestivalSet) => `${s.artist} · Forest`;

describe('nextPickInCycle', () => {
  it('walks none, maybe, want-to-see, must, none', () => {
    expect(nextPickInCycle(null)).toBe('maybe');
    expect(nextPickInCycle(undefined)).toBe('maybe');
    expect(nextPickInCycle('maybe')).toBe('want-to-see');
    expect(nextPickInCycle('want-to-see')).toBe('must');
    expect(nextPickInCycle('must')).toBeNull();
  });
});

describe('zoom and width', () => {
  it('sizes two-up columns and clamps', () => {
    expect(twoUpColumnWidth(390, 44)).toBe(173);
    expect(twoUpColumnWidth(320, 44)).toBe(138);
    expect(twoUpColumnWidth(280, 44)).toBe(120);
    expect(twoUpColumnWidth(1000, 44)).toBe(220);
  });
  it('picks a default zoom by viewport', () => {
    expect(defaultZoomIndex(390)).toBe(1);
    expect(defaultZoomIndex(1024)).toBe(2);
    expect(GRID_ZOOM_LEVELS).toHaveLength(3);
  });
});

describe('buildClashMarks', () => {
  it('marks the overlapping halves of two sets', () => {
    const marks = buildClashMarks([group(pick('a', 0, 60), pick('b', 30, 90))], label);
    expect(marks.get('a')!.segments).toEqual([{ from: 0.5, to: 1 }]);
    expect(marks.get('b')!.segments).toEqual([{ from: 0, to: 0.5 }]);
    expect(marks.get('a')!.text).toBe('Clashes with B · Forest');
  });
  it('keeps withIds pairwise in a chain', () => {
    const marks = buildClashMarks([group(pick('a', 0, 60), pick('b', 30, 120), pick('c', 90, 150))], label);
    expect(marks.get('a')!.withIds).toEqual(['b']);
    expect(marks.get('b')!.withIds).toEqual(['a', 'c']);
  });
  it('merges segments from two partners covering the same slice', () => {
    const marks = buildClashMarks([group(pick('a', 0, 60), pick('b', 30, 60), pick('c', 30, 90))], label);
    expect(marks.get('a')!.segments).toEqual([{ from: 0.5, to: 1 }]);
  });
});

describe('pickClashTarget', () => {
  const early = group(pick('a', 0, 60, { stageId: 's1' }), pick('b', 30, 90, { stageId: 's2' }));
  const late = group(pick('c', 120, 180, { stageId: 's1' }), pick('d', 150, 200, { stageId: 's1' }));
  it('returns null with no groups', () => {
    expect(pickClashTarget([], new Set(['s1']))).toBeNull();
  });
  it('chooses the earliest overlap', () => {
    expect(pickClashTarget([late, early], new Set(['s1', 's2']))).toEqual({ set: early.picks[0]!.set, visible: true });
  });
  it('falls back to the other pick when the first stage is hidden', () => {
    expect(pickClashTarget([early], new Set(['s2']))!.set.id).toBe('b');
  });
  it('reports visible false when every pick is hidden', () => {
    expect(pickClashTarget([early], new Set())).toEqual({ set: early.picks[0]!.set, visible: false });
  });
});

describe('groupUntimedByStage', () => {
  const stages = [
    { id: 's1', name: 'Main' }, { id: 's2', name: 'Forest' }, { id: 's3', name: 'Empty' },
  ] as Stage[];
  it('orders by festival stage, sorts names, puts unknown last, drops empty', () => {
    const sets = [
      makeSet('1', { artist: 'zed', stageId: 's2' }),
      makeSet('2', { artist: 'Bob', stageId: 's1' }),
      makeSet('3', { artist: 'alice', stageId: 's1' }),
      makeSet('4', { artist: 'Who', stageId: 'gone' }),
    ];
    const out = groupUntimedByStage(sets, stages);
    expect(out.map((g) => g.stage?.id ?? null)).toEqual(['s1', 's2', null]);
    expect(out[0]!.sets.map((s) => s.artist)).toEqual(['alice', 'Bob']);
  });
});

describe('gridNeighbour', () => {
  const cells = [
    { id: 'a1', col: 0, start: 600 }, { id: 'a2', col: 0, start: 720 },
    { id: 'c1', col: 2, start: 590 }, { id: 'c2', col: 2, start: 700 },
  ];
  it('moves up and down within a column', () => {
    expect(gridNeighbour(cells, 'a1', 'ArrowDown')).toBe('a2');
    expect(gridNeighbour(cells, 'a2', 'ArrowUp')).toBe('a1');
  });
  it('skips an empty column and picks the closest start', () => {
    expect(gridNeighbour(cells, 'a2', 'ArrowRight')).toBe('c2');
    expect(gridNeighbour(cells, 'c1', 'ArrowLeft')).toBe('a1');
  });
  it('supports Home and End', () => {
    expect(gridNeighbour(cells, 'a2', 'Home')).toBe('a1');
    expect(gridNeighbour(cells, 'a1', 'End')).toBe('a2');
  });
  it('returns null at the edges', () => {
    expect(gridNeighbour(cells, 'a1', 'ArrowUp')).toBeNull();
    expect(gridNeighbour(cells, 'a2', 'ArrowDown')).toBeNull();
    expect(gridNeighbour(cells, 'c1', 'ArrowRight')).toBeNull();
    expect(gridNeighbour(cells, 'a1', 'ArrowLeft')).toBeNull();
    expect(gridNeighbour(cells, 'a1', 'Home')).toBeNull();
  });
});
