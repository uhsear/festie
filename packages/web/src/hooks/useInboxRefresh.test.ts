import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const load = vi.fn().mockResolvedValue(undefined);
let user: { id: string } | null = { id: 'u1' };
let offlineMode = false;

vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: unknown }) => unknown) => sel({ user }),
}));
vi.mock('@festie/shared/stores/inboxStore', () => ({
  useInboxStore: { getState: () => ({ load }) },
}));
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: { getState: () => ({ offlineMode }) },
}));

import { useInboxRefresh } from './useInboxRefresh';

describe('useInboxRefresh', () => {
  beforeEach(() => {
    load.mockClear();
    user = { id: 'u1' };
    offlineMode = false;
  });

  it('loads on mount when signed in', () => {
    renderHook(() => useInboxRefresh());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not load when signed out', () => {
    user = null;
    renderHook(() => useInboxRefresh());
    document.dispatchEvent(new Event('visibilitychange'));
    expect(load).not.toHaveBeenCalled();
  });

  it('does not load when offline', () => {
    offlineMode = true;
    renderHook(() => useInboxRefresh());
    expect(load).not.toHaveBeenCalled();
  });

  it('loads again when the tab becomes visible, and stops after unmount', () => {
    const { unmount } = renderHook(() => useInboxRefresh());
    document.dispatchEvent(new Event('visibilitychange'));
    expect(load).toHaveBeenCalledTimes(2);
    unmount();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
