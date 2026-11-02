import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCrewHub } from '../useCrewHub';
import { useCrewStore } from '../../stores/crewStore';
import { useAuthStore } from '../../stores/authStore';
import { useFestivalDataStore } from '../../stores/festivalDataStore';
import { useLiveLocationStore } from '../../stores/liveLocationStore';
import type { Crew } from '../../types';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));

vi.mock('../../stores/resetStores', () => ({ resetAllStores: vi.fn() }));

const days = [{ date: '2026-09-04' }, { date: '2026-09-05' }];
const sets = [
  { id: 's1', stageId: 'st', dayIndex: 0, date: '2026-09-04', startTime: '13:00', endTime: '14:00' },
  { id: 's2', stageId: 'st', dayIndex: 0, date: '2026-09-04', startTime: '15:00', endTime: '16:00' },
  { id: 's3', stageId: 'st', dayIndex: 1, date: '2026-09-05', startTime: '15:00', endTime: '16:00' },
  { id: 's4', stageId: 'st', dayIndex: 1, date: '2026-09-05', startTime: '17:00', endTime: '18:00' },
];
const mkProfile = (id: string, picks: Record<string, string>) => ({ id, userId: id, name: id, picks });
const profiles = [
  mkProfile('u1', { s1: 'must', s2: 'must', s3: 'must', s4: 'must' }),
  mkProfile('u2', { s1: 'must', s2: 'want-to-see', s3: 'maybe', s4: 'maybe' }),
];

let loadPolls: ReturnType<typeof vi.fn>;

function setup(nowIso: string) {
  loadPolls = vi.fn().mockResolvedValue(undefined);
  const c = {
    id: 'c1',
    name: 'Crew',
    owner: 'u1',
    festivalId: 'f1',
    members: [{ userId: 'u1' }, { userId: 'u2' }],
  } as unknown as Crew;
  useAuthStore.setState({ user: { id: 'u1' } as never });
  useCrewStore.setState({
    crews: [c],
    activeCrew: c,
    crewMembers: c.members,
    meetingPoints: [],
    polls: [],
    crewStatuses: [],
    loadPolls,
    loadStatuses: vi.fn().mockResolvedValue(undefined),
    loadMeetingPoints: vi.fn().mockResolvedValue(undefined),
  } as never);
  useLiveLocationStore.setState({ peers: {} } as never);
  useFestivalDataStore.setState({
    currentFestival: { id: 'f1', name: 'Fest' } as never,
    festivals: [{ id: 'f1', name: 'Fest' }] as never,
    sets: sets as never,
    days: days as never,
    allProfiles: profiles as never,
    currentProfile: profiles[0] as never,
  } as never);
  return new Date(nowIso).getTime();
}

describe('useCrewHub', () => {
  beforeEach(() => vi.clearAllMocks());

  it('past festival: no upNext, howWeDid holds shared picks', () => {
    const nowMs = setup('2027-01-01T12:00:00');
    const { result } = renderHook(() => useCrewHub(nowMs));
    expect(result.current.isPast).toBe(true);
    expect(result.current.upNext).toEqual([]);
    expect(result.current.mix).toEqual([]);
    expect(result.current.howWeDid.map((e) => e.set.id)).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('upcoming festival: mix capped at 3 and upNext grouped', () => {
    const nowMs = setup('2026-08-01T12:00:00');
    const { result } = renderHook(() => useCrewHub(nowMs));
    expect(result.current.isPast).toBe(false);
    expect(result.current.mix).toHaveLength(3);
    expect(result.current.howWeDid).toEqual([]);
    expect(result.current.upNext[0]!.groups[0]!.names).toEqual(['u1', 'u2']);
    expect(result.current.festivalName).toBe('Fest');
    expect(result.current.isOwner).toBe(true);
  });

  it('loads polls once per crew id', () => {
    const nowMs = setup('2026-08-01T12:00:00');
    const { rerender } = renderHook(({ n }) => useCrewHub(n), { initialProps: { n: nowMs } });
    rerender({ n: nowMs + 1000 });
    expect(loadPolls).toHaveBeenCalledTimes(1);
    expect(loadPolls).toHaveBeenCalledWith('c1');
  });
});
