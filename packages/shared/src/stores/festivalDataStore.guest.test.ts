import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFestivalDataStore } from './festivalDataStore';
import { useAuthStore } from './authStore';
import { api } from '../services/api';
import type { Profile, User } from '../types/domain';

vi.mock('../services/api', () => {
  const get = vi.fn();
  // The profiles list reads meta.pickCounts through getEnvelope; route it through
  // the get mock so each test's queued responses still apply in order.
  const getEnvelope = vi.fn(async (path: string) => ({ data: await get(path), meta: {} }));
  return { api: { get, getEnvelope, post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const user = { id: 'user-1' } as User;
const store = () => useFestivalDataStore.getState();

function profile(picks: Profile['picks'] = {}): Profile {
  return { id: 'prof-1', userId: 'user-1', festivalId: 'f1', picks, notes: {}, updatedAt: '' };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: null, userToken: null });
  useFestivalDataStore.setState({
    currentFestivalId: 'f1',
    currentFestival: null,
    currentProfile: null,
    allProfiles: [],
    sets: [{ id: 's1' }, { id: 's2' }] as never,
    guestPicks: {},
    pickSync: {},
  });
});

describe('guest picks', () => {
  it('savePick writes guestPicks and calls no api method', async () => {
    await store().savePick({ festivalId: 'f1', setId: 's1', priority: 'must' });
    expect(store().guestPicks).toEqual({ f1: { s1: 'must' } });
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
    expect(store().pickSync).toEqual({});
  });

  it('savePick(null) and removePick delete the key and drop an empty festival', async () => {
    useFestivalDataStore.setState({ guestPicks: { f1: { s1: 'must', s2: 'maybe' } } });
    await store().savePick({ festivalId: 'f1', setId: 's1', priority: null });
    expect(store().guestPicks).toEqual({ f1: { s2: 'maybe' } });
    await store().removePick('f1', 's2');
    expect(store().guestPicks).toEqual({});
  });

  it('bulkSavePicks never downgrades must and returns the changed count', async () => {
    useFestivalDataStore.setState({ guestPicks: { f1: { s1: 'must' } } });
    const changed = await store().bulkSavePicks(['s1', 's2'], 'maybe');
    expect(changed).toBe(1);
    expect(store().guestPicks).toEqual({ f1: { s1: 'must', s2: 'maybe' } });
  });

  it('restorePicks undoes a guest bulk add on the device', async () => {
    useFestivalDataStore.setState({ guestPicks: { f1: { s1: 'must' } } });
    await store().bulkSavePicks(['s1', 's2'], 'must');
    await store().restorePicks({ s2: undefined });
    expect(store().guestPicks).toEqual({ f1: { s1: 'must' } });
    await store().restorePicks({ s1: 'maybe' });
    expect(store().guestPicks).toEqual({ f1: { s1: 'maybe' } });
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it('throws without a festival', async () => {
    useFestivalDataStore.setState({ currentFestivalId: null });
    await expect(store().bulkSavePicks(['s1'], 'must')).rejects.toThrow('Choose a festival first');
  });

  it('a signed-in user with no profile still joins the festival', async () => {
    useAuthStore.setState({ user });
    vi.mocked(api.post).mockResolvedValueOnce({});
    vi.mocked(api.get).mockResolvedValueOnce([profile()]);
    vi.mocked(api.put).mockResolvedValueOnce({});
    await store().savePick({ festivalId: 'f1', setId: 's1', priority: 'must' });
    expect(api.post).toHaveBeenCalledWith('/profiles', { festivalId: 'f1' });
    expect(store().guestPicks).toEqual({});
  });
});

describe('mergeGuestPicks', () => {
  beforeEach(() => {
    useAuthStore.setState({ user });
    useFestivalDataStore.setState({ guestPicks: { f1: { s1: 'must', gone: 'maybe' } } });
  });

  it('posts the profile, PUTs the merged map, then clears guestPicks', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(profile({ s2: 'want-to-see' }));
    vi.mocked(api.put).mockResolvedValueOnce({});
    vi.mocked(api.get).mockResolvedValueOnce([]);
    await store().mergeGuestPicks();
    expect(api.post).toHaveBeenCalledWith('/profiles', { festivalId: 'f1' });
    expect(api.put).toHaveBeenCalledWith(
      '/profiles/prof-1',
      { picks: { s1: 'must', s2: 'want-to-see' } },
      { clientId: 'guest-merge-prof-1', offlineLabel: 'Update picks' },
    );
    expect(store().guestPicks).toEqual({});
    expect(api.get).toHaveBeenCalledWith('/profiles/f1');
  });

  it('does not PUT when nothing is added, but still clears', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(profile({ s1: 'maybe' }));
    vi.mocked(api.get).mockResolvedValueOnce([]);
    await store().mergeGuestPicks();
    expect(api.put).not.toHaveBeenCalled();
    expect(store().guestPicks).toEqual({});
  });

  it('keeps guestPicks on a network error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await store().mergeGuestPicks();
    expect(store().guestPicks.f1).toBeDefined();
    warn.mockRestore();
  });

  it('clears only the festival that returned 404', async () => {
    useFestivalDataStore.setState({ guestPicks: { f1: { s1: 'must' }, f2: { x: 'must' } } });
    vi.mocked(api.post)
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }))
      .mockRejectedValueOnce(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await store().mergeGuestPicks();
    expect(store().guestPicks).toEqual({ f2: { x: 'must' } });
    warn.mockRestore();
  });

  it('shares one in-flight merge between concurrent calls', async () => {
    vi.mocked(api.post).mockResolvedValue(profile({ s2: 'maybe' }));
    vi.mocked(api.put).mockResolvedValue({});
    vi.mocked(api.get).mockResolvedValue([]);
    await Promise.all([store().mergeGuestPicks(), store().mergeGuestPicks()]);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
