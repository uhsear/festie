import { describe, it, expect } from 'vitest';
import { nextJoinSelect } from './crewJoinSelect';

const base = { joinedParam: 'new', crewLoading: false, activeCrewId: 'old' as string | null, crewIds: ['old', 'new'], selected: null as string | null };

describe('nextJoinSelect', () => {
  it('switches once from another active crew', () => {
    const first = nextJoinSelect(base);
    expect(first).toEqual({ select: 'new', selected: 'new' });
    expect(nextJoinSelect({ ...base, selected: first.selected }).select).toBeNull();
  });

  it('does nothing when there is no active crew, so useActiveCrew auto-select keeps its retry', () => {
    expect(nextJoinSelect({ ...base, activeCrewId: null })).toEqual({ select: null, selected: null });
  });

  it('does nothing while loading, when already on the joined crew, or when the crew is unknown', () => {
    expect(nextJoinSelect({ ...base, crewLoading: true }).select).toBeNull();
    expect(nextJoinSelect({ ...base, activeCrewId: 'new' }).select).toBeNull();
    expect(nextJoinSelect({ ...base, crewIds: ['old'] }).select).toBeNull();
  });

  it('does not loop after a failed select', () => {
    const { selected } = nextJoinSelect(base);
    for (let i = 0; i < 3; i++) expect(nextJoinSelect({ ...base, selected }).select).toBeNull();
  });

  it('resets when the param clears, so a rejoin of the same crew selects again', () => {
    const { selected } = nextJoinSelect(base);
    const cleared = nextJoinSelect({ ...base, joinedParam: undefined, selected });
    expect(cleared).toEqual({ select: null, selected: null });
    expect(nextJoinSelect({ ...base, selected: cleared.selected }).select).toBe('new');
  });
});
