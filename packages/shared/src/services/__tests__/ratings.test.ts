import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

import { api } from '../api';
import {
  fetchCrowdRatings,
  fetchCrewRatings,
  clearRatingsCache,
  rateSet,
  clearSetRating,
  fetchFestivalRatings,
  fetchWrap,
  fetchCrewWrap,
  fetchLifetime,
  locateSet,
} from '../ratings';

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

describe('set rating writes', () => {
  it('rateSet posts the encoded setId with the collapsing rate-<setId> clientId', async () => {
    await rateSet('a/b', 4, 'loved it');
    expect(api.post).toHaveBeenCalledWith('/ratings/a%2Fb', { rating: 4, note: 'loved it' }, { clientId: 'rate-a/b' });
  });

  it('rateSet leaves the note out when none is given', async () => {
    await rateSet('s1', 3);
    expect(api.post).toHaveBeenCalledWith('/ratings/s1', { rating: 3 }, { clientId: 'rate-s1' });
  });

  it('clearSetRating deletes with the same clientId', async () => {
    await clearSetRating('s1');
    expect(api.delete).toHaveBeenCalledWith('/ratings/s1', { clientId: 'rate-s1' });
  });

  it('fetchFestivalRatings accepts a bare array or an envelope', async () => {
    get.mockResolvedValueOnce([{ setId: 'a', rating: 5 }]).mockResolvedValueOnce({ ratings: [{ setId: 'b', rating: 2 }] });
    expect(await fetchFestivalRatings('f 1')).toEqual([{ setId: 'a', rating: 5 }]);
    expect(get).toHaveBeenCalledWith('/ratings/festival/f%201');
    expect(await fetchFestivalRatings('f1')).toEqual([{ setId: 'b', rating: 2 }]);
  });
});

describe('wrap fetchers', () => {
  it('fetchWrap adds the crew only when given', async () => {
    await fetchWrap('f1');
    await fetchWrap('f1', 'c 1');
    expect(get.mock.calls.map((c) => c[0])).toEqual(['/ratings/wrap/f1', '/ratings/wrap/f1?crewId=c%201']);
  });

  it('fetchCrewWrap, fetchLifetime and locateSet hit their endpoints', async () => {
    await fetchCrewWrap('c1', 'f1');
    await fetchLifetime();
    await locateSet('s/1');
    expect(get.mock.calls.map((c) => c[0])).toEqual([
      '/ratings/crew-wrap/c1/f1',
      '/ratings/lifetime',
      '/festivals/locate-set/s%2F1',
    ]);
  });
});
