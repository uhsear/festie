import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { api } from '../services/api';
import { useAuthStore } from './authStore';
import { useFollowStore } from './followStore';
import { resetAllStores } from './resetStores';

const mockApi = api as unknown as Record<'get' | 'put' | 'delete', ReturnType<typeof vi.fn>>;

describe('followStore', () => {
  beforeEach(() => {
    useFollowStore.setState({ festivalIds: [], loaded: false });
    useAuthStore.setState({ user: null });
    Object.values(mockApi).forEach((m) => m.mockReset());
  });

  it('load is a no-op for guests', async () => {
    await useFollowStore.getState().load();
    expect(mockApi.get).not.toHaveBeenCalled();
    expect(useFollowStore.getState().loaded).toBe(false);
  });

  it('load reads the follows for a signed-in user', async () => {
    useAuthStore.setState({ user: { id: 'u1' } as never });
    mockApi.get.mockResolvedValue({ festivalIds: ['f1', 'f2'] });
    await useFollowStore.getState().load();
    expect(mockApi.get).toHaveBeenCalledWith('/festivals/follows');
    expect(useFollowStore.getState().isFollowing('f2')).toBe(true);
    expect(useFollowStore.getState().loaded).toBe(true);
  });

  it('shares one request between concurrent loads', async () => {
    useAuthStore.setState({ user: { id: 'u1' } as never });
    mockApi.get.mockResolvedValue({ festivalIds: ['f1'] });
    await Promise.all([1, 2, 3].map(() => useFollowStore.getState().load()));
    expect(mockApi.get).toHaveBeenCalledTimes(1);
    expect(useFollowStore.getState().festivalIds).toEqual(['f1']);
  });

  it('keeps a toggle made while a load is in flight', async () => {
    useAuthStore.setState({ user: { id: 'u1' } as never });
    let resolveGet!: (v: { festivalIds: string[] }) => void;
    mockApi.get.mockReturnValue(new Promise((r) => (resolveGet = r)));
    mockApi.put.mockResolvedValue({});
    mockApi.delete.mockResolvedValue({});
    const loading = useFollowStore.getState().load();
    await useFollowStore.getState().setFollowing('f3', true);
    await useFollowStore.getState().setFollowing('f1', false);
    resolveGet({ festivalIds: ['f1', 'f2'] });
    await loading;
    expect(useFollowStore.getState().festivalIds).toEqual(['f3', 'f2']);
    expect(useFollowStore.getState().loaded).toBe(true);
  });

  it('drops a snapshot that lands after sign-out', async () => {
    useAuthStore.setState({ user: { id: 'u1' } as never });
    let resolveGet!: (v: { festivalIds: string[] }) => void;
    mockApi.get.mockReturnValue(new Promise((r) => (resolveGet = r)));
    const loading = useFollowStore.getState().load();
    useAuthStore.setState({ user: null });
    resolveGet({ festivalIds: ['f1'] });
    await loading;
    expect(useFollowStore.getState()).toMatchObject({ festivalIds: [], loaded: false });
  });

  it('follows optimistically and unfollows', async () => {
    let resolve!: () => void;
    mockApi.put.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const pending = useFollowStore.getState().setFollowing('f1', true);
    expect(useFollowStore.getState().isFollowing('f1')).toBe(true);
    resolve();
    await pending;
    expect(mockApi.put).toHaveBeenCalledWith('/festivals/f1/follow', {});
    mockApi.delete.mockResolvedValue({});
    await useFollowStore.getState().setFollowing('f1', false);
    expect(mockApi.delete).toHaveBeenCalledWith('/festivals/f1/follow');
    expect(useFollowStore.getState().isFollowing('f1')).toBe(false);
  });

  it('reverts and rethrows when the write fails', async () => {
    useFollowStore.setState({ festivalIds: ['f9'] });
    mockApi.put.mockRejectedValue(new Error('boom'));
    await expect(useFollowStore.getState().setFollowing('f1', true)).rejects.toThrow('boom');
    expect(useFollowStore.getState().festivalIds).toEqual(['f9']);
  });

  it('is cleared by resetAllStores', () => {
    useFollowStore.setState({ festivalIds: ['f1'], loaded: true });
    resetAllStores();
    expect(useFollowStore.getState()).toMatchObject({ festivalIds: [], loaded: false });
  });
});
