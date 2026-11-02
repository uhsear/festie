// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCheckIn } from './useCheckIn';
import { startCheckin, finishCheckin, getCheckin } from '../services/checkin';

vi.mock('../services/checkin', () => ({
  startCheckin: vi.fn(),
  finishCheckin: vi.fn(),
  getCheckin: vi.fn(),
}));

// In the future, so the hook does not drop it as already ended.
const timer = { dueAt: new Date(Date.now() + 30 * 60_000).toISOString(), minutes: 30 };

describe('useCheckIn', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loads the active timer on mount', async () => {
    vi.mocked(getCheckin).mockResolvedValue(timer);
    const { result } = renderHook(() => useCheckIn('c1'));
    await waitFor(() => expect(result.current.checkin).toEqual(timer));
  });

  it('start updates checkin', async () => {
    vi.mocked(getCheckin).mockResolvedValue(null);
    vi.mocked(startCheckin).mockResolvedValue(timer);
    const { result } = renderHook(() => useCheckIn('c1'));
    await act(() => result.current.start(30));
    expect(startCheckin).toHaveBeenCalledWith('c1', { minutes: 30, position: undefined });
    expect(result.current.checkin).toEqual(timer);
    expect(result.current.busy).toBe(false);
  });

  it('a failed done keeps checkin and re-throws', async () => {
    vi.mocked(getCheckin).mockResolvedValue(timer);
    vi.mocked(finishCheckin).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCheckIn('c1'));
    await waitFor(() => expect(result.current.checkin).toEqual(timer));
    await act(async () => {
      await expect(result.current.done()).rejects.toThrow('offline');
    });
    expect(result.current.checkin).toEqual(timer);
  });

  it('done resolves to the server cleared flag', async () => {
    vi.mocked(getCheckin).mockResolvedValue(timer);
    vi.mocked(finishCheckin).mockResolvedValue({ cleared: false });
    const { result } = renderHook(() => useCheckIn('c1'));
    await waitFor(() => expect(result.current.checkin).toEqual(timer));
    let cleared: boolean | undefined;
    await act(async () => {
      cleared = await result.current.done();
    });
    expect(cleared).toBe(false);
    expect(result.current.checkin).toBeNull();
  });

  it('start resolves to the server timer', async () => {
    vi.mocked(getCheckin).mockResolvedValue(null);
    vi.mocked(startCheckin).mockResolvedValue(timer);
    const { result } = renderHook(() => useCheckIn('c1'));
    let res: unknown;
    await act(async () => {
      res = await result.current.start(30);
    });
    expect(res).toEqual(timer);
  });

  it('drops the timer once dueAt passes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      vi.setSystemTime(Date.parse(timer.dueAt) - 60_000);
      vi.mocked(getCheckin).mockResolvedValue(timer);
      const { result } = renderHook(() => useCheckIn('c1'));
      await act(async () => {});
      expect(result.current.checkin).toEqual(timer);
      await act(async () => {
        vi.advanceTimersByTime(59_000);
      });
      expect(result.current.checkin).toEqual(timer);
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(result.current.checkin).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a response for an old crew', async () => {
    let resolveOld!: (v: typeof timer) => void;
    vi.mocked(getCheckin).mockImplementation((id: string) =>
      id === 'old' ? new Promise((r) => (resolveOld = r)) : Promise.resolve(null),
    );
    const { result, rerender } = renderHook(({ id }) => useCheckIn(id), { initialProps: { id: 'old' } });
    rerender({ id: 'new' });
    await act(async () => resolveOld(timer));
    expect(result.current.checkin).toBeNull();
  });
});
