import { useEffect } from 'react';
import { useUIStore, THEME_STORAGE_KEY } from '@festie/shared/stores/uiStore';
import type { ThemePreference } from '@festie/shared/stores/uiStore';
import { colors, colorsDaylight } from '@festie/shared/tokens';

/**
 * Paint the document in a theme. index.html runs the same logic before first
 * paint; this keeps the DOM in sync once the store changes. `stage` is the
 * default, so it carries no `data-theme` attribute.
 */
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === 'daylight') root.dataset.theme = 'daylight';
  else delete root.dataset.theme;
  root.style.colorScheme = theme === 'daylight' ? 'light' : 'dark';
  const ground = theme === 'daylight' ? colorsDaylight.bg.primary : colors.bg.primary;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ground);
}

// A visitor with no saved preference follows the OS. Read at import, before any store write; mobile has no OS sync, so the shared default stays 'stage'.
let firstVisit = (() => {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === null;
  } catch {
    return false;
  }
})();

/** Keep the document in step with the persisted theme preference, and with the OS scheme in Match system mode. */
export function useThemeSync(): void {
  const theme = useUIStore((state) => state.theme);
  useEffect(() => {
    if (firstVisit) {
      firstVisit = false;
      useUIStore.getState().setThemeMode('system');
    }
    applyTheme(theme);
  }, [theme]);

  const followSystemTheme = useUIStore((state) => state.followSystemTheme);
  const applySystemScheme = useUIStore((state) => state.applySystemScheme);
  useEffect(() => {
    if (!followSystemTheme || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const sync = () => applySystemScheme(mq.matches ? 'light' : 'dark');
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [followSystemTheme, applySystemScheme]);
}
