// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCrewStore } from '../stores/crewStore';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { useLiveLocationCrewSync } from './useDayOf';
import type { Crew } from '../types';

const crew = (id: string) => ({ id }) as unknown as Crew;

describe('useLiveLocationCrewSync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useCrewStore.setState({ activeCrew: null });
    useLiveLocationStore.getState().setActiveCrew(null);
  });

  it('scopes the live-location store to the active crew and follows a switch', () => {
    useCrewStore.setState({ activeCrew: crew('a') });
    renderHook(() => useLiveLocationCrewSync());
    expect(useLiveLocationStore.getState().crewId).toBe('a');

    act(() => useCrewStore.setState({ activeCrew: crew('b') }));
    expect(useLiveLocationStore.getState().crewId).toBe('b');
  });

  it('keeps the scope when the consumer that set it unmounts', () => {
    useCrewStore.setState({ activeCrew: crew('a') });
    const { unmount } = renderHook(() => useLiveLocationCrewSync());
    unmount();
    expect(useLiveLocationStore.getState().crewId).toBe('a');
  });

  it('loads active SOS for the new crew on a crew change, and not for a null crew', () => {
    const load = vi.fn().mockResolvedValue(undefined);
    useLiveLocationStore.setState({ loadActiveSos: load });
    renderHook(() => useLiveLocationCrewSync());
    expect(load).not.toHaveBeenCalled();

    act(() => useCrewStore.setState({ activeCrew: crew('b') }));
    expect(load).toHaveBeenCalledWith('b');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
