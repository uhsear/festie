import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCreateCrew } from '../useCreateCrew';
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

const createCrew = vi.fn();
const selectFestival = vi.fn();

function setup(currentFestivalId: string | null) {
  useCrewStore.setState({ createCrew } as never);
  useFestivalDataStore.setState({
    currentFestival: currentFestivalId ? ({ id: currentFestivalId } as never) : null,
    selectFestival,
  } as never);
  return renderHook(() => useCreateCrew()).result.current;
}

describe('useCreateCrew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCrew.mockResolvedValue(crew);
    selectFestival.mockResolvedValue(undefined);
  });

  it('creates the crew and switches festival when it differs', async () => {
    const create = setup('f1');
    await expect(create('Tent 9', 'f2')).resolves.toBe(crew);
    expect(createCrew).toHaveBeenCalledWith({ name: 'Tent 9', festivalId: 'f2' });
    expect(selectFestival).toHaveBeenCalledWith('f2');
  });

  it('does not switch when the festival matches', async () => {
    const create = setup('f2');
    await create('Tent 9', 'f2');
    expect(selectFestival).not.toHaveBeenCalled();
  });

  it('returns the crew when the festival switch fails', async () => {
    selectFestival.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const create = setup('f1');
    await expect(create('Tent 9', 'f2')).resolves.toBe(crew);
  });

  it('propagates a create failure without switching', async () => {
    createCrew.mockRejectedValue(new Error('cap'));
    const create = setup('f1');
    await expect(create('Tent 9', 'f2')).rejects.toThrow('cap');
    expect(selectFestival).not.toHaveBeenCalled();
  });
});
