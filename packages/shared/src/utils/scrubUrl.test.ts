import { describe, it, expect } from 'vitest';
import { scrubSensitiveUrl } from './scrubUrl';

describe('scrubSensitiveUrl', () => {
  it('redacts token, code and joinCrew query values', () => {
    expect(scrubSensitiveUrl('/a?token=abc&x=1')).toBe('/a?token=[redacted]&x=1');
    expect(scrubSensitiveUrl('/a?code=K9&x=1')).toBe('/a?code=[redacted]&x=1');
    expect(scrubSensitiveUrl('/a?x=1&joinCrew=ZZ#h')).toBe('/a?x=1&joinCrew=[redacted]#h');
  });
  it('redacts path secrets', () => {
    expect(scrubSensitiveUrl('/reset/abc123')).toBe('/reset/[redacted]');
    expect(scrubSensitiveUrl('/cal/tok123.ics')).toBe('/cal/[redacted].ics');
    expect(scrubSensitiveUrl('/join/ABCD?x=1')).toBe('/join/[redacted]?x=1');
  });
  it('redacts deep links', () => {
    expect(scrubSensitiveUrl('festie://reset-password?token=abc')).toBe('festie://reset-password?token=[redacted]');
    expect(scrubSensitiveUrl('festie://join/ABCD')).toBe('festie://join/[redacted]');
  });
  it('handles two secrets in one URL', () => {
    expect(scrubSensitiveUrl('https://x.test/join/ABCD?token=t')).toBe('https://x.test/join/[redacted]?token=[redacted]');
  });
  it('leaves clean URLs and undefined alone', () => {
    expect(scrubSensitiveUrl('/festivals/1?tab=2')).toBe('/festivals/1?tab=2');
    expect(scrubSensitiveUrl(undefined)).toBeUndefined();
  });
  it('is idempotent', () => {
    const once = scrubSensitiveUrl('/cal/tok.ics?token=t')!;
    expect(scrubSensitiveUrl(once)).toBe(once);
  });
});
