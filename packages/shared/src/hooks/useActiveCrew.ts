import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCrewStore } from '../stores/crewStore';
import { useFestivalStore } from '../stores/festivalStore';
import type { Crew } from '../types';
import { crewForFestival, crewFestivalName, crewScreenStatus, type CrewScreenStatus } from '../utils/crewPlan';

/**
 * The crew a crew screen shows. Loads the crews once, selects one when none is open
 * (the crew of the festival on screen, else the first), and reports what to render
 * (skeleton, error card, "No crew yet").
 */
export function useActiveCrew(): { status: CrewScreenStatus; crew: Crew | null; crews: Crew[]; retry: () => void } {
  const user = useAuthStore((s) => s.user);
  const crews = useCrewStore((s) => s.crews);
  const crew = useCrewStore((s) => s.activeCrew);
  const crewLoading = useCrewStore((s) => s.crewLoading);
  const festivalId = useFestivalStore((s) => s.currentFestival?.id);
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
  const firstCrewId = crews.find((c) => !c._optimistic)?.id;
  // With crews at two festivals, open the one that belongs to the festival on screen.
  const autoCrewId = (festivalId && crews.find((c) => !c._optimistic && c.festivalId === festivalId)?.id) || firstCrewId;
  // Auto-select each crew once: crewLoading is a dep, so a failed select would otherwise retry forever.
  const autoSelectedId = useRef<string | null>(null);
  useEffect(() => {
    if (crew) {
      autoSelectedId.current = null;
      return;
    }
    // A pending select of another crew clears activeCrew; do not override it with the first crew.
    if (!user || !autoCrewId || crewLoading || autoSelectedId.current === autoCrewId) return;
    autoSelectedId.current = autoCrewId;
    track(useCrewStore.getState().selectCrew(autoCrewId));
  }, [user, crew, autoCrewId, crewLoading, track]);

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
    const first = store.crews.find((c) => !c._optimistic);
    track(first ? store.selectCrew(first.id) : store.loadCrews());
  }, [track]);

  return {
    status: crewScreenStatus({
      hasActiveCrew: !!crew,
      crewCount: crews.length,
      joiningOnly: crews.length > 0 && !firstCrewId,
      loading: crewLoading,
      error: failed ? 'failed' : null,
    }),
    crew,
    crews,
    retry,
  };
}

/**
 * The crew the map shows layers for. The selected festival follows the Lineup tab, so the
 * active crew can belong to another festival. When the user has a crew for the selected
 * festival, this selects it (once per crew) so its members and meeting points load.
 * `crew` is null until that crew is the active one, so layers never mix two crews.
 * `otherFestivalName` names the active crew's festival when no crew fits the selected one.
 */
export function useMapCrew(): { crew: Crew | null; otherFestivalName: string | null } {
  const { crew: activeCrew, crews } = useActiveCrew();
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
      .catch((err) => console.warn('map: could not switch to the crew for this festival', err));
  }, [matchId, activeId]);

  return {
    crew: match && match.id === activeId ? match : null,
    otherFestivalName: !match && activeCrew ? crewFestivalName(activeCrew, festivals, currentFestival) : null,
  };
}

/**
 * Makes the festival store follow the crew's festival, so crew plan and compare
 * read the crew's lineup and profiles. Switches once per festival id per mount.
 */
export function useCrewFestival(crew: Crew | null): {
  state: 'match' | 'switching' | 'failed';
  festivalName: string;
  retry: () => void;
} {
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivals = useFestivalStore((s) => s.festivals);
  const targetId = crew?.festivalId ?? null;
  const matches = !targetId || targetId === currentFestival?.id;

  const [failedId, setFailedId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const attempted = useRef(new Set<string>());
  const supersededRetry = useRef(new Set<string>());

  useEffect(() => {
    if (matches || !targetId) return;
    const key = `${targetId}:${attempt}`;
    if (attempted.current.has(key)) return;
    attempted.current.add(key);
    useFestivalStore
      .getState()
      .selectFestival(targetId)
      .then(
        () => {
          if (useFestivalStore.getState().currentFestival?.id === targetId) return;
          // A newer selectFestival call (the web loader's re-fetch) superseded this one,
          // so it resolved without switching. Try once more, then offer Try again.
          if (supersededRetry.current.has(targetId)) {
            setFailedId(targetId);
            return;
          }
          supersededRetry.current.add(targetId);
          setAttempt((n) => n + 1);
        },
        () => setFailedId(targetId),
      );
  }, [matches, targetId, attempt]);

  const retry = useCallback(() => {
    setFailedId(null);
    setAttempt((n) => n + 1);
  }, []);

  const state = matches ? 'match' : failedId === targetId ? 'failed' : 'switching';
  return {
    state,
    festivalName: crewFestivalName(crew, festivals, currentFestival) ?? "the crew's festival",
    retry,
  };
}
