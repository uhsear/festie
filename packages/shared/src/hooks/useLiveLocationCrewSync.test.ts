// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCrewStore } from '../stores/crewStore';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { useLiveLocationCrewSync } from './useDayOf';
import type { Crew } from '../types';

const crew = (id: string) => ({ id }) as unknown as Crew;

describe('useLiveLocationCrewSync', () => {
  beforeEach(() => {
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
});
