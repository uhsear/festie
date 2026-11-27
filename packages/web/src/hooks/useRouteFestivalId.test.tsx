import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useRouteFestivalId } from './useRouteFestivalId';

const select = (id: string | undefined) =>
  act(() => useFestivalDataStore.setState({ currentFestival: id ? ({ id } as never) : null }));

describe('useRouteFestivalId', () => {
  beforeEach(() => select(undefined));

  it('prefers the link, then the selected festival', () => {
    select('cur');
    expect(renderHook(() => useRouteFestivalId('linked')).result.current).toBe('linked');
    expect(renderHook(() => useRouteFestivalId(undefined)).result.current).toBe('cur');
  });

  it('keeps the link while the first festival finishes loading', () => {
    const { result } = renderHook(() => useRouteFestivalId('linked'));
    expect(result.current).toBe('linked');
    select('cur');
    expect(result.current).toBe('linked');
  });

  it('follows the picker once the user picks another festival', () => {
    select('cur');
    const { result } = renderHook(() => useRouteFestivalId('linked'));
    select('other');
    expect(result.current).toBe('other');
    select('cur');
    expect(result.current).toBe('cur');
  });
});
