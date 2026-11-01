import { useEffect, useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCrewStore } from '../stores/crewStore';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import type { Crew, FestivalDay, SosEntry } from '../types';
import {
  selectActiveMeet,
  selectActiveSos,
  selectCrewWhereabouts,
  type ActiveMeet,
  type CrewWhereabout,
} from '../utils/dayOf';

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
 */
export function useCrewDayOf(nowMs: number, days: ReadonlyArray<FestivalDay>, timeZone?: string): CrewDayOf {
  const user = useAuthStore((s) => s.user);
  const crews = useCrewStore((s) => s.crews);
  const crew = useCrewStore((s) => s.activeCrew);
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const statuses = useCrewStore((s) => s.crewStatuses);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const peers = useLiveLocationStore((s) => s.peers);
  const sos = useActiveSos();

  const firstCrewId = crews[0]?.id;
  useEffect(() => {
    if (user && !crew && firstCrewId) useCrewStore.getState().selectCrew(firstCrewId).catch(() => {});
  }, [user, crew, firstCrewId]);

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
        sos,
        meetingPoints,
        selfUserId: user.id,
        nowMs,
      }),
      meet: selectActiveMeet({ meetingPoints, crew, days, nowMs, timeZone }),
    };
  }, [user, crew, crewMembers, statuses, peers, sos, meetingPoints, nowMs, days, timeZone]);
}
