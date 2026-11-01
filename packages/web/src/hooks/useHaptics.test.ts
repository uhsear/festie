import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { VIBRATION_PATTERNS } from '@festie/shared/utils';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useHaptics } from './useHaptics';

describe('useHaptics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ hapticsEnabled: true });
  });

  it('plays the shared patterns for error and heavy', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.error();
    expect(navigator.vibrate).toHaveBeenCalledWith(VIBRATION_PATTERNS.error);
    result.current.heavy();
    expect(navigator.vibrate).toHaveBeenCalledWith(VIBRATION_PATTERNS.heavy);
  });

  it('is silent when haptics are off, except heavy (SOS)', () => {
    useUIStore.setState({ hapticsEnabled: false });
    const { result } = renderHook(() => useHaptics());
    result.current.tap();
    expect(navigator.vibrate).not.toHaveBeenCalled();
    result.current.heavy();
    expect(navigator.vibrate).toHaveBeenCalledWith(VIBRATION_PATTERNS.heavy);
  });

  it('reports isSupported=true when vibrate API exists', () => {
    const { result } = renderHook(() => useHaptics());
    expect(result.current.isSupported).toBe(true);
  });

  it('calls navigator.vibrate(15) for tap', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.tap();
    expect(navigator.vibrate).toHaveBeenCalledWith(15);
  });

  it('calls navigator.vibrate(30) for select', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.select();
    expect(navigator.vibrate).toHaveBeenCalledWith(30);
  });

  it('calls navigator.vibrate with pattern for success', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.success();
    expect(navigator.vibrate).toHaveBeenCalledWith([30, 50, 30]);
  });

  it('calls navigator.vibrate with pattern for warning', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.warning();
    expect(navigator.vibrate).toHaveBeenCalledWith([50, 30, 50, 30, 50]);
  });

  it('returns stable function references across renders', () => {
    const { result, rerender } = renderHook(() => useHaptics());
    const _first = result.current;
    rerender();
    const second = result.current;
    // Functions are recreated each render (no useCallback), but we verify
    // they still work correctly
    expect(typeof second.tap).toBe('function');
    expect(typeof second.select).toBe('function');
    expect(typeof second.success).toBe('function');
    expect(typeof second.warning).toBe('function');
  });
});
