import { describe, it, expect } from 'vitest';
import {
  shortDate,
  timeReleaseConfirmText,
  timeReleaseOrphanText,
  timeReleasePartialText,
  timeReleasePrompts,
  timeReleaseRowText,
  timeReleaseState,
  undoReleaseWarning,
  weekdayDate,
  type TimeReleaseDate,
  type TimeReleasePanelData,
} from './timeReleases';

const NOW = Date.parse('2027-01-20T12:00:00Z');
const row = (over: Partial<TimeReleaseDate> = {}): TimeReleaseDate => ({
  date: '2027-02-05',
  label: 'Friday',
  timed: 44,
  total: 44,
  claimedAt: null,
  sentAt: null,
  recipients: null,
  previewTitle: 'Wasteland: Friday set times are out',
  ...over,
});
const panel = (dates: TimeReleaseDate[], canSend = true): TimeReleasePanelData => ({
  festivalName: 'Wasteland',
  canSend,
  recipientsNow: 812,
  emailOff: null,
  defaultBody: 'See who plays when and build your plan.',
  dates,
  orphanDates: [],
});

describe('dates', () => {
  it('reads a date in UTC, so the text does not depend on the device', () => {
    expect(shortDate('2027-02-05')).toBe('5 Feb');
    expect(shortDate('2027-01-06T23:30:00.000Z')).toBe('6 Jan');
    expect(weekdayDate('2027-02-05')).toBe('Fri 5 Feb');
    expect(shortDate('soon')).toBe('soon');
  });
});

describe('timeReleaseState', () => {
  it('is unsent without a claim, sending inside ten minutes, stuck after, and sent once stamped', () => {
    expect(timeReleaseState(row(), NOW)).toBe('unsent');
    expect(timeReleaseState(row({ claimedAt: new Date(NOW - 9 * 60_000).toISOString() }), NOW)).toBe('sending');
    expect(timeReleaseState(row({ claimedAt: new Date(NOW - 11 * 60_000).toISOString() }), NOW)).toBe('stuck');
    expect(timeReleaseState(row({ claimedAt: new Date(NOW - 99 * 60_000).toISOString(), sentAt: new Date(NOW).toISOString() }), NOW)).toBe('sent');
  });
});

describe('timeReleaseRowText', () => {
  it('reads each state', () => {
    expect(timeReleaseRowText(row(), NOW)).toBe('Fri 5 Feb · 44 of 44 timed · Not sent');
    expect(timeReleaseRowText(row({ claimedAt: new Date(NOW - 60_000).toISOString() }), NOW)).toBe('Fri 5 Feb · 44 of 44 timed · Sending');
    expect(timeReleaseRowText(row({ claimedAt: new Date(NOW - 20 * 60_000).toISOString() }), NOW)).toBe('Fri 5 Feb · 44 of 44 timed · Not finished');
    const sent = row({ claimedAt: '2027-01-06T10:00:00.000Z', sentAt: '2027-01-06T10:01:00.000Z', recipients: 640 });
    expect(timeReleaseRowText(sent, NOW)).toBe('Fri 5 Feb · 44 of 44 timed · Sent 6 Jan to 640 people');
    expect(timeReleaseRowText({ ...sent, recipients: 1 }, NOW)).toContain('to 1 person');
  });
});

describe('confirm and partial text', () => {
  it('states the ceiling and the exact title', () => {
    expect(timeReleaseConfirmText(812, 'Wasteland: Friday set times are out')).toBe(
      'Alert goes to up to 812 people: "Wasteland: Friday set times are out".',
    );
  });

  it('names the untimed sets of a partial date, and says nothing for a full one', () => {
    expect(timeReleasePartialText(row({ timed: 1, total: 44 }))).toBe(
      'Only 1 of 44 Friday sets has a time. 43 still show to be announced.',
    );
    expect(timeReleasePartialText(row({ timed: 40, total: 44 }))).toContain('Only 40 of 44 Friday sets have a time.');
    expect(timeReleasePartialText(row())).toBeNull();
  });
});

describe('timeReleasePrompts', () => {
  it('prompts for a fully timed date that no one claimed, and for nothing when sending is closed', () => {
    const dates = [row(), row({ date: '2027-02-06', label: 'Saturday', timed: 3, total: 44 }), row({ date: '2027-02-07', label: 'Sunday', claimedAt: '2027-01-01T00:00:00Z' })];
    expect(timeReleasePrompts(panel(dates))).toEqual(['Friday: 44 of 44 sets timed. Alert not sent.']);
    expect(timeReleasePrompts(panel(dates, false))).toEqual([]);
  });
});

describe('orphan and undo text', () => {
  it('names an orphan date', () => {
    expect(timeReleaseOrphanText({ date: '2027-02-05', claimedAt: 'x', sentAt: 'y' })).toBe(
      'An alert went out for 5 Feb, which no day uses now.',
    );
  });

  it('warns on undo only for a touched date whose alert went out', () => {
    const dates = [row({ sentAt: '2027-01-06T10:00:00Z' }), row({ date: '2027-02-06', label: 'Saturday' })];
    expect(undoReleaseWarning(['2027-02-05'], dates)).toBe('The Friday alert already went out. Undo will not recall it.');
    expect(undoReleaseWarning(['2027-02-06'], dates)).toBeNull();
    expect(undoReleaseWarning(undefined, dates)).toBeNull();
    expect(undoReleaseWarning(['2027-02-04'], [], [{ date: '2027-02-04', claimedAt: 'x', sentAt: 'y' }])).toBe(
      'The 4 Feb alert already went out. Undo will not recall it.',
    );
  });
});
