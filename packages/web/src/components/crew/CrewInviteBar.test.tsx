import { describe, it, expect } from 'vitest';
import { formatExpiry } from './CrewInviteBar';

const NOW = Date.parse('2026-06-15T12:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();

describe('formatExpiry', () => {
  it('returns null when there is no expiry', () => {
    expect(formatExpiry(null, NOW)).toBeNull();
    expect(formatExpiry(undefined, NOW)).toBeNull();
  });

  it('formats days, hours, and minutes ahead', () => {
    expect(formatExpiry(at(3 * 86_400_000), NOW)).toBe('Expires in 3d');
    expect(formatExpiry(at(5 * 3_600_000), NOW)).toBe('Expires in 5h');
    expect(formatExpiry(at(20 * 60_000), NOW)).toBe('Expires in 20m');
  });

  it('says Expired once the time has passed', () => {
    expect(formatExpiry(at(-1000), NOW)).toBe('Expired');
  });
});
