import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));

import { api } from '../api';
import { fetchCrowdRatings, fetchCrewRatings, clearRatingsCache } from '../ratings';

const get = vi.mocked(api.get);

beforeEach(() => {
  vi.clearAllMocks();
  clearRatingsCache();
});
afterEach(() => vi.useRealTimers());

describe('ratings service', () => {
  it('pages the crowd endpoint until nextCursor is null', async () => {
    get
      .mockResolvedValueOnce({ ratings: [{ setId: 'a', avgRating: '4.5', totalRatings: '2' }], nextCursor: 'c1' })
      .mockResolvedValueOnce({ ratings: [{ setId: 'b', avgRating: 3, totalRatings: 7 }], nextCursor: null });
    const map = await fetchCrowdRatings('f1');
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0]![0]).toBe('/ratings/festival/f1/all?limit=100');
    expect(get.mock.calls[1]![0]).toBe('/ratings/festival/f1/all?limit=100&cursor=c1');
    expect(map.get('a')).toEqual({ avg: 4.5, count: 2 });
    expect(map.get('b')).toEqual({ avg: 3, count: 7 });
  });

  it('groups crew ratings by set', async () => {
    get.mockResolvedValueOnce({
      ratings: [
        { setId: 'a', userId: 'u1', username: 'Sam', rating: 4 },
        { setId: 'a', userId: 'u2', username: 'Alex', rating: 5 },
      ],
      nextCursor: null,
    });
    const map = await fetchCrewRatings('c1', 'f1');
    expect(map.get('a')).toHaveLength(2);
  });

  it('makes no request for a second call within 5 minutes, then refetches', async () => {
    vi.useFakeTimers();
    get.mockResolvedValue({ ratings: [], nextCursor: null });
    await fetchCrowdRatings('f1');
    await fetchCrowdRatings('f1');
    expect(get).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await fetchCrowdRatings('f1');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('retries after a rejected call', async () => {
    get.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ ratings: [], nextCursor: null });
    await expect(fetchCrowdRatings('f1')).rejects.toThrow('boom');
    await expect(fetchCrowdRatings('f1')).resolves.toBeInstanceOf(Map);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('stops after 20 pages', async () => {
    get.mockResolvedValue({ ratings: [], nextCursor: 'more' });
    await fetchCrowdRatings('f1');
    expect(get).toHaveBeenCalledTimes(20);
  });
});
