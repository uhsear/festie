// The pure validators under test (isValidDate / isValidTime / HEX_RE) are
// lifted into lib/adminValidators.ts — a framework-free module with no react /
// react-native imports — so this test loads cleanly under node-vitest without
// stubbing the token runtime. AdminFields.tsx re-exports them for the component.
import {
  isValidDate,
  isValidTime,
  HEX_RE,
  filterOptions,
  pickerDateFromValue,
  valueFromPickerDate,
} from '../../lib/adminValidators';

// Mobile-LOCAL validators for the OTA-able admin write surface (no native
// datetimepicker / color-picker). These are the pure branches behind
// DateField / TimeField / HexColorField -- the screens themselves are thin, so
// the validation logic is the meaningful thing to lock down.

describe('isValidDate (YYYY-MM-DD calendar date)', () => {
  it('accepts a real date', () => {
    expect(isValidDate('2026-06-23')).toBe(true);
  });

  it('accepts a valid leap day (2024-02-29)', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
  });

  it('rejects a non-leap-year Feb 29 (2025-02-29)', () => {
    expect(isValidDate('2025-02-29')).toBe(false);
  });

  it('rejects an impossible day-of-month (2026-02-30)', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
  });

  it('rejects an out-of-range month (2026-13-01)', () => {
    expect(isValidDate('2026-13-01')).toBe(false);
  });

  it('rejects a non-ISO format (6/23/26)', () => {
    expect(isValidDate('6/23/26')).toBe(false);
  });

  it('rejects empty, garbage and partial values', () => {
    expect(isValidDate('')).toBe(false);
    expect(isValidDate('TBA')).toBe(false);
    expect(isValidDate('2026-6-3')).toBe(false); // unpadded
    expect(isValidDate('2026-00-10')).toBe(false); // month 0
    expect(isValidDate('2026-06-00')).toBe(false); // day 0
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidDate('  2026-06-23  ')).toBe(true);
  });
});

describe('isValidTime (24h HH:MM)', () => {
  it('accepts midnight and the last minute of the day', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
  });

  it('rejects 24:00 (hour out of range)', () => {
    expect(isValidTime('24:00')).toBe(false);
  });

  it('rejects 23:60 (minute out of range)', () => {
    expect(isValidTime('23:60')).toBe(false);
  });

  it("rejects unpadded '9:5'", () => {
    expect(isValidTime('9:5')).toBe(false);
  });

  it('rejects empty and garbage', () => {
    expect(isValidTime('')).toBe(false);
    expect(isValidTime('noon')).toBe(false);
    expect(isValidTime('12:00:00')).toBe(false); // seconds not allowed
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidTime('  09:05  ')).toBe(true);
  });
});

describe('filterOptions (ModalSelect search)', () => {
  const zones = ['Asia/Tokyo', 'America/New_York', 'Europe/Amsterdam'].map((z) => ({ label: z, value: z }));

  it('keeps only labels containing the query, ignoring case', () => {
    expect(filterOptions(zones, 'tok').map((o) => o.value)).toEqual(['Asia/Tokyo']);
    expect(filterOptions(zones, 'AMS').map((o) => o.value)).toEqual(['Europe/Amsterdam']);
  });

  it('keeps everything for a blank query', () => {
    expect(filterOptions(zones, '  ')).toHaveLength(3);
  });

  it('returns nothing when no label matches', () => {
    expect(filterOptions(zones, 'zzz')).toEqual([]);
  });
});

describe('Android picker value mapping', () => {
  const now = new Date(2026, 5, 3, 8, 15);

  it('opens a valid date at local noon', () => {
    const d = pickerDateFromValue('date', '2026-06-23', now);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 5, 23, 12]);
  });

  it('opens a valid time today at that hour and minute', () => {
    const d = pickerDateFromValue('time', '21:30', now);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 5, 3, 21, 30]);
  });

  it('opens a blank time at today 12:00', () => {
    const d = pickerDateFromValue('time', '', now);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([3, 12, 0]);
  });

  it('opens TBA / invalid at now (date) or 12:00 (time)', () => {
    expect(pickerDateFromValue('date', 'TBA', now)).toBe(now);
    expect(pickerDateFromValue('date', '', now)).toBe(now);
    expect(pickerDateFromValue('time', 'TBA', now).getHours()).toBe(12);
  });

  it('zero-pads picked values', () => {
    expect(valueFromPickerDate('time', new Date(2026, 0, 1, 9, 5))).toBe('09:05');
    expect(valueFromPickerDate('date', new Date(2026, 5, 3))).toBe('2026-06-03');
  });

  it('round-trips', () => {
    expect(valueFromPickerDate('date', pickerDateFromValue('date', '2026-12-31', now))).toBe('2026-12-31');
    expect(valueFromPickerDate('time', pickerDateFromValue('time', '00:00', now))).toBe('00:00');
    expect(valueFromPickerDate('time', pickerDateFromValue('time', '23:59', now))).toBe('23:59');
  });
});

describe('HEX_RE (#RRGGBB)', () => {
  it('accepts a full lowercase 6-digit hex', () => {
    expect(HEX_RE.test('#1a2b3c')).toBe(true);
  });

  it('accepts uppercase and mixed-case hex', () => {
    expect(HEX_RE.test('#1A2B3C')).toBe(true);
    expect(HEX_RE.test('#FfAa00')).toBe(true);
  });

  it('rejects the 3-digit shorthand (#fff)', () => {
    expect(HEX_RE.test('#fff')).toBe(false);
  });

  it('rejects a named color (red)', () => {
    expect(HEX_RE.test('red')).toBe(false);
  });

  it('rejects out-of-range hex digits (#GGGGGG)', () => {
    expect(HEX_RE.test('#GGGGGG')).toBe(false);
  });

  it('rejects missing hash, wrong length, and empty', () => {
    expect(HEX_RE.test('1a2b3c')).toBe(false); // no #
    expect(HEX_RE.test('#1a2b3')).toBe(false); // 5 digits
    expect(HEX_RE.test('#1a2b3cc')).toBe(false); // 7 digits
    expect(HEX_RE.test('')).toBe(false);
  });
});
