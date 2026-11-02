import { create, StateCreator } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getStorage } from '../platform/storage';

export interface FestivalModeState {
  /**
   * Festival low-power mode (PERSISTED). Battery is a paired constraint with
   * no-signal at a festival: the phone has to last the whole day. When ON,
   * consumers MUST gate expensive, battery-hungry features and keep only the
   * essentials:
   *
   *   GATE OFF when lowPowerMode:           KEEP ON (essentials):
   *   - live-location auto-share            - set reminders / notifications
   *   - ambient / decorative animation      - crew meeting pins
   *   - aggressive polling (poll/status     - last-known breadcrumbs
   *     refetch intervals → back off)       - manual one-shot location share
   *
   * This is a USER-CONTROLLED preference, so it persists across launches.
   * Consumers read it as `useFestivalModeStore(s => s.lowPowerMode)` and
   * branch their effects on it.
   */
  lowPowerMode: boolean;
}

export interface FestivalModeActions {
  /** Toggle festival low-power mode (persisted). See `lowPowerMode` docs. */
  setLowPowerMode: (on: boolean) => void;
  toggleLowPowerMode: () => void;
}

export type FestivalModeStore = FestivalModeState & FestivalModeActions;

const festivalModeStore: StateCreator<FestivalModeStore> = (set) => ({
  lowPowerMode: false,

  setLowPowerMode: (on: boolean) => {
    set((state) => (state.lowPowerMode === on ? state : { lowPowerMode: on }));
  },

  toggleLowPowerMode: () => {
    set((state) => ({ lowPowerMode: !state.lowPowerMode }));
  },
});

export const useFestivalModeStore = create<FestivalModeStore>()(
  persist(festivalModeStore, {
    name: 'festie-festival-mode-v2',
    storage: createJSONStorage(() => getStorage()),
    partialize: (state) => ({
      lowPowerMode: state.lowPowerMode,
    }),
  }),
);

// Pure helper — pass in festival day dates (YYYY-MM-DD) and get back whether
// today is one of them. Kept outside the store so components can call it with
// store-external data without triggering re-renders.
//
// Festival dates are wall-clock dates (e.g. "2026-04-17" = the calendar day
// labeled as Day 1 in local time), so we MUST compare against local date not
// UTC — otherwise users in negative-UTC zones see the banner on the wrong
// calendar day whenever they're past 20:00 local.
export function isTodayFestivalDay(dayDates: string[]): boolean {
  if (!dayDates?.length) return false;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return dayDates.includes(today);
}
