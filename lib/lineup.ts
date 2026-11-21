// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The announced lineup (festivals.lineup): name keys, cover rule and save-time normalising.
 * The root backend cannot import @festie/shared at run time (scripts/build.mjs marks packages
 * external), so packages/shared/src/utils/lineupCover.ts holds a copy. Both run against
 * tests/fixtures/lineup-cover.json so they cannot drift.
 */

import { sanitizeString, sanitizeIdentifier, sanitizeLinkRecord } from './helpers/sanitize';
import { withTransaction } from './db/connection';
import { lockFestival } from './db/stores/festival-lock';

export const MAX_LINEUP_ENTRIES = 500;
const MAX_LINKED_SETS = 10;

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

/**
 * The fold core: lineupFoldKey, then "&" as "and", apostrophes and periods deleted, other symbols as
 * spaces. It keeps a leading "the". An empty result falls back to the lower-cased input.
 * artistNameKey (lib/artist-key.ts) uses it as is.
 */
export function foldNameCore(name: string): string {
  const folded = lineupFoldKey(name)
    .replace(/&/g, ' and ')
    .replace(/['.]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
  return folded || String(name ?? '').trim().toLowerCase();
}

/** Folds a name for matching: "Zed's Dead" = "Zeds Dead", "roi*" = "roi", "The X" = "X". */
export function lineupNameKey(name: string): string {
  return foldNameCore(name).replace(/^the (?=\S)/, '');
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
    const artists = (entry.artists ?? []).map((artist: any) => {
      const artistId = sanitizeIdentifier(artist.id, 100);
      return {
        ...(artistId ? { id: artistId } : {}),
        name: sanitizeString(artist.name, 300),
        links: sanitizeLinkRecord(artist.links),
      };
    });
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
function entryDayIndex(entry: any, days: any[]): number {
  if (!entry?.dayDate) return -1;
  return (days ?? []).findIndex((day) => day?.date === entry.dayDate);
}

type LineupState = 'announced' | 'scheduled' | 'cancelled';

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

const MAX_INTEREST_SETS = 10;
// A release-day import can convert thousands of profiles; announce reads them this many at a time.
const ANNOUNCE_CHUNK = 50;

export interface InterestMark {
  state: 'open' | 'converted';
  /** Set ids that covered the act when it converted, at most MAX_INTEREST_SETS. */
  sets?: string[];
  /** The subset of `sets` that conversion itself picked. Import undo and the converted-pick guard read it. */
  added?: string[];
  /** When the server converted it (ISO). The converted-pick guard reads it. */
  at?: string;
}

export interface InterestPlan {
  marks: Record<string, InterestMark>;
  /** Picks to insert: set id to 'want-to-see'. Never a set the profile already picked. */
  added: Record<string, 'want-to-see'>;
  changed: boolean;
}

/**
 * What conversion does for one profile. A converted mark whose sets are all gone reopens (an organizer
 * who fixes a slot deletes and re-adds the set, which makes a new id). An open mark on a covered,
 * non-cancelled entry becomes `converted` with want-to-see picks on every covering set. A pick the
 * profile already has stays as it is. An entry that would take the profile past maxPicks stays open.
 */
export function planInterestConversion(input: {
  marks: Record<string, InterestMark>;
  picks: Record<string, string>;
  cover: Record<string, LineupCover>;
  existingSetIds: ReadonlySet<string>;
  maxPicks: number;
  now: string;
}): InterestPlan {
  const { marks, picks, cover, existingSetIds, maxPicks, now } = input;
  const next: Record<string, InterestMark> = { ...marks };
  const added: Record<string, 'want-to-see'> = {};
  let pickCount = Object.keys(picks).length;
  let changed = false;
  for (const [entryId, mark] of Object.entries(marks)) {
    const entryCover = cover[entryId];
    if (!entryCover) continue;
    if (mark.state === 'converted') {
      if ((mark.sets ?? []).some((setId) => existingSetIds.has(setId))) continue;
      next[entryId] = { state: 'open' };
      changed = true;
    }
    if (entryCover.state !== 'scheduled') continue;
    const setIds = entryCover.setIds.slice(0, MAX_INTEREST_SETS);
    const fresh = setIds.filter((setId) => !(setId in picks) && !(setId in added));
    if (pickCount + fresh.length > maxPicks) continue;
    for (const setId of fresh) added[setId] = 'want-to-see';
    pickCount += fresh.length;
    next[entryId] = { state: 'converted', sets: setIds, added: fresh, at: now };
    changed = true;
  }
  return { marks: next, added, changed };
}

/**
 * Server-side conversion of interest marks into picks, run after commit by every writer that can add a
 * set or change names. It locks the festival row, so a concurrent save waits and every set id it reads
 * still exists. A failure is logged and leaves marks as they were: it never fails the writer.
 */
export function createInterestConversion({ pool, stores, emitter, log, config }: any) {
  /** Tells a user's open devices their marks or picks changed. A failure is logged only. */
  async function announce(profileIds: string[]) {
    if (profileIds.length === 0) return;
    try {
      const profiles: any[] = [];
      for (let i = 0; i < profileIds.length; i += ANNOUNCE_CHUNK) {
        const chunk = await Promise.all(profileIds.slice(i, i + ANNOUNCE_CHUNK).map((id) => stores.profiles.getById(id)));
        profiles.push(...chunk.filter(Boolean));
      }
      const users = await stores.users.getByIds([...new Set(profiles.map((p: any) => p.userId).filter(Boolean))]);
      for (const profile of profiles) {
        emitter.profileUpdated({ profile, user: users.get(profile.userId) ?? null, changedFields: { interests: true } });
      }
    } catch (error: any) {
      log.warn('interest announce failed', { error: error?.message });
    }
  }

  async function convertInTransaction(client: any, festivalId: string): Promise<string[]> {
    const locked = await lockFestival(client, festivalId);
    if (!locked?.published_at) return [];
    const festival = await stores.festivals.getById(festivalId, client);
    if (!festival?.lineup?.length) return [];
    const days = festival.days ?? [];
    const cover = coverLineup(festival.lineup, days, festival.b2bSeparator || 'b2b');
    const existingSetIds = new Set<string>(days.flatMap((day: any) => (day.sets ?? []).map((set: any) => set.id)));
    const { rows } = await client.query(
      `
      SELECT
        fp.id,
        fp.interests_json AS marks,
        COALESCE(
          (
            SELECT
              jsonb_object_agg(p.set_id, p.priority)
            FROM
              festival_profile_picks p
            WHERE
              p.profile_id = fp.id
          ),
          '{}'::jsonb
        ) AS picks
      FROM
        festival_profiles fp
      WHERE
        fp.festival_id = $1
        AND fp.deleted_at IS NULL
        AND fp.interests_json <> '{}'::jsonb
      ORDER BY
        fp.id
      FOR UPDATE OF
        fp
    `,
      [festivalId],
    );
    const now = new Date().toISOString();
    const changedIds: string[] = [];
    for (const row of rows) {
      const plan = planInterestConversion({
        marks: row.marks,
        picks: row.picks,
        cover,
        existingSetIds,
        maxPicks: config.MAX_PICKS,
        now,
      });
      if (!plan.changed) continue;
      const addedIds = Object.keys(plan.added);
      if (addedIds.length > 0) {
        await client.query(
          `INSERT INTO festival_profile_picks (profile_id, set_id, priority)
           SELECT $1, s, 'want-to-see' FROM unnest($2::text[]) AS s
           ON CONFLICT (profile_id, set_id) DO NOTHING`,
          [row.id, addedIds],
        );
      }
      // The new picks go first, so a pick the mirror already holds keeps its priority.
      await client.query(
        `
  UPDATE festival_profiles
  SET
    interests_json = $2::jsonb,
    picks_json = $3::jsonb || COALESCE(picks_json, '{}'::jsonb),
    updated_at = NOW()
  WHERE
    id = $1
`,
        [row.id, JSON.stringify(plan.marks), JSON.stringify(plan.added)],
      );
      changedIds.push(row.id);
    }
    return changedIds;
  }

  async function convertOnce(festivalId: string): Promise<number> {
    let changedIds: string[];
    try {
      changedIds = await withTransaction(pool, (client) => convertInTransaction(client, festivalId));
    } catch (error: any) {
      log.warn('interest conversion failed', { festivalId, error: error?.message });
      return 0;
    }
    await announce(changedIds);
    return changedIds.length;
  }

  // shortcut: in-flight state is per process (PM2 runs one instance), upgrade to an advisory lock if the app scales out.
  const running = new Map<string, { dirty: boolean; done: Promise<number> }>();

  /**
   * Resolves to the number of profiles whose marks changed. Calls for one festival coalesce: while a run
   * is in flight, further calls mark it dirty and share one trailing run, so a burst costs at most two
   * transactions on the festival lock.
   */
  function convert(festivalId: string): Promise<number> {
    const active = running.get(festivalId);
    if (active) {
      active.dirty = true;
      return active.done;
    }
    const state = { dirty: false, done: Promise.resolve(0) };
    state.done = (async () => {
      let changed = 0;
      try {
        do {
          state.dirty = false;
          changed += await convertOnce(festivalId);
        } while (state.dirty);
      } finally {
        running.delete(festivalId);
      }
      return changed;
    })();
    running.set(festivalId, state);
    return state.done;
  }

  return { convert, announce };
}
