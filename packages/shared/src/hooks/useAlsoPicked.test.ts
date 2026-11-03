import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAlsoPicked, clearAlsoPickedCache } from './useAlsoPicked';
import { api } from '../services/api';
import { useFestivalStore } from '../stores/festivalStore';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const sets = ['s1', 's2', 's3', 's4'].map((id) => ({ id, artist: id })) as never[];

describe('useAlsoPicked', () => {
  beforeEach(() => {
    clearAlsoPickedCache();
    vi.mocked(api.get).mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useFestivalStore.setState({ sets, currentProfile: { id: 'p', picks: { s3: 'must' } } as never });
  });

  it('is idle without ids', () => {
    const { result } = renderHook(() => useAlsoPicked(undefined, undefined));
    expect(result.current).toEqual({ sets: [], status: 'idle' });
  });

  it('fetches once per set within 10 minutes and removes picked sets', async () => {
    vi.mocked(api.get).mockResolvedValue({ setIds: ['s2', 's3', 's4'] });
    const first = renderHook(() => useAlsoPicked('f1', 's1'));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(first.result.current.sets.map((s) => s.id)).toEqual(['s2', 's4']);
    expect(api.get).toHaveBeenCalledWith('/festivals/f1/sets/s1/also-picked');
    const second = renderHook(() => useAlsoPicked('f1', 's1'));
    expect(second.result.current.status).toBe('ready');
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('hides the result on error', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useAlsoPicked('f1', 's1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.sets).toEqual([]);
  });
});
