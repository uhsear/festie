/**
 * The admin release panel: the "set times are out" alert, sent one festival date at a time.
 * Types mirror GET /admin/festivals/:id/time-releases. The text helpers are pure so web and a later
 * mobile panel read the same.
 */

export interface TimeReleaseDate {
  date: string;
  label: string;
  timed: number;
  total: number;
  claimedAt: string | null;
  sentAt: string | null;
  recipients: number | null;
  /** The push title for a release of this date alone. */
  previewTitle: string;
}

/** A release row whose date no current day uses, for example after a date correction. */
export interface TimeReleaseOrphan {
  date: string;
  claimedAt: string;
  sentAt: string | null;
}

export interface TimeReleasePanelData {
  festivalName: string;
  /** True only for a published festival that is not over. */
  canSend: boolean;
  /** Followers plus profile holders, before preference and push-token filters. */
  recipientsNow: number;
  /** 'no_postal_address' when the email part is off. */
  emailOff: string | null;
  /** The push body when the admin writes no custom line. */
  defaultBody: string;
  dates: TimeReleaseDate[];
  orphanDates: TimeReleaseOrphan[];
}

export interface TimeReleaseSendBody {
  dates: string[];
  note?: string;
  confirmPartial?: boolean;
}

export interface TimeReleaseSendResult {
  queued: true;
  dates: string[];
  skipped: string[];
  recipients: number;
}

/** A claim with no `sentAt` after this long counts as stuck, and the admin may retry it. Matches the server. */
export const TIME_RELEASE_STUCK_AFTER_MS = 10 * 60 * 1000;

export const TIME_RELEASE_NOTE_MAX = 200;

export const TIME_RELEASE_HELP = 'People who turned off lineup alerts, or have no app or email, get nothing.';

export type TimeReleaseState = 'unsent' | 'sending' | 'stuck' | 'sent';

export function timeReleaseState(row: Pick<TimeReleaseDate, 'claimedAt' | 'sentAt'>, nowMs: number): TimeReleaseState {
  if (row.sentAt) return 'sent';
  if (!row.claimedAt) return 'unsent';
  return nowMs - new Date(row.claimedAt).getTime() > TIME_RELEASE_STUCK_AFTER_MS ? 'stuck' : 'sending';
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5 Feb" from "2027-02-05" or an ISO timestamp, read in UTC so the text never depends on the device. */
export function shortDate(value: string): string {
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? value : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Fri 5 Feb" from "2027-02-05". */
export function weekdayDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : `${WEEKDAYS[d.getUTCDay()]} ${shortDate(date)}`;
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** One panel row: "Fri 5 Feb · 44 of 44 timed · Not sent". */
export function timeReleaseRowText(row: TimeReleaseDate, nowMs: number): string {
  const head = `${weekdayDate(row.date)} · ${row.timed} of ${row.total} timed`;
  const state = timeReleaseState(row, nowMs);
  if (state === 'sent') {
    const to = row.recipients === null ? '' : ` to ${people(row.recipients)}`;
    return `${head} · Sent ${shortDate(row.sentAt as string)}${to}`;
  }
  if (state === 'stuck') return `${head} · Not finished`;
  if (state === 'sending') return `${head} · Sending`;
  return `${head} · Not sent`;
}

/** The confirm text: who it reaches at most, and the exact push title. */
export function timeReleaseConfirmText(recipientsNow: number, title: string): string {
  return `Alert goes to up to ${recipientsNow} people: "${title}".`;
}

/** Why a partial date needs a second tick, or null when every set has a time. */
export function timeReleasePartialText(row: Pick<TimeReleaseDate, 'timed' | 'total' | 'label'>): string | null {
  if (row.timed >= row.total) return null;
  const untimed = row.total - row.timed;
  return `Only ${row.timed} of ${row.total} ${row.label} sets ${row.timed === 1 ? 'has' : 'have'} a time. ${untimed} still show to be announced.`;
}

/** Dates that are fully timed and not claimed yet: the editor prompts the admin to send them. */
export function timeReleasePrompts(panel: TimeReleasePanelData): string[] {
  if (!panel.canSend) return [];
  return panel.dates
    .filter((d) => d.total > 0 && d.timed === d.total && !d.claimedAt)
    .map((d) => `${d.label}: ${d.timed} of ${d.total} sets timed. Alert not sent.`);
}

export function timeReleaseOrphanText(orphan: TimeReleaseOrphan): string {
  return `An alert went out for ${shortDate(orphan.date)}, which no day uses now.`;
}

/** The warning in the undo dialog when an alert already went out for a date the import touched. */
export function undoReleaseWarning(
  touchedDates: readonly string[] | undefined,
  dates: readonly Pick<TimeReleaseDate, 'date' | 'label' | 'sentAt'>[],
  orphans: readonly TimeReleaseOrphan[] = [],
): string | null {
  const touched = new Set(touchedDates ?? []);
  const sent = [
    ...dates.filter((d) => d.sentAt && touched.has(d.date)).map((d) => d.label),
    ...orphans.filter((o) => o.sentAt && touched.has(o.date)).map((o) => shortDate(o.date)),
  ];
  if (sent.length === 0) return null;
  return `The ${sent.join(' and ')} alert already went out. Undo will not recall it.`;
}
