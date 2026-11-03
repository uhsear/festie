import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useViewAs } from '../useViewAs';
import { useFestivalDataStore } from '../../stores/festivalDataStore';
import { useFestivalUIStore } from '../../stores/festivalUIStore';
import { useCrewStore } from '../../stores/crewStore';
import type { Profile } from '../../types/domain';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));

vi.mock('../../stores/resetStores', () => ({
  resetAllStores: vi.fn(),
}));

const profile = (id: string, userId: string, name: string, picks: Profile['picks'] = {}) =>
  ({ id, userId, festivalId: 'f1', name, picks, notes: {}, updatedAt: '' }) as Profile;
const me = profile('p1', 'u1', 'Me', { a: 'must' });
const ana = profile('p2', 'u2', 'Ana', { b: 'must' });
const stranger = profile('p3', 'u3', 'Stranger', { c: 'must' });

describe('useViewAs', () => {
  beforeEach(() => {
    useFestivalDataStore.setState({ currentProfile: me, allProfiles: [me, ana, stranger] });
    useFestivalUIStore.setState({ viewAsProfileId: null });
    useCrewStore.setState({ crewMembers: [{ userId: 'u1' }, { userId: 'u2' }] });
  });

  it('starts with no target', () => {
    const { result } = renderHook(() => useViewAs());
    expect(result.current.target).toBeNull();
  });

  it('starts and clears a crew mate', () => {
    const { result } = renderHook(() => useViewAs());
    expect(result.current.canView('p2')).toBe(true);
    act(() => result.current.start('p2'));
    expect(result.current.target).toEqual({ profileId: 'p2', name: 'Ana', picks: { b: 'must' } });
    act(() => result.current.clear());
    expect(result.current.target).toBeNull();
    expect(useFestivalUIStore.getState().viewAsProfileId).toBeNull();
  });

  it('refuses someone outside the active crew, even when forced', () => {
    const { result } = renderHook(() => useViewAs());
    expect(result.current.canView('p3')).toBe(false);
    act(() => result.current.start('p3'));
    expect(useFestivalUIStore.getState().viewAsProfileId).toBeNull();
    act(() => useFestivalUIStore.getState().setViewAs('p3'));
    expect(result.current.target).toBeNull();
  });

  it('refuses my own profile', () => {
    const { result } = renderHook(() => useViewAs());
    expect(result.current.canView('p1')).toBe(false);
    act(() => result.current.start('p1'));
    expect(useFestivalUIStore.getState().viewAsProfileId).toBeNull();
  });

  it('offers nobody without an active crew', () => {
    useCrewStore.setState({ crewMembers: [] });
    const { result } = renderHook(() => useViewAs());
    expect(result.current.canView('p2')).toBe(false);
  });

  it('ends by itself when the member leaves the crew', () => {
    const { result } = renderHook(() => useViewAs());
    act(() => result.current.start('p2'));
    expect(result.current.target).not.toBeNull();
    act(() => useCrewStore.setState({ crewMembers: [{ userId: 'u1' }] }));
    expect(result.current.target).toBeNull();
  });
});
