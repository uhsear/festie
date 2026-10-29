import { describe, it, expect } from 'vitest';
import { maskEmail } from './maskEmail';

describe('maskEmail', () => {
  it('keeps the first letter and the domain tail', () => {
    expect(maskEmail('asir@example.com')).toBe('a@…e.com');
  });
  it('never returns the full address for short domains', () => {
    expect(maskEmail('bo@x.io')).toBe('b@…x.io');
  });
  it('hides malformed values completely', () => {
    expect(maskEmail('not-an-email')).toBe('…');
    expect(maskEmail('@x.com')).toBe('…');
  });
});
