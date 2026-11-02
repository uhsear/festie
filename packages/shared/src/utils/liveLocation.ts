// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * liveLocation.ts — publish-throttle math shared by the web + mobile live-location
 * publishers. Keeping this in one place guarantees both platforms throttle GPS
 * publishes identically (and conservatively). Pure: no platform deps.
 */

import { haversineDistance } from './geo';
import {
  LIVE_LOCATION,
  LIVE_SHARE_COPY,
  LIVE_SHARE_DEFAULT_DURATION_ID,
  LIVE_SHARE_DURATIONS,
  LIVE_SHARE_MAX_MS,
} from '../constants/config';
import type { LiveShareEndReason } from '../stores/liveLocationStore';
import type { FestivalDay, FestivalSet, SosEntry } from '../types/domain';
import { fmtZonedClock, logicalDayEndAt, logicalDayIndexAt } from './dayOf';
import { getSetTimeBounds } from './setStatus';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Decide whether a freshly-read GPS fix should be published to the crew.
 *
 * Returns true when EITHER:
 *   • this is the first fix (no prior coord / no last-sent time), OR
 *   • at least UPDATE_INTERVAL_MS has elapsed since the last publish, OR
 *   • the device has moved more than MIN_MOVE_METERS since the last publish.
 *
 * This keeps a stationary phone quiet (battery + data) while still relaying
 * meaningful movement promptly. `now` and `lastSentAt` are epoch ms.
 */
export function shouldPublishLocation(
  prev: LatLng | null | undefined,
  next: LatLng,
  lastSentAt: number | null | undefined,
  now: number,
): boolean {
  if (!prev || lastSentAt == null) return true;
  if (now - lastSentAt >= LIVE_LOCATION.UPDATE_INTERVAL_MS) return true;
  const moved = haversineDistance(
    { latitude: prev.lat, longitude: prev.lng },
    { latitude: next.lat, longitude: next.lng },
  );
  return Number.isFinite(moved) && moved > LIVE_LOCATION.MIN_MOVE_METERS;
}

/**
 * Whether a peer's last fix is "stale" — older than the freshness window but not
 * yet swept (peers are removed entirely past STALE_MS). Drives the Snap Map-style
 * desaturated avatar + "last seen N ago" chip vs the pulsing "live" treatment.
 *
 * `serverAt` is the authoritative server-receive time (epoch ms or ISO string).
 * An unknown/invalid timestamp is treated as fresh so we never spuriously grey
 * out a marker we can't age. `now` is epoch ms.
 */
export function isPeerStale(
  serverAt: string | number | null | undefined,
  now: number,
  freshMs: number = LIVE_LOCATION.FRESH_MS,
): boolean {
  let ms: number;
  if (typeof serverAt === 'number') ms = serverAt;
  else if (typeof serverAt === 'string') ms = new Date(serverAt).getTime();
  else return false;
  if (!Number.isFinite(ms)) return false;
  return now - ms > freshMs;
}

// ── Phase 4C presentation helpers (heading / battery / share-window) ──────────
// Pure formatters shared by the web CrewMap + mobile OfflineMap peer renderers so
// a peer's direction-of-travel, battery, and remaining share window read
// identically on every surface. All total/defensive: absent/invalid => null so a
// caller can simply skip the chip.

/** 8-wind arrow glyphs, indexed by 45° sector starting at North (0° = ↑). */
const HEADING_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'] as const;

/**
 * Map a GPS course/heading (degrees clockwise from true north) to an 8-wind arrow
 * glyph for a direction-of-travel indicator. Returns null when heading is absent
 * or non-finite (a stationary fix often reports no heading) so callers render no
 * arrow rather than a misleading one.
 */
export function headingToArrow(heading: number | null | undefined): string | null {
  if (typeof heading !== 'number' || !Number.isFinite(heading)) return null;
  const norm = ((heading % 360) + 360) % 360;
  const idx = Math.round(norm / 45) % 8;
  return HEADING_ARROWS[idx]!; // idx is always 0–7 (% 8); noUncheckedIndexedAccess can't see it
}

/** At/below this battery %, the label nudges the crew to regroup before a dead phone. */
export const LOW_BATTERY_THRESHOLD = 20;

/**
 * Format a peer's battery level (0–100) for the popup, e.g. "85%" or, when low,
 * "8% — regroup". Returns null for absent/invalid/out-of-range so the chip is
 * simply omitted. Mobile reads expo-battery; web reads the Battery API where
 * present. Both send a level only when the sharer opts in.
 */
export function formatBatteryLabel(
  level: number | null | undefined,
  lowThreshold: number = LOW_BATTERY_THRESHOLD,
): string | null {
  if (typeof level !== 'number' || !Number.isFinite(level)) return null;
  const pct = Math.round(level);
  if (pct < 0 || pct > 100) return null;
  return pct <= lowThreshold ? `${pct}% — regroup` : `${pct}%`;
}

