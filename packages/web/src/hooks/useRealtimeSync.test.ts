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
});
