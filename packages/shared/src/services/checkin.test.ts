import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkinErrorMessage, markSosSeen } from './checkin';
import { api, ApiClientError } from './api';
import { useLiveLocationStore } from '../stores/liveLocationStore';

vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

describe('checkinErrorMessage', () => {
  const err = (status: number, network = false) => new ApiClientError('x', status, undefined, undefined, network);

  it('no network', () => {
    expect(checkinErrorMessage(err(0, true), 'start')).toBe(
      'No signal — the timer did not start. Tell your crew where you are going another way.',
    );
    expect(checkinErrorMessage(err(0, true), 'done')).toBe(
      'No signal — your timer is still running. Try again, or your crew gets an SOS when it ends.',
    );
  });

  it('503', () => {
    expect(checkinErrorMessage(err(503), 'start')).toBe(
      'Check-in timers are not available right now. Tell your crew where you are going.',
    );
    expect(checkinErrorMessage(err(503), 'done')).toBe('Check-in timers are not available right now.');
  });

  it('403', () => {
    expect(checkinErrorMessage(err(403), 'start')).toBe("You're not in this crew any more.");
    expect(checkinErrorMessage(err(403), 'done')).toBe("You're not in this crew any more.");
  });

  it('other errors fall back to the action message', () => {
    expect(checkinErrorMessage(undefined, 'start')).toBe('Could not start the timer. Try again.');
    expect(checkinErrorMessage(undefined, 'done')).toBe('Could not stop the timer. Try again.');
  });
});

describe('markSosSeen', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    useLiveLocationStore.getState().reset();
    useLiveLocationStore.setState({ crewId: 'c1' });
    useLiveLocationStore.getState().applySos({ crewId: 'c1', userId: 'u1', username: 'u1', raisedAt: '2026-06-06T12:00:00.000Z' });
  });

  it('applies the returned viewer list to the store', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ seenBy: [{ userId: 'u2', username: 'Sam' }] });
    await markSosSeen('c1', 'u1');
    expect(api.post).toHaveBeenCalledWith('/crews/c1/sos/seen', { raiserId: 'u1' });
    expect(useLiveLocationStore.getState().sosByUser['u1']!.seenBy).toEqual([{ userId: 'u2', username: 'Sam' }]);
  });
});
