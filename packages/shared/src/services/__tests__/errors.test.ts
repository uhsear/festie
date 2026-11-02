import { describe, it, expect } from 'vitest';
import { mapErrorToUserMessage } from '../errors';

const apiErr = (o: Record<string, unknown>) =>
  Object.assign(new Error(String(o.message)), { name: 'ApiClientError', ...o });

describe('mapErrorToUserMessage', () => {
  it('strips the field path from a validation error', () => {
    expect(
      mapErrorToUserMessage(apiErr({ status: 400, code: 'VALIDATION_ERROR', message: 'newPassword: Too small' })),
    ).toBe('Too small');
  });
  it('falls back when nothing is left after the path', () => {
    expect(
      mapErrorToUserMessage(apiErr({ status: 400, code: 'VALIDATION_ERROR', message: 'a.b[0]: ' }), 'Nope'),
    ).toBe('Nope');
  });
  it('keeps other client messages', () => {
    expect(
      mapErrorToUserMessage(apiErr({ status: 403, code: 'PASSWORD_INCORRECT', message: 'Current password is wrong' })),
    ).toBe('Current password is wrong');
  });
  it('keeps the offline message', () => {
    expect(mapErrorToUserMessage(apiErr({ status: 0, isNetworkError: true, message: 'x' }))).toBe(
      "You're offline. Check your connection and try again.",
    );
  });
  it('keeps a plain Error message', () => {
    expect(mapErrorToUserMessage(new Error('boom'))).toBe('boom');
  });
});
