import { afterEach, describe, expect, it, vi } from 'vitest';

// The grid labels read the runtime locale. Load a fresh module with the runtime default set to `locale`,
// so the hour-cycle cache starts empty and the 12-hour and 24-hour branches both run on any host.
async function gridIn(locale: string) {
  vi.resetModules();
  vi.restoreAllMocks();
  const RealDateTimeFormat = Intl.DateTimeFormat;
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      return new RealDateTimeFormat(locales ?? locale, options);
    } as unknown as typeof Intl.DateTimeFormat,
  );
  return import('./grid');
}

afterEach(() => vi.restoreAllMocks());

describe('grid time labels', () => {
  it('keep the compact 12-hour form in a 12-hour locale', async () => {
    const grid = await gridIn('en-US');
    expect(grid.fmtHour(21 * 60)).toBe('9pm');
    expect(grid.fmtShort('21:30')).toBe('9:30pm');
    expect(grid.fmtAxisHour(21 * 60)).toBe('9p');
    expect(grid.fmtAxisHour(9 * 60 + 30)).toBe('9:30a');
  });

  it.each(['en-GB', 'de-DE'])('use plain 24-hour times in %s', async (locale) => {
    const grid = await gridIn(locale);
    expect(grid.fmtHour(21 * 60)).toBe('21:00');
    expect(grid.fmtShort('21:30')).toBe('21:30');
    expect(grid.fmtShort('9:05')).toBe('09:05');
    expect(grid.fmtAxisHour(21 * 60)).toBe('21:00');
    expect(grid.fmtAxisHour(9 * 60 + 30)).toBe('09:30');
  });

  it('wraps a festival-day minute past midnight in both cycles', async () => {
    expect((await gridIn('en-US')).fmtAxisHour(25 * 60)).toBe('1a');
    expect((await gridIn('en-GB')).fmtAxisHour(25 * 60)).toBe('01:00');
  });
});
