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
 * A match test for one search query, or null for a blank query (which matches everything). Case-, accent-,
 * punctuation- and space-insensitive substring: "jay z" finds "Jay-Z", "above beyond" finds "Above&Beyond",
 * "dont stop" finds "Don't Stop". A query that is all punctuation matches literally, so a lone "&" finds
 * "Above & Beyond" and never becomes the empty match-everything query.
 */
export function searchMatcher(query: string): ((text: string) => boolean) | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const key = /[\p{L}\p{N}]/u.test(trimmed)
    ? (s: string) => foldLetters(s).replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, '')
    : (s: string) => foldLetters(s).replace(/\s+/g, '');
  const needle = key(trimmed);
  return (text) => key(text).includes(needle);
}

/** Every artist name in one string, so "illenium slander" finds a B2B set without the separator word. */
export const joinedArtistNames = (artists: readonly { name: string }[] | undefined): string =>
  (artists ?? []).map((a) => a.name).join(' ');

/**
 * Lineup search match, shared by web and mobile. Case-, accent-, punctuation- and space-insensitive substring
 * match on the headline artist, any B2B artist name, or the stage name. An
 * empty (or whitespace-only) query matches every set.
 */
export function setMatchesSearch(set: FestivalSet, query: string, stages: Stage[]): boolean {
  const matches = searchMatcher(query);
  if (!matches) return true;
  if (set.artist && matches(set.artist)) return true;
  if (set.displayName && matches(set.displayName)) return true;
  if (set.artists?.some((a) => matches(a.name))) return true;
  if (matches(joinedArtistNames(set.artists))) return true;
  const stageName = stages.find((s) => s.id === set.stageId)?.name;
  return stageName ? matches(stageName) : false;
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
