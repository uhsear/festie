// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * liveLocationStore — ephemeral Live Location + SOS state for the active crew.
 *
 * PRIVACY-CRITICAL: this store is created WITHOUT the persist middleware (unlike
 * crewStore). GPS coordinates and SOS positions are NEVER written to disk
 * (AsyncStorage / localStorage). They live only in memory for the lifetime of
 * the page/app session and reset to empty on every launch — so the "share my
 * location" toggle is always OFF by default and coordinates never leak to
 * storage, analytics, or replay.
 *
 * Scope: one crew at a time. `crewId` is the crew this store is currently scoped
 * to (viewing and/or sharing). Switching crews resets peers + SOS so one crew's
 * markers never bleed into another's.
 *
 * Self-healing: `sweepStale` drops peers whose serverAt is older than the TTL
 * (defense in depth alongside the server's 120s Redis TTL + peer-stopped
 * broadcasts), so a force-quit peer's marker fades even with no clean stop event.
 *
 * Two notions of "sharing": `shareIntent` is what the USER asked for (crew, end
 * time, paused, battery opt-in) and outlives any screen; `sharingCrewId` /
 * `startSharing` / `stopSharing` only track what the publisher is sending right now.
 */

import { create, StateCreator } from 'zustand';
import type { PeerLocation, SosEntry, SosViewer } from '../types';
import { LIVE_LOCATION } from '../constants/config';
import { api } from '../services/api';

export type LiveShareEndReason = 'expired' | 'background' | 'low-power' | 'error' | 'denied' | 'rejected' | 'user';

export interface LiveShareIntent {
  crewId: string;
  /** ISO time the session ends. It keeps running while paused. */
  expiresAt: string;
  paused: boolean;
  shareBattery: boolean;
}

export interface LiveLocationState {
  /** The crew this store is scoped to (viewing/sharing), or null when inactive. */
  crewId: string | null;
  /** The crew we are actively publishing our own position to, or null. */
  sharingCrewId: string | null;
  /** The user's live-share session, or null. Cleared on a crew switch and on logout. */
  shareIntent: LiveShareIntent | null;
  /** Why the last session ended, for a one-time notice. Null while sharing or after clearShareEnded. */
  shareEndedReason: LiveShareEndReason | null;
  /**
   * Phase 4C: ISO timestamp our own time-boxed share auto-stops, or null. Drives
   * the "sharing ends in Nm" countdown on our own sharing indicator (peers get
   * theirs from each peer's relayed expiresAt). Cleared on stop/reset.
   */
  sharingExpiresAt: string | null;
  /** Publisher bookkeeping: epoch ms of our last published fix. */
  lastSentAt: number | null;
  /** Publisher bookkeeping: our last published coordinate (for move-threshold). */
  lastSentCoord: { lat: number; lng: number } | null;
  /** Peers currently sharing to this crew, keyed by userId. */
  peers: Record<string, PeerLocation>;
  /**
   * When each swept peer last reached the server (ISO serverAt), keyed by userId,
   * for "Lost contact 12 min ago". Only the time is kept, never the position.
   * A new fix or a deliberate stop clears the entry.
   */
  lostContact: Record<string, string>;
  /**
   * All active SOS entries for this crew, keyed by the raiser's userId. Multiple
   * crew members can have an SOS up at once; each is its own keyed slot.
   */
  sosByUser: Record<string, SosEntry>;
  /**
   * BACKWARD-COMPAT (do NOT remove): the single most-recent active SOS, DERIVED
   * from `sosByUser` (latest by `raisedAt`), or null when none. Every existing
   * consumer that reads `state.sos` keeps working unchanged; it now simply tracks
   * the newest of possibly several active SOS entries.
   */
  sos: SosEntry | null;
  /** All active SOS entries as an array, newest first (derived from `sosByUser`). */
  activeSosList: SosEntry[];
}

