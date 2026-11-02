import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { useFestivalStore } from '../stores/festivalStore';
import type { FestivalSet } from '../types';
import { pickAlsoPicked } from '../utils/discover';

export type AlsoPickedStatus = 'idle' | 'loading' | 'ready' | 'error';

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;
// Insertion order is the eviction order: the oldest entry is dropped first.
const cache = new Map<string, { ids: string[]; at: number }>();
let warned = false;

function remember(key: string, ids: string[]): void {
  cache.delete(key);
  cache.set(key, { ids, at: Date.now() });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

function fresh(key: string): string[] | null {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < TTL_MS ? hit.ids : null;
}

/** Test hook: forgets every cached co-pick result. */
export function clearAlsoPickedCache(): void {
  cache.clear();
  warned = false;
}

interface Settled {
  key: string;
  ids: string[] | null;
}

/** Sets that other people picked together with this one. An error hides the section. */
export function useAlsoPicked(
  festivalId: string | undefined,
  setId: string | undefined,
): { sets: FestivalSet[]; status: AlsoPickedStatus } {
  const allSets = useFestivalStore((s) => s.sets);
  const picks = useFestivalStore((s) => s.currentProfile?.picks);
  const [settled, setSettled] = useState<Settled | null>(null);
  const key = festivalId && setId ? `${festivalId}:${setId}` : null;

  useEffect(() => {
    if (!key || !festivalId || !setId || fresh(key)) return;
    let cancelled = false;
    api
      .get<{ setIds: string[] }>(
        `/festivals/${encodeURIComponent(festivalId)}/sets/${encodeURIComponent(setId)}/also-picked`,
      )
      .then((res) => {
        const ids = Array.isArray(res?.setIds) ? res.setIds : [];
        remember(key, ids);
        if (!cancelled) setSettled({ key, ids });
      })
      .catch((err: unknown) => {
        if (!warned) {
          warned = true;
          console.warn('Could not load what other people picked with this set.', err);
        }
        if (!cancelled) setSettled({ key, ids: null });
      });
    return () => {
      cancelled = true;
    };
  }, [key, festivalId, setId]);

  const ids = key ? (fresh(key) ?? (settled?.key === key ? settled.ids : undefined)) : undefined;
  const sets = useMemo(() => (ids ? pickAlsoPicked(ids, allSets, picks) : []), [ids, allSets, picks]);

  if (!key) return { sets: [], status: 'idle' };
  if (ids === undefined) return { sets: [], status: 'loading' };
  if (ids === null) return { sets: [], status: 'error' };
  return { sets, status: 'ready' };
}
