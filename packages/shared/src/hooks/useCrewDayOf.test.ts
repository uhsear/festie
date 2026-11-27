// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthStore } from '../stores/authStore';
import { useCrewStore } from '../stores/crewStore';
import { useCrewDayOf } from './useDayOf';
import type { Crew } from '../types';

const crew = (id: string) => ({ id, name: id, members: [] }) as unknown as Crew;

describe('useCrewDayOf first-crew selection', () => {
  const selectCrew = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    selectCrew.mockClear();
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    useCrewStore.setState({ crews: [crew('old'), crew('new')], activeCrew: crew('old'), crewLoading: false, selectCrew });
  });

  it('selects the first crew when none is open', () => {
    useCrewStore.setState({ activeCrew: null });
    renderHook(() => useCrewDayOf(0, []));
    expect(selectCrew).toHaveBeenCalledWith('old');
  });

  it('does not override a pending select of another crew (join while already in a crew)', () => {
    renderHook(() => useCrewDayOf(0, []));
    // selectCrew('new') clears activeCrew and sets crewLoading in one update.
    act(() => useCrewStore.setState({ activeCrew: null, crewLoading: true }));
    expect(selectCrew).not.toHaveBeenCalled();
  });

  it('selects the first crew once a load that was running at mount finishes', () => {
    useCrewStore.setState({ activeCrew: null, crewLoading: true });
    renderHook(() => useCrewDayOf(0, []));
    expect(selectCrew).not.toHaveBeenCalled();
    act(() => useCrewStore.setState({ crewLoading: false }));
    expect(selectCrew).toHaveBeenCalledTimes(1);
    expect(selectCrew).toHaveBeenCalledWith('old');
  });
});

describe('useCrewDayOf festival scope', () => {
  const selectCrew = vi.fn().mockResolvedValue(undefined);
  const inFestival = (id: string, festivalId: string) => ({ ...crew(id), festivalId }) as Crew;

  beforeEach(() => {
    selectCrew.mockClear();
    useAuthStore.setState({ user: { id: 'u1' } } as never);
  });

  it('hides a crew from another festival and yields no crew when this festival has none', () => {
    useCrewStore.setState({ crews: [inFestival('edc', 'f-edc')], activeCrew: inFestival('edc', 'f-edc'), crewLoading: false, selectCrew });
    const { result } = renderHook(() => useCrewDayOf(0, [], undefined, 'f-hush'));
    expect(result.current.crew).toBeNull();
    expect(selectCrew).not.toHaveBeenCalled();
  });

  it('opens the crew of this festival when another festival crew is active', () => {
    useCrewStore.setState({
      crews: [inFestival('edc', 'f-edc'), inFestival('orchard', 'f-orchard')],
      activeCrew: inFestival('edc', 'f-edc'),
      crewLoading: false,
      selectCrew,
    });
    const { result } = renderHook(() => useCrewDayOf(0, [], undefined, 'f-orchard'));
    expect(result.current.crew).toBeNull();
    expect(selectCrew).toHaveBeenCalledWith('orchard');
  });

  it('keeps the active crew when it belongs to this festival, or when no festival is given', () => {
    useCrewStore.setState({ crews: [inFestival('orchard', 'f-orchard')], activeCrew: inFestival('orchard', 'f-orchard'), crewLoading: false, selectCrew });
    expect(renderHook(() => useCrewDayOf(0, [], undefined, 'f-orchard')).result.current.crew?.id).toBe('orchard');
    expect(renderHook(() => useCrewDayOf(0, [])).result.current.crew?.id).toBe('orchard');
  });
});
