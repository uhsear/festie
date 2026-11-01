import type { FestivalPhase } from './festivalTime';

export type AppSectionKey = 'lineup' | 'myPlan' | 'crew' | 'map' | 'more';
export const APP_SECTIONS: readonly { key: AppSectionKey; label: string }[] = [
  { key: 'lineup', label: 'Lineup' },
  { key: 'myPlan', label: 'My Plan' },
  { key: 'crew', label: 'Crew' },
  { key: 'map', label: 'Map' },
  { key: 'more', label: 'More' },
];

export type CrewTabKey = 'find' | 'members' | 'plan' | 'money';
export const CREW_TABS: readonly { key: CrewTabKey; label: string }[] = [
  { key: 'find', label: 'Find' },
  { key: 'members', label: 'Members' },
  { key: 'plan', label: 'Plan' },
  { key: 'money', label: 'Money' },
];
export const DEFAULT_CREW_TAB: CrewTabKey = 'find';

// Old web and mobile keys still arrive from push links and bookmarks.
const CREW_TAB_ALIASES: Record<string, CrewTabKey> = {
  logistics: 'find',
  meeting: 'find',
  meet: 'find',
  activity: 'find',
  polls: 'plan',
  packing: 'plan',
  rides: 'plan',
  expenses: 'money',
};

export function parseCrewTab(raw: unknown): CrewTabKey | null {
  if (typeof raw !== 'string') return null;
  const exact = CREW_TABS.find((t) => t.key === raw);
  if (exact) return exact.key;
  return Object.hasOwn(CREW_TAB_ALIASES, raw) ? (CREW_TAB_ALIASES[raw] ?? null) : null;
}

export type PhaseActionKey = 'myPlan' | 'crew' | 'map' | 'nownext' | 'wrap';
export const PHASE_ACTION_LABELS: Record<PhaseActionKey, string> = {
  myPlan: 'My Plan',
  crew: 'Crew',
  map: 'Map',
  nownext: 'Now & Next',
  wrap: 'Festival wrap',
};
export const PHASE_ACTION_ORDER: Record<FestivalPhase, readonly PhaseActionKey[]> = {
  pre: ['myPlan', 'crew', 'nownext', 'map', 'wrap'],
  live: ['map', 'crew', 'nownext', 'myPlan', 'wrap'],
  post: ['wrap', 'crew', 'myPlan', 'nownext', 'map'],
};
