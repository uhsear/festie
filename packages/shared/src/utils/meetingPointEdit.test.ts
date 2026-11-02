import { describe, it, expect } from 'vitest';
import { meetingPointEditLine } from './meetingPointEdit';

const NOW = new Date('2026-06-05T12:00:00.000Z');
// 2026-06-06 22:00 UTC = Sat 3:00 PM in America/Los_Angeles (UTC-7).
const SAT_3PM_LA = '2026-06-06T22:00:00.000Z';

const line = (
  edit_was: { location?: string; meetAt?: string | null } | null,
  extra: { editor_name?: string | null; recurs_daily?: boolean; timeZone?: string } = {},
) =>
  meetingPointEditLine(
    { edit_was, editor_name: extra.editor_name === undefined ? 'ana' : extra.editor_name, recurs_daily: extra.recurs_daily },
    { now: NOW, timeZone: extra.timeZone ?? 'America/Los_Angeles' },
  );

describe('meetingPointEditLine', () => {
  it('time only', () => {
    expect(line({ meetAt: SAT_3PM_LA })).toBe('Edited by ana, was Sat 3:00 PM');
  });
  it('place only', () => {
    expect(line({ location: 'North gate' })).toBe('Edited by ana, was North gate');
  });
  it('both', () => {
    expect(line({ location: 'North gate', meetAt: SAT_3PM_LA })).toBe('Edited by ana, was North gate at Sat 3:00 PM');
  });
  it('old time null reads no time', () => {
    expect(line({ meetAt: null })).toBe('Edited by ana, was no time');
  });
  it('recurring reads daily', () => {
    expect(line({ meetAt: SAT_3PM_LA }, { recurs_daily: true })).toBe('Edited by ana, was daily 3:00 PM');
  });
  it('missing editor name', () => {
    expect(line({ location: 'North gate' }, { editor_name: null })).toBe('Edited, was North gate');
    expect(line({ location: 'North gate' }, { editor_name: '' })).toBe('Edited, was North gate');
  });
  it('empty or null edit_was gives null', () => {
    expect(line({})).toBeNull();
    expect(line(null)).toBeNull();
  });
  it('uses the festival zone, not the UTC now', () => {
    expect(line({ meetAt: SAT_3PM_LA }, { timeZone: 'America/Los_Angeles' })).toContain('3:00 PM');
    expect(line({ meetAt: SAT_3PM_LA }, { timeZone: 'UTC' })).toContain('10:00 PM');
  });
});
