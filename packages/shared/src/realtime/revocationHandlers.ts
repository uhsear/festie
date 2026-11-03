// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * revocationHandlers — local-state teardown for the server's authorization
 * revocation events (`session:revoked`, `crew:access-revoked`,
 * `crew:member-kicked`).
 *
 * These live here (not in the hook) so the self-vs-other decision is unit
 * testable without React. The hazard this module exists to contain: a
 * `crew:member-kicked` event is broadcast to the WHOLE crew room, so every
 * remaining member receives it too. Only the member whose `userId` matches the
 * signed-in user may be logged out of the crew; everyone else just drops one
 * roster row. When the current user id is unknown we treat the event as
 * "another member" — an unnecessary roster row beats a spurious eviction.
 */

import { useAuthStore } from '../stores/authStore';
import { useCrewStore } from '../stores/crewStore';
import { useLiveLocationStore } from '../stores/liveLocationStore';

/** The signed-in user id, or null when signed out / not yet hydrated. */
function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

/** The crew's name from the crew list or the open crew, read before teardown. */
function readCrewName(crewId: string): string | null {
  const { crews, activeCrew } = useCrewStore.getState();
  const crew = crews.find((c) => c.id === crewId) ?? (activeCrew?.id === crewId ? activeCrew : null);
  return crew?.name ?? null;
}

/**
 * The current user lost access to `crewId` (kicked, removed by an admin, or
 * the crew was revoked). Drop it from the crew list and, when it is the open
 * crew, clear every crew-scoped slice.
 *
 * `_cachedAt` / `_cachedCrewId` are persisted to disk — clearing them matters:
 * without it a cold start rehydrates the revoked crew's meeting points, polls
 * and expenses from local storage.
 */
export function applyCrewAccessRevoked(crewId: string): void {
  if (!crewId) return;
  useCrewStore.setState((state) => {
    const wasActive = state.activeCrew?.id === crewId;
    const base = { crews: state.crews.filter((c) => c.id !== crewId) };
    if (!wasActive) return base;
    return {
      ...base,
      activeCrew: null,
      crewMembers: [],
      polls: [],
      meetingPoints: [],
      packingItems: [],
      rideOffers: [],
      crewStatuses: [],
      expenses: [],
      expenseBalances: [],
      settlements: [],
      activity: [],
      activityNextCursor: null,
      crewOverlap: {},
      _cachedAt: null,
      _cachedCrewId: null,
    };
  });
  // Ephemeral peer markers + SOS for that crew (setActiveCrew(null) resets them
  // and any in-flight sharing).
  if (useLiveLocationStore.getState().crewId === crewId) {
    useLiveLocationStore.getState().setActiveCrew(null);
  }
}

/**
 * A member was kicked from `crewId`. Self -> full access teardown; anyone else
 * -> drop that one roster row (only for the crew that is actually open, since
 * `crewMembers` holds the active crew's roster).
 *
 * Returns the crew name when the kicked user is me (so the caller can show a
 * notice), else null.
 */
export function applyCrewMemberKicked(crewId: string, userId: string): { crewName: string | null } | null {
  if (!crewId || !userId) return null;
  const me = currentUserId();
  if (me && userId === me) {
    const crewName = readCrewName(crewId);
    applyCrewAccessRevoked(crewId);
    return { crewName };
  }
  useCrewStore.setState((state) => {
    if (state.activeCrew?.id !== crewId) return {};
    return {
      crewMembers: state.crewMembers.filter((m) => m.userId !== userId),
      activeCrew: {
        ...state.activeCrew,
        members: (state.activeCrew.members ?? []).filter((m) => m.userId !== userId),
      },
    };
  });
  return null;
}

/**
 * The crew was deleted. Tear down local access like a revocation. Returns the
 * crew name for a notice unless the deleter is me (I already know).
 */
export function applyCrewDeleted(crewId: string, deletedBy?: string): { crewName: string | null } | null {
  if (!crewId) return null;
  const crewName = readCrewName(crewId);
  applyCrewAccessRevoked(crewId);
  const me = currentUserId();
  return deletedBy && me && deletedBy === me ? null : { crewName };
}

/**
 * The server killed this session. Same teardown as a user-initiated sign-out
 * (`logout()` clears the token and calls resetAllStores), then the caller's
 * platform navigation sends the user to the auth surface.
 *
 * `logout()` POSTs /auth/logout, which will 401 on an already-revoked session;
 * that is harmless — the api layer skips its 401-refresh retry for `/auth/`
 * paths, and logout() purges local state whether or not the call succeeds.
 */
export async function applySessionRevoked(onRevoked?: () => void): Promise<void> {
  try {
    await useAuthStore.getState().logout();
  } finally {
    onRevoked?.();
  }
}
