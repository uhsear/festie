import type { FestivalDay, FestivalSet, LineupEntry, Stage } from '../types/domain';
import { formatTime } from './format';
import { lineupNameKey, type LineupCover } from './lineupCover';
import { byStartTime, formatDayChip } from './scheduleFormat';
import { foldSearch } from './setSearch';

// Everything the attendee lineup (web today, mobile from phase A5) decides: the badge on a row, the
// header counts, search, which rows show on which day, and how they group. Web and mobile render
// the result, so the two cannot drift. The cover rule itself lives in lineupCover.ts.

const DAY_MS = 86_400_000;
/** An act announced within this many days of now carries the "New" badge. */
export const LINEUP_NEW_DAYS = 14;

/** A festival day with the sets that fall on it. */
export type LineupDay = FestivalDay & { sets: FestivalSet[] };

/** The store keeps sets flat with a `dayIndex`; the cover rule wants them under their day. */
export function lineupDays(days: FestivalDay[], sets: FestivalSet[]): LineupDay[] {
  return days.map((day, index) => ({ ...day, sets: sets.filter((set) => set.dayIndex === index) }));
}

/** The poster name, or the artists joined with the festival's B2B separator. */
export function lineupEntryName(entry: LineupEntry, separator?: string): string {
  return entry.displayName || entry.artists.map((artist) => artist.name).join(` ${separator || 'b2b'} `);
}

export type LineupBadgeKind = 'cancelled' | 'day-tba' | 'stage-time-tba' | 'not-on-timetable' | 'new';

export interface LineupBadge {
  kind: LineupBadgeKind;
  text: string;
}

/**
 * The badges on one row. A scheduled act has no status badge: its row names its day, stage and time.
 * "New" means announced in the last 14 days and after the festival was published, so acts that were
 * loaded as a draft are not "New" at publish. A re-paste keeps `announcedAt`, so it adds no "New".
 * `announcedAt` is a festival-zone date and `publishedAt` an instant, so the comparison can be a day off.
 */
export function lineupEntryBadge(
  entry: LineupEntry,
  cover: LineupCover,
  days: readonly Pick<LineupDay, 'label' | 'date' | 'sets'>[],
  publishedAt: string | null | undefined,
  now: number,
): LineupBadge[] {
  if (cover.state === 'cancelled') return [{ kind: 'cancelled', text: 'Cancelled' }];
  const badges: LineupBadge[] = [];
  if (cover.state === 'announced') {
    const hasSets = (day: Pick<LineupDay, 'sets'>) => (day.sets ?? []).length > 0;
    const day = cover.dayIndex >= 0 ? days[cover.dayIndex] : undefined;
    if (day) {
      badges.push(
        hasSets(day)
          ? { kind: 'not-on-timetable', text: 'Not on the timetable yet' }
          : { kind: 'stage-time-tba', text: `${formatDayChip(day).label} · Stage and time TBA` },
      );
    } else {
      badges.push(
        days.length > 0 && days.every(hasSets)
          ? { kind: 'not-on-timetable', text: 'Not on the timetable yet' }
          : { kind: 'day-tba', text: 'Day TBA' },
      );
    }
  }
  const announced = Date.parse(`${entry.announcedAt}T00:00:00Z`);
  const published = publishedAt?.slice(0, 10);
  if (
    published &&
    Number.isFinite(announced) &&
    entry.announcedAt > published &&
    now - announced <= LINEUP_NEW_DAYS * DAY_MS
  ) {
    badges.push({ kind: 'new', text: 'New' });
  }
  return badges;
}

export interface LineupSummary {
  /** Acts that are not cancelled. */
  total: number;
  /** Acts covered by at least one set, timed or not. */
  scheduled: number;
  cancelled: number;
  /** "118 acts announced · Set times TBA", or "31 of 118 acts are on the timetable". */
  header: string;
}

export function lineupSummary(lineup: readonly LineupEntry[], cover: Record<string, LineupCover>): LineupSummary {
  let scheduled = 0;
  let cancelled = 0;
  for (const entry of lineup) {
    const state = cover[entry.id]?.state;
    if (state === 'cancelled') cancelled += 1;
    else if (state === 'scheduled') scheduled += 1;
  }
  const total = lineup.length - cancelled;
  const acts = `${total} ${total === 1 ? 'act' : 'acts'}`;
  const header = scheduled === 0 ? `${acts} announced · Set times TBA` : `${scheduled} of ${acts} are on the timetable`;
  return { total, scheduled, cancelled, header };
}

