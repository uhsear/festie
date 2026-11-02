// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveShareSession } from './useLiveShareSession';
import type { GeoFix, GeoWatcher } from './useLiveLocationPublisher';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { useFestivalModeStore } from '../stores/festivalModeStore';
import type { Socket } from '../services/socket';

function makeSocket() {
  const emit = vi.fn();
  const socket = { connected: true, emit, on: vi.fn(), off: vi.fn() } as unknown as Socket;
  return { socket, emit };
}

function makeWatcher() {
  const teardown = vi.fn();
  let fail: ((err: unknown) => void) | undefined;
  const watchPosition: GeoWatcher = (_onFix: (fix: GeoFix) => void, onError) => {
    fail = onError;
    return teardown;
  };
  return { watchPosition, teardown, fail: (err: unknown) => fail?.(err) };
}

const END = new Date(10 * 60_000).toISOString();

describe('useLiveShareSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    useLiveLocationStore.getState().reset();
    useFestivalModeStore.setState({ lowPowerMode: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits location:share for an intent, with the intent end time', () => {
    const { socket, emit } = makeSocket();
    const w = makeWatcher();
    renderHook(() => useLiveShareSession({ socket, watchPosition: w.watchPosition }));
    expect(emit).not.toHaveBeenCalled();
    act(() => useLiveLocationStore.getState().beginShare('c1', END, false));
    expect(emit).toHaveBeenCalledWith('location:share', { _v: 1, crewId: 'c1', expiresAt: END }, expect.any(Function));
  });

  it('pause stops the watcher and emits location:stop; resume re-shares with the same end time', () => {
    const { socket, emit } = makeSocket();
    const w = makeWatcher();
    renderHook(() => useLiveShareSession({ socket, watchPosition: w.watchPosition }));
    act(() => useLiveLocationStore.getState().beginShare('c1', END, false));
    act(() => useLiveLocationStore.getState().setSharePaused(true));
    expect(emit).toHaveBeenCalledWith('location:stop', { _v: 1, crewId: 'c1' });
    expect(w.teardown).toHaveBeenCalledTimes(1);
    act(() => useLiveLocationStore.getState().setSharePaused(false));
    const shares = emit.mock.calls.filter((c) => c[0] === 'location:share');
    expect(shares).toHaveLength(2);
    expect(shares[1]![1]).toEqual({ _v: 1, crewId: 'c1', expiresAt: END });
  });

  it('expiry while paused ends the session as expired', () => {
    const { socket } = makeSocket();
    const w = makeWatcher();
    renderHook(() => useLiveShareSession({ socket, watchPosition: w.watchPosition }));
    act(() => useLiveLocationStore.getState().beginShare('c1', END, false));
    act(() => useLiveLocationStore.getState().setSharePaused(true));
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(useLiveLocationStore.getState().shareIntent).toBeNull();
    expect(useLiveLocationStore.getState().shareEndedReason).toBe('expired');
  });

  it('low-power mode ends the session as low-power', () => {
    const { socket } = makeSocket();
    const w = makeWatcher();
    renderHook(() => useLiveShareSession({ socket, watchPosition: w.watchPosition }));
    act(() => useLiveLocationStore.getState().beginShare('c1', END, false));
    act(() => useFestivalModeStore.setState({ lowPowerMode: true }));
    expect(useLiveLocationStore.getState().shareEndedReason).toBe('low-power');
  });

  it('a watcher error with code 1 ends the session as denied', () => {
    const { socket } = makeSocket();
    const w = makeWatcher();
    renderHook(() => useLiveShareSession({ socket, watchPosition: w.watchPosition }));
    act(() => useLiveLocationStore.getState().beginShare('c1', END, false));
    act(() => w.fail({ code: 1 }));
    expect(useLiveLocationStore.getState().shareEndedReason).toBe('denied');
  });
});
