import { describe, it, expect } from 'vitest';
import {
  visibleNotificationRows,
  isValidQuietWindow,
  describeScheduleNotice,
  mustSeeOptionLabel,
} from './notificationSettings';

describe('notificationSettings', () => {
  it('hides the three crew rows that have no sender yet', () => {
    const keys = visibleNotificationRows().map((r) => r.key);
    expect(keys).toHaveLength(8);
    for (const k of ['crewPolls', 'crewMoney', 'crewRides']) expect(keys).not.toContain(k);
    expect(keys).toContain('crewMeetingPoints');
  });

  it('gives crew nudges their own switch, separate from crew picks', () => {
    const rows = visibleNotificationRows();
    expect(rows.find((r) => r.key === 'crewUpdates')?.hint).toBe('When someone in your crew changes their picks.');
    const nudge = rows.find((r) => r.key === 'crewNudges');
    expect(nudge?.label).toBe('Nudges from your crew');
    expect(nudge?.hint).toBe('When a crewmate nudges you to check in. These still arrive during quiet hours.');
    expect(rows.findIndex((r) => r.key === 'crewNudges')).toBe(rows.findIndex((r) => r.key === 'crewUpdates') + 1);
  });

  it('validates quiet windows', () => {
    expect(isValidQuietWindow('04:00', '04:00')).toBe(false);
    expect(isValidQuietWindow('04:00', '11:00')).toBe(true);
    expect(isValidQuietWindow('24:00', '11:00')).toBe(false);
    expect(isValidQuietWindow('4:00', '11:00')).toBe(false);
  });

  it('describes the schedule notice', () => {
    expect(describeScheduleNotice({ changes: 1, people: 1, notified: true })).toBe(
      'Saved. 1 person picked or set a reminder on the changed sets and will get an alert, unless they turned schedule alerts off.',
    );
    expect(describeScheduleNotice({ changes: 2, people: 3, notified: true })).toContain('3 people picked');
    expect(describeScheduleNotice({ changes: 1, people: 0, notified: false })).toBe(
      'Saved. No one had picked or set a reminder on the changed sets, so no alerts were sent.',
    );
    expect(describeScheduleNotice({ changes: 1, people: 2, notified: false })).toBe('Saved without alerts.');
    expect(describeScheduleNotice({ changes: 0, people: 0, notified: false })).toBe('Festival updated');
  });

  it('labels must-see options', () => {
    expect(mustSeeOptionLabel(null)).toBe('Off');
    expect(mustSeeOptionLabel(15)).toBe('15 min before');
    expect(mustSeeOptionLabel(60)).toBe('1 hour before');
  });
});
