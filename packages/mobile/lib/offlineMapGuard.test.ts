import { describe, it, expect } from 'vitest';
import { checkMapSpace, FREE_SPACE_MARGIN_BYTES } from './offlineMapGuard';

const MB = 1_000_000;

describe('checkMapSpace', () => {
  it('is ok when the archive plus the margin fits', () => {
    expect(checkMapSpace(100 * MB, 100 * MB + FREE_SPACE_MARGIN_BYTES)).toEqual({ ok: true });
    expect(checkMapSpace(100 * MB, 10_000 * MB)).toEqual({ ok: true });
  });

  it('refuses with the needed and free sizes when it does not fit', () => {
    const result = checkMapSpace(100 * MB, 120 * MB);
    expect(result).toEqual({
      ok: false,
      message: `Not enough free space to save the map (needs ${Math.ceil((100 * MB + FREE_SPACE_MARGIN_BYTES) / MB)} MB, 120 MB free). Free up some space and try again.`,
    });
  });

  it('refuses when only the margin does not fit', () => {
    expect(checkMapSpace(100 * MB, 100 * MB + FREE_SPACE_MARGIN_BYTES - 1).ok).toBe(false);
  });

  it('proceeds when either number is unknown', () => {
    expect(checkMapSpace(null, 10 * MB)).toEqual({ ok: true });
    expect(checkMapSpace(100 * MB, null)).toEqual({ ok: true });
    expect(checkMapSpace(100 * MB, Number.NaN)).toEqual({ ok: true });
    expect(checkMapSpace(100 * MB, 0)).toEqual({ ok: true });
  });
});
