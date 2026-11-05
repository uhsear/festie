import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCrewOverlapStatus, clearCrewOverlapStatusCache } from './useCrewOverlapStatus';
import { useCrewStore } from '../stores/crewStore';

const loadOverlap = vi.fn<(crewId: string, festivalId: string) => Promise<void>>();

describe('useCrewOverlapStatus', () => {
  beforeEach(() => {
    clearCrewOverlapStatusCache();
    loadOverlap.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useCrewStore.setState({ activeCrew: { id: 'c1', festivalId: 'crew-fest' } as never, loadOverlap });
  });
  afterEach(() => vi.useRealTimers());

  it('stays idle when crew mode is off', () => {
    const { result } = renderHook(() => useCrewOverlapStatus(false, 'f'));
    expect(result.current.status).toBe('idle');
    expect(loadOverlap).not.toHaveBeenCalled();
  });

  it("loads with the crew's own festival id, then is ready at once next time", async () => {
    loadOverlap.mockResolvedValue(undefined);
    const first = renderHook(() => useCrewOverlapStatus(true, 'other-fest'));
    expect(first.result.current.status).toBe('loading');
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(loadOverlap).toHaveBeenCalledWith('c1', 'crew-fest');
    first.unmount();
    loadOverlap.mockReturnValue(new Promise(() => {}));
    const second = renderHook(() => useCrewOverlapStatus(true, 'other-fest'));
    expect(second.result.current.status).toBe('ready');
  });

  it('reports error on failure and retries', async () => {
    loadOverlap.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useCrewOverlapStatus(true));
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('reports error when the first load takes longer than 5 s', () => {
    vi.useFakeTimers();
    loadOverlap.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCrewOverlapStatus(true));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.status).toBe('error');
  });
});
