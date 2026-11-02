import { useCallback } from 'react';
import { useCrewStore } from '../stores/crewStore';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import type { Crew } from '../types/domain';

/**
 * Creates a crew for the chosen festival, then switches the app to that
 * festival when it differs from the current one. Create errors propagate (the
 * store already set `error`); a switch failure is logged and ignored because
 * the crew exists.
 */
export function useCreateCrew(): (name: string, festivalId: string) => Promise<Crew> {
  return useCallback(async (name: string, festivalId: string): Promise<Crew> => {
    const crew = await useCrewStore.getState().createCrew({ name, festivalId });
    const festivalState = useFestivalDataStore.getState();
    if (festivalId !== festivalState.currentFestival?.id) {
      try {
        await festivalState.selectFestival(festivalId);
      } catch (err) {
        console.warn('Created crew but could not switch festival', err);
      }
    }
    return crew;
  }, []);
}
