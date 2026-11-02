import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAdminUserList } from '../useAdminUserList';
import { api } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: { getEnvelope: vi.fn() },
  ApiClientError: class extends Error {},
}));

const getEnvelope = api.getEnvelope as unknown as ReturnType<typeof vi.fn>;
const page = (ids: string[], nextCursor: string | null, total = 10) => ({
  data: ids.map((id) => ({ id, username: id })),
  meta: { pagination: { hasMore: !!nextCursor, nextCursor, pageSize: ids.length, total } },
});
const lastUrl = () => String(getEnvelope.mock.calls[getEnvelope.mock.calls.length - 1][0]);

describe('useAdminUserList', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getEnvelope.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('sends one request after 300 ms of typing', async () => {
    getEnvelope.mockResolvedValue(page(['a'], null, 1));
    const { result } = renderHook(() => useAdminUserList());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getEnvelope).toHaveBeenCalledTimes(1);
    act(() => result.current.setSearch('b'));
    act(() => result.current.setSearch('bo'));
    act(() => result.current.setSearch('bob'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(getEnvelope).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getEnvelope).toHaveBeenCalledTimes(2);
    expect(lastUrl()).toContain('search=bob');
  });

  it('loadMore sends the cursor and appends', async () => {
    getEnvelope.mockResolvedValueOnce(page(['a', 'b'], 'c1')).mockResolvedValueOnce(page(['c'], null));
    const { result } = renderHook(() => useAdminUserList());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.hasMore).toBe(true);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(lastUrl()).toContain('cursor=c1');
    expect(result.current.users.map((u) => u.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.hasMore).toBe(false);
  });

  it('a new search resets the list', async () => {
    getEnvelope.mockResolvedValueOnce(page(['a', 'b'], 'c1')).mockResolvedValueOnce(page(['z'], null, 1));
    const { result } = renderHook(() => useAdminUserList());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.setSearch('z'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.users.map((u) => u.id)).toEqual(['z']);
    expect(result.current.total).toBe(1);
  });

  it('ignores a stale response', async () => {
    let resolveOld: (v: unknown) => void = () => {};
    getEnvelope
      .mockReturnValueOnce(new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce(page(['new'], null, 1));
    const { result } = renderHook(() => useAdminUserList());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.setSearch('x'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      resolveOld(page(['old'], null, 1));
    });
    expect(result.current.users.map((u) => u.id)).toEqual(['new']);
  });

  it('a search during Load more clears loadingMore and keeps the new page', async () => {
    let resolveMore: (v: unknown) => void = () => {};
    getEnvelope
      .mockResolvedValueOnce(page(['a', 'b'], 'c1'))
      .mockReturnValueOnce(new Promise((r) => (resolveMore = r)))
      .mockResolvedValueOnce(page(['z'], 'z1', 1))
      .mockResolvedValueOnce(page(['y'], null, 2));
    const { result } = renderHook(() => useAdminUserList());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    let more: Promise<void> = Promise.resolve();
    act(() => {
      more = result.current.loadMore();
    });
    expect(result.current.loadingMore).toBe(true);
    act(() => result.current.setSearch('z'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.loadingMore).toBe(false);
    await act(async () => {
      resolveMore(page(['stale'], null));
      await more;
    });
    expect(result.current.users.map((u) => u.id)).toEqual(['z']);
    expect(result.current.loadingMore).toBe(false);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(lastUrl()).toContain('cursor=z1');
    expect(result.current.users.map((u) => u.id)).toEqual(['z', 'y']);
  });

  it('loadMore does nothing while page 1 is loading', async () => {
    let resolveSearch: (v: unknown) => void = () => {};
    getEnvelope
      .mockResolvedValueOnce(page(['a', 'b'], 'c1'))
      .mockReturnValueOnce(new Promise((r) => (resolveSearch = r)));
    const { result } = renderHook(() => useAdminUserList());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.setSearch('z'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(getEnvelope).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveSearch(page(['z'], null, 1));
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.users.map((u) => u.id)).toEqual(['z']);
  });
});
