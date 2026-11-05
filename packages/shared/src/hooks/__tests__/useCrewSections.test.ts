import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCrewSections, retryDelayMs } from '../useCrewSections';
import { useCrewStore } from '../../stores/crewStore';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));
vi.mock('../../stores/resetStores', () => ({ resetAllStores: vi.fn() }));

const err = (status: number, retryAfter?: string) =>
  Object.assign(new Error('x'), { name: 'ApiClientError', status, retryAfter });

let loaders: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.useFakeTimers();
  loaders = Object.fromEntries(
    ['loadPolls', 'loadMeetingPoints', 'loadPacking', 'loadRides', 'loadExpenses'].map((k) => [k, vi.fn().mockResolvedValue(undefined)]),
  );
  useCrewStore.setState(loaders as never);
});
afterEach(() => vi.useRealTimers());

describe('retryDelayMs', () => {
  it('honors Retry-After seconds', () => expect(retryDelayMs(err(429, '7'), 1)).toBe(7000));
  it('backs off exponentially with jitter otherwise', () => {
    const d = retryDelayMs(err(503), 2);
    expect(d).toBeGreaterThanOrEqual(1000);
    expect(d).toBeLessThanOrEqual(2000);
  });
});

describe('useCrewSections', () => {
  it('recovers after a 429 using Retry-After', async () => {
    loaders.loadPolls.mockRejectedValueOnce(err(429, '2'));
    const { result } = renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(loaders.loadPolls).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(loaders.loadPolls).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('gives up after 3 attempts and reload retries again', async () => {
    loaders.loadRides.mockRejectedValue(err(429));
    const { result } = renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(loaders.loadRides).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBe('Failed to load: rides');
    loaders.loadRides.mockResolvedValue(undefined);
    await act(async () => { result.current.reload(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.error).toBeNull();
  });

  it('does not retry a 403', async () => {
    loaders.loadPacking.mockRejectedValue(err(403));
    const { result } = renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(loaders.loadPacking).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('Failed to load: packing');
  });

  it('stops retrying after unmount', async () => {
    loaders.loadPolls.mockRejectedValue(err(503));
    const { unmount } = renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(loaders.loadPolls).toHaveBeenCalledTimes(1);
  });
});
