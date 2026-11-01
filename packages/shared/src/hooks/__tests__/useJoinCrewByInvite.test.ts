import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useJoinCrewByInvite } from '../useJoinCrewByInvite';
import { useCrewStore } from '../../stores/crewStore';
import { useFestivalDataStore } from '../../stores/festivalDataStore';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));
vi.mock('../../stores/resetStores', () => ({ resetAllStores: vi.fn() }));

const crew = { id: 'c1', name: 'Tent 9', owner: 'u1', members: [], festivalId: 'f2', createdAt: '', updatedAt: '' };

const joinByCode = vi.fn();
const selectCrew = vi.fn();
const selectFestival = vi.fn();

function setup(currentFestivalId: string | null) {
  useCrewStore.setState({ joinByCode, selectCrew } as never);
  useFestivalDataStore.setState({
    currentFestival: currentFestivalId ? ({ id: currentFestivalId } as never) : null,
    selectFestival,
  } as never);
  return renderHook(() => useJoinCrewByInvite()).result.current;
}

describe('useJoinCrewByInvite', () => {
  beforeEach(() => {
    joinByCode.mockReset();
    selectCrew.mockReset().mockResolvedValue(undefined);
    selectFestival.mockReset().mockResolvedValue(undefined);
  });

  it('switches festival when it differs', async () => {
    joinByCode.mockResolvedValue(crew);
    const join = setup('f1');
    const out = await join('ABC123');
    expect(joinByCode).toHaveBeenCalledWith({ inviteCode: 'ABC123' });
    expect(selectFestival).toHaveBeenCalledWith('f2');
    expect(selectCrew).toHaveBeenCalledWith('c1');
    expect(out).toEqual({ kind: 'joined', crew });
  });

  it('does not switch when the festival matches', async () => {
    joinByCode.mockResolvedValue(crew);
    const join = setup('f2');
    await join('ABC123');
    expect(selectFestival).not.toHaveBeenCalled();
    expect(selectCrew).toHaveBeenCalledWith('c1');
  });

  it('returns queued when the join was queued offline', async () => {
    joinByCode.mockResolvedValue(null);
    const join = setup('f1');
    expect(await join('ABC123')).toEqual({ kind: 'queued' });
    expect(selectFestival).not.toHaveBeenCalled();
    expect(selectCrew).not.toHaveBeenCalled();
  });

  it('returns already for alreadyMember', async () => {
    joinByCode.mockResolvedValue({ ...crew, alreadyMember: true });
    const join = setup('f2');
    expect((await join('ABC123')).kind).toBe('already');
  });

  it('still returns joined when selectFestival fails', async () => {
    joinByCode.mockResolvedValue(crew);
    selectFestival.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const join = setup('f1');
    expect((await join('ABC123')).kind).toBe('joined');
    expect(selectCrew).toHaveBeenCalledWith('c1');
    warn.mockRestore();
  });

  it('propagates join errors', async () => {
    joinByCode.mockRejectedValue(new Error('Crew is full'));
    const join = setup('f1');
    await expect(join('ABC123')).rejects.toThrow('Crew is full');
  });
});
