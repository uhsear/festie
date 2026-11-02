import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const selectFestival = vi.fn().mockResolvedValue(undefined);
const loadFestivals = vi.fn().mockResolvedValue(undefined);
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: { getState: () => ({ festivals: [{ id: 'f1' }], loadFestivals, selectFestival }) },
}));

import { usePushLanding } from './usePushLanding';

describe('usePushLanding', () => {
  beforeEach(() => {
    selectFestival.mockClear();
  });

  it('selects a valid festival and clears the parameter', () => {
    window.history.replaceState(null, '', '/?festival=f2&x=1');
    renderHook(() => usePushLanding());
    expect(selectFestival).toHaveBeenCalledWith('f2');
    expect(window.location.search).toBe('?x=1');
  });

  it('ignores an invalid id', () => {
    window.history.replaceState(null, '', '/?festival=../etc');
    renderHook(() => usePushLanding());
    expect(selectFestival).not.toHaveBeenCalled();
  });
});
