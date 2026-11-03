import { describe, it, expect } from 'vitest';
import { offlineReminderAt, offlineReminderId } from './offlineReminder';

const NY = 'America/New_York';
const hourIn = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);

describe('offlineReminderAt', () => {
  it('returns null when the pack is ready', () => {
    expect(offlineReminderAt([{ date: '2026-11-02' }], { timeZone: NY, packReady: true })).toBeNull();
  });

  it('returns null when no day has a date', () => {
    expect(offlineReminderAt([], { timeZone: NY, packReady: false })).toBeNull();
    expect(offlineReminderAt([{ date: null }], { timeZone: NY, packReady: false })).toBeNull();
  });

  it('returns 18:00 festival time on the day before day 1, on the autumn DST-change day', () => {
    // 2026-11-01 is the day New York falls back to EST (UTC-5).
    const at = offlineReminderAt([{ date: '2026-11-03' }, { date: '2026-11-02' }], { timeZone: NY, packReady: false });
    expect(at).toBe(Date.UTC(2026, 10, 1, 23, 0));
    expect(hourIn(at!, NY)).toBe('18:00');
  });

  it('returns 18:00 festival time on the spring DST-change day', () => {
    // 2026-03-08 is the day New York springs forward to EDT (UTC-4).
    const at = offlineReminderAt([{ date: '2026-03-09' }], { timeZone: NY, packReady: false });
    expect(at).toBe(Date.UTC(2026, 2, 8, 22, 0));
  });

  it('crosses a month boundary', () => {
    const at = offlineReminderAt([{ date: '2026-08-01' }], { timeZone: 'UTC', packReady: false });
    expect(at).toBe(Date.UTC(2026, 6, 31, 18, 0));
  });

  it('uses the device clock when the festival has no zone', () => {
    const at = offlineReminderAt([{ date: '2026-07-10' }], { packReady: false });
    expect(new Date(at!).getHours()).toBe(18);
    expect(new Date(at!).getDate()).toBe(9);
  });

  it('skips a reminder that falls in quiet hours', () => {
    const quiet = { dndStart: '17:00', dndEnd: '19:00', dndTimeZone: NY };
    expect(offlineReminderAt([{ date: '2026-11-02' }], { timeZone: NY, packReady: false, quietHours: quiet })).toBeNull();
    const nights = { dndStart: '23:00', dndEnd: '08:00', dndTimeZone: NY };
    expect(offlineReminderAt([{ date: '2026-11-02' }], { timeZone: NY, packReady: false, quietHours: nights })).not.toBeNull();
  });
});

describe('offlineReminderId', () => {
  it('is stable per festival', () => {
    expect(offlineReminderId('f1')).toBe('festie-offline-pack-f1');
  });
});
