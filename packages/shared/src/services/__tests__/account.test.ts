import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from '../api';
import { exportErrorMessage, stopAllSharing } from '../account';
import { useAuthStore } from '../../stores/authStore';
import { useCrewStore } from '../../stores/crewStore';

const mockApi = api as unknown as { post: ReturnType<typeof vi.fn> };
const err = (status: number, retryAfter?: string) =>
  Object.assign(new Error('x'), { name: 'ApiClientError', status, retryAfter });

describe('exportErrorMessage', () => {
  it('429 with Retry-After in the morning says today', () => {
    const now = new Date(2026, 5, 10, 9, 0, 0).getTime();
    expect(exportErrorMessage(err(429, '3600'), now)).toMatch(
      /^You can download your data once a day\. Try again today at .+\.$/,
    );
  });

  it('429 late at night says tomorrow', () => {
    const now = new Date(2026, 5, 10, 23, 30, 0).getTime();
    expect(exportErrorMessage(err(429, '3600'), now)).toContain('Try again tomorrow at ');
  });

  it('429 without Retry-After has no time', () => {
    expect(exportErrorMessage(err(429))).toBe('You can download your data once a day. Try again tomorrow.');
  });

  it('500 gives the server-problem text', () => {
    expect(exportErrorMessage(err(500))).toBe('Something went wrong on our side. Try again in a minute.');
  });
});

describe('stopAllSharing', () => {
  const row = (user_id: string) => ({
    crew_id: 'c1', user_id, status: 'here' as const, target_meeting_point_id: null, eta_minutes: null, note: null,
    latitude: 28.5, longitude: -81.4, location_captured_at: '2026-06-10T09:00:00Z', updated_at: '2026-06-10T09:00:00Z',
  });

  beforeEach(() => {
    mockApi.post.mockReset();
    useAuthStore.setState({ user: { id: 'u1', username: 'a', publicSchedule: true } as never });
    useCrewStore.setState({ crewStatuses: [row('u1'), row('u2')] });
  });

  it('posts, merges the user and clears only my status location', async () => {
    mockApi.post.mockResolvedValue({ user: { id: 'u1', publicSchedule: false }, clearedStatusLocations: 2 });
    await stopAllSharing();
    expect(mockApi.post).toHaveBeenCalledWith('/account/stop-sharing', {});
    expect(useAuthStore.getState().user?.publicSchedule).toBe(false);
    expect(useAuthStore.getState().user?.username).toBe('a');
    const [mine, theirs] = useCrewStore.getState().crewStatuses;
    expect(mine).toMatchObject({ user_id: 'u1', status: 'here', latitude: null, longitude: null, location_captured_at: null });
    expect(theirs).toMatchObject({ user_id: 'u2', latitude: 28.5 });
  });

  it('propagates errors and leaves the status location', async () => {
    mockApi.post.mockRejectedValue(new Error('nope'));
    await expect(stopAllSharing()).rejects.toThrow('nope');
    expect(useCrewStore.getState().crewStatuses[0].latitude).toBe(28.5);
  });
});
