// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The announced lineup (festivals.lineup): name keys, cover rule and save-time normalising.
 * The root backend cannot import @festie/shared at run time (scripts/build.mjs marks packages
 * external), so packages/shared/src/utils/lineupCover.ts holds a copy. Both run against
 * tests/fixtures/lineup-cover.json so they cannot drift.
 */

import { sanitizeString, sanitizeIdentifier, sanitizeLinkRecord } from './helpers/sanitize';

export const MAX_LINEUP_ENTRIES = 500;
export const MAX_LINKED_SETS = 10;

const KEY_SEPARATOR = '\u0001';

/** The fold core: accents, case, curly quotes and spacing only. "The X" and "X" stay apart, so imports never merge them. */
export function lineupFoldKey(name: string): string {
  return String(name ?? '')
    .normalize('NFKD')
    // Marks go only after Latin, Greek or Cyrillic letters, so Japanese and Indic marks keep names apart.
    // Explicit ranges, no lookbehind or Script= escapes: this runs in the mobile bundle too.
    .replace(/([A-Za-z\u00c0-\u024f\u1e00-\u1eff\u0370-\u03ff\u1f00-\u1fff\u0400-\u04ff])\p{M}+/gu, '$1')
    .toLowerCase()
    .replace(/[’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Folds a name for matching: "Zed's Dead" = "Zeds Dead", "roi*" = "roi", "The X" = "X". */
export function lineupNameKey(name: string): string {
  const folded = lineupFoldKey(name)
    .replace(/&/g, ' and ')
    .replace(/['.]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
  if (!folded) return String(name ?? '').trim().toLowerCase();
  return folded.replace(/^the (?=\S)/, '');
}

/** One billing line is one key: the sorted name keys of its artists, so B2B order does not matter. */
export function lineupEntryKey(entry: any): string {
  const keys = (entry?.artists ?? []).map((artist: any) => lineupNameKey(artist?.name));
  return [...new Set<string>(keys)].sort().join(KEY_SEPARATOR);
}

/** The date in the festival's zone, so "announced today" matches the organizer's calendar. */
export function todayInZone(timeZone: string | null | undefined, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts;
  } catch {
    // An unknown zone id falls back to UTC below.
  }
  return now.toISOString().slice(0, 10);
}

export interface LineupIssue {
  code: 'lineup_duplicate' | 'lineup_id_duplicate';
  message: string;
}

/** Duplicate ids and duplicate entry keys. Line numbers are 1-based positions in the list. */
export function lineupIssues(lineup: any): LineupIssue[] {
  if (!Array.isArray(lineup)) return [];
  const issues: LineupIssue[] = [];
  const byKey = new Map<string, number[]>();
  const byId = new Map<string, number[]>();
  lineup.forEach((entry: any, index: number) => {
    const key = lineupEntryKey(entry);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), index + 1]);
    const id = sanitizeIdentifier(entry?.id, 100);
    if (id) byId.set(id, [...(byId.get(id) ?? []), index + 1]);
  });
  const lines = (list: number[]) => list.join(', ');
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const name = (lineup[list[0]! - 1]?.artists ?? []).map((artist: any) => artist?.name).join(' b2b ');
    issues.push({
      code: 'lineup_duplicate',
      message: `The announced lineup lists "${name}" more than once (lines ${lines(list)}). Remove the extra line. Two acts with the same name need artist notes, which arrive with the artist repository.`,
    });
  }
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    issues.push({ code: 'lineup_id_duplicate', message: `Duplicate announced lineup id: ${id} (lines ${lines(list)})` });
  }
  return issues;
}

interface NormalizeContext {
  createId: (prefix: string) => string;
  today: string;
}

/**
 * Cleans an incoming lineup. Assumes lineupIssues found no duplicates.
 * An entry without an id takes the id and announcedAt of the stored entry with the same key, so a
 * re-paste keeps its identity. announcedAt is server-owned: known ids keep the stored value and new
 * ids get today's date.
 */
export function normalizeLineup(incoming: any[], stored: any[], ctx: NormalizeContext) {
  const storedById = new Map<string, any>();
  const storedByKey = new Map<string, any>();
  for (const entry of stored ?? []) {
    storedById.set(entry.id, entry);
    storedByKey.set(lineupEntryKey(entry), entry);
  }
  const taken = new Set((incoming ?? []).map((entry) => sanitizeIdentifier(entry?.id, 100)).filter(Boolean));
  return (incoming ?? []).slice(0, MAX_LINEUP_ENTRIES).map((entry: any) => {
    const artists = (entry.artists ?? []).map((artist: any) => ({
      name: sanitizeString(artist.name, 300),
      links: sanitizeLinkRecord(artist.links),
    }));
    let id = sanitizeIdentifier(entry.id, 100);
    let known = id ? storedById.get(id) : undefined;
    if (!id) {
      const match = storedByKey.get(lineupEntryKey({ artists }));
      if (match && !taken.has(match.id)) {
        id = match.id;
        known = match;
        taken.add(id);
      }
    }
    return {
      id: id || ctx.createId('lu'),
      artists,
      displayName: sanitizeString(entry.displayName ?? '', 300) || null,
      tier: entry.tier ?? null,
      dayDate: entry.dayDate ?? null,
      status: entry.status === 'cancelled' ? 'cancelled' : 'announced',
      announcedAt: known?.announcedAt || ctx.today,
      linkedSetIds: (entry.linkedSetIds ?? [])
        .map((setId: any) => sanitizeIdentifier(setId, 100))
        .filter(Boolean)
        .slice(0, MAX_LINKED_SETS),
    };
  });
}

