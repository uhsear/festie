export type NotificationBoolKey =
  | 'setReminders'
  | 'scheduleChanges'
  | 'crewUpdates'
  | 'crewMeetingPoints'
  | 'crewPolls'
  | 'crewMoney'
  | 'crewRides'
  | 'lineupDrops'
  | 'crewReformed'
  | 'wrapReady';

export interface NotificationTypeRow {
  key: NotificationBoolKey;
  label: string;
  hint: string;
  /** True when the reminder is scheduled on the device, so it does not depend on push. */
  onDevice: boolean;
  /** False until a sender exists for the type. */
  live: boolean;
}

// Tranches 24, 26 and 30 set `live: true` on their row when they add a sender.
export const NOTIFICATION_TYPE_ROWS: readonly NotificationTypeRow[] = [
  { key: 'setReminders', label: 'Set reminders', hint: 'Before a set you asked to be reminded about.', onDevice: true, live: true },
  { key: 'scheduleChanges', label: 'Schedule changes', hint: 'When a set you picked moves or is removed.', onDevice: false, live: true },
  { key: 'crewUpdates', label: 'Crew picks', hint: 'When someone in your crew changes their picks.', onDevice: false, live: true },
  { key: 'crewMeetingPoints', label: 'Meeting points', hint: 'When your crew sets or moves a meeting point.', onDevice: false, live: false },
  { key: 'crewPolls', label: 'Polls', hint: 'When your crew starts or closes a poll.', onDevice: false, live: false },
  { key: 'crewMoney', label: 'Money', hint: 'Expenses and settle-up in your crew.', onDevice: false, live: false },
  { key: 'crewRides', label: 'Rides', hint: 'Ride offers and changes in your crew.', onDevice: false, live: false },
  { key: 'lineupDrops', label: 'New lineups', hint: "A festival you've been to before posts its lineup.", onDevice: false, live: true },
  { key: 'crewReformed', label: 'Crew re-forms', hint: 'A past crew reunites for a new festival.', onDevice: false, live: true },
  { key: 'wrapReady', label: 'Wrap-up ready', hint: 'Your festival recap is ready to view.', onDevice: false, live: true },
];

export function visibleNotificationRows(): NotificationTypeRow[] {
  return NOTIFICATION_TYPE_ROWS.filter((r) => r.live);
}

export const QUIET_HOURS_PRESETS: readonly { id: string; label: string; start: string; end: string }[] = [
  { id: 'nights', label: 'Nights', start: '23:00', end: '08:00' },
  { id: 'festival', label: 'Festival nights', start: '04:00', end: '11:00' },
];

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidQuietWindow(start: string, end: string): boolean {
  return HHMM_RE.test(start) && HHMM_RE.test(end) && start !== end;
}

export const MUST_SEE_REMINDER_OPTIONS: readonly (5 | 10 | 15 | 30 | 60 | null)[] = [null, 5, 10, 15, 30, 60];

export function mustSeeOptionLabel(v: number | null): string {
  if (v === null) return 'Off';
  return v === 60 ? '1 hour before' : `${v} min before`;
}

/** Which global preference a per-festival topic mute overrides. */
export const TOPIC_GLOBAL_KEY = { crew: 'crewUpdates', schedule: 'scheduleChanges' } as const;

export interface ScheduleNotice {
  changes: number;
  people: number;
  notified: boolean;
}

export function describeScheduleNotice(notice: ScheduleNotice): string {
  if (notice.notified) {
    const noun = notice.people === 1 ? 'person' : 'people';
    return `Saved. ${notice.people} ${noun} picked the changed sets and will get an alert, unless they turned schedule alerts off.`;
  }
  if (notice.changes > 0 && notice.people === 0) return 'Saved. No one had picked the changed sets, so no alerts were sent.';
  if (notice.changes > 0) return 'Saved without alerts.';
  return 'Festival updated';
}
