import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFestivalDataStore } from './festivalDataStore';
import { useAuthStore } from './authStore';
import { useUIStore } from './uiStore';
import { api } from '../services/api';
import type { Festival, InterestMark, Profile, User } from '../types/domain';

vi.mock('../services/api', () => {
  const get = vi.fn();
  const getEnvelope = vi.fn(async (path: string) => ({ data: await get(path), meta: {} }));
  return { api: { get, getEnvelope, post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const user = { id: 'user-1' } as User;
const store = () => useFestivalDataStore.getState();
const entry = (id: string, name: string) => ({
  id,
  artists: [{ name, links: {} }],
  displayName: null,
  tier: null,
  dayDate: null,
  status: 'announced' as const,
  announcedAt: '2026-11-20',
  linkedSetIds: [],
});
const festival = (lineup: ReturnType<typeof entry>[]): Festival =>
  ({
    id: 'f1',
    name: 'Fest',
    startDate: '2099-02-05',
    endDate: '2099-02-06',
    b2bSeparator: 'b2b',
    lineup,
    createdAt: '',
    updatedAt: '',
  }) as Festival;
const profile = (interests: Record<string, InterestMark> = {}, picks: Profile['picks'] = {}): Profile => ({
  id: 'prof-1',
  userId: 'user-1',
  festivalId: 'f1',
  picks,
  notes: {},
  interests,
  updatedAt: '',
});
const toastMessages = () => useUIStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ toasts: [], pendingSync: 0 });
  useAuthStore.setState({ user: null, userToken: null });
  useFestivalDataStore.setState({
    currentFestivalId: 'f1',
    currentFestival: festival([entry('lu-a', 'Alpha'), entry('lu-b', 'Beta')]),
    currentProfile: null,
    allProfiles: [],
    sets: [],
    days: [],
    guestPicks: {},
    guestInterests: {},
    pickSync: {},
    savesInFlight: 0,
  });
});