/** Drops non-http(s) links from a stored lineup on read, whatever wrote the row. */
export function cleanLineupLinks(lineup: any): any[] {
  if (!Array.isArray(lineup)) return [];
  return lineup.map((entry: any) => ({
    ...entry,
    artists: (entry?.artists ?? []).map((artist: any) => ({ ...artist, links: sanitizeLinkRecord(artist?.links) })),
  }));
}

/** A set's artist names: its artists, or the flat name split on the separator and " b2b ". */
function setNames(set: any, separator: string): string[] {
  const names = (set?.artists ?? []).map((artist: any) => artist?.name).filter(Boolean);
  if (names.length > 0) return names;
  const flat = String(set?.artist ?? '').trim();
  if (!flat) return [];
  const escaped = (separator || 'b2b').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return flat.split(new RegExp(`\\s+(?:${escaped}|b2b)\\s+`, 'i')).map((name) => name.trim()).filter(Boolean);
}

/** The index of the first day whose date equals dayDate, or -1 for Day TBA or a removed day. */
export function entryDayIndex(entry: any, days: any[]): number {
  if (!entry?.dayDate) return -1;
  return (days ?? []).findIndex((day) => day?.date === entry.dayDate);
}

export type LineupState = 'announced' | 'scheduled' | 'cancelled';

export interface LineupCover {
  setIds: string[];
  state: LineupState;
  dayIndex: number;
}

/**
 * Which sets cover each entry. A set covers an entry when both name-key sets are equal, or when
 * the set id is in the entry's linkedSetIds. A cancelled entry is never "scheduled".
 */
export function coverLineup(lineup: any[], days: any[], separator: string): Record<string, LineupCover> {
  const setsByKey = new Map<string, string[]>();
  const existingIds = new Set<string>();
  for (const day of days ?? []) {
    for (const set of day?.sets ?? []) {
      existingIds.add(set.id);
      const key = lineupEntryKey({ artists: setNames(set, separator).map((name) => ({ name })) });
      if (key) setsByKey.set(key, [...(setsByKey.get(key) ?? []), set.id]);
    }
  }
  const cover: Record<string, LineupCover> = {};
  for (const entry of lineup ?? []) {
    const ids = new Set<string>(setsByKey.get(lineupEntryKey(entry)) ?? []);
    for (const id of entry.linkedSetIds ?? []) if (existingIds.has(id)) ids.add(id);
    const setIds = [...ids];
    const state: LineupState = entry.status === 'cancelled' ? 'cancelled' : setIds.length > 0 ? 'scheduled' : 'announced';
    cover[entry.id] = { setIds, state, dayIndex: entryDayIndex(entry, days) };
  }
  return cover;
}

export interface ActsDayCoverage {
  /** Acts that are not cancelled, plus the sets that no listed act covers. */
  actsTotal: number;
  /** Acts on the timetable or with a day of their own. Every set sits on a day. */
  actsWithDay: number;
}

/** How many acts have a day. A set that covers an act counts once, as that act. */
export function actsDayCoverage(festival: any): ActsDayCoverage {
  const days: any[] = festival?.days ?? [];
  const lineup: any[] = Array.isArray(festival?.lineup) ? festival.lineup : [];
  const cover = coverLineup(lineup, days, festival?.b2bSeparator || 'b2b');
  const coveredSetIds = new Set<string>();
  let actsTotal = 0;
  let actsWithDay = 0;
  for (const entry of lineup) {
    const placed = cover[entry.id];
    if (!placed) continue;
    placed.setIds.forEach((id) => coveredSetIds.add(id));
    if (placed.state === 'cancelled') continue;
    actsTotal += 1;
    if (placed.state === 'scheduled' || placed.dayIndex >= 0) actsWithDay += 1;
  }
  for (const day of days) {
    for (const set of day?.sets ?? []) {
      if (coveredSetIds.has(set.id)) continue;
      actsTotal += 1;
      actsWithDay += 1;
    }
  }
  return { actsTotal, actsWithDay };
}

export type ScheduleProgress = 'times' | 'days' | 'lineup';

/** How far a festival's schedule has come, for the picker badge. Null when it has no acts at all. */
export function scheduleProgress(festival: any): ScheduleProgress | null {
  const timed = (festival?.days ?? []).some((day: any) =>
    (day?.sets ?? []).some((set: any) => typeof set?.startTime === 'string' && set.startTime !== ''),
  );
  if (timed) return 'times';
  const { actsTotal, actsWithDay } = actsDayCoverage(festival);
  if (actsWithDay > 0) return 'days';
  return actsTotal > 0 ? 'lineup' : null;
}
