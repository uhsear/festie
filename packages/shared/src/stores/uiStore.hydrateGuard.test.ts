import { describe, it, expect, vi } from 'vitest';

const KEY = 'festie-ui-theme-v1';

describe('applySystemScheme before hydration with an async storage', () => {
  it('does not overwrite the saved record', async () => {
    vi.resetModules();
    const saved = JSON.stringify({ state: { theme: 'daylight', followSystemTheme: false, hapticsEnabled: false }, version: 0 });
    const db = new Map<string, string>([[KEY, saved]]);
    const { configureStorage } = await import('../platform/storage');
    configureStorage({
      getItem: async (k) => {
        await new Promise((r) => setTimeout(r, 10));
        return db.get(k) ?? null;
      },
      setItem: async (k, v) => void db.set(k, v),
      removeItem: async (k) => void db.delete(k),
    });
    const { useUIStore } = await import('./uiStore');
    expect(useUIStore.persist.hasHydrated()).toBe(false);

    useUIStore.getState().applySystemScheme('dark');
    await new Promise((r) => setTimeout(r, 30));

    expect(useUIStore.persist.hasHydrated()).toBe(true);
    expect(db.get(KEY)).toBe(saved);
    expect(useUIStore.getState().hapticsEnabled).toBe(false);
  });
});
