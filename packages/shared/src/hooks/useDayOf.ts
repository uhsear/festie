import { useEffect, useMemo, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCrewStore } from '../stores/crewStore';
import { useFestivalStore } from '../stores/festivalStore';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { useSosSeenAck } from './useSosSeenAck';
import type { Crew, FestivalDay, SosEntry } from '../types';
import {
  selectActiveMeet,
  selectActiveSos,
  selectCrewWhereabouts,
  type ActiveMeet,
  type CrewWhereabout,
} from '../utils/dayOf';
import { selectCrewFaces, type CrewFace, type SelectCrewFacesInput } from '../utils/crewFaces';

/**
 * Keeps the live-location store scoped to the active crew app-wide. The store
 * drops SOS and peer events for any other crew, so scoping it only while the
 * crew map is open lost SOS after leaving that screen or switching crews.
 * Mount once, where the app-wide SOS banner lives.
 */
export function useLiveLocationCrewSync(): void {
  const crewId = useCrewStore((s) => s.activeCrew?.id ?? null);
  useEffect(() => {
    const store = useLiveLocationStore.getState();
    store.setActiveCrew(crewId);
    if (crewId) void store.loadActiveSos(crewId);
  }, [crewId]);
  useSosSeenAck();
}

/** Active SOS entries for the open crew, newest first. Empty for guests. */
export function useActiveSos(): SosEntry[] {
  const user = useAuthStore((s) => s.user);
  const crewId = useCrewStore((s) => s.activeCrew?.id ?? null);
  const list = useLiveLocationStore((s) => s.activeSosList);
  return useMemo(() => (user ? selectActiveSos(list, crewId) : []), [user, list, crewId]);
}

export interface CrewDayOf {
  crew: Crew | null;
  whereabouts: CrewWhereabout[];
  meet: ActiveMeet | null;
}

/**
 * Crew data for the day-of Now surface: who is where, and where to meet.
 * Selects the first crew when none is open (as the crew screen does), then
 * refreshes statuses and meeting points for it. Offline, the persisted
 * crewStore copy keeps rendering.
 *
 * Pass `festivalId` to scope the surface to that festival: a crew from another
 * festival is never shown, the crew for this festival is opened instead, and a
 * festival with no crew of yours yields `crew: null`.
 */
export function useCrewDayOf(
  nowMs: number,
  days: ReadonlyArray<FestivalDay>,
  timeZone?: string,
  festivalId?: string,
): CrewDayOf {
  const user = useAuthStore((s) => s.user);
  const crews = useCrewStore((s) => s.crews);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  // A crew with no festival (older rows) stays visible everywhere.
  const crew = activeCrew && (!festivalId || !activeCrew.festivalId || activeCrew.festivalId === festivalId) ? activeCrew : null;
  const crewLoading = useCrewStore((s) => s.crewLoading);
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const statuses = useCrewStore((s) => s.crewStatuses);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const peers = useLiveLocationStore((s) => s.peers);
  const lostContact = useLiveLocationStore((s) => s.lostContact);
  const sos = useActiveSos();

  const firstCrewId = (festivalId ? crews.find((c) => c.festivalId === festivalId) : crews[0])?.id;
  // Auto-select each crew once: crewLoading is a dep, so a failed select would otherwise retry forever.
  const autoSelectedId = useRef<string | null>(null);
  useEffect(() => {
    if (crew) {
      autoSelectedId.current = null;
      return;
    }
    // A pending select of another crew (a join landing) clears activeCrew; do not override it with the first crew.
    if (!user || !firstCrewId || crewLoading || autoSelectedId.current === firstCrewId) return;
    autoSelectedId.current = firstCrewId;
    useCrewStore.getState().selectCrew(firstCrewId).catch(() => {});
  }, [user, crew, firstCrewId, crewLoading]);

  const crewId = user ? crew?.id : undefined;
  useEffect(() => {
    if (!crewId) return;
    // Failures keep the persisted copy; the store records the error itself.
    const store = useCrewStore.getState();
    store.loadStatuses(crewId).catch(() => {});
    store.loadMeetingPoints(crewId).catch(() => {});
  }, [crewId]);

  return useMemo(() => {
    if (!user || !crew) return { crew: null, whereabouts: [], meet: null };
    const members = crewMembers.length ? crewMembers : crew.members || [];
    return {
      crew,
      whereabouts: selectCrewWhereabouts({
        members,
        statuses,
        peers,
        lostContact,
        sos,
        meetingPoints,
        selfUserId: user.id,
        nowMs,
      }),
      meet: selectActiveMeet({ meetingPoints, crew, days, nowMs, timeZone }),
    };
  }, [user, crew, crewMembers, statuses, peers, lostContact, sos, meetingPoints, nowMs, days, timeZone]);
}

/** The crew hub's face row: each crewmate with their stage and a walk or last-seen caption. */
export function useCrewFaces(
  nowMs: number,
  days: ReadonlyArray<FestivalDay>,
  viewer: SelectCrewFacesInput['viewer'],
  timeZone?: string,
): CrewFace[] {
  const { whereabouts } = useCrewDayOf(nowMs, days, timeZone);
  const peers = useLiveLocationStore((s) => s.peers);
  const stages = useFestivalStore((s) => s.stages);
  return useMemo(
    () => selectCrewFaces({ whereabouts, peers, stages, viewer, nowMs }),
    [whereabouts, peers, stages, viewer, nowMs],
  );
}