/** "42 min", "1 h 5 min" or "2 h". Rounds up to whole minutes, at least 1. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(1, Math.ceil(remainingMs / 60_000));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "Lost contact 12 min ago" (or "2 h ago") for a peer whose live fix was swept. */
export function lostContactLabel(lostAtMs: number, nowMs: number = Date.now()): string {
  const mins = Math.max(1, Math.floor((nowMs - lostAtMs) / 60_000));
  return mins < 60 ? `Lost contact ${mins} min ago` : `Lost contact ${Math.floor(mins / 60)} h ago`;
}

/**
 * Countdown for a time-boxed share, e.g. "sharing ends in 4 min". `expiresAt` is the
 * ISO timestamp (or epoch ms) the share auto-stops. Returns null when there is no
 * window or it has already elapsed (the peer is swept regardless) so callers show
 * nothing. Always rounds UP to whole minutes (never "ends in 0 min" while still live).
 */
export function formatShareWindow(
  expiresAt: string | number | null | undefined,
  now: number,
): string | null {
  if (expiresAt == null) return null;
  let ms: number;
  if (typeof expiresAt === 'number') ms = expiresAt;
  else if (typeof expiresAt === 'string') ms = new Date(expiresAt).getTime();
  else return null;
  if (!Number.isFinite(ms)) return null;
  const remaining = ms - now;
  if (remaining <= 0) return null;
  return `sharing ends in ${formatCountdown(remaining)}`;
}

export interface LiveShareOption {
  id: string;
  label: string;
  ms: number;
}

/**
 * The durations the sharer can pick. "Rest of today" ends with the logical festival
 * day (06:00 next morning) and shows only when that is over 1 hour and at most
 * LIVE_SHARE_MAX_MS away. It is the default when shown, else the 2 hour preset.
 */
/**
 * When "Rest of today" ends: 1 hour after the last set of the current festival
 * day, or at the end of that day (06:00) when it has no timed sets. Null outside
 * a festival day.
 */
export function restOfTodayEndAt(
  days: ReadonlyArray<Pick<FestivalDay, 'date'>>,
  sets: ReadonlyArray<Pick<FestivalSet, 'startTime' | 'endTime' | 'date' | 'dayIndex'>>,
  nowMs: number,
  timeZone?: string,
): number | null {
  const dayEnd = logicalDayEndAt(days, nowMs, timeZone);
  if (dayEnd == null) return null;
  const index = logicalDayIndexAt(days, nowMs, timeZone);
  let lastSetEnd = -Infinity;
  for (const set of sets) {
    if (set.dayIndex !== index) continue;
    const bounds = getSetTimeBounds(set, days, timeZone);
    if (bounds) lastSetEnd = Math.max(lastSetEnd, bounds.endMs);
  }
  return Number.isFinite(lastSetEnd) ? lastSetEnd + 3_600_000 : dayEnd;
}

export function liveShareOptions({
  days,
  sets = [],
  timeZone,
  nowMs,
}: {
  days: ReadonlyArray<Pick<FestivalDay, 'date'>>;
  /** The festival's sets, so "Rest of today" ends 1 hour after the day's last set. */
  sets?: ReadonlyArray<Pick<FestivalSet, 'startTime' | 'endTime' | 'date' | 'dayIndex'>>;
  timeZone?: string;
  nowMs: number;
}): { options: LiveShareOption[]; defaultId: string } {
  const options: LiveShareOption[] = LIVE_SHARE_DURATIONS.map((d) => ({ id: d.id, label: d.label, ms: d.ms }));
  const end = restOfTodayEndAt(days, sets, nowMs, timeZone);
  if (end != null && end - nowMs > 3_600_000 && end - nowMs <= LIVE_SHARE_MAX_MS) {
    options.push({ id: 'day', label: LIVE_SHARE_COPY.restOfToday(fmtZonedClock(end, timeZone)), ms: end - nowMs });
    return { options, defaultId: 'day' };
  }
  return { options, defaultId: LIVE_SHARE_DEFAULT_DURATION_ID };
}

const LIVE_SHARE_ENDED_TEXT: Record<LiveShareEndReason, string> = {
  expired: 'Live location stopped at the time you picked.',
  background: 'Live location stopped when you left the app. Turn it on again to keep sharing.',
  'low-power': 'Live location stopped because low-power mode is on.',
  error: "Couldn't read your location, so sharing stopped. Check that location is on and try again.",
  denied: 'Location permission is off. Turn it on in your settings to share.',
  rejected: "Couldn't share your location with this crew. Try again.",
  user: '',
};

/** One-line notice for why sharing ended. Empty when the user stopped it. */
export function liveShareEndedText(reason: LiveShareEndReason): string {
  return LIVE_SHARE_ENDED_TEXT[reason];
}

/** "Not seen yet", "Seen by Sam", "Seen by Sam and Alex", "Seen by Sam, Alex and 2 more". */
export function sosSeenLabel(entry: Pick<SosEntry, 'seenBy'>): string {
  const names = (entry.seenBy ?? []).map((v) => v.username);
  if (names.length === 0) return 'Not seen yet';
  if (names.length === 1) return `Seen by ${names[0]}`;
  if (names.length === 2) return `Seen by ${names[0]} and ${names[1]}`;
  return `Seen by ${names[0]}, ${names[1]} and ${names.length - 2} more`;
}