/** Case- and accent-insensitive substring match on the poster name and on every artist name. */
export function lineupEntryMatchesSearch(entry: LineupEntry, query: string): boolean {
  const q = foldSearch(query.trim());
  if (!q) return true;
  if (entry.displayName && foldSearch(entry.displayName).includes(q)) return true;
  return entry.artists.some((artist) => foldSearch(artist.name).includes(q));
}

/** Announced acts that match a search, across every day, for the "Announced acts" group under set results. */
export function searchLineupEntries(
  lineup: readonly LineupEntry[],
  cover: Record<string, LineupCover>,
  query: string,
): LineupEntry[] {
  if (!query.trim()) return [];
  return lineup.filter((entry) => cover[entry.id]?.state === 'announced' && lineupEntryMatchesSearch(entry, query));
}

/** The sets that cover an entry, earliest first: by day, then start time, with untimed sets last. */
export function lineupCoveringSets(cover: LineupCover, sets: readonly FestivalSet[]): FestivalSet[] {
  const ids = new Set(cover.setIds);
  return sets
    .filter((set) => ids.has(set.id))
    .sort((a, b) => (a.dayIndex ?? 0) - (b.dayIndex ?? 0) || byStartTime(a, b));
}

/** "Fri · 10:00 PM · Main Stage", or "Fri · Main Stage · Time TBA" when the set has no start time. */
export function lineupSetWhen(set: FestivalSet, days: readonly FestivalDay[], stages: readonly Stage[]): string {
  const day = typeof set.dayIndex === 'number' ? days[set.dayIndex] : undefined;
  const stage = stages.find((s) => s.id === set.stageId)?.name;
  const time = formatTime(set.startTime);
  return [day ? formatDayChip(day).label : null, ...(time ? [time, stage] : [stage, 'Time TBA'])]
    .filter(Boolean)
    .join(' · ');
}

export interface LineupSelection {
  /** Entries to list, billing order, entries for the selected day first. */
  active: LineupEntry[];
  /** Cancelled entries, listed at the end. */
  cancelled: LineupEntry[];
}

/**
 * Which entries show for the selected day. An entry whose date resolves to the day shows, then the
 * "Day TBA" entries on every day tab. By default only entries without a set show; `fullLineup` adds
 * the scheduled ones, which belong to the day of their earliest set.
 */
export function selectLineupEntries(
  lineup: readonly LineupEntry[],
  cover: Record<string, LineupCover>,
  sets: readonly FestivalSet[],
  options: { dayIndex: number; fullLineup: boolean },
): LineupSelection {
  const own: LineupEntry[] = [];
  const undated: LineupEntry[] = [];
  const cancelled: LineupEntry[] = [];
  for (const entry of lineup) {
    const c = cover[entry.id];
    if (!c) continue;
    if (c.state === 'scheduled' && !options.fullLineup) continue;
    const dayIndex = c.state === 'scheduled' ? (lineupCoveringSets(c, sets)[0]?.dayIndex ?? -1) : c.dayIndex;
    if (dayIndex !== options.dayIndex && dayIndex !== -1) continue;
    (c.state === 'cancelled' ? cancelled : dayIndex === -1 ? undated : own).push(entry);
  }
  return { active: [...own, ...undated], cancelled };
}

/** Poster view: entries grouped by tier, 1 first and no tier last. Billing order holds inside a tier. */
export function groupLineupByTier(entries: readonly LineupEntry[]): { tier: number | null; entries: LineupEntry[] }[] {
  const groups = new Map<number | null, LineupEntry[]>();
  for (const entry of entries) groups.set(entry.tier, [...(groups.get(entry.tier) ?? []), entry]);
  return [...groups.entries()]
    .map(([tier, list]) => ({ tier, entries: list }))
    .sort((a, b) => (a.tier ?? Infinity) - (b.tier ?? Infinity));
}

/** A-Z view: entries by name key under letter headings, "#" for names that start with a digit or symbol. */
export function groupLineupAlphabetically(
  entries: readonly LineupEntry[],
  separator?: string,
): { letter: string; entries: LineupEntry[] }[] {
  const keyed = entries
    .map((entry) => ({ entry, key: lineupNameKey(lineupEntryName(entry, separator)) }))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: 'base' }));
  const groups: { letter: string; entries: LineupEntry[] }[] = [];
  for (const { entry, key } of keyed) {
    const first = key.charAt(0);
    const letter = /\p{L}/u.test(first) ? first.toLocaleUpperCase() : '#';
    const last = groups[groups.length - 1];
    if (last?.letter === letter) last.entries.push(entry);
    else groups.push({ letter, entries: [entry] });
  }
  return groups;
}
