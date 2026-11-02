import { api } from './api';

export interface CrowdRating { avg: number; count: number }
export interface CrewRating { userId: string; username: string; rating: number }

const TTL_MS = 5 * 60 * 1000;
const MAX_PAGES = 20;
const PAGE_LIMIT = 100;

interface RatingsPage<T> { ratings: T[]; nextCursor: string | null }

const cache = new Map<string, { at: number; promise: Promise<unknown> }>();

export function clearRatingsCache(): void {
  cache.clear();
}

async function fetchAllPages<T>(basePath: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = `limit=${PAGE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res: RatingsPage<T> = await api.get<RatingsPage<T>>(`${basePath}?${qs}`);
    items.push(...(res.ratings ?? []));
    cursor = res.nextCursor ?? null;
    if (!cursor) break;
  }
  return items;
}

/** One request chain per key per 5 minutes. A failed chain is dropped so the next call retries. */
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise as Promise<T>;
  const promise = load();
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

export function fetchCrowdRatings(festivalId: string): Promise<Map<string, CrowdRating>> {
  const path = `/ratings/festival/${encodeURIComponent(festivalId)}/all`;
  return cached(path, async () => {
    const rows = await fetchAllPages<{ setId: string; avgRating: number | string; totalRatings: number | string }>(path);
    return new Map(rows.map((r) => [r.setId, { avg: Number(r.avgRating), count: Number(r.totalRatings) }]));
  });
}

export function fetchCrewRatings(crewId: string, festivalId: string): Promise<Map<string, CrewRating[]>> {
  const path = `/ratings/crew/${encodeURIComponent(crewId)}/festival/${encodeURIComponent(festivalId)}`;
  return cached(path, async () => {
    const rows = await fetchAllPages<{ setId: string; userId: string; username: string; rating: number }>(path);
    const bySet = new Map<string, CrewRating[]>();
    for (const r of rows) {
      const list = bySet.get(r.setId) ?? [];
      list.push({ userId: r.userId, username: r.username, rating: r.rating });
      bySet.set(r.setId, list);
    }
    return bySet;
  });
}
