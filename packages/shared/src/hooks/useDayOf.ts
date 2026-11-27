import { useEffect, useMemo, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { followFestivalCrew, useCrewStore } from '../stores/crewStore';
import { useFestivalStore } from '../stores/festivalStore';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { useSosSeenAck } from './useSosSeenAck';
import type { Crew, FestivalDay, SosEntry } from '../types';
import { crewForFestival, defaultCrewId } from '../utils/crewPlan';
import { useCurrentFestivalCrew } from './useActiveCrew';
import {
  selectActiveMeet,
  selectActiveSos,
  selectCrewWhereabouts,
  type ActiveMeet,
  type CrewWhereabout,
} from '../utils/dayOf';
import { selectCrewFaces, type CrewFace, type SelectCrewFacesInput } from '../utils/crewFaces';

/**
 * Keeps the live-location store scoped to the active crew app-wide, and the active crew
 * on the selected festival (see followFestivalCrew). The store
 * drops SOS and peer events for any other crew, so scoping it only while the
 * crew map is open lost SOS after leaving that screen or switching crews.
 * Mount once, where the app-wide SOS banner lives.
 */
export function useLiveLocationCrewSync(): void {
  const crewId = useCrewStore((s) => s.activeCrew?.id ?? null);
  const festivalId = useFestivalStore((s) => s.currentFestivalId);
  useEffect(() => {
    followFestivalCrew();
  }, [festivalId]);
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
 * Selects the user's crew of the selected festival when none is open, then
 * refreshes statuses and meeting points for it. Offline, the persisted
 * crewStore copy keeps rendering. A crew of another festival is never shown: the
 * result has no crew, so the Now surface offers to start one for this festival.
 */
export function useCrewDayOf(nowMs: number, days: ReadonlyArray<FestivalDay>, timeZone?: string): CrewDayOf {
  const user = useAuthStore((s) => s.user);
  const crews = useCrewStore((s) => s.crews);
  const crew = useCurrentFestivalCrew();
  const festivalId = useFestivalStore((s) => s.currentFestival?.id ?? s.currentFestivalId);
  const crewLoading = useCrewStore((s) => s.crewLoading);
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const statuses = useCrewStore((s) => s.crewStatuses);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const peers = useLiveLocationStore((s) => s.peers);
  const lostContact = useLiveLocationStore((s) => s.lostContact);
  const sos = useActiveSos();

  // No festival chosen yet: open the first crew, as the crew screen does.
  const festivalCrewId = festivalId ? crewForFestival(crews, null, { id: festivalId })?.id : defaultCrewId(crews, null);
  // Auto-select each crew once: crewLoading is a dep, so a failed select would otherwise retry forever.
  const autoSelectedId = useRef<string | null>(null);
  useEffect(() => {
    if (crew) {
      autoSelectedId.current = null;
      return;
    }
    // A pending select of another crew (a join landing) clears activeCrew; do not override it with this one.
    if (!user || !festivalCrewId || crewLoading || autoSelectedId.current === festivalCrewId) return;
    autoSelectedId.current = festivalCrewId;
    useCrewStore.getState().selectCrew(festivalCrewId).catch(() => {});
  }, [user, crew, festivalCrewId, crewLoading]);

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
