import type { FestivalDay, FestivalSet } from '../types/domain';
import { artistDisplayName, formatTime } from './format';
import { logicalDayIndexAt } from './dayOf';
import { createDateInLocalFrame, festivalStartMinutes, getSetTimeBounds } from './setStatus';
import type { SetStatusResult } from './setStatus';
import { primarySpotifyArtist } from './links';

/**
 * Schedule-display helpers shared by both the mobile festival surfaces
 * (NowNextStrip, festival-mode, TimelineView) and any web equivalents that need
 * the same formatted output. All functions are pure and platform-agnostic.
 */

/**
 * Compact countdown label from a duration in **whole minutes**.
 *
 * Examples: 0 → "now", 25 → "in 25m", 90 → "in 1h 30m", 120 → "in 2h".
 *
 * Intentionally does NOT include the "starting now" variant used on the
 * festival-mode screen — that caller passes the same mins < 1 guard and
 * renders its own copy phrase; the shared output "now" is the neutral form.
 */
export function fmtCountdown(mins: number): string {
  if (mins < 1) return 'now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

/**
 * Ascending comparator for festival sets by start time within the festival day.
 *
 * A start before 06:00 belongs to the night before (`festivalStartMinutes`), so
 * `01:00` sorts after `23:30`. Sets with a startTime sort before sets without
 * one. Stable for `Array.sort`.
 * Used in the mobile timeline and crew-compare screens to order sets
 * chronologically; lifted here so both screens share an identical sort and web
 * can adopt it without duplicating the logic.
 */
export function byStartTime(a: FestivalSet, b: FestivalSet): number {
  const ta = a.startTime || '';
  const tb = b.startTime || '';
  if (ta && tb) return festivalStartMinutes(ta) - festivalStartMinutes(tb);
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  return 0;
}

/**
 * Compact "Artist — HH:MM" label for a set, used in the crew overlap list.
 *
 * Falls back to a truncated set id when the set is not found, so the UI always
 * has *something* to display rather than crashing or showing a blank row.
 */
export function setLabel(set: FestivalSet | undefined, fallbackId: string): string {
  if (!set) return `Set ${fallbackId.slice(0, 6)}`;
  const artist = set.artist ?? set.artists?.[0]?.name ?? `Set ${fallbackId.slice(0, 6)}`;
  const time = set.startTime ? ` — ${set.startTime}` : '';
  return `${artist}${time}`;
}

export interface DayChip {
  label: string;
  date: string | null;
  a11y: string;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Noon avoids any DST or UTC shift moving the weekday. */
function dayKeyDate(date: string | undefined | null): Date | null {
  const key = date?.slice(0, 10) ?? '';
  if (!DAY_KEY.test(key)) return null;
  const d = createDateInLocalFrame(key, 12, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Day chip text: label (or weekday), short date, and a screen-reader string. */
export function formatDayChip(day: Pick<FestivalDay, 'date' | 'label'>): DayChip {
  const d = dayKeyDate(day.date);
  const short = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  const long = d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : null;
  const label =
    day.label?.trim() || (d ? d.toLocaleDateString('en-US', { weekday: 'long' }) : '') || day.date || 'Day';
  const date = short && !label.includes(short) ? short : null;
  return { label, date, a11y: date && long ? `${label}, ${long}` : label };
}

/** 'Saturday, Nov 7', or the label alone when the day has no date. */
function dayHeading(day: Pick<FestivalDay, 'date' | 'label'>): string {
  const chip = formatDayChip(day);
  return chip.date ? `${chip.label}, ${chip.date}` : chip.label;
}

/** '3:00 PM - 3:55 PM', or the start alone, or '' with no start. Every set row shows this. */
export function formatSetTimeRange(set: Pick<FestivalSet, 'startTime' | 'endTime'>): string {
  const start = formatTime(set.startTime);
  const end = formatTime(set.endTime);
  return start && end ? `${start} - ${end}` : start;
}

/** 'Saturday, Nov 7 · 3:00 PM - 3:55 PM · In 2h' */
export function formatSetWhen(set: FestivalSet, days: FestivalDay[], status: SetStatusResult | null): string {
  const parts: string[] = [];
  const day = typeof set.dayIndex === 'number' ? days[set.dayIndex] : undefined;
  if (day) parts.push(dayHeading(day));
  parts.push(formatSetTimeRange(set) || 'Time TBA');
  if (status?.status === 'live') parts.push('Live now');
  else if (status?.status === 'soon' || status?.status === 'upcoming') parts.push(status.label);
  else if (status?.status === 'past') parts.push('Ended');
  return parts.join(' · ');
}

/** Time order for the cards, with sets already over today split off. */
export function splitCardsByNow(
  sets: FestivalSet[],
  opts: { days: FestivalDay[]; nowMs: number; timeZone?: string; separator?: string },
): { earlier: FestivalSet[]; rest: FestivalSet[] } {
  const { days, nowMs, timeZone, separator } = opts;
  const sorted = [...sets].sort(
    (a, b) =>
      byStartTime(a, b) ||
      artistDisplayName(a, separator).localeCompare(artistDisplayName(b, separator), undefined, {
        sensitivity: 'base',
      }),
  );
  const today = logicalDayIndexAt(days, nowMs, timeZone);
  if (today === null) return { earlier: [], rest: sorted };
  const earlier: FestivalSet[] = [];
  const rest: FestivalSet[] = [];
  for (const set of sorted) {
    const endMs = set.dayIndex === today ? getSetTimeBounds(set, days, timeZone)?.endMs : undefined;
    (endMs !== undefined && endMs <= nowMs ? earlier : rest).push(set);
  }
  return { earlier, rest };
}

/** Button text for the Reminder & note panel. */
export function reminderNoteSummary(minutes: number | null | undefined, hasNote: boolean, canRemind: boolean): string {
  const parts: string[] = [];
  if (canRemind) parts.push(minutes ? `Reminder ${minutes === 60 ? '1h' : `${minutes}m`} before` : 'Remind me');
  parts.push(hasNote ? 'Note added' : 'Add a note');
  return parts.join(' · ');
}

export interface ListenRow {
  setId: string;
  name: string;
  /** The primary artist's Spotify page (https only), or null. */
  spotifyUrl: string | null;
}

export interface ListenDay {
  label: string;
  rows: ListenRow[];
}

/** "Listen before you go": the given sets by festival day in time order, unscheduled last. Link-outs only, no user OAuth. */
export function buildListenList(sets: FestivalSet[], days: FestivalDay[], separator?: string): ListenDay[] {
  const byDay = new Map<number, ListenDay>();
  for (const set of [...sets].sort(byStartTime)) {
    const day = typeof set.dayIndex === 'number' ? days[set.dayIndex] : undefined;
    const key = day ? (set.dayIndex as number) : Number.MAX_SAFE_INTEGER;
    let group = byDay.get(key);
    if (!group) byDay.set(key, (group = { label: day ? dayHeading(day) : 'Unscheduled', rows: [] }));
    const url = primarySpotifyArtist(set)?.url ?? null;
    group.rows.push({
      setId: set.id,
      name: artistDisplayName(set, separator),
      spotifyUrl: url && /^https?:\/\//i.test(url) ? url : null,
    });
  }
  return [...byDay.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
}

/** Plain text for "Copy as text": a title line, then each day with one artist per line and its Spotify link. */
export function listenListText(festivalName: string, list: ListenDay[]): string {
  const lines = [`Listen before you go: ${festivalName}`];
  for (const day of list) {
    lines.push('', day.label);
    for (const row of day.rows) lines.push(row.spotifyUrl ? `- ${row.name}: ${row.spotifyUrl}` : `- ${row.name}`);
  }
  return lines.join('\n');
}
