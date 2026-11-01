import { useCallback } from 'react';
import { useCrewStore } from '../stores/crewStore';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import type { Crew } from '../types/domain';

export type JoinOutcome = { kind: 'joined' | 'already'; crew: Crew } | { kind: 'queued' };

/**
 * Joins a crew by invite code, then switches to the crew's festival and
 * selects the crew. Join errors propagate (the store already set `error`);
 * switch/select failures are logged and ignored because the join succeeded.
 */
export function useJoinCrewByInvite(): (code: string) => Promise<JoinOutcome> {
  return useCallback(async (code: string): Promise<JoinOutcome> => {
    const crew = await useCrewStore.getState().joinByCode({ inviteCode: code });
    if (!crew) return { kind: 'queued' };

    const festivalState = useFestivalDataStore.getState();
    if (crew.festivalId && crew.festivalId !== festivalState.currentFestival?.id) {
      try {
        await festivalState.selectFestival(crew.festivalId);
      } catch (err) {
        console.warn('Joined crew but could not switch festival', err);
      }
    }
    try {
      await useCrewStore.getState().selectCrew(crew.id);
    } catch (err) {
      console.warn('Joined crew but could not select it', err);
    }
    return { kind: crew.alreadyMember ? 'already' : 'joined', crew };
  }, []);
}
