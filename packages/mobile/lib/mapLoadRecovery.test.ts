import { describe, it, expect } from 'vitest';
import { decideLoadFailure, MAX_AUTO_REMOUNTS } from './mapLoadRecovery';

describe('decideLoadFailure', () => {
  it('remounts the WebView on the first failure', () => {
    expect(decideLoadFailure(0)).toBe('remount');
  });

  it('falls back to the banner once the automatic remount is spent', () => {
    expect(decideLoadFailure(MAX_AUTO_REMOUNTS)).toBe('fallback');
    expect(decideLoadFailure(MAX_AUTO_REMOUNTS + 3)).toBe('fallback');
  });
});
