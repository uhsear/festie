import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useThemeSync } from './theme';

type Listener = () => void;

function stubMatchMedia(initialLight: boolean) {
  const mq = {
    matches: initialLight,
    listeners: new Set<Listener>(),
    addEventListener: (_: string, l: Listener) => mq.listeners.add(l),
    removeEventListener: (_: string, l: Listener) => mq.listeners.delete(l),
  };
  vi.stubGlobal('matchMedia', () => mq);
  return mq;
}

beforeEach(() => {
  useUIStore.setState({ theme: 'stage', followSystemTheme: false });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useThemeSync with Match system', () => {
  it('follows the OS scheme now and on change', () => {
    const mq = stubMatchMedia(true);
    useUIStore.setState({ followSystemTheme: true });
    const { unmount } = renderHook(() => useThemeSync());
    expect(useUIStore.getState().theme).toBe('daylight');

    mq.matches = false;
    mq.listeners.forEach((l) => l());
    expect(useUIStore.getState().theme).toBe('stage');

    unmount();
    expect(mq.listeners.size).toBe(0);
  });

  it('ignores the OS scheme when not following', () => {
    stubMatchMedia(true);
    renderHook(() => useThemeSync());
    expect(useUIStore.getState().theme).toBe('stage');
  });
});
