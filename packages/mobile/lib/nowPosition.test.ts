import { nowPositionPercent } from './nowPosition';

const TZ = 'America/New_York';
// 2026-07-10 is EDT (UTC-4): 18:00 local = 22:00Z.
const bounds = { minMin: 14 * 60, maxMin: 26 * 60 }; // 14:00 -> 02:00 next day

describe('nowPositionPercent', () => {
  it('returns null for a past festival even when the wall-clock time is in range', () => {
    const now = Date.UTC(2026, 9, 28, 22, 0); // Oct 28, 18:00 EDT
    expect(nowPositionPercent(now, '2026-07-10', bounds, TZ)).toBeNull();
  });

  it('positions the line on the current festival day in the festival zone', () => {
    const now = Date.UTC(2026, 6, 10, 22, 0); // Jul 10, 18:00 EDT
    expect(nowPositionPercent(now, '2026-07-10', bounds, TZ)).toBeCloseTo((4 / 12) * 100, 5);
  });

  it('uses the festival zone, not the device zone', () => {
    // 03:00Z Jul 11 is 23:00 EDT Jul 10: inside the window.
    const now = Date.UTC(2026, 6, 11, 3, 0);
    expect(nowPositionPercent(now, '2026-07-10', bounds, TZ)).toBeCloseTo((9 / 12) * 100, 5);
  });

  it('keeps the line for a set running past midnight, on the next calendar day', () => {
    const now = Date.UTC(2026, 6, 11, 5, 30); // Jul 11, 01:30 EDT
    expect(nowPositionPercent(now, '2026-07-10', bounds, TZ)).toBeCloseTo((11.5 / 12) * 100, 5);
  });

  it('hides the line after the window closes and before it opens', () => {
    expect(nowPositionPercent(Date.UTC(2026, 6, 11, 7, 0), '2026-07-10', bounds, TZ)).toBeNull(); // 03:00 EDT
    expect(nowPositionPercent(Date.UTC(2026, 6, 10, 15, 0), '2026-07-10', bounds, TZ)).toBeNull(); // 11:00 EDT
  });

  it('returns null without a day date', () => {
    expect(nowPositionPercent(Date.now(), undefined, bounds, TZ)).toBeNull();
  });
});
