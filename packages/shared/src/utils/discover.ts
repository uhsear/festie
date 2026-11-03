import type { FestivalDay, FestivalSet, Priority } from '../types/domain';
import { artistDisplayName } from './format';
import { byStartTime } from './scheduleFormat';
import { getSetTimeBounds } from './setStatus';

type Picks = Record<string, Priority | null | undefined> | null | undefined;

const PRIORITY_WEIGHT: Record<Priority, number> = { must: 3, 'want-to-see': 2, maybe: 1 };
const norm = (g: string): string => g.toLocaleLowerCase();

/** Distinct genres across a set's artists: case-insensitive, first spelling kept, stored order. */
export function setGenres(set: FestivalSet): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const artist of set.artists ?? []) {
    for (const raw of artist.genres ?? []) {
      const g = raw.trim();
      if (!g || seen.has(norm(g))) continue;
      seen.add(norm(g));
      out.push(g);
    }
  }
  return out;
}

const byCountThenName = (a: { name: string; n: number }, b: { name: string; n: number }) =>
  b.n - a.n || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Genres on at least 3 sets, most common first. Empty when fewer than 2 genres qualify. */
export function festivalGenres(sets: readonly FestivalSet[], limit = 8): string[] {
  const counts = new Map<string, { name: string; n: number }>();
  for (const set of sets) {
    for (const g of setGenres(set)) {
      const entry = counts.get(norm(g));
      if (entry) entry.n += 1;
      else counts.set(norm(g), { name: g, n: 1 });
    }
  }
  const qualifying = [...counts.values()].filter((e) => e.n >= 3);
  if (qualifying.length < 2) return [];
  return qualifying.sort(byCountThenName).slice(0, limit).map((e) => e.name);
}

/** The genres of the user's picks, weighted by priority. Empty until 3 picked sets have genres. */
export function topPickedGenres(sets: readonly FestivalSet[], picks: Picks, limit = 3): string[] {
  const weights = new Map<string, { name: string; n: number }>();
  let pickedWithGenres = 0;
  for (const set of sets) {
    const priority = picks?.[set.id];
    const genres = priority ? setGenres(set) : [];
    if (!priority || genres.length === 0) continue;
    pickedWithGenres += 1;
    for (const g of genres) {
      const entry = weights.get(norm(g));
      if (entry) entry.n += PRIORITY_WEIGHT[priority];
      else weights.set(norm(g), { name: g, n: PRIORITY_WEIGHT[priority] });
    }
  }
  if (pickedWithGenres < 3) return [];
  return [...weights.values()].sort(byCountThenName).slice(0, limit).map((e) => e.name);
}

/** Unpicked sets in the given genres that have not ended, best match first. */
export function discoverSets(o: {
  sets: readonly FestivalSet[];
  picks: Picks;
  genres: readonly string[];
  days: readonly FestivalDay[];
  timeZone: string | null;
  nowMs: number;
  limit?: number;
}): FestivalSet[] {
  const rank = new Map(o.genres.map((g, i) => [norm(g), i]));
  const scored: { set: FestivalSet; score: number }[] = [];
  for (const set of o.sets) {
    if (o.picks?.[set.id]) continue;
    let score = 0;
    for (const g of setGenres(set)) {
      const r = rank.get(norm(g));
      if (r !== undefined) score += o.genres.length - r;
    }
    if (score === 0) continue;
    const endMs = getSetTimeBounds(set, o.days, o.timeZone ?? undefined)?.endMs;
    if (endMs !== undefined && endMs <= o.nowMs) continue;
    scored.push({ set, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.set.dayIndex ?? Infinity) - (b.set.dayIndex ?? Infinity) ||
      byStartTime(a.set, b.set) ||
      artistDisplayName(a.set).localeCompare(artistDisplayName(b.set), undefined, { sensitivity: 'base' }),
  );
  return scored.slice(0, o.limit ?? 10).map((s) => s.set);
}

/** Resolves server co-pick ids to sets, in server order, without the user's own picks. */
export function pickAlsoPicked(
  setIds: readonly string[],
  sets: readonly FestivalSet[],
  picks: Picks,
  limit = 3,
): FestivalSet[] {
  const byId = new Map(sets.map((s) => [s.id, s]));
  const out: FestivalSet[] = [];
  for (const id of setIds) {
    const set = byId.get(id);
    if (set && !picks?.[id]) out.push(set);
    if (out.length >= limit) break;
  }
  return out;
}
