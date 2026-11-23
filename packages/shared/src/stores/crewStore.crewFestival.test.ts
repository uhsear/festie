import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCrewStore } from './crewStore';
import { useAuthStore } from './authStore';
import { useFestivalDataStore } from './festivalDataStore';
import { api } from '../services/api';
import type { Crew } from '../types/domain';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const crew = (id: string, festivalId?: string): Crew =>
  ({ id, name: id, owner: 'u1', members: [], festivalId, inviteCode: 'X', createdAt: '', updatedAt: '' }) as Crew;

describe('crew festival auto-select', () => {
  let select: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    select = vi.fn().mockResolvedValue(undefined);
    useCrewStore.setState({ crews: [], activeCrew: null, crewLoading: false, error: null });
    useAuthStore.setState({ user: { id: 'u1' } as never });
    useFestivalDataStore.setState({ currentFestivalId: null, selectFestival: select as never });
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/crews') return [crew('c1', 'F')] as never;
      return { ...crew('c1', 'F'), members: [] } as never;
    });
  });

  it('selects the crew festival after loadCrews when none is chosen', async () => {
    await useCrewStore.getState().loadCrews();
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith('F');
  });

  it('selects the crew festival after selectCrew', async () => {
    await useCrewStore.getState().selectCrew('c1');
    expect(select).toHaveBeenCalledWith('F');
  });

  it('leaves an already chosen festival alone', async () => {
    useFestivalDataStore.setState({ currentFestivalId: 'other' });
    await useCrewStore.getState().loadCrews();
    expect(select).not.toHaveBeenCalled();
  });

  it('waits for festival store hydration so a saved festival is not replaced', async () => {
    let finish: () => void = () => {};
    vi.spyOn(useFestivalDataStore.persist, 'hasHydrated').mockReturnValue(false);
    vi.spyOn(useFestivalDataStore.persist, 'onFinishHydration').mockImplementation((cb) => {
      finish = () => cb(useFestivalDataStore.getState());
      return () => {};
    });
    await useCrewStore.getState().loadCrews();
    expect(select).not.toHaveBeenCalled();
    useFestivalDataStore.setState({ currentFestivalId: 'saved' });
    vi.spyOn(useFestivalDataStore.persist, 'hasHydrated').mockReturnValue(true);
    finish();
    expect(select).not.toHaveBeenCalled();
  });

  it('does nothing without a crew', async () => {
    vi.mocked(api.get).mockResolvedValue([] as never);
    await useCrewStore.getState().loadCrews();
    expect(select).not.toHaveBeenCalled();
  });

  it('does nothing for a guest', async () => {
    useAuthStore.setState({ user: null });
    await useCrewStore.getState().loadCrews();
    expect(select).not.toHaveBeenCalled();
  });

  it('does nothing when the crew has no festival', async () => {
    vi.mocked(api.get).mockResolvedValue([crew('c1')] as never);
    await useCrewStore.getState().loadCrews();
    expect(select).not.toHaveBeenCalled();
  });
});