describe('toggleInterest', () => {
  it('a guest mark stays on the device and calls no api method', async () => {
    await store().toggleInterest('lu-a');
    expect(store().guestInterests).toEqual({ f1: { 'lu-a': { state: 'open' } } });
    await store().toggleInterest('lu-a');
    expect(store().guestInterests).toEqual({});
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it('a signed-in toggle sends one delta with its own clientId, then the opposite delta', async () => {
    useAuthStore.setState({ user });
    useFestivalDataStore.setState({ currentProfile: profile() });
    vi.mocked(api.put).mockResolvedValue({});

    await store().toggleInterest('lu-a');
    expect(store().currentProfile?.interests).toEqual({ 'lu-a': { state: 'open' } });
    expect(api.put).toHaveBeenLastCalledWith(
      '/profiles/prof-1',
      { interestAdd: ['lu-a'] },
      { clientId: 'interest-prof-1-lu-a', offlineLabel: 'Update picks' },
    );

    await store().toggleInterest('lu-a');
    expect(store().currentProfile?.interests).toEqual({});
    expect(api.put).toHaveBeenLastCalledWith(
      '/profiles/prof-1',
      { interestRemove: ['lu-a'] },
      { clientId: 'interest-prof-1-lu-a', offlineLabel: 'Update picks' },
    );
  });

  it('a tap on a converted mark clears it with a remove delta and leaves the picks', async () => {
    useAuthStore.setState({ user });
    useFestivalDataStore.setState({
      currentProfile: profile({ 'lu-a': { state: 'converted', sets: ['s1'] } }, { s1: 'want-to-see' }),
    });
    vi.mocked(api.put).mockResolvedValue({});
    await store().toggleInterest('lu-a');
    expect(api.put).toHaveBeenCalledWith('/profiles/prof-1', { interestRemove: ['lu-a'] }, expect.anything());
    expect(store().currentProfile?.interests).toEqual({});
    expect(store().currentProfile?.picks).toEqual({ s1: 'want-to-see' });
  });

  it('rolls back only its own mark when the write fails', async () => {
    useAuthStore.setState({ user });
    useFestivalDataStore.setState({ currentProfile: profile({ 'lu-b': { state: 'open' } }) });
    vi.mocked(api.put).mockRejectedValueOnce(new Error('boom'));
    await expect(store().toggleInterest('lu-a')).rejects.toThrow('boom');
    expect(store().currentProfile?.interests).toEqual({ 'lu-b': { state: 'open' } });
    expect(store().error).toBeTruthy();
  });
});

describe('applyProfilePatch', () => {
  it('returns false when interestsChanged, so the caller reloads the marks', () => {
    useFestivalDataStore.setState({ allProfiles: [profile()], currentProfile: profile() });
    expect(store().applyProfilePatch({ profileId: 'prof-1', picks: { s1: 'must' }, interestsChanged: true })).toBe(false);
    expect(store().currentProfile?.picks).toEqual({});
    expect(store().applyProfilePatch({ profileId: 'prof-1', picks: { s1: 'must' } })).toBe(true);
  });
});

describe('the converted-marks toast', () => {
  it('shows once per reload that turns open marks into converted ones', async () => {
    useAuthStore.setState({ user });
    useFestivalDataStore.setState({
      currentProfile: profile({ 'lu-a': { state: 'open' }, 'lu-b': { state: 'open' } }),
    });
    vi.mocked(api.get).mockResolvedValueOnce([
      profile(
        { 'lu-a': { state: 'converted', sets: ['s1'] }, 'lu-b': { state: 'converted', sets: ['s2'] } },
        { s1: 'want-to-see', s2: 'want-to-see' },
      ),
    ]);
    await store().loadProfiles('f1');
    expect(toastMessages()).toEqual(['2 acts you marked now have sets. We added them to your picks.']);

    // The same marks on a second reload are not news.
    vi.mocked(api.get).mockResolvedValueOnce([
      profile({ 'lu-a': { state: 'converted', sets: ['s1'] }, 'lu-b': { state: 'converted', sets: ['s2'] } }),
    ]);
    await store().loadProfiles('f1');
    expect(toastMessages()).toHaveLength(1);
  });

  it('a pending write keeps the optimistic marks over a stale read', async () => {
    useAuthStore.setState({ user });
    useFestivalDataStore.setState({ currentProfile: profile({ 'lu-a': { state: 'open' } }), savesInFlight: 1 });
    vi.mocked(api.get).mockResolvedValueOnce([profile({})]);
    await store().loadProfiles('f1');
    expect(store().currentProfile?.interests).toEqual({ 'lu-a': { state: 'open' } });
  });
});

describe('mergeGuestInterests', () => {
  beforeEach(() => {
    useAuthStore.setState({ user });
    useFestivalDataStore.setState({
      guestInterests: {
        f1: {
          'lu-a': { state: 'open' },
          'lu-b': { state: 'open' },
          'lu-gone': { state: 'open' },
          'lu-done': { state: 'converted', sets: ['s1'] },
        },
      },
    });
  });

  it('sends one interestAdd of the open ids that are in the lineup and not on the account, then clears', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(profile({ 'lu-b': { state: 'open' } }));
    vi.mocked(api.put).mockResolvedValue({});
    vi.mocked(api.get).mockResolvedValue([]);
    await store().mergeGuestInterests();
    expect(api.post).toHaveBeenCalledWith('/profiles', { festivalId: 'f1' }, { _bypassOfflineQueue: true });
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith(
      '/profiles/prof-1',
      { interestAdd: ['lu-a'] },
      { clientId: 'interest-merge-prof-1-0', offlineLabel: 'Update marks' },
    );
    expect(store().guestInterests).toEqual({});
  });

  it('keeps the marks on a network error and clears a festival that returned 404', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await store().mergeGuestInterests();
    expect(store().guestInterests.f1).toBeDefined();

    vi.mocked(api.post).mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }));
    await store().mergeGuestInterests();
    expect(store().guestInterests).toEqual({});
    warn.mockRestore();
  });

  it('runs at the end of mergeGuestPicks, so every sign-in path merges marks', async () => {
    vi.mocked(api.post).mockResolvedValue(profile());
    vi.mocked(api.put).mockResolvedValue({});
    vi.mocked(api.get).mockResolvedValue([]);
    await store().mergeGuestPicks();
    expect(api.put).toHaveBeenCalledWith('/profiles/prof-1', { interestAdd: ['lu-a', 'lu-b'] }, expect.anything());
    expect(store().guestInterests).toEqual({});
  });
});

