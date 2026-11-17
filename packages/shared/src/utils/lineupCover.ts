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
    // Explicit ranges, no lookbehind or Script= escapes: this runs in the mobile bundle too.
    .replace(/([A-Za-z\u00c0-\u024f\u1e00-\u1eff\u0370-\u03ff\u1f00-\u1fff\u0400-\u04ff])\p{M}+/gu, '$1')
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

const SAMPLE = 3;
const nameList = (names: string[]) =>
  names.length > SAMPLE ? `${names.slice(0, SAMPLE).join(', ')} and ${names.length - SAMPLE} more` : names.join(', ');
const entryName = (e: LineupEntry) => e.displayName || e.artists.map((a) => a.name).join(' b2b ');

/**
 * Heads-up lines for the save summary, computed on the form state. `savedDays` are the days as
 * last saved; with them the check also names acts that this save unschedules by removing a set.
 */
export function lineupNotices(
  lineup: LineupEntry[],
  days: (CoverDay & { label?: string })[],
  separator: string,
  savedDays?: CoverDay[],
): string[] {
  const notices: string[] = [];
  const cover = coverLineup(lineup, days, separator);
  const unmatched = lineup.filter((e) => cover[e.id]!.state === 'announced');
  const anySets = days.some((d) => (d.sets ?? []).length > 0);
  if (anySets && unmatched.length > 0) {
    notices.push(
      `${unmatched.length} announced ${unmatched.length === 1 ? 'act has' : 'acts have'} no matching set: ${nameList(unmatched.map(entryName))}. Fix the spelling, or link the set by hand.`,
    );
  }
  if (savedDays) {
    const before = coverLineup(lineup, savedDays, separator);
    const lost = lineup.filter((e) => before[e.id]!.state === 'scheduled' && cover[e.id]!.state === 'announced');
    if (lost.length > 0) notices.push(`This save removes the set for ${nameList(lost.map(entryName))}. They go back to "Announced".`);
  }
  for (const entry of lineup) {
    const c = cover[entry.id]!;
    if (entry.status !== 'cancelled' || c.setIds.length === 0) continue;
    const label = days.find((d) => (d.sets ?? []).some((s) => c.setIds.includes(s.id)))?.label;
    notices.push(`${entryName(entry)} is cancelled but still has ${c.setIds.length} ${c.setIds.length === 1 ? 'set' : 'sets'}${label ? ` on ${label}` : ''}.`);
  }
  return notices;
}
