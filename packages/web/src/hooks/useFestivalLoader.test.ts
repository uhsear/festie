import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Shared mutable refs, hoisted so the vi.mock factories below can read them.
const h = vi.hoisted(() => ({
  checkSession: vi.fn(async () => {}),
  joinByCode: vi.fn(async () => {}),
  loadFestivals: vi.fn(async () => {}),
  selectFestival: vi.fn(async (_id: string) => {}),
  festivals: [] as { id: string }[],
  state: {
    user: null as unknown,
    hydrated: true,
    cb: null as null | (() => void),
    currentFestival: null as unknown,
    currentProfile: null as unknown,
  },
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@festie/shared', () => {
  const authState = () => ({ user: h.state.user, checkSession: h.checkSession });
  // useAuthStore is both a selector-hook and carries getState()/persist statics.
  const useAuthStore = Object.assign((sel: (s: ReturnType<typeof authState>) => unknown) => sel(authState()), {
    getState: authState,
    persist: {
      hasHydrated: () => h.state.hydrated,
      onFinishHydration: (cb: () => void) => {
        h.state.cb = cb;
        return () => {};
      },
    },
  });
  return { useAuthStore };
});

vi.mock('@festie/shared/stores', () => {
  const slice = {
    loadFestivals: h.loadFestivals,
    selectFestival: h.selectFestival,
    get currentFestival() {
      return h.state.currentFestival;
    },
    get currentProfile() {
      return h.state.currentProfile;
    },
    loadProfiles: vi.fn(async () => {}),
  };
  const useFestivalStore = Object.assign((sel: (s: typeof slice) => unknown) => sel(slice), {
    getState: () => ({ festivals: h.festivals as unknown[], currentFestival: null }),
  });
  return { useFestivalStore };
});

vi.mock('@festie/shared/stores/crewStore', () => ({
  useCrewStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ loadCrews: vi.fn(async () => {}), joinByCode: h.joinByCode }),
}));

vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));

import { useFestivalLoader, readSignupRef } from './useFestivalLoader';

describe('useFestivalLoader session probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.user = null;
    h.state.hydrated = true;
    h.state.cb = null;
    h.state.currentFestival = null;
    h.state.currentProfile = null;
  });

  it('does not call checkSession when no user is persisted', () => {
    h.state.user = null;
    renderHook(() => useFestivalLoader());
    expect(h.checkSession).not.toHaveBeenCalled();
  });

  it('calls checkSession when a user is persisted', () => {
    h.state.user = { id: 'u1' };
    renderHook(() => useFestivalLoader());
    expect(h.checkSession).toHaveBeenCalledTimes(1);
  });

  it('waits for persist hydration before probing', () => {
    h.state.hydrated = false;
    h.state.user = { id: 'u1' };
    renderHook(() => useFestivalLoader());
    expect(h.checkSession).not.toHaveBeenCalled();
    h.state.cb?.(); // simulate onFinishHydration firing
    expect(h.checkSession).toHaveBeenCalledTimes(1);
  });
  it('refetches festivals when the auth user changes (sign-out)', async () => {
    h.state.user = { id: 'u1' };
    const { rerender } = renderHook(() => useFestivalLoader());
    await act(async () => {});
    h.loadFestivals.mockClear();
    h.state.user = null;
    rerender();
    await act(async () => {});
    expect(h.loadFestivals).toHaveBeenCalledTimes(1);
  });
});

