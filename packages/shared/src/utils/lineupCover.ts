import type { LineupEntry } from '../types/domain';

// The announced lineup's name key, cover rule and day resolution. lib/lineup.ts (root backend) holds
// a copy because the server cannot import this package at run time. Both run against
// tests/fixtures/lineup-cover.json, so they cannot drift.

const KEY_SEPARATOR = '\u0001';

/** Folds a name for matching: "Zed's Dead" = "Zeds Dead", "roi*" = "roi", "The X" = "X". */
export function lineupNameKey(name: string): string {
  const folded = String(name ?? '')
    .normalize('NFKD')
    // Marks go only after Latin, Greek or Cyrillic letters, so Japanese and Indic marks keep names apart.
    .replace(/(?<=[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’ʼ.]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
  if (!folded) return String(name ?? '').trim().toLowerCase();
  return folded.replace(/^the (?=\S)/, '');
}

/** One billing line is one key: the sorted name keys of its artists, so B2B order does not matter. */
export function lineupEntryKey(entry: { artists?: { name: string }[] }): string {
  const keys = (entry.artists ?? []).map((artist) => lineupNameKey(artist.name));
  return [...new Set(keys)].sort().join(KEY_SEPARATOR);
}

export type LineupState = 'announced' | 'scheduled' | 'cancelled';

export interface LineupCover {
  /** Ids of the sets that cover the entry, including hand-linked ones that still exist. */
  setIds: string[];
  state: LineupState;
  /** Index into `days`, or -1 for "Day TBA" and for a dayDate that matches no day. */
  dayIndex: number;
}

type CoverDay = { date?: string; sets?: CoverSet[] };
type CoverSet = { id: string; artist?: string; artists?: { name: string }[] };

/** The first day whose date equals the entry's dayDate. A removed or re-dated day gives -1. */
export function entryDayIndex(entry: Pick<LineupEntry, 'dayDate'>, days: { date?: string }[]): number {
  if (!entry.dayDate) return -1;
  return days.findIndex((day) => day.date === entry.dayDate);
}

/** A set's artist names: its artists, or the flat name split on the separator and " b2b ". */
function setNames(set: CoverSet, separator: string): string[] {
  const names = (set.artists ?? []).map((artist) => artist.name).filter(Boolean);
  if (names.length > 0) return names;
  const flat = (set.artist ?? '').trim();
  if (!flat) return [];
  const escaped = (separator || 'b2b').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return flat
    .split(new RegExp(`\\s+(?:${escaped}|b2b)\\s+`, 'i'))
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Which sets cover each entry, keyed by entry id. A set covers an entry when both name-key sets are
 * equal (not a subset), or when its id is in the entry's linkedSetIds. A cancelled entry is never
 * "scheduled", but it still lists the sets that cover it.
 */
export function coverLineup(
  lineup: LineupEntry[],
  days: CoverDay[],
  separator: string,
): Record<string, LineupCover> {
  const setsByKey = new Map<string, string[]>();
  const existingIds = new Set<string>();
  for (const day of days) {
    for (const set of day.sets ?? []) {
      existingIds.add(set.id);
      const key = lineupEntryKey({ artists: setNames(set, separator).map((name) => ({ name })) });
      if (key) setsByKey.set(key, [...(setsByKey.get(key) ?? []), set.id]);
    }
  }
  const cover: Record<string, LineupCover> = {};
  for (const entry of lineup) {
    const ids = new Set<string>(setsByKey.get(lineupEntryKey(entry)) ?? []);
    for (const id of entry.linkedSetIds ?? []) if (existingIds.has(id)) ids.add(id);
    const setIds = [...ids];
    const state: LineupState =
      entry.status === 'cancelled' ? 'cancelled' : setIds.length > 0 ? 'scheduled' : 'announced';
    cover[entry.id] = { setIds, state, dayIndex: entryDayIndex(entry, days) };
  }
  return cover;
}
