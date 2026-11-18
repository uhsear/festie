import { describe, it, expect } from 'vitest';
import { mapErrorToUserMessage, isEdgeUnavailable, canQueueOnEdgeError } from '../errors';

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

describe('edge 5xx queueing', () => {
  it('flags edge statuses and leaves app errors alone', () => {
    for (const status of [502, 503, 504, 520, 521, 524, 530]) expect(isEdgeUnavailable(status)).toBe(true);
    for (const status of [undefined, 0, 200, 400, 409, 429, 500]) expect(isEdgeUnavailable(status)).toBe(false);
  });
  it('queues PUT, PATCH and DELETE on any edge status', () => {
    for (const method of ['PUT', 'patch', 'DELETE']) {
      expect(canQueueOnEdgeError(502, method)).toBe(true);
      expect(canQueueOnEdgeError(530, method)).toBe(true);
    }
  });
  it('queues a POST only when the origin never ran it', () => {
    expect(canQueueOnEdgeError(530, 'POST')).toBe(true);
    expect(canQueueOnEdgeError(521, 'POST')).toBe(true);
    expect(canQueueOnEdgeError(502, 'POST')).toBe(false);
    expect(canQueueOnEdgeError(504, 'POST')).toBe(false);
  });
  it('never queues a GET', () => {
    expect(canQueueOnEdgeError(502, 'GET')).toBe(false);
  });
});