export interface LiveLocationActions {
  /**
   * Scope the store to a crew (viewing). Resets peers + SOS + sharing bookkeeping
   * when the crew changes so stale markers from another crew never render.
   */
  setActiveCrew: (crewId: string | null) => void;
  /**
   * Mark that we have started publishing our own position to `crewId`. `expiresAt`
   * (Phase 4C) is the ISO auto-stop time for the "sharing ends in Nm" own-side
   * countdown; omit it to leave the window unset.
   */
  startSharing: (crewId: string, expiresAt?: string | null) => void;
  /** Stop publishing our own position; clears publisher bookkeeping. */
  stopSharing: () => void;
  /** Start a time-boxed share session. Clears any earlier end reason. */
  beginShare: (crewId: string, expiresAt: string, shareBattery: boolean) => void;
  /** Pause hides our dot from the crew; the end time keeps running. No-op without a session. */
  setSharePaused: (paused: boolean) => void;
  /** End the session and record why. No-op without a session. */
  endShare: (reason: LiveShareEndReason) => void;
  clearShareEnded: () => void;
  /** Merge viewers into one raiser's SOS (union by userId). Ignores an unknown raiser. */
  applySosSeen: (raiserId: string, seenBy: SosViewer[]) => void;
  /** Record a just-published fix (used by the throttle in useLiveLocationPublisher). */
  recordSent: (coord: { lat: number; lng: number }, at: number) => void;
  /** Apply a peer's position. Ignored if it targets a different crew than active. */
  applyPeerUpdate: (peer: PeerLocation) => void;
  /** Remove a peer (stop / disconnect / expiry). */
  removePeer: (userId: string) => void;
  /** Drop peers whose serverAt is older than ttlMs (defense in depth vs server TTL). */
  sweepStale: (now: number, ttlMs?: number) => void;
  /** Apply an SOS (keyed by raiser userId). Ignored if it targets a different crew than active. */
  applySos: (entry: SosEntry) => void;
  /**
   * Clear SOS state. With a `raiserId`, removes just that raiser's SOS; with no
   * argument (the socket "clear-all" / resolved path) clears every active SOS.
   */
  clearSos: (raiserId?: string) => void;
  /**
   * Read the crew's active SOS list over HTTP, so a member who opens the app
   * after an SOS was raised still sees it. Never throws; keeps state on error.
   */
  loadActiveSos: (crewId: string) => Promise<void>;
  /** Full reset (e.g. on logout). */
  reset: () => void;
}

export type LiveLocationStore = LiveLocationState & LiveLocationActions;

const EMPTY: LiveLocationState = {
  crewId: null,
  sharingCrewId: null,
  shareIntent: null,
  shareEndedReason: null,
  sharingExpiresAt: null,
  lastSentAt: null,
  lastSentCoord: null,
  peers: {},
  lostContact: {},
  sosByUser: {},
  sos: null,
  activeSosList: [],
};

/**
 * Recompute the derived SOS views (`activeSosList` newest-first + the
 * backward-compat single `sos`) from the keyed `sosByUser` map. Centralized so
 * every mutation that touches `sosByUser` keeps the derived fields in sync.
 */
function deriveSos(
  sosByUser: Record<string, SosEntry>,
): Pick<LiveLocationState, 'sosByUser' | 'sos' | 'activeSosList'> {
  const activeSosList = Object.values(sosByUser).sort(
    (a, b) => new Date(b.raisedAt).getTime() - new Date(a.raisedAt).getTime(),
  );
  return { sosByUser, activeSosList, sos: activeSosList[0] ?? null };
}

