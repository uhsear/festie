import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchPastMeetingPoints } from './meetingPoints';
import { api } from './api';

vi.mock('./api', () => ({ api: { get: vi.fn() } }));

describe('fetchPastMeetingPoints', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('gets the encoded past route and unwraps meetingPoints', async () => {
    const points = [{ id: 'm1' }];
    vi.mocked(api.get).mockResolvedValueOnce({ meetingPoints: points });
    await expect(fetchPastMeetingPoints('a/b')).resolves.toBe(points);
    expect(api.get).toHaveBeenCalledWith('/crews/a%2Fb/meeting-points/past');
  });

  it('returns an empty list when the response is empty', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(undefined);
    await expect(fetchPastMeetingPoints('c')).resolves.toEqual([]);
    vi.mocked(api.get).mockResolvedValueOnce({});
    await expect(fetchPastMeetingPoints('c')).resolves.toEqual([]);
  });
});
