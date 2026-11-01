import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  user: null as { id: string } | null,
  sessionChecked: false,
  checkSession: vi.fn(),
};
let hydrated = true;
let finishHydration: (() => void) | null = null;

vi.mock('@festie/shared', () => {
  const useAuthStore = Object.assign(() => state, {
    getState: () => state,
    persist: {
      hasHydrated: () => hydrated,
      onFinishHydration: (cb: () => void) => {
        finishHydration = cb;
        return () => {};
      },
    },
  });
  return { useAuthStore };
});

import { authReady, isAuthenticated, redirectIfSignedIn } from './auth-guard';

beforeEach(() => {
  state.user = null;
  state.sessionChecked = false;
  state.checkSession = vi.fn(async () => {
    state.user = { id: 'u1' };
    state.sessionChecked = true;
    return true;
  });
  hydrated = true;
  finishHydration = null;
});

describe('authReady', () => {
  it('waits for checkSession when nothing was persisted, so a cookie session is not bounced', async () => {
    await authReady();
    expect(state.checkSession).toHaveBeenCalledTimes(1);
    expect(isAuthenticated()).toBe(true);
  });

  it('skips the probe when a user is already persisted', async () => {
    state.user = { id: 'u1' };
    await authReady();
    expect(state.checkSession).not.toHaveBeenCalled();
  });

  it('skips the probe once the session was already checked', async () => {
    state.sessionChecked = true;
    await authReady();
    expect(state.checkSession).not.toHaveBeenCalled();
    expect(isAuthenticated()).toBe(false);
  });

  it('waits for persist hydration before judging', async () => {
    hydrated = false;
    let done = false;
    const p = authReady().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    finishHydration!();
    await p;
    expect(state.checkSession).toHaveBeenCalledTimes(1);
  });

  it('treats a throwing checkSession as signed out instead of rejecting', async () => {
    state.checkSession = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(authReady()).resolves.toBeUndefined();
    expect(isAuthenticated()).toBe(false);
  });
});

describe('redirectIfSignedIn', () => {
  it('throws a redirect to /cards when a user is set', async () => {
    state.user = { id: 'u1' };
    await expect(redirectIfSignedIn()).rejects.toMatchObject({ options: { to: '/cards' } });
  });

  it('resolves when no user is set', async () => {
    state.sessionChecked = true;
    await expect(redirectIfSignedIn()).resolves.toBeUndefined();
  });
});
