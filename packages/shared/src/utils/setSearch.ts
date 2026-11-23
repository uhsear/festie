import type { FestivalSet, Stage } from '../types/domain';
import { byStartTime } from './scheduleFormat';

const LETTER_FOLDS: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd' };

/** Lowercase and strip diacritics, and fold the letters NFD leaves alone, so "Orjan" finds "Ørjan". */
export const foldLetters = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[øæœßłđ]/g, (c) => LETTER_FOLDS[c]!);

/**
 * foldLetters plus no punctuation, so "dr strangelove" finds "Dr. Strangelove & The Orchestra".
 * A string that is all punctuation keeps it, so a lone "&" never turns into the empty match-everything query.
 */
export const foldSearch = (s: string): string => {
  const folded = foldLetters(s);
  return folded.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim() || folded;
};

/** Every artist name in one string, so "illenium slander" finds a B2B set without the separator word. */
export const joinedArtistNames = (artists: readonly { name: string }[] | undefined): string =>
  (artists ?? []).map((a) => a.name).join(' ');

/**
 * Lineup search match, shared by web and mobile. Case-, accent- and punctuation-insensitive substring
 * match on the headline artist, any B2B artist name, or the stage name. An
 * empty (or whitespace-only) query matches every set.
 */
export function setMatchesSearch(set: FestivalSet, query: string, stages: Stage[]): boolean {
  const q = foldSearch(query.trim());
  if (!q) return true;
  if (set.artist && foldSearch(set.artist).includes(q)) return true;
  if (set.displayName && foldSearch(set.displayName).includes(q)) return true;
  if (set.artists?.some((a) => foldSearch(a.name).includes(q))) return true;
  if (foldSearch(joinedArtistNames(set.artists)).includes(q)) return true;
  const stageName = stages.find((s) => s.id === set.stageId)?.name;
  return stageName ? foldSearch(stageName).includes(q) : false;
}

/**
 * Search matches on every day except `selectedDay`, grouped by day in ascending
 * order and sorted by start time (TBA last). Ignores the stage and "my picks"
 * filters on purpose: the user is looking for an artist. A blank query returns
 * no groups.
 */
export function searchOtherDays(
  sets: FestivalSet[],
  query: string,
  selectedDay: number,
  stages: Stage[],
): Array<{ dayIndex: number; sets: FestivalSet[] }> {
  if (!query.trim()) return [];
  const byDay = new Map<number, FestivalSet[]>();
  for (const set of sets) {
    if (set.dayIndex == null || set.dayIndex === selectedDay) continue;
    if (!setMatchesSearch(set, query, stages)) continue;
    const group = byDay.get(set.dayIndex);
    if (group) group.push(set);
    else byDay.set(set.dayIndex, [set]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayIndex, daySets]) => ({ dayIndex, sets: daySets.sort(byStartTime) }));
}
