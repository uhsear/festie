import { describe, it, expect, beforeEach, vi } from 'vitest';
import { followFestivalCrew, useCrewStore } from './crewStore';
import { useAuthStore } from './authStore';
import { useFestivalDataStore } from './festivalDataStore';
import { api } from '../services/api';
import type { Crew } from '../types/domain';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const crew = (id: string, festivalId?: string): Crew =>
  ({ id, name: id, owner: 'u1', members: [], festivalId, inviteCode: 'X', createdAt: '', updatedAt: '' }) as Crew;

// Design Squad belongs to the finished festival, Orchard Crew to the live one.
const DESIGN = crew('design', 'edc');
const ORCHARD = crew('orchard', 'moonlit');

describe('the open crew follows the selected festival', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: 'u1' } as never });
    useCrewStore.setState({ crews: [DESIGN, ORCHARD], activeCrew: DESIGN, crewLoading: false, error: null });
    useFestivalDataStore.setState({ currentFestivalId: 'edc', selectFestival: vi.fn().mockResolvedValue(undefined) as never });
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      const id = url.replace('/crews/', '');
      return { ...(id === 'orchard' ? ORCHARD : DESIGN), members: [] } as never;
    });
  });

  it('opens the crew of the festival the user switches to', async () => {
    useFestivalDataStore.setState({ currentFestivalId: 'moonlit' });
    followFestivalCrew();
    await vi.waitFor(() => expect(useCrewStore.getState().activeCrew?.id).toBe('orchard'));
  });

  it('switches back when the festival switches back', async () => {
    useFestivalDataStore.setState({ currentFestivalId: 'moonlit' });
    followFestivalCrew();
    await vi.waitFor(() => expect(useCrewStore.getState().activeCrew?.id).toBe('orchard'));
    useFestivalDataStore.setState({ currentFestivalId: 'edc' });
    followFestivalCrew();
    await vi.waitFor(() => expect(useCrewStore.getState().activeCrew?.id).toBe('design'));
  });

  it('leaves the open crew alone when the festival has no crew of the user', () => {
    useFestivalDataStore.setState({ currentFestivalId: 'hush' });
    followFestivalCrew();
    expect(api.get).not.toHaveBeenCalled();
    expect(useCrewStore.getState().activeCrew?.id).toBe('design');
  });

  it('replaces a saved crew of another festival once the crew list loads', async () => {
    useFestivalDataStore.setState({ currentFestivalId: 'moonlit' });
    vi.mocked(api.get).mockClear();
    useCrewStore.setState({ crews: [], activeCrew: DESIGN });
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/crews') return [DESIGN, ORCHARD] as never;
      return { ...ORCHARD, members: [] } as never;
    });
    await useCrewStore.getState().loadCrews();
    await vi.waitFor(() => expect(useCrewStore.getState().activeCrew?.id).toBe('orchard'));
  });

  it('does nothing for a guest', () => {
    useAuthStore.setState({ user: null });
    useFestivalDataStore.setState({ currentFestivalId: 'moonlit' });
    followFestivalCrew();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('skips an offline-join placeholder', () => {
    useCrewStore.setState({ crews: [DESIGN, { ...ORCHARD, _optimistic: true } as Crew] });
    useFestivalDataStore.setState({ currentFestivalId: 'moonlit' });
    followFestivalCrew();
    expect(api.get).not.toHaveBeenCalled();
  });
});
