import { FestivalSet } from '../types/domain';
import { createDateInLocalFrame } from './setStatus';

/**
 * Format a festival date range for display, e.g. "Sep 4 – Sep 6, 2026".
 * Accepts YYYY-MM-DD or ISO strings (uses the date portion, parsed as local to
 * avoid UTC off-by-one). Returns null on missing/unparseable input so callers
 * hide the row instead of rendering "Invalid Date".
 */
export function formatFestivalDateRange(startDate?: string | null, endDate?: string | null): string | null {
  if (!startDate || !endDate) return null;
  // Build both endpoints in a single consistent local frame (no JS string-parser
  // UTC/local ambiguity) — same TZ-safe pattern as setStatus.createDateInLocalFrame.
  const start = createDateInLocalFrame(startDate, 0, 0);
  const end = createDateInLocalFrame(endDate, 0, 0);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return formatDateSpan(startDate, endDate);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Format an ISO-ish date string into a short, human label like "Jun 21, 2025".
 *
 * The server's festival dates arrive as 'YYYY-MM-DD' (or a full ISO timestamp);
 * we parse the calendar parts by hand instead of `new Date(iso)` so a device in
 * a negative UTC offset doesn't render the day before (the classic midnight-UTC
 * off-by-one). Returns the raw input on any parse miss so we never blank a date.
 */
export function formatFestivalDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  const month = MONTHS[monthIdx];
  if (!month || day < 1 || day > 31) return iso;
  return `${month} ${day}, ${year}`;
}

/**
 * Human date span for a festival row. Collapses a single-day festival to one
 * date, drops the repeated year when both ends share it ("Jun 21 – 23, 2025"),
 * and keeps both years when they differ.
 */
export function formatDateSpan(start: string | null | undefined, end: string | null | undefined): string | null {
  const a = formatFestivalDate(start);
  const b = formatFestivalDate(end);
  if (!a && !b) return null;
  if (a && b && a !== b) {
    // Same year → "Jun 21, 2025 – Jun 23, 2025" reads as "Jun 21 – Jun 23, 2025".
    const aYear = a.slice(a.lastIndexOf(',') + 1).trim();
    const bYear = b.slice(b.lastIndexOf(',') + 1).trim();
    if (aYear && aYear === bYear) {
      const aNoYear = a.slice(0, a.lastIndexOf(',')).trim();
      return `${aNoYear} – ${b}`;
    }
    return `${a} – ${b}`;
  }
  return a || b;
}

const hourCycles = new Map<string, boolean>();

/**
 * True when the locale writes clock times on a 24-hour clock (de-DE, en-GB), false for a 12-hour one (en-US).
 * With no `locale` it reads the runtime locale: the browser language on web, the device language on mobile.
 * A runtime that reports no hour cycle counts as 12-hour, the format Festie used before it followed the locale.
 */
