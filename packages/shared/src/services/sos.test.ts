import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearCrewSos, sosErrorMessage } from './sos';
import { api, ApiClientError } from './api';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import type { SosEntry } from '../types';

vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const sos = (userId: string): SosEntry => ({
  crewId: 'c1',
  userId,
  username: userId,
  raisedAt: '2026-06-06T12:00:00.000Z',
});

describe('clearCrewSos', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    useLiveLocationStore.getState().reset();
    useLiveLocationStore.setState({ crewId: 'c1' });
    useLiveLocationStore.getState().applySos(sos('u1'));
    useLiveLocationStore.getState().applySos(sos('u2'));
  });

  it('posts the raiser and clears that SOS', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({});
    await clearCrewSos('c1', 'u1');
    expect(api.post).toHaveBeenCalledWith('/crews/c1/sos/clear', { raiserId: 'u1' });
    expect(Object.keys(useLiveLocationStore.getState().sosByUser)).toEqual(['u2']);
  });

  it('treats 409 as success and clears the store', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiClientError('conflict', 409));
    await expect(clearCrewSos('c1', 'u1')).resolves.toBeUndefined();
    expect(Object.keys(useLiveLocationStore.getState().sosByUser)).toEqual(['u2']);
  });

  it('re-throws a 500 and leaves the store unchanged', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiClientError('boom', 500));
    await expect(clearCrewSos('c1', 'u1')).rejects.toThrow('boom');
    expect(Object.keys(useLiveLocationStore.getState().sosByUser).sort()).toEqual(['u1', 'u2']);
  });
});

describe('sosErrorMessage', () => {
  const err = (status: number, network = false) => new ApiClientError('x', status, undefined, undefined, network);

  it('no network', () => {
    expect(sosErrorMessage(err(0, true), 'send')).toBe(
      'No signal — your SOS was NOT sent. Use your phone or radio to reach your crew directly.',
    );
    expect(sosErrorMessage(err(0, true), 'clear')).toBe(
      'No signal — the SOS is still showing. Try again when you have signal.',
    );
  });

  it('429 on send', () => {
    expect(sosErrorMessage(err(429), 'send')).toBe('Your SOS is already active. Your crew can see it.');
  });

  it('503', () => {
    expect(sosErrorMessage(err(503), 'send')).toBe('SOS is turned off right now. Call or message your crew directly.');
    expect(sosErrorMessage(err(503), 'clear')).toBe('SOS is turned off right now.');
  });

  it('403', () => {
    expect(sosErrorMessage(err(403), 'send')).toBe("You're not in this crew any more, so your SOS was not sent.");
    expect(sosErrorMessage(err(403), 'clear')).toBe("You're not in this crew any more.");
  });

  it('anything else maps through the shared mapper with the action fallback', () => {
    expect(sosErrorMessage(err(500), 'send')).toBe('Something went wrong on our side. Try again in a minute.');
    expect(sosErrorMessage('weird', 'send')).toBe('Could not send your SOS. Try again.');
    expect(sosErrorMessage('weird', 'clear')).toBe('Could not clear the SOS. Try again.');
  });
});
