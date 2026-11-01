import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useNotificationTopics } from '../useNotificationTopics';
import { useAuthStore } from '../../stores/authStore';
import { useFestivalStore } from '../../stores/festivalStore';
import { api } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

function setMember(member: boolean) {
  useAuthStore.setState({ user: { id: 'u1' } } as never);
  useFestivalStore.setState({
    currentFestival: { id: 'f1', name: 'Fest' },
    currentProfile: member ? { festivalId: 'f1' } : { festivalId: 'other' },
  } as never);
}

describe('useNotificationTopics', () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.put.mockReset();
  });

  it('makes no request for a non-member', () => {
    setMember(false);
    const { result } = renderHook(() => useNotificationTopics());
    expect(result.current.festival).toBeNull();
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('loads topics for a member', async () => {
    setMember(true);
    mockApi.get.mockResolvedValue({ crew: true, schedule: false });
    const { result } = renderHook(() => useNotificationTopics());
    expect(result.current.subs).toBeNull();
    await waitFor(() => expect(result.current.subs).toEqual({ crew: true, schedule: false }));
    expect(result.current.festival).toEqual({ id: 'f1', name: 'Fest' });
  });

  it('rolls back only the failed key and re-throws', async () => {
    setMember(true);
    mockApi.get.mockResolvedValue({ crew: true, schedule: true });
    mockApi.put.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useNotificationTopics());
    await waitFor(() => expect(result.current.subs).not.toBeNull());
    await act(async () => {
      await expect(result.current.setTopic('crew', false)).rejects.toThrow('nope');
    });
    expect(result.current.subs).toEqual({ crew: true, schedule: true });
  });
});
