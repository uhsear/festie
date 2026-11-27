import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCrewStore } from '../stores/crewStore';
import { useFestivalStore } from '../stores/festivalStore';
import type { Crew } from '../types';
import {
  crewForFestival,
  crewFestivalName,
  crewScreenStatus,
  defaultCrewId,
  type CrewScreenStatus,
} from '../utils/crewPlan';

/**
 * The crew a crew screen shows. Loads the crews once, selects the crew of the selected
 * festival (else the first) when none is open, and reports what to render (skeleton, error card, "No crew yet").
 */
export function useActiveCrew(): { status: CrewScreenStatus; crew: Crew | null; crews: Crew[]; retry: () => void } {
  const user = useAuthStore((s) => s.user);
  const crews = useCrewStore((s) => s.crews);
  const crew = useCrewStore((s) => s.activeCrew);
  const crewLoading = useCrewStore((s) => s.crewLoading);
  // Only this hook's own load and select failures count. crewStore.error is also
  // written by createCrew and joinByCode, which must not turn "No crew yet" into an error card.
  const [failed, setFailed] = useState(false);
  const track = useCallback((p: Promise<unknown>) => {
    p.then(
      () => setFailed(false),
      () => setFailed(true),
    );
  }, []);

  const requestedLoad = useRef(false);
  useEffect(() => {
    if (!user) {
      requestedLoad.current = false;
      return;
    }
    if (requestedLoad.current || crews.length > 0 || crewLoading) return;
    requestedLoad.current = true;
    track(useCrewStore.getState().loadCrews());
  }, [user, crews.length, crewLoading, track]);

  // Skip an offline-join placeholder: it has no server crew to select until the join replays.
  const currentFestivalId = useFestivalStore((s) => s.currentFestival?.id ?? s.currentFestivalId);
  const openCrewId = defaultCrewId(crews, currentFestivalId);
  // Auto-select each crew once: crewLoading is a dep, so a failed select would otherwise retry forever.
  const autoSelectedId = useRef<string | null>(null);
  useEffect(() => {
    if (crew) {
      autoSelectedId.current = null;
      return;
    }
    // A pending select of another crew clears activeCrew; do not override it with the first crew.
    if (!user || !openCrewId || crewLoading || autoSelectedId.current === openCrewId) return;
    autoSelectedId.current = openCrewId;
    track(useCrewStore.getState().selectCrew(openCrewId));
  }, [user, crew, openCrewId, crewLoading, track]);

  // A persisted activeCrew is a cold-start read cache; refetch it once per crew so members
  // who joined while this device was closed appear. selectCrew keeps same-crew data on screen.
  const revalidatedId = useRef<string | null>(null);
  const activeId = crew?.id;
  useEffect(() => {
    if (!user || !activeId || revalidatedId.current === activeId) return;
    // An in-flight select is already fetching this crew.
    revalidatedId.current = activeId;
    if (useCrewStore.getState().crewLoading) return;
    track(useCrewStore.getState().selectCrew(activeId));
  }, [user, activeId, track]);

  const retry = useCallback(() => {
    const store = useCrewStore.getState();
    const openId = defaultCrewId(store.crews, useFestivalStore.getState().currentFestivalId);
    track(openId ? store.selectCrew(openId) : store.loadCrews());
  }, [track]);

  return {
    status: crewScreenStatus({
      hasActiveCrew: !!crew,
      crewCount: crews.length,
      joiningOnly: crews.length > 0 && !openCrewId,
      loading: crewLoading,
      error: failed ? 'failed' : null,
    }),
    crew,
    crews,
    retry,
  };
}

/**
 * The open crew when it belongs to the selected festival, else null. Festival-scoped
 * surfaces (Now, set detail) read this so a crew of another festival never shows under
 * the selected one. It only reads: followFestivalCrew and useActiveCrew open the crew.
 */
export function useCurrentFestivalCrew(): Crew | null {
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const festivalId = useFestivalStore((s) => s.currentFestival?.id ?? s.currentFestivalId);
  return activeCrew && (!activeCrew.festivalId || activeCrew.festivalId === festivalId) ? activeCrew : null;
}

/**
 * The crew a festival-scoped screen (map, compare, crew plan) shows. The selected festival
 * follows the Lineup tab, so the active crew can belong to another festival. When the user
 * has a crew for the selected festival, this selects it (once per crew) so its members and
 * meeting points load. `crew` is null until that crew is the active one, so layers never
 * mix two crews. `status` is `none` when no crew fits the selected festival, and
 * `otherFestivalName` then names the active crew's festival. The screen never switches
 * the festival to fit a crew: the festival picker owns that choice.
 */
export function useFestivalCrew(): {
  status: CrewScreenStatus;
  crew: Crew | null;
  festivalName: string | null;
  hasCrews: boolean;
  otherFestivalName: string | null;
  retry: () => void;
} {
  const { status, crew: activeCrew, crews, retry } = useActiveCrew();
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivals = useFestivalStore((s) => s.festivals);
  const match = crewForFestival(crews, activeCrew, currentFestival);
  const matchId = match?.id;
  const activeId = activeCrew?.id;

  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!matchId || matchId === activeId || requested.current === matchId) return;
    if (useCrewStore.getState().crewLoading) return;
    requested.current = matchId;
    useCrewStore
      .getState()
      .selectCrew(matchId)
      .catch((err) => console.warn('could not switch to the crew for this festival', err));
  }, [matchId, activeId]);

  const open = !!match && match.id === activeId;
  let fitted = status;
  if (status === 'ready' && currentFestival && !open) fitted = match ? 'loading' : 'none';
  return {
    status: fitted,
    crew: open ? match : null,
    festivalName: currentFestival?.name ?? null,
    hasCrews: crews.length > 0,
    otherFestivalName: !match && activeCrew ? crewFestivalName(activeCrew, festivals, currentFestival) : null,
    retry,
  };
}

/** The crew the map shows layers for, and the other festival's name when none fits. */
export function useMapCrew(): { crew: Crew | null; otherFestivalName: string | null } {
  const { crew, otherFestivalName } = useFestivalCrew();
  return { crew, otherFestivalName };
}
