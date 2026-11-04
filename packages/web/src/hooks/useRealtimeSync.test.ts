import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers: Record<string, (data?: unknown) => void> = {};
const fakeSocket = {
  connected: true,
  on: (ev: string, fn: (data?: unknown) => void) => {
    handlers[ev] = fn;
  },
  off: vi.fn(),
  emit: vi.fn(),
};

vi.mock('@festie/shared/hooks/useSocket', () => ({ useSocket: () => ({ socket: fakeSocket }) }));
vi.mock('@festie/shared/hooks/useCrewRealtime', () => ({ useCrewRealtime: vi.fn() }));
vi.mock('@festie/shared/hooks', () => ({ useRevocationRealtime: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('./useCrewQuerySink', () => ({ useCrewQuerySink: () => ({}) }));

import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { useFestivalDataStore } from '@festie/shared/stores/festivalDataStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { useRealtimeSync } from './useRealtimeSync';

describe('useRealtimeSync (T58)', () => {
  const selectFestival = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    selectFestival.mockClear();
    useFestivalStore.setState({ currentFestivalId: 'fest-1', selectFestival } as never);
  });
  afterEach(() => vi.useRealTimers());

  it('ignores festival:updated for another festival and reloads the current one once', () => {
    renderHook(() => useRealtimeSync());
    handlers['festival:updated']({ _v: 1, id: 'other' });
    handlers['festival:updated']({ _v: 1 });
    act(() => void vi.advanceTimersByTime(400));
    expect(selectFestival).toHaveBeenCalledTimes(0);

    handlers['festival:updated']({ _v: 1, id: 'fest-1' });
    act(() => void vi.advanceTimersByTime(400));
    expect(selectFestival).toHaveBeenCalledTimes(1);
  });

  it('does not re-render when onlineUsers changes', () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return useRealtimeSync();
    });
    const before = renders;
    act(() => useUIStore.setState({ onlineUsers: [{ id: 'u1', name: 'a', status: 'online' }] } as never));
    expect(renders).toBe(before);
  });
  it('does not join the festival room for a signed-in non-member, joins once a profile exists', () => {
    fakeSocket.emit.mockClear();
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    useFestivalDataStore.setState({ currentProfile: null } as never);
    renderHook(() => useRealtimeSync());
    act(() => handlers['connect']());
    expect(fakeSocket.emit).not.toHaveBeenCalledWith('join:festival', expect.anything(), expect.anything(), expect.anything());

    act(() => useFestivalDataStore.setState({ currentProfile: { id: 'p1' } } as never));
    act(() => handlers['connect']());
    expect(fakeSocket.emit).toHaveBeenCalledWith('join:festival', 'fest-1', { _v: 1 }, expect.any(Function));
    useAuthStore.setState({ user: null } as never);
  });
  it('refetches the open crew on crew:updated so a member drops a regenerated invite code', () => {
    const loadCrews = vi.fn().mockResolvedValue(undefined);
    const selectCrew = vi.fn().mockResolvedValue(undefined);
    useCrewStore.setState({ activeCrew: { id: 'c1', inviteCode: 'OLD' }, loadCrews, selectCrew } as never);
    renderHook(() => useRealtimeSync());
    handlers['crew:updated']({ _v: 1, id: 'c1' });
    act(() => void vi.advanceTimersByTime(400));
    expect(selectCrew).toHaveBeenCalledWith('c1');
    expect(loadCrews).toHaveBeenCalledTimes(1);
  });
});
