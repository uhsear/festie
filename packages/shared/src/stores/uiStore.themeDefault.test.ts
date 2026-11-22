import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY = 'festie-ui-theme-v1';

async function freshStore() {
  vi.resetModules();
  return (await import('./uiStore')).useUIStore;
}

describe('theme default for a store with no persisted value', () => {
  beforeEach(() => localStorage.clear());

  it('follows the system theme on a fresh install', async () => {
    const store = await freshStore();
    expect(store.getState().followSystemTheme).toBe(true);
  });

  it('keeps a persisted fixed choice', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: 'stage', followSystemTheme: false }, version: 0 }));
    const store = await freshStore();
    expect(store.getState().followSystemTheme).toBe(false);
    expect(store.getState().theme).toBe('stage');
  });

  it('keeps a legacy persisted theme that has no followSystemTheme field as fixed', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: 'daylight' }, version: 0 }));
    const store = await freshStore();
    expect(store.getState().followSystemTheme).toBe(false);
    expect(store.getState().theme).toBe('daylight');
  });

  it('keeps a persisted system choice', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: 'daylight', followSystemTheme: true }, version: 0 }));
    const store = await freshStore();
    expect(store.getState().followSystemTheme).toBe(true);
  });
});
