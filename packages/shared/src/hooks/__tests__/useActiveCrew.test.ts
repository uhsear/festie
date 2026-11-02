import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useActiveCrew, useCrewFestival } from '../useActiveCrew';
import { useCrewStore } from '../../stores/crewStore';
import { useAuthStore } from '../../stores/authStore';
import { useFestivalDataStore } from '../../stores/festivalDataStore';
import { useFestivalUIStore } from '../../stores/festivalUIStore';
import type { Crew } from '../../types';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));

vi.mock('../../stores/resetStores', () => ({ resetAllStores: vi.fn() }));

const crew = (id: string, festivalId?: string) =>
  ({ id, name: id, owner: 'u1', festivalId, members: [] }) as unknown as Crew;

let selectCrew: ReturnType<typeof vi.fn>;
let loadCrews: ReturnType<typeof vi.fn>;
let selectFestival: ReturnType<typeof vi.fn>;

beforeEach(() => {
  selectCrew = vi.fn().mockResolvedValue(undefined);
  loadCrews = vi.fn().mockResolvedValue(undefined);
  selectFestival = vi.fn().mockResolvedValue(undefined);
  useAuthStore.setState({ user: { id: 'u1' } as never });
  useCrewStore.setState({
    crews: [],
    activeCrew: null,
    crewMembers: [],
    crewLoading: false,
    error: null,
    selectCrew,
    loadCrews,
  } as never);
  useFestivalDataStore.setState({
    currentFestival: { id: 'f1', name: 'One' } as never,
    festivals: [
      { id: 'f1', name: 'One' },
      { id: 'f2', name: 'Two' },
    ] as never,
    selectFestival,
  } as never);
  useFestivalUIStore.setState({ selectedDay: 2 });
});

describe('useActiveCrew', () => {
  it('selects crews[0] when none is active', async () => {
    useCrewStore.setState({ crews: [crew('c1'), crew('c2')] });
    const { result } = renderHook(() => useActiveCrew());
    await waitFor(() => expect(selectCrew).toHaveBeenCalledWith('c1'));
    expect(result.current.status).toBe('loading');
  });

  it('loads crews once when there are none', async () => {
    const { result, rerender } = renderHook(() => useActiveCrew());
    await waitFor(() => expect(loadCrews).toHaveBeenCalledTimes(1));
    rerender();
    expect(loadCrews).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('none');
  });

  it('reports error after a failed select and does not call it again; retry calls it', async () => {
    selectCrew.mockRejectedValue(new Error('boom'));
    useCrewStore.setState({ crews: [crew('c1')] });
    const { result, rerender } = renderHook(() => useActiveCrew());
    await waitFor(() => expect(result.current.status).toBe('error'));
    rerender();
    expect(selectCrew).toHaveBeenCalledTimes(1);
    expect(selectCrew).toHaveBeenCalledTimes(1);
    act(() => result.current.retry());
    expect(selectCrew).toHaveBeenCalledTimes(2);
  });

  it('keeps "none" when a join or create fails with no crews', async () => {
    const { result } = renderHook(() => useActiveCrew());
    await waitFor(() => expect(loadCrews).toHaveBeenCalledTimes(1));
    act(() => useCrewStore.setState({ error: 'Invalid invite code' }));
    expect(result.current.status).toBe('none');
  });
});

describe('useCrewFestival', () => {
  it('never switches when the ids match, and keeps selectedDay', () => {
    const { result } = renderHook(() => useCrewFestival(crew('c1', 'f1')));
    expect(result.current.state).toBe('match');
    expect(selectFestival).not.toHaveBeenCalled();
    expect(useFestivalUIStore.getState().selectedDay).toBe(2);
  });

  it('is a match for a crew with no festivalId', () => {
    const { result } = renderHook(() => useCrewFestival(crew('c1')));
    expect(result.current.state).toBe('match');
    expect(selectFestival).not.toHaveBeenCalled();
  });

  it('switches once to the crew festival and names it', async () => {
    selectFestival.mockImplementation(async (id: string) => {
      await Promise.resolve();
      useFestivalDataStore.setState({ currentFestival: { id, name: 'Two' } as never });
    });
    const { result, rerender } = renderHook(() => useCrewFestival(crew('c1', 'f2')));
    expect(result.current.state).toBe('switching');
    expect(result.current.festivalName).toBe('Two');
    await waitFor(() => expect(result.current.state).toBe('match'));
    rerender();
    expect(selectFestival).toHaveBeenCalledTimes(1);
  });

  it('reports failed on rejection and retries once more', async () => {
    selectFestival.mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => useCrewFestival(crew('c1', 'f2')));
    await waitFor(() => expect(result.current.state).toBe('failed'));
    act(() => result.current.retry());
    await waitFor(() => expect(selectFestival).toHaveBeenCalledTimes(2));
  });

  it('retries once, then fails, when a newer selectFestival call supersedes the switch', async () => {
    // A superseded selectFestival resolves without changing currentFestival.
    const { result } = renderHook(() => useCrewFestival(crew('c1', 'f2')));
    await waitFor(() => expect(result.current.state).toBe('failed'));
    expect(selectFestival).toHaveBeenCalledTimes(2);
  });

  it('settles on match when the retry after a superseded switch lands', async () => {
    selectFestival.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      useFestivalDataStore.setState({ currentFestival: { id: 'f2', name: 'Two' } as never });
    });
    const { result } = renderHook(() => useCrewFestival(crew('c1', 'f2')));
    await waitFor(() => expect(result.current.state).toBe('match'));
    expect(selectFestival).toHaveBeenCalledTimes(2);
  });
});
