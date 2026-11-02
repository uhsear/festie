import { useEffect, useMemo, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCrewStore } from '../stores/crewStore';
import { useFestivalStore } from '../stores/festivalStore';
import type { Crew, CrewMeetingPoint, CrewPoll, FestivalDay, FestivalSet, Priority, Profile } from '../types';
import {
  CREW_PLAN_SLOTS,
  buildCrewMix,
  buildSlots,
  crewFestivalName,
  crewOwnerInfo,
  crewProfilesFor,
  groupSlotPicks,
  pickActiveMeetingPoint,
  type CrewMixEntry,
  type SlotGroup,
} from '../utils/crewPlan';
import type { CrewWhereabout } from '../utils/dayOf';
import { isFestivalOver, resolveFestivalTimeZone } from '../utils/festivalTime';
import { useCrewDayOf } from './useDayOf';

export interface CrewHub {
  crew: Crew | null;
  festivalName: string | null;
  memberCount: number;
  isOwner: boolean;
  ownerName: string | null;
  meetingPoint: CrewMeetingPoint | null;
  isPast: boolean;
  upNext: Array<{ startMs: number; startTime: string; groups: SlotGroup[] }>;
  howWeDid: CrewMixEntry[];
  mix: CrewMixEntry[];
  whereabouts: CrewWhereabout[];
  openPolls: CrewPoll[];
  myPicks: Record<string, Priority>;
}

const EMPTY_PICKS: Record<string, Priority> = {};

/**
 * Everything the crew plan screen shows, built from the persisted stores so it
 * renders offline. Wires stores to the pure helpers in `utils/crewPlan`.
 */
export function useCrewHub(nowMs: number): CrewHub {
  const user = useAuthStore((s) => s.user);
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const polls = useCrewStore((s) => s.polls);
  const sets = useFestivalStore((s) => s.sets) as FestivalSet[];
  const days = useFestivalStore((s) => s.days) as FestivalDay[];
  const allProfiles = useFestivalStore((s) => s.allProfiles) as Profile[];
  const currentProfile = useFestivalStore((s) => s.currentProfile) as Profile | null;
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivals = useFestivalStore((s) => s.festivals);
  const timeZone = resolveFestivalTimeZone(currentFestival);

  const { crew, whereabouts } = useCrewDayOf(nowMs, days, timeZone);

  const crewId = crew?.id;
  const loadedPollsFor = useRef<string | null>(null);
  useEffect(() => {
    if (!crewId || loadedPollsFor.current === crewId) return;
    loadedPollsFor.current = crewId;
    useCrewStore.getState().loadPolls(crewId).catch(() => {});
  }, [crewId]);

  const members = useMemo(() => (crewMembers.length ? crewMembers : (crew?.members ?? [])), [crewMembers, crew]);

  const crewProfiles = useMemo(
    () =>
      crewProfilesFor(
        allProfiles,
        [...crewMembers.map((m) => m.userId), ...(crew?.members ?? []).map((m) => m.userId)],
        currentProfile,
      ),
    [allProfiles, crewMembers, crew, currentProfile],
  );

  const isPast = useMemo(() => isFestivalOver(currentFestival, days, new Date(nowMs)), [currentFestival, days, nowMs]);

  return useMemo(() => {
    const owner = crew && user ? crewOwnerInfo(crew, members, user.id) : { isOwner: false, ownerName: null };
    const upNext = isPast
      ? []
      : buildSlots(sets, days, crewProfiles, nowMs, CREW_PLAN_SLOTS, timeZone)
          .filter((slot) => slot.picks.length > 0)
          .map((slot) => ({ startMs: slot.startMs, startTime: slot.startTime, groups: groupSlotPicks(slot.picks) }));
    return {
      crew,
      festivalName: crewFestivalName(crew, festivals, currentFestival),
      memberCount: members.length,
      ...owner,
      meetingPoint: pickActiveMeetingPoint(meetingPoints, nowMs),
      isPast,
      upNext,
      howWeDid: isPast ? buildCrewMix({ sets, days, profiles: crewProfiles, timeZone, limit: 5 }) : [],
      mix: isPast ? [] : buildCrewMix({ sets, days, profiles: crewProfiles, nowMs, timeZone, limit: 3 }),
      whereabouts: whereabouts.filter((w) => w.sos || w.live || w.statusLabel).slice(0, 3),
      openPolls: polls
        .filter((p) => !p.closed)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      myPicks: (currentProfile?.picks as Record<string, Priority> | undefined) ?? EMPTY_PICKS,
    };
  }, [
    crew,
    user,
    members,
    festivals,
    currentFestival,
    meetingPoints,
    nowMs,
    isPast,
    sets,
    days,
    crewProfiles,
    timeZone,
    whereabouts,
    polls,
    currentProfile,
  ]);
}
