import { redirect } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';

type PersistApi = { hasHydrated: () => boolean; onFinishHydration: (cb: () => void) => () => void };

/**
 * Resolves once the auth state is trustworthy enough to decide a redirect.
 *
 * 1. Wait for zustand persist rehydration (the store reads as logged-out until then).
 * 2. If nothing was persisted (local storage cleared, new device) but a valid cookie
 *    may exist, wait for `checkSession()` before judging. Without this, deep links
 *    bounced to /login for users who were in fact signed in.
 *
 * A persisted user skips the probe: the session check in useFestivalLoader re-verifies it.
 */
export async function authReady(): Promise<void> {
  const persist = (useAuthStore as unknown as { persist?: PersistApi }).persist;
  if (persist && !persist.hasHydrated()) {
    await new Promise<void>((resolve) => {
      const unsub = persist.onFinishHydration(() => {
        unsub();
        resolve();
      });
    });
  }
  const { user, sessionChecked, checkSession } = useAuthStore.getState();
  if (!user && !sessionChecked) {
    try {
      await checkSession();
    } catch {
      // checkSession reports failures through its return value; a throw here means offline, so treat as signed out.
    }
  }
}

export const isAuthenticated = () => !!useAuthStore.getState().user;
export const isAdmin = () => useAuthStore.getState().user?.isAdmin || false;

/** beforeLoad for /login and /register: a signed-in user has no use for them. */
export async function redirectIfSignedIn() {
  await authReady();
  if (isAuthenticated()) throw redirect({ to: '/cards' });
}
