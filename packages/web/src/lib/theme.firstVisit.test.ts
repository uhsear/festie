import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const KEY = 'festie-ui-theme-v1';

async function load() {
  vi.resetModules();
  const { useUIStore } = await import('@festie/shared/stores/uiStore');
  const { useThemeSync } = await import('./theme');
  return { useUIStore, useThemeSync };
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('useThemeSync first visit', () => {
  it('follows a light OS when nothing is saved', async () => {
    localStorage.clear();
    const { useUIStore, useThemeSync } = await load();
    renderHook(() => useThemeSync());
    expect(useUIStore.getState().followSystemTheme).toBe(true);
    expect(useUIStore.getState().theme).toBe('daylight');
  });

  it('keeps a saved explicit stage choice', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: 'stage', followSystemTheme: false }, version: 0 }));
    const { useUIStore, useThemeSync } = await load();
    renderHook(() => useThemeSync());
    expect(useUIStore.getState().followSystemTheme).toBe(false);
    expect(useUIStore.getState().theme).toBe('stage');
  });
});