const liveLocationStore: StateCreator<LiveLocationStore> = (set, get) => ({
  ...EMPTY,

  setActiveCrew: (crewId) => {
    if (get().crewId === crewId) return;
    // Crew switch: wipe everything scoped to the previous crew, including any
    // active sharing (you must re-opt-in for the new crew — no silent re-share).
    set({ ...EMPTY, crewId });
  },

  startSharing: (crewId, expiresAt = null) => {
    set({ crewId, sharingCrewId: crewId, sharingExpiresAt: expiresAt, lastSentAt: null, lastSentCoord: null });
  },

  stopSharing: () => {
    set({ sharingCrewId: null, sharingExpiresAt: null, lastSentAt: null, lastSentCoord: null });
  },

  beginShare: (crewId, expiresAt, shareBattery) => {
    set({ shareIntent: { crewId, expiresAt, paused: false, shareBattery }, shareEndedReason: null });
  },

  setSharePaused: (paused) => {
    set((state) => (state.shareIntent ? { shareIntent: { ...state.shareIntent, paused } } : state));
  },

  endShare: (reason) => {
    set((state) => (state.shareIntent ? { shareIntent: null, shareEndedReason: reason } : state));
  },

  clearShareEnded: () => {
    set({ shareEndedReason: null });
  },

  applySosSeen: (raiserId, seenBy) => {
    set((state) => {
      const entry = state.sosByUser[raiserId];
      if (!entry) return state;
      const merged = new Map((entry.seenBy ?? []).map((v) => [v.userId, v]));
      for (const v of seenBy) merged.set(v.userId, v);
      return deriveSos({ ...state.sosByUser, [raiserId]: { ...entry, seenBy: [...merged.values()] } });
    });
  },

  recordSent: (coord, at) => {
    set({ lastSentCoord: coord, lastSentAt: at });
  },

  applyPeerUpdate: (peer) => {
    const { crewId } = get();
    // Guard: only accept peers for the crew we're scoped to. The realtime hook
    // already guards via the router; this is defense in depth.
    if (crewId && peer.crewId !== crewId) return;
    set((state) => {
      const { [peer.userId]: _found, ...lostContact } = state.lostContact;
      return { peers: { ...state.peers, [peer.userId]: peer }, lostContact };
    });
  },

  removePeer: (userId) => {
    set((state) => {
      if (!(userId in state.peers) && !(userId in state.lostContact)) return state;
      const next = { ...state.peers };
      delete next[userId];
      const { [userId]: _stopped, ...lostContact } = state.lostContact;
      return { peers: next, lostContact };
    });
  },

  sweepStale: (now, ttlMs = LIVE_LOCATION.STALE_MS) => {
    set((state) => {
      let changed = false;
      const next: Record<string, PeerLocation> = {};
      const lostContact = { ...state.lostContact };
      for (const [userId, peer] of Object.entries(state.peers)) {
        const serverMs = new Date(peer.serverAt).getTime();
        if (Number.isFinite(serverMs) && now - serverMs > ttlMs) {
          changed = true;
          lostContact[userId] = peer.serverAt;
          continue;
        }
        next[userId] = peer;
      }
      return changed ? { peers: next, lostContact } : state;
    });
  },

  applySos: (entry) => {
    const { crewId } = get();
    if (crewId && entry.crewId !== crewId) return;
    set((state) => deriveSos({ ...state.sosByUser, [entry.userId]: entry }));
  },

  clearSos: (raiserId) => {
    set((state) => {
      // No raiserId → the socket "clear-all" / resolved path: drop every SOS.
      if (raiserId === undefined) {
        if (Object.keys(state.sosByUser).length === 0) return state;
        return deriveSos({});
      }
      if (!(raiserId in state.sosByUser)) return state;
      const next = { ...state.sosByUser };
      delete next[raiserId];
      return deriveSos(next);
    });
  },

  loadActiveSos: async (crewId) => {
    const startedAt = Date.now();
    try {
      const res = await api.get<{ sos: SosEntry[] }>(`/crews/${crewId}/sos`);
      if (get().crewId !== crewId) return;
      const next: Record<string, SosEntry> = {};
      for (const entry of res.sos) {
        if (entry.crewId === crewId) next[entry.userId] = entry;
      }
      // A live sos:raised that landed mid-request is newer than the response.
      for (const entry of Object.values(get().sosByUser)) {
        if (new Date(entry.raisedAt).getTime() > startedAt) next[entry.userId] = entry;
      }
      set(deriveSos(next));
    } catch (err) {
      console.warn('[liveLocationStore] loadActiveSos failed; keeping current SOS state', err);
    }
  },

  reset: () => {
    set({ ...EMPTY });
  },
});

// NOTE: plain create() — NO persist middleware. Ephemerality is a hard privacy
// requirement (see file header). Do not wrap this in persist().
export const useLiveLocationStore = create<LiveLocationStore>()(liveLocationStore);
