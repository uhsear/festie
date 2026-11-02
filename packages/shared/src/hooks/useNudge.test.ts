// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNudge, NUDGE_COOLDOWN_MS } from './useNudge';
import { nudgeCrewMember } from '../services/nudge';
import { ApiClientError } from '../services/api';

vi.mock('../services/nudge', async (orig) => ({
  ...(await orig<typeof import('../services/nudge')>()),
  nudgeCrewMember: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useNudge', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('goes idle, sending, sent, then idle after the cooldown', async () => {
    const d = deferred<{ nudged: true }>();
    vi.mocked(nudgeCrewMember).mockReturnValueOnce(d.promise);
    const { result } = renderHook(() => useNudge('c1', 'u2', 'Ana'));
    expect(result.current).toMatchObject({ status: 'idle', message: null });

    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send();
    });
    expect(result.current.status).toBe('sending');
    expect(nudgeCrewMember).toHaveBeenCalledWith('c1', 'u2');

    await act(async () => {
      d.resolve({ nudged: true });
      await sending;
    });
    expect(result.current).toMatchObject({
      status: 'sent',
      message: 'Sent. Ana gets a push if their crew notifications are on.',
    });

    act(() => {
      vi.advanceTimersByTime(NUDGE_COOLDOWN_MS);
    });
    expect(result.current).toMatchObject({ status: 'idle', message: null });
  });

  it('does not call the service again while sending or sent', async () => {
    const d = deferred<{ nudged: true }>();
    vi.mocked(nudgeCrewMember).mockReturnValueOnce(d.promise);
    const { result } = renderHook(() => useNudge('c1', 'u2', 'Ana'));
    act(() => {
      void result.current.send();
    });
    await act(async () => {
      await result.current.send();
    });
    expect(nudgeCrewMember).toHaveBeenCalledTimes(1);
    await act(async () => {
      d.resolve({ nudged: true });
    });
    expect(result.current.status).toBe('sent');
    await act(async () => {
      await result.current.send();
    });
    expect(nudgeCrewMember).toHaveBeenCalledTimes(1);
  });

  it('shows the limited line on a 429 and allows a later try', async () => {
    vi.mocked(nudgeCrewMember).mockRejectedValueOnce(new ApiClientError('x', 429));
    const { result } = renderHook(() => useNudge('c1', 'u2', 'Ana'));
    await act(async () => {
      await result.current.send();
    });
    expect(result.current).toMatchObject({
      status: 'error',
      message: 'You told Ana in the last 5 minutes. Try again later.',
    });
    vi.mocked(nudgeCrewMember).mockResolvedValueOnce({ nudged: true });
    await act(async () => {
      await result.current.send();
    });
    expect(result.current.status).toBe('sent');
    expect(nudgeCrewMember).toHaveBeenCalledTimes(2);
  });

  it('resets to idle when the person changes', async () => {
    vi.mocked(nudgeCrewMember).mockResolvedValueOnce({ nudged: true });
    const { result, rerender } = renderHook(({ uid }) => useNudge('c1', uid, 'Ana'), { initialProps: { uid: 'u2' } });
    await act(async () => {
      await result.current.send();
    });
    expect(result.current.status).toBe('sent');
    rerender({ uid: 'u3' });
    expect(result.current).toMatchObject({ status: 'idle', message: null });
  });

  it('ignores a response that arrives after the ids changed', async () => {
    const d = deferred<{ nudged: true }>();
    vi.mocked(nudgeCrewMember).mockReturnValueOnce(d.promise);
    const { result, rerender } = renderHook(({ uid }) => useNudge('c1', uid, 'Ana'), { initialProps: { uid: 'u2' } });
    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send();
    });
    rerender({ uid: 'u3' });
    await act(async () => {
      d.resolve({ nudged: true });
      await sending;
    });
    expect(result.current).toMatchObject({ status: 'idle', message: null });
  });

  it('does nothing without both ids', async () => {
    const { result } = renderHook(() => useNudge(null, 'u2', 'Ana'));
    await act(async () => {
      await result.current.send();
    });
    expect(nudgeCrewMember).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });
});