describe('useFestivalLoader ?joinCrew consent gate', () => {
  beforeEach(() => {
    h.state.user = { id: 'u1' };
    h.state.currentFestival = { id: 'f1' };
    h.state.currentProfile = { id: 'p1' };
    sessionStorage.clear();
    window.history.pushState({}, '', '/?joinCrew=ABC123');
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('stages the code instead of auto-joining -- never calls joinByCode without explicit confirmation', async () => {
    renderHook(() => useFestivalLoader());
    await act(async () => {});
    expect(h.joinByCode).not.toHaveBeenCalled();
  });

  it('a guest with a pending code who signs in gets the code staged', async () => {
    window.history.pushState({}, '', '/');
    h.state.user = null;
    sessionStorage.setItem('fk.pendingJoinCrew', 'ABC123');
    const { result, rerender } = renderHook(() => useFestivalLoader());
    await act(async () => {});
    expect(result.current.pendingJoinCode).toBeNull();
    h.state.user = { id: 'u1' };
    rerender();
    await act(async () => {});
    expect(result.current.pendingJoinCode).toBe('ABC123');
    expect(sessionStorage.getItem('fk.pendingJoinCrew')).toBeNull();
    expect(h.joinByCode).not.toHaveBeenCalled();
  });

  it('a guest who opens ?joinCrew=, goes to sign-up and signs in gets the code staged', async () => {
    h.state.user = null;
    const { result, rerender } = renderHook(() => useFestivalLoader());
    await act(async () => {});
    expect(sessionStorage.getItem('fk.pendingJoinCrew')).toBe('ABC123');
    window.history.pushState({}, '', '/register');
    h.state.user = { id: 'u1' };
    rerender();
    await act(async () => {});
    expect(result.current.pendingJoinCode).toBe('ABC123');
    expect(sessionStorage.getItem('fk.pendingJoinCrew')).toBeNull();
  });

  it('stages a signed-in visitor even before a festival is selected', async () => {
    h.state.currentFestival = null;
    const { result } = renderHook(() => useFestivalLoader());
    await act(async () => {});
    expect(result.current.pendingJoinCode).toBe('ABC123');
  });
});

describe('useFestivalLoader ?ref capture', () => {
  beforeEach(() => {
    h.state.user = null;
    sessionStorage.clear();
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('stores a valid ref lower-cased, and the first value wins', () => {
    window.history.pushState({}, '', '/?ref=Tiktok_1');
    renderHook(() => useFestivalLoader());
    window.history.pushState({}, '', '/?ref=other');
    renderHook(() => useFestivalLoader());
    expect(sessionStorage.getItem('festie-ref')).toBe('tiktok_1');
  });

  it('readSignupRef returns the stored ref for the register request', () => {
    expect(readSignupRef()).toBeUndefined();
    window.history.pushState({}, '', '/?ref=crew_share');
    renderHook(() => useFestivalLoader());
    expect(readSignupRef()).toBe('crew_share');
  });

  it('ignores an invalid ref', () => {
    window.history.pushState({}, '', '/?ref=bad%20ref!');
    renderHook(() => useFestivalLoader());
    expect(sessionStorage.getItem('festie-ref')).toBeNull();
  });
});

describe('useFestivalLoader ?festival deep link', () => {
  beforeEach(() => {
    h.state.user = null;
    h.festivals = [{ id: 'f1' }, { id: 'f2' }];
    h.selectFestival.mockClear();
  });

  afterEach(() => {
    h.festivals = [];
    window.history.pushState({}, '', '/');
  });

  it('selects the linked festival, strips festival= and keeps ref=', async () => {
    window.history.pushState({}, '', '/?festival=f2&ref=festival-page#x');
    renderHook(() => useFestivalLoader());
    await act(async () => {});
    expect(h.selectFestival).toHaveBeenCalledWith('f2');
    expect(window.location.search).toBe('?ref=festival-page');
    expect(window.location.hash).toBe('#x');
  });

  it('falls back to the default pick for an unknown id and still strips the param', async () => {
    window.history.pushState({}, '', '/?festival=nope');
    renderHook(() => useFestivalLoader());
    await act(async () => {});
    expect(h.selectFestival).not.toHaveBeenCalledWith('nope');
    expect(h.selectFestival).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('');
  });

  it('leaves other paths alone', async () => {
    window.history.pushState({}, '', '/wrap?festival=f2');
    renderHook(() => useFestivalLoader());
    await act(async () => {});
    expect(window.location.search).toBe('?festival=f2');
  });
});
