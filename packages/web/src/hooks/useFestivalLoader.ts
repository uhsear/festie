import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { useFestivalStore, followTodayOnResume } from '@festie/shared/stores';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { pickDefaultFestival } from '@festie/shared/utils';
import { PENDING_JOIN_KEY } from '../components/auth/invite';
import { useToast } from '../lib/toastContext';

const REF_KEY = 'festie-ref';
const REF_PATTERN = /^[a-z0-9_-]{1,40}$/;

function stripJoinCrewParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete('joinCrew');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

/** Drops only ?festival= so ?ref= and the rest survive. */
function stripFestivalParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete('festival');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

/** Remembers an anonymous ?ref= source for sign-up counts. The first valid value wins. */
function captureRef() {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref')?.toLowerCase();
    if (ref && REF_PATTERN.test(ref) && !sessionStorage.getItem(REF_KEY)) sessionStorage.setItem(REF_KEY, ref);
  } catch {
    /* sessionStorage unavailable */
  }
}

/** The ?ref= source captured on this visit, for the register request. */
export function readSignupRef(): string | undefined {
  try {
    return sessionStorage.getItem(REF_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Handles all festival/session/crew bootstrapping logic:
 * - Session check on mount
 * - Auto-load festivals + select first one
 * - Load crews when user logs in
 * - ?joinCrew=<code> deep-link handling: stages the code as `pendingJoinCode`
 *   for JoinCrewSheet to confirm -- it is never joined automatically without
 *   explicit user consent -- including the code a guest carried through sign-up
 * - ?ref=<source> capture for anonymous sign-up counts
 * - Re-fetch profiles on login
 */
export function useFestivalLoader() {
  const navigate = useNavigate();
  const checkSession = useAuthStore((s) => s.checkSession);
  const user = useAuthStore((s) => s.user);
  const loadFestivals = useFestivalStore((s) => s.loadFestivals);
  const selectFestival = useFestivalStore((s) => s.selectFestival);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const loadCrews = useCrewStore((s) => s.loadCrews);
  const { toast } = useToast();
  const joinAttemptedRef = useRef<string | null>(null);
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(null);

  useEffect(captureRef, []);

  // Check session once on mount. On web the httpOnly cookie is the session, so a
  // cookie-only session (no persisted user) must still be probed; a guest pays one 401.
  // Wait for zustand persist rehydration first so the probe cannot race it.
  useEffect(() => {
    let cancelled = false;
    const persist = (
      useAuthStore as unknown as {
        persist?: { hasHydrated: () => boolean; onFinishHydration: (cb: () => void) => () => void };
      }
    ).persist;
    const probe = () => {
      if (!cancelled) checkSession().catch(() => {});
    };
    if (!persist || persist.hasHydrated()) {
      probe();
      return () => {
        cancelled = true;
      };
    }
    const unsub = persist.onFinishHydration(() => {
      unsub();
      probe();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [checkSession]);

  // Auto-load festivals + select first one on boot (mirrors legacy init())
  useEffect(() => {
    // ?festival=<id> from a public festival page; read before the load, on the root path only.
    const linkedId = window.location.pathname === '/' ? new URLSearchParams(window.location.search).get('festival') : null;
    loadFestivals()
      .then(() => {
        const fests = useFestivalStore.getState().festivals;
        if (linkedId) stripFestivalParam();
        if (linkedId && fests.some((f) => f.id === linkedId)) {
          selectFestival(linkedId).catch(() => {});
          return;
        }
        const cached = useFestivalStore.getState().currentFestival;
        // Signed-in users revalidate in the effect below; guests would otherwise keep the cache forever.
        if (cached && !useAuthStore.getState().user) selectFestival(cached.id).catch(() => {});
        if (fests.length > 0 && !cached) {
          const pick = pickDefaultFestival(fests);
          if (pick) selectFestival(pick.id).catch(() => {});
        }
      })
      .catch(() => {});
  }, [loadFestivals, selectFestival, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- refetch after sign-in/out: logout resets the stores

  // Tab back to the app on a later day: move the day tab to today (no fetch).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') followTodayOnResume();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Load crews whenever auth state transitions to logged-in
  useEffect(() => {
    if (user) {
      loadCrews().catch(() => {});
    }
  }, [user?.id, loadCrews]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: use user.id to avoid re-fetching on every auth object change

  // ?joinCrew=<inviteCode> deep-link handler. Validates the code's shape
  // (mirrors routes/crew-invites.ts:156's own check) and STAGES it for explicit
  // confirmation in JoinCrewSheet -- a bare link must never silently enroll a
  // logged-in visitor. A guest's code is stashed in sessionStorage across
  // sign-up/sign-in; once signed in it is read back here and staged. The server
  // creates the festival profile on join, so no festival context is awaited.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('joinCrew');

    if (!user) {
      if (!raw || joinAttemptedRef.current === raw) return;
      try {
        sessionStorage.setItem(PENDING_JOIN_KEY, raw);
      } catch {
        /* sessionStorage unavailable */
      }
      joinAttemptedRef.current = raw;
      navigate({ to: '/register' });
      return;
    }

    let stashed: string | null = null;
    try {
      stashed = sessionStorage.getItem(PENDING_JOIN_KEY);
      sessionStorage.removeItem(PENDING_JOIN_KEY);
    } catch {
      /* sessionStorage unavailable */
    }
    const code = raw ?? stashed;
    // The guard only dedupes a live URL code. A stashed code was already removed
    // from storage, and the guest branch set the ref to that same code before
    // sign-up, so guarding it would drop the invite.
    if (!code || (raw && joinAttemptedRef.current === raw)) return;

    joinAttemptedRef.current = code;
    if (!/^[a-zA-Z0-9]{4,12}$/.test(code)) {
      stripJoinCrewParam();
      toast('Invalid invite link', 'error');
      return;
    }
    setPendingJoinCode(code);
  }, [user?.id, navigate, toast]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: user.id avoids re-running on every auth object change

  // Dismisses the pending join sheet, whether or not the join happened.
  const clearPendingJoin = () => {
    setPendingJoinCode(null);
    stripJoinCrewParam();
  };

  // Re-fetch festival profiles on login once a festival is selected
  useEffect(() => {
    if (user && currentFestival) {
      selectFestival(currentFestival.id).catch(() => {});
    }
  }, [user?.id, currentFestival?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pendingJoinCode, clearPendingJoin };
}
