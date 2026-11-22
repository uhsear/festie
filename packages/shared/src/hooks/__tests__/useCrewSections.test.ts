import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCrewSections, retryDelayMs, RECONNECT_RETRY_MS } from '../useCrewSections';
import { useCrewStore } from '../../stores/crewStore';
import { useUIStore } from '../../stores/uiStore';

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
afterEach(() => {
  vi.useRealTimers();
  useUIStore.setState({ offlineMode: false });
});

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
    loaders.loadPolls!.mockRejectedValueOnce(err(429, '2'));
    const { result } = renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(loaders.loadPolls).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(loaders.loadPolls).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('gives up after 3 attempts and reload retries again', async () => {
    loaders.loadRides!.mockRejectedValue(err(429));
    const { result } = renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(loaders.loadRides).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBe('Failed to load: rides');
    loaders.loadRides!.mockResolvedValue(undefined);
    await act(async () => { result.current.reload(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.error).toBeNull();
  });

  it('does not retry a 403', async () => {
    loaders.loadPacking!.mockRejectedValue(err(403));
    const { result } = renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(loaders.loadPacking).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('Failed to load: packing');
  });

  it('stops retrying after unmount', async () => {
    loaders.loadPolls!.mockRejectedValue(err(503));
    const { unmount } = renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(loaders.loadPolls).toHaveBeenCalledTimes(1);
  });

  it('reloads at once when the connection returns with a failure showing', async () => {
    useUIStore.setState({ offlineMode: true });
    loaders.loadRides!.mockRejectedValue(err(503));
    const { result } = renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current.error).toBe('Failed to load: rides');
    const before = loaders.loadRides!.mock.calls.length;
    loaders.loadRides!.mockResolvedValue(undefined);
    await act(async () => { useUIStore.setState({ offlineMode: false }); await vi.advanceTimersByTimeAsync(0); });
    expect(loaders.loadRides).toHaveBeenCalledTimes(before + 1);
    expect(result.current.error).toBeNull();
  });

  it('tries once more when the reload at reconnect also fails', async () => {
    useUIStore.setState({ offlineMode: true });
    loaders.loadRides!.mockRejectedValue(err(503));
    const { result } = renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current.error).toBe('Failed to load: rides');
    // Back online but the network is not ready yet: the reload at reconnect fails as well.
    await act(async () => { useUIStore.setState({ offlineMode: false }); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(RECONNECT_RETRY_MS - 100); });
    expect(result.current.error).toBe('Failed to load: rides');
    loaders.loadRides!.mockResolvedValue(undefined);
    await act(async () => { await vi.advanceTimersByTimeAsync(RECONNECT_RETRY_MS + 100); });
    expect(result.current.error).toBeNull();
  });

  it('makes only one extra try after a failed reconnect reload', async () => {
    useUIStore.setState({ offlineMode: true });
    loaders.loadRides!.mockRejectedValue(err(503));
    renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    const before = loaders.loadRides!.mock.calls.length;
    await act(async () => { useUIStore.setState({ offlineMode: false }); await vi.advanceTimersByTimeAsync(120_000); });
    // reconnect run (3 attempts) plus one extra run (3 attempts), then nothing more
    expect(loaders.loadRides).toHaveBeenCalledTimes(before + 6);
  });

  it('leaves no armed retry after a successful reconnect reload', async () => {
    useUIStore.setState({ offlineMode: true });
    loaders.loadRides!.mockRejectedValue(err(503));
    const { result } = renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    loaders.loadRides!.mockResolvedValue(undefined);
    await act(async () => { useUIStore.setState({ offlineMode: false }); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.error).toBeNull();
    loaders.loadRides!.mockRejectedValue(err(403));
    await act(async () => { result.current.reload(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.error).toBe('Failed to load: rides');
    const before = loaders.loadRides!.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(RECONNECT_RETRY_MS * 3); });
    expect(loaders.loadRides).toHaveBeenCalledTimes(before);
  });

  it('waits for a slow reconnect reload instead of cancelling it', async () => {
    useUIStore.setState({ offlineMode: true });
    loaders.loadRides!.mockRejectedValue(err(503));
    const { result } = renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    // Reconnect reload takes 8 s (> RECONNECT_RETRY_MS) and then succeeds.
    loaders.loadRides!.mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 8000)));
    const before = loaders.loadRides!.mock.calls.length;
    await act(async () => { useUIStore.setState({ offlineMode: false }); await vi.advanceTimersByTimeAsync(RECONNECT_RETRY_MS + 4000); });
    expect(loaders.loadRides).toHaveBeenCalledTimes(before + 1);
    expect(result.current.error).toBeNull();
  });

  it('does not reload on reconnect when nothing failed', async () => {
    useUIStore.setState({ offlineMode: true });
    renderHook(() => useCrewSections('c1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { useUIStore.setState({ offlineMode: false }); await vi.advanceTimersByTimeAsync(0); });
    expect(loaders.loadPolls).toHaveBeenCalledTimes(1);
  });
});
