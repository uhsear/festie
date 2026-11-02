import { useCallback, useMemo } from 'react';
import { useCrewStore } from '../stores/crewStore';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import { useFestivalUIStore } from '../stores/festivalUIStore';
import type { Priority } from '../types/domain';
import { viewAsTarget } from '../utils/scheduleFilters';

export interface UseViewAsReturn {
  target: { profileId: string; name: string; picks: Record<string, Priority> } | null;
  /** True when this profile can be viewed: in the active crew and not me. */
  canView: (profileId: string) => boolean;
  start: (profileId: string) => void;
  clear: () => void;
}

/**
 * "View as": filter the schedule to one crew mate's picks. Only members of the
 * active crew qualify, checked here and again in viewAsTarget, so a stale or
 * forged id filters nothing. Never persisted.
 */
export function useViewAs(): UseViewAsReturn {
  const viewAsProfileId = useFestivalUIStore((s) => s.viewAsProfileId);
  const setViewAs = useFestivalUIStore((s) => s.setViewAs);
  const allProfiles = useFestivalDataStore((s) => s.allProfiles);
  const myProfileId = useFestivalDataStore((s) => s.currentProfile?.id);
  const crewMembers = useCrewStore((s) => s.crewMembers);

  const crewUserIds = useMemo(() => new Set(crewMembers.map((m) => m.userId)), [crewMembers]);

  const target = useMemo(
    () => (viewAsProfileId === myProfileId ? null : viewAsTarget(allProfiles, viewAsProfileId, crewUserIds)),
    [allProfiles, viewAsProfileId, myProfileId, crewUserIds],
  );

  const canView = useCallback(
    (profileId: string) => profileId !== myProfileId && viewAsTarget(allProfiles, profileId, crewUserIds) !== null,
    [allProfiles, myProfileId, crewUserIds],
  );

  const start = useCallback(
    (profileId: string) => {
      if (canView(profileId)) setViewAs(profileId);
    },
    [canView, setViewAs],
  );

  const clear = useCallback(() => setViewAs(null), [setViewAs]);

  return { target, canView, start, clear };
}
