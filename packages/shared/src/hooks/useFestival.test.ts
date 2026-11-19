// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFestivalStore } from '../stores/festivalStore';
import { useFestival } from './useFestival';

describe('useFestival getStageName', () => {
  beforeEach(() => {
    useFestivalStore.setState({ stages: [{ id: 'st1', name: 'Main' }] as never });
  });

  it('returns the stage name for a known id', () => {
    const { result } = renderHook(() => useFestival());
    expect(result.current.getStageName('st1')).toBe('Main');
  });

  it('returns undefined for an unknown id so callers can apply their own fallback', () => {
    const { result } = renderHook(() => useFestival());
    expect(result.current.getStageName('nope')).toBeUndefined();
  });
});