describe('convertGuestInterests', () => {
  const sets = [
    { id: 's1', artist: 'Alpha', dayIndex: 0, artists: [{ name: 'Alpha' }] },
    { id: 's2', artist: 'Alpha', dayIndex: 0, artists: [{ name: 'Alpha' }] },
  ];
  const days = [{ date: '2099-02-05', label: 'Fri', dayIndex: 0 }];

  it('turns a mark on a covered act into want-to-see guest picks, never downgrading, and a second run changes nothing', () => {
    useFestivalDataStore.setState({
      sets: sets as never,
      days: days as never,
      guestInterests: { f1: { 'lu-a': { state: 'open' }, 'lu-b': { state: 'open' } } },
      guestPicks: { f1: { s1: 'must' } },
    });
    store().convertGuestInterests();
    expect(store().guestPicks).toEqual({ f1: { s1: 'must', s2: 'want-to-see' } });
    const marks = store().guestInterests.f1!;
    expect(marks['lu-a']?.state).toBe('converted');
    expect(marks['lu-a']?.sets).toEqual(['s1', 's2']);
    expect(marks['lu-b']).toEqual({ state: 'open' });
    expect(toastMessages()).toEqual(['1 act you marked now has a set. We added it to your picks.']);

    const before = { picks: store().guestPicks, marks: store().guestInterests };
    store().convertGuestInterests();
    expect(store().guestPicks).toBe(before.picks);
    expect(store().guestInterests).toBe(before.marks);
    expect(toastMessages()).toHaveLength(1);
  });

  it('a converted mark reopens when its sets are gone, and a mark on a removed act is dropped', () => {
    useFestivalDataStore.setState({
      sets: [] as never,
      days: days as never,
      guestInterests: { f1: { 'lu-a': { state: 'converted', sets: ['old'] }, 'lu-removed': { state: 'open' } } },
    });
    store().convertGuestInterests();
    expect(store().guestInterests).toEqual({ f1: { 'lu-a': { state: 'open' } } });
  });

  it('does nothing for a signed-in user', () => {
    useAuthStore.setState({ user });
    useFestivalDataStore.setState({
      sets: sets as never,
      days: days as never,
      guestInterests: { f1: { 'lu-a': { state: 'open' } } },
    });
    store().convertGuestInterests();
    expect(store().guestInterests.f1?.['lu-a']).toEqual({ state: 'open' });
  });
});

describe('persisted state', () => {
  it('guestInterests and the profile marks survive a rehydrate', () => {
    useFestivalDataStore.setState({
      currentProfile: profile({ 'lu-a': { state: 'open' } }),
      guestInterests: { f1: { 'lu-b': { state: 'open' } } },
    });
    const options = useFestivalDataStore.persist.getOptions();
    const blob = options.partialize!(store()) as Record<string, any>;
    expect(blob.guestInterests).toEqual({ f1: { 'lu-b': { state: 'open' } } });
    expect(blob.currentProfile.interests).toEqual({ 'lu-a': { state: 'open' } });

    const merged = options.merge!(blob, { ...store(), guestInterests: {} }) as ReturnType<typeof store>;
    expect(merged.guestInterests).toEqual({ f1: { 'lu-b': { state: 'open' } } });
    expect(merged.currentProfile?.interests).toEqual({ 'lu-a': { state: 'open' } });
  });
});