export function uses24HourClock(locale?: string): boolean {
  const key = locale ?? '';
  let is24 = hourCycles.get(key);
  if (is24 === undefined) {
    const { hourCycle, hour12 } = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions();
    is24 = hourCycle ? hourCycle === 'h23' || hourCycle === 'h24' : hour12 === false;
    hourCycles.set(key, is24);
  }
  return is24;
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();

// A formatter without a time zone captures the device zone when it is built, so only a named zone is cached:
// a phone that changes zone must not keep showing the old one.
function clockFormat(timeZone?: string, locale?: string): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${timeZone ?? ''}`;
  const cached = timeZone ? clockFormats.get(key) : undefined;
  if (cached) return cached;
  const is24 = uses24HourClock(locale);
  const format = new Intl.DateTimeFormat(locale, {
    hour: is24 ? '2-digit' : 'numeric',
    minute: '2-digit',
    ...(is24 ? { hourCycle: 'h23' as const } : {}),
    ...(timeZone ? { timeZone } : {}),
  });
  if (timeZone) clockFormats.set(key, format);
  return format;
}

/**
 * The clock time of an instant in `timeZone` (the device zone when omitted), in the locale's hour cycle:
 * "9:30 PM" for en-US, "21:30" for en-GB and de-DE. Always a plain space before AM/PM, never ICU's no-break space.
 */
export function formatClock(ms: number, timeZone?: string, locale?: string): string {
  return clockFormat(timeZone, locale).format(ms).replace(/\s/g, ' ');
}

/**
 * Shows a festival wall-clock "HH:MM" in the locale's hour cycle. The value is a plain time of day, so it goes
 * through a fixed UTC date: the device zone never moves it. Input that is not a time comes back unchanged.
 */
export function formatTime(t: string | undefined, locale?: string): string {
  if (!t) return '';
  const [hh = '0', mm = '00'] = t.split(':');
  const hour = parseInt(hh, 10);
  const minute = parseInt(mm, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return t;
  return formatClock(Date.UTC(2000, 0, 1, hour, minute), 'UTC', locale);
}

/** Like formatTime, but split in the time and its AM/PM marker ("9:30" and "PM"; the marker is empty on a 24-hour clock). */
export function formatTimeParts(t: string | undefined, locale?: string): { time: string; period: string } {
  const whole = formatTime(t, locale);
  const [hh = '0', mm = '00'] = (t ?? '').split(':');
  if (!t || whole === t) return { time: whole, period: '' };
  const parts = clockFormat('UTC', locale).formatToParts(Date.UTC(2000, 0, 1, parseInt(hh, 10), parseInt(mm, 10)));
  const clean = (value: string) => value.replace(/\s/g, ' ');
  const time = parts.filter((p) => p.type !== 'dayPeriod').map((p) => clean(p.value)).join('').trim();
  return { time, period: clean(parts.find((p) => p.type === 'dayPeriod')?.value ?? '') };
}

/** The time for a tight label: on a 12-hour clock a whole hour drops its minutes ("9 PM"); 24-hour times keep them ("21:00"). */
export function formatTimeCompact(t: string | undefined, locale?: string): string {
  const whole = formatTime(t, locale);
  return uses24HourClock(locale) ? whole : whole.replace(':00', '');
}

const HHMM = /^\d{2}:\d{2}$/;

/** Formats an HH:MM value in the locale's hour cycle; free-text values pass through unchanged. */
export function formatTimeOrRaw(t: string, locale?: string): string {
  return HHMM.test(t) ? formatTime(t, locale) : t;
}

export function timeToMinutes(t: string | undefined): number {
  if (!t) return 0;
  const [hh = 0, mm = 0] = t.split(':').map((x) => parseInt(x, 10));
  return hh * 60 + mm;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function artistDisplayName(set: FestivalSet, separator?: string): string {
  if (set.displayName) return set.displayName;
  const sep = separator || 'b2b';
  const joined = set.artists?.length ? set.artists.map((a) => a.name).join(` ${sep} `) : '';

  if (set.artist && (!joined || set.artist !== joined)) return set.artist;
  if (joined) return joined;
  return set.artist || 'Unknown';
}

export function artistSubtitle(set: FestivalSet, separator?: string): string {
  if (!set.artists || set.artists.length < 2) return '';
  const sep = separator || 'b2b';
  const joined = set.artists.map((a) => a.name).join(` ${sep} `);
  if (set.displayName) return set.displayName === joined ? '' : joined;
  if (!set.artist || set.artist === joined) return '';
  return joined;
}

const PLATFORM_LABELS: Record<string, string> = {
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  instagram: 'Instagram',
  twitter: 'X',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  website: 'Website',
  youtube: 'YouTube',
  apple_music: 'Apple Music',
};

/** Human label for an artist link key; unknown keys pass through unchanged. */
export function platformLabel(platform: string): string {
  return (Object.hasOwn(PLATFORM_LABELS, platform) && PLATFORM_LABELS[platform]) || platform;
}

/** True only for http(s) URLs; blocks javascript:, data:, intent: and other schemes. */
export function isSafeExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

const LINK_ORDER = ['spotify', 'apple_music', 'soundcloud', 'youtube', 'instagram', 'twitter', 'tiktok', 'facebook', 'website'];

/** An artist's openable links, music services first, then socials; unknown keys last. Non-http(s) URLs are dropped. */
export function artistLinkEntries(links: Record<string, string> | undefined): Array<{ key: string; label: string; url: string }> {
  const rank = (key: string) => (LINK_ORDER.includes(key) ? LINK_ORDER.indexOf(key) : LINK_ORDER.length);
  return Object.entries(links ?? {})
    .filter(([, url]) => typeof url === 'string' && isSafeExternalUrl(url))
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, url]) => ({ key, label: platformLabel(key), url }));
}

export function getSetLinks(set: FestivalSet): Array<{ name: string; links: Record<string, string> }> {
  if (!set.artists?.length) {
    return set.linkUrl ? [{ name: set.artist || 'Unknown', links: { spotify: set.linkUrl } }] : [];
  }
  return set.artists.filter((a) => a.links && Object.keys(a.links).length > 0) as Array<{
    name: string;
    links: Record<string, string>;
  }>;
}
