import type { Festival } from '../types';
import {
  FESTIVAL_DAY_START_HOUR,
  createDateInLocalFrame,
  getSetTimeBounds,
  zonedWallTimeToMs,
  zoneOffsetMsAt,
} from './setStatus';

interface DayLike {
  date?: string | null;
}

const validZones = new Map<string, boolean>();

/**
 * Validate an IANA time-zone id (e.g. `America/New_York`). Returns false for
 * empty/garbage so callers can safely fall back to the device-local frame.
 */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== 'string') return false;
  const known = validZones.get(tz);
  if (known !== undefined) return known;
  let valid = true;
  try {
    // Throws RangeError for an unknown zone.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    valid = false;
  }
  validZones.set(tz, valid);
  return valid;
}

/**
 * Resolve a festival's IANA time zone, when known. Reads the optional
 * `timeZone` field the backend may attach so reminder fire-times can be anchored
 * in the festival's zone (not the device's). Returns undefined when absent or
 * invalid, in which case time math falls back to the device-local frame —
 * preserving the prior `createDateInLocalFrame` behavior with no regression.
 */
export function resolveFestivalTimeZone(festival: { timeZone?: string | null } | null | undefined): string | undefined {
  const tz = festival?.timeZone;
  return isValidTimeZone(tz) ? tz : undefined;
}

/** Festival-like object that may carry inline days (e.g. from the list endpoint). */
interface FestivalWithDays extends Festival {
  days?: ReadonlyArray<DayLike>;
}

/**
 * Returns true once 06:00 after the festival's last day has passed, in the
 * festival zone (device-local when the festival has no zone). Sets before
 * 06:00 belong to the last night, so the festival is not over at midnight.
 *
 * NOTE: `festivalStore.selectFestival` strips `days` off the Festival object
 * and stores them in a separate `days` field. So callers MUST pass both the
 * festival and the days array. The second argument is optional for the (rare)
 * case where a Festival object from the list endpoint still has them inline.
 */
export function isFestivalOver(
  festival: Festival | null | undefined,
  days?: ReadonlyArray<DayLike> | null,
  now: Date = new Date(),
): boolean {
  if (!festival) return false;
  const daysArr = (days && days.length > 0 ? days : (festival as FestivalWithDays).days) || [];
  if (!daysArr.length) return false;
  if (!daysArr[daysArr.length - 1]?.date) return false;
  return festivalStatus(festival, daysArr, now) === 'past';
}

export type FestivalStatus = 'upcoming' | 'ongoing' | 'past';

/**
 * Classify a festival relative to `now`, in the festival zone (device-local
 * when the festival has no zone):
 *  - 'past'     from 06:00 after the final day (its last night has ended)
 *  - 'ongoing'  while `now` is within [first day 00:00, 06:00 after the last day)
 *  - 'upcoming' before it starts
 * Uses inline `days[]` when present, otherwise the festival's startDate/endDate
 * (the list endpoint provides those). Returns null when no usable dates exist so
 * callers can simply hide the status. `now` is injectable for testing.
 */
export function festivalStatus(
  festival: (Festival & { startDate?: string | null; endDate?: string | null }) | null | undefined,
  days?: ReadonlyArray<DayLike> | null,
  now: Date = new Date(),
): FestivalStatus | null {
  if (!festival) return null;
  const daysArr = (days && days.length > 0 ? days : (festival as FestivalWithDays).days) || [];
  const dayDates = daysArr.map((d) => d?.date).filter(Boolean) as string[];

  let first: string | undefined;
  let last: string | undefined;
  if (dayDates.length) {
    const sorted = [...dayDates].sort();
    first = sorted[0];
    last = sorted[sorted.length - 1];
  } else {
    first = festival.startDate || undefined;
    last = festival.endDate || festival.startDate || undefined;
  }
  if (!first || !last) return null;

  const tz = resolveFestivalTimeZone(festival);
  // Hour 30 is 06:00 the next morning; both converters normalize it.
  const wallMs = (date: string, hours: number) =>
    tz ? zonedWallTimeToMs(date, hours, 0, tz) : createDateInLocalFrame(date, hours, 0).getTime();
  const startMs = wallMs(first, 0);
  const endMs = wallMs(last, FESTIVAL_DAY_START_HOUR + 24);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;

  const nowMs = now.getTime();
  if (nowMs >= endMs) return 'past';
  if (nowMs >= startMs) return 'ongoing';
  return 'upcoming';
}

/**
 * Order festivals for a picker: live first, then upcoming (soonest first), then
 * past (most recent first). A festival with no usable dates sorts with upcoming.
 */
export function sortFestivalsForPicker<T extends Festival>(festivals: readonly T[], now: Date = new Date()): T[] {
  // Rank each festival once instead of re-deriving its status per comparison.
  const ranked = festivals.map((f) => {
    const s = festivalStatus(f, null, now);
    const r = s === 'ongoing' ? 0 : s === 'past' ? 2 : 1;
    return { f, r, start: f.startDate || '' };
  });
  ranked.sort((a, b) => {
    if (a.r !== b.r) return a.r - b.r;
    // ISO date strings sort lexicographically. Past = most recent first.
    return a.r === 2 ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start);
  });
  return ranked.map(({ f }) => f);
}

/** The festival a new visitor should open on, or undefined for an empty list. */
export function pickDefaultFestival<T extends Festival>(festivals: readonly T[], now: Date = new Date()): T | undefined {
  return sortFestivalsForPicker(festivals, now)[0];
}

