import { useMemo } from 'react';
import { useCrewStore } from '../stores/crewStore';
import { indexCrewDays, type CrewDaysIndex } from '../utils/crewDays';

/** The active crew's day answers as a lookup. */
export function useCrewDaysIndex(): CrewDaysIndex {
  const crewDays = useCrewStore((s) => s.crewDays);
  return useMemo(() => indexCrewDays(crewDays), [crewDays]);
}
