import type { FestivalSet } from '../types/domain';
import { festivalStartMinutes } from './setStatus';

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