/**
 * Lifecycle phase of a festival, used to re-prioritize the home/landing surface:
 *  - 'pre'  — before it starts (lean into picks / lineup / crew invites / Spotify)
 *  - 'live' — while it's running (lean into Now & Next / live map / SOS / meeting points)
 *  - 'post' — once it's over    (lean into wrap-up / expenses / settle-up)
 *
 * A thin semantic wrapper over {@link festivalStatus} (ongoing → 'live') so web
 * and mobile derive the same phase from the festival date range vs `now` and can
 * reorder/emphasize — never hide — content per phase. Returns null when no usable
 * dates exist so callers fall back to a phase-neutral layout.
 */
export type FestivalPhase = 'pre' | 'live' | 'post';

export function festivalPhase(
  festival: (Festival & { startDate?: string | null; endDate?: string | null }) | null | undefined,
  days?: ReadonlyArray<DayLike> | null,
  now: Date = new Date(),
): FestivalPhase | null {
  const status = festivalStatus(festival, days, now);
  if (!status) return null;
  return status === 'upcoming' ? 'pre' : status === 'ongoing' ? 'live' : 'post';
}

/**
 * Returns true when a set's start time has arrived (so the user can
 * meaningfully rate it), in the festival zone and with the 06:00 start roll
 * from `getSetTimeBounds`. If the set has no start time or day, fall back to
 * the festival-over check.
 */
export function hasSetStarted(
  set: { startTime?: string | null; dayIndex?: number | null } | null,
  festival: Festival | null | undefined,
  days?: ReadonlyArray<DayLike> | null,
  now: Date = new Date(),
): boolean {
  if (!set) return false;
  if (!festival) return false;
  const daysArr = (days && days.length > 0 ? days : (festival as FestivalWithDays).days) || [];
  if (!set.startTime || set.dayIndex == null) return isFestivalOver(festival, daysArr, now);
  const day = daysArr[set.dayIndex];
  if (!day?.date) return isFestivalOver(festival, daysArr, now);
  // Only the start matters here, so the day's date goes in directly with no end time.
  const bounds = getSetTimeBounds(
    { startTime: set.startTime, endTime: '', date: day.date },
    [],
    resolveFestivalTimeZone(festival),
  );
  if (!bounds) return isFestivalOver(festival, daysArr, now);
  return bounds.startMs <= now.getTime();
}

/**
 * `'Festival time'` when the festival zone's UTC offset at `nowMs` differs from
 * the device's, else null. Compares offsets, not names, because two zone ids
 * can share one clock (`America/Detroit` and `America/New_York`). Set times are
 * stored as festival wall-clock, so this only labels what is already shown.
 */
export function festivalTimeLabel(timeZone: string | undefined, nowMs: number = Date.now()): 'Festival time' | null {
  if (!isValidTimeZone(timeZone)) return null;
  const deviceOffsetMs = -new Date(nowMs).getTimezoneOffset() * 60_000;
  return zoneOffsetMsAt(nowMs, timeZone) !== deviceOffsetMs ? 'Festival time' : null;
}

/** The city part of an IANA zone id: `America/Los_Angeles` gives `Los Angeles`, `UTC` gives `UTC`. */
export function timeZoneCity(timeZone: string): string {
  return timeZone.slice(timeZone.lastIndexOf('/') + 1).replace(/_/g, ' ');
}

// Used when the runtime has no Intl.supportedValuesOf (Hermes may lack it).
const FALLBACK_TIME_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Australia/Sydney',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Toronto',
  'America/Vancouver',
  'Europe/Amsterdam',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Lisbon',
  'Europe/Budapest',
  'Europe/Belgrade',
  'Asia/Tokyo',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Australia/Melbourne',
  'Pacific/Auckland',
];

/**
 * IANA zone ids for a time-zone picker: every zone the runtime knows, or a
 * fixed list of common festival zones when it cannot enumerate them. A valid
 * `current` zone that is missing from the list is added, so an existing
 * festival's zone always shows as selected.
 */
export function listTimeZones(current?: string | null): string[] {
  const supportedValuesOf = (Intl as { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf;
  const zones = typeof supportedValuesOf === 'function' ? supportedValuesOf('timeZone') : [...FALLBACK_TIME_ZONES];
  if (isValidTimeZone(current) && !zones.includes(current)) zones.push(current);
  return zones;
}

/**
 * Group festivals for a picker. Live and upcoming: soonest start first. Past:
 * most recent start first. Undated (no usable dates): name order.
 */
export function groupFestivalsByStatus<F extends Festival & { startDate?: string | null; endDate?: string | null }>(
  festivals: F[],
  now: Date = new Date(),
): { live: F[]; upcoming: F[]; past: F[]; undated: F[] } {
  const groups = { live: [] as F[], upcoming: [] as F[], past: [] as F[], undated: [] as F[] };
  for (const f of festivals) {
    const status = festivalStatus(f, undefined, now);
    groups[status === 'ongoing' ? 'live' : (status ?? 'undated')].push(f);
  }
  const start = (f: F) => f.startDate ?? '';
  groups.live.sort((a, b) => start(a).localeCompare(start(b)));
  groups.upcoming.sort((a, b) => start(a).localeCompare(start(b)));
  groups.past.sort((a, b) => start(b).localeCompare(start(a)));
  groups.undated.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}
