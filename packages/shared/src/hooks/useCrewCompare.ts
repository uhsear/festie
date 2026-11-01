import { useMemo } from 'react';
import { useCrewStore } from '../stores/crewStore';
import { useFestivalStore } from '../stores/festivalStore';
import type { FestivalDay, FestivalSet, Priority, Profile } from '../types';
import { PRIORITY_WEIGHT } from '../utils/crewNudges';
import { assignCrewColors, buildCrewMix, crewProfilesFor, findFreeTogether, type FreeSlot } from '../utils/crewPlan';
import { resolveFestivalTimeZone } from '../utils/festivalTime';
import { buildCrewSplits, type CrewSplit, type CrewTogether } from '../utils/pickConflicts';
import { byStartTime } from '../utils/scheduleFormat';

export interface CrewCompareColumn {
  profileId: string;
  userId: string;
  name: string;
  isMe: boolean;
  color: string;
}

export interface CrewCompareRow {
  set: FestivalSet;
  picks: Record<string, Priority | undefined>;
  pickers: number;
  topPriority: Priority;
  mine: Priority | undefined;
}

export interface CrewCompare {
  columns: CrewCompareColumn[];
  rows: CrewCompareRow[];
  freeTogether: FreeSlot[];
  /** Where members split up and which sets they see together; both empty for a crew of one. */
  split: CrewSplit[];
  together: CrewTogether[];
  timeZone: string | undefined;
}

/** The compare grid: one column per crew member (you first), one row per picked set on the selected day. */
export function useCrewCompare(sort: 'time' | 'mix'): CrewCompare {
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const crew = useCrewStore((s) => s.activeCrew);
  const sets = useFestivalStore((s) => s.sets) as FestivalSet[];
  const days = useFestivalStore((s) => s.days) as FestivalDay[];
  const allProfiles = useFestivalStore((s) => s.allProfiles) as Profile[];
  const currentProfile = useFestivalStore((s) => s.currentProfile) as Profile | null;
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const timeZone = useFestivalStore((s) => resolveFestivalTimeZone(s.currentFestival));

  const profiles = useMemo(
    () =>
      crewProfilesFor(
        allProfiles,
        [...crewMembers.map((m) => m.userId), ...(crew?.members ?? []).map((m) => m.userId)],
        currentProfile,
      ),
    [allProfiles, crewMembers, crew, currentProfile],
  );

  const ordered = useMemo(() => {
    const others = profiles.filter((p) => p.id !== currentProfile?.id);
    return currentProfile ? [currentProfile, ...others] : others;
  }, [profiles, currentProfile]);

  const columns = useMemo(() => {
    const colors = assignCrewColors(ordered.map((p) => p.id));
    return ordered.map((p) => ({
      profileId: p.id,
      userId: p.userId,
      name: p.name || 'Crew member',
      isMe: p.id === currentProfile?.id,
      color: colors[p.id]!,
    }));
  }, [ordered, currentProfile]);

  const rows = useMemo(() => {
    const built = sets
      .filter((s) => s.dayIndex === selectedDay)
      .map((set) => {
        const picks: Record<string, Priority | undefined> = {};
        let pickers = 0;
        let top: Priority | null = null;
        for (const p of ordered) {
          const priority = p.picks?.[set.id] as Priority | undefined;
          picks[p.id] = priority;
          if (!priority) continue;
          pickers += 1;
          if (!top || PRIORITY_WEIGHT[priority] > PRIORITY_WEIGHT[top]) top = priority;
        }
        return {
          set,
          picks,
          pickers,
          topPriority: top as Priority,
          mine: currentProfile?.picks?.[set.id] as Priority | undefined,
        };
      })
      .filter((r) => r.pickers > 0);
    if (sort === 'time') return built.sort((a, b) => byStartTime(a.set, b.set));
    const rank = new Map(
      buildCrewMix({ sets, days, profiles: ordered, dayIndex: selectedDay, minCount: 1, limit: Infinity }).map(
        (e, idx) => [e.set.id, idx] as const,
      ),
    );
    return built.sort((a, b) => (rank.get(a.set.id) ?? 0) - (rank.get(b.set.id) ?? 0));
  }, [sets, days, ordered, selectedDay, currentProfile, sort]);

  const freeTogether = useMemo(
    () => findFreeTogether({ sets, days, profiles: ordered, dayIndex: selectedDay, nowMs: Date.now(), timeZone }),
    [sets, days, ordered, selectedDay, timeZone],
  );

  // shortcut: shows every member on every day; filter by attendance once T43 crew days exist.
  const { split, together } = useMemo(
    () => buildCrewSplits({ sets, days, profiles: ordered, dayIndex: selectedDay, timeZone }),
    [sets, days, ordered, selectedDay, timeZone],
  );

  return { columns, rows, freeTogether, split, together, timeZone };
}
