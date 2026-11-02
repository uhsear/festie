import { describe, it, expect } from 'vitest';
import { scrubToken } from './scrubUrl';

describe('scrubToken', () => {
  it('redacts the token value and keeps other params', () => {
    expect(scrubToken('/reset-password?token=abc&x=1')).toBe('/reset-password?token=[redacted]&x=1');
  });
  it('leaves undefined alone', () => {
    expect(scrubToken(undefined)).toBeUndefined();
  });
});
