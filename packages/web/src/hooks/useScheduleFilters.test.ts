import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { FestivalSet } from '@festie/shared/types';

let storeState: Record<string, unknown>;
const picks: Record<string, string | null> = {};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState),
}));
vi.mock('@festie/shared/hooks', () => ({
  usePicks: () => ({ getMyPick: (id: string) => picks[id] ?? null }),
}));

import { applyScheduleFilters, useScheduleFilters } from './useScheduleFilters';

const set = (id: string, stageId: string) => ({ id, stageId }) as FestivalSet;
const SETS = [set('a', 'main'), set('b', 'forest'), set('c', 'main')];
const getMyPick = (id: string) => (id === 'a' ? ('must' as const) : null);

describe('applyScheduleFilters', () => {
  it('returns everything when no filter is active', () => {
    expect(applyScheduleFilters(SETS, { activeStages: [], stageCount: 2, onlyMine: false, getMyPick })).toHaveLength(3);
  });
  it('treats a selection that covers every stage as "all stages"', () => {
    const out = applyScheduleFilters(SETS, {
      activeStages: ['main', 'forest'],
      stageCount: 2,
      onlyMine: false,
      getMyPick,
    });
    expect(out).toHaveLength(3);
  });
  it('keeps only the selected stages', () => {
    const out = applyScheduleFilters(SETS, { activeStages: ['forest'], stageCount: 2, onlyMine: false, getMyPick });
    expect(out.map((s) => s.id)).toEqual(['b']);
  });
  it('keeps only picked sets when onlyMine is on', () => {
    const out = applyScheduleFilters(SETS, { activeStages: [], stageCount: 2, onlyMine: true, getMyPick });
    expect(out.map((s) => s.id)).toEqual(['a']);
  });
  it('combines both filters', () => {
    const out = applyScheduleFilters(SETS, { activeStages: ['forest'], stageCount: 2, onlyMine: true, getMyPick });
    expect(out).toEqual([]);
  });
});

describe('useScheduleFilters', () => {
  it('reads onlyMine from the store so Cards, Timeline and Grid agree', () => {
    storeState = { stages: [{ id: 'main' }, { id: 'forest' }], activeStages: [], onlyMine: true };
    picks.c = 'maybe';
    const { result } = renderHook(() => useScheduleFilters());
    expect(result.current.filterSets(SETS).map((s) => s.id)).toEqual(['c']);
    expect(result.current.onlyMine).toBe(true);
  });
});
