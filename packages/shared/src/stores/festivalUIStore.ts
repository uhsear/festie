import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { getStorage } from '../platform/storage';
import type { FestivalPhase } from '../utils/festivalTime';
import {
  sanitizeSchedulePrefs,
  visibleDayIndexes,
  type ScheduleFilterPrefs,
  type ScheduleGroupBy,
  type ScheduleView,
} from '../utils/scheduleFilters';

export interface FestivalUIScope {
  stageIds: string[];
  dayCount: number;
}

export interface FestivalUIState {
  selectedDay: number;
  activeStages: string[];
  searchQuery: string;
  /** When true, the schedule shows only sets the user has picked. */
  onlyMine: boolean;
  /** null = use defaultScheduleView. */
  scheduleView: ScheduleView | null;
  hiddenDays: number[];
  dismissedPhase: FestivalPhase | null;
  /** Cards "Group by"; null = Time. */
  scheduleGroupBy: ScheduleGroupBy | null;
  /** Festival the live fields belong to. Not persisted. */
  prefsFestivalId: string | null;
  /** Stage ids and day count the live fields were sanitized against. Not persisted. */
  prefsScope: FestivalUIScope;
  /** Remembered filter prefs per festival. The only persisted field. */
  byFestival: Record<string, ScheduleFilterPrefs>;
}

export interface FestivalUIActions {
  setSelectedDay: (dayIndex: number) => void;
  setActiveStages: (stageIds: string[]) => void;
  setSearchQuery: (query: string) => void;
  setOnlyMine: (onlyMine: boolean) => void;
  setScheduleView: (view: ScheduleView | null) => void;
  setHiddenDays: (days: number[]) => void;
  dismissPhaseBand: (phase: FestivalPhase | null) => void;
  setScheduleGroupBy: (groupBy: ScheduleGroupBy | null) => void;
  restoreForFestival: (festivalId: string, scope: FestivalUIScope & { todayIdx: number }) => void;
}

export type FestivalUIStore = FestivalUIState & FestivalUIActions;

// Filters must keep working when storage is unavailable (private window, quota).
// They are then just not remembered. Warn once, never throw.
let warned = false;
function warnOnce(err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn('Schedule filters are not saved on this device.', err);
}

const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      const r = getStorage().getItem(name);
      if (r && typeof (r as Promise<string | null>).then === 'function') {
        return (r as Promise<string | null>).catch((err) => {
          warnOnce(err);
          return null;
        });
      }
      return r as string | null;
    } catch (err) {
      warnOnce(err);
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      const r = getStorage().setItem(name, value);
      if (r && typeof (r as Promise<void>).then === 'function') return (r as Promise<void>).catch(warnOnce);
    } catch (err) {
      warnOnce(err);
    }
  },
  removeItem: (name) => {
    try {
      const r = getStorage().removeItem(name);
      if (r && typeof (r as Promise<void>).then === 'function') return (r as Promise<void>).catch(warnOnce);
    } catch (err) {
      warnOnce(err);
    }
  },
};

type PrefFields = Pick<
  FestivalUIState,
  'scheduleView' | 'activeStages' | 'onlyMine' | 'searchQuery' | 'hiddenDays' | 'dismissedPhase' | 'scheduleGroupBy'
>;

function toPrefs(s: PrefFields): ScheduleFilterPrefs {
  return {
    view: s.scheduleView,
    activeStages: s.activeStages,
    onlyMine: s.onlyMine,
    searchQuery: s.searchQuery,
    hiddenDays: s.hiddenDays,
    dismissedPhase: s.dismissedPhase,
    groupBy: s.scheduleGroupBy,
  };
}

function fromPrefs(p: ScheduleFilterPrefs): PrefFields {
  return {
    scheduleView: p.view,
    activeStages: p.activeStages,
    onlyMine: p.onlyMine,
    searchQuery: p.searchQuery,
    hiddenDays: p.hiddenDays,
    dismissedPhase: p.dismissedPhase,
    scheduleGroupBy: p.groupBy,
  };
}

const firstVisibleDay = (dayCount: number, hiddenDays: number[]): number =>
  visibleDayIndexes(dayCount, hiddenDays, -1)[0] ?? 0;

export const useFestivalUIStore = create<FestivalUIStore>()(
  persist(
    (set, get) => {
      /** Applies a live-field change and mirrors the snapshot into byFestival. */
      const update = (patch: Partial<PrefFields>, extra: Partial<FestivalUIState> = {}) => {
        set((s) => {
          const next = { ...s, ...patch, ...extra };
          if (!s.prefsFestivalId) return { ...patch, ...extra };
          return {
            ...patch,
            ...extra,
            byFestival: { ...s.byFestival, [s.prefsFestivalId]: toPrefs(next) },
          };
        });
      };

      return {
        selectedDay: 0,
        activeStages: [],
        searchQuery: '',
        onlyMine: false,
        scheduleView: null,
        hiddenDays: [],
        dismissedPhase: null,
        scheduleGroupBy: null,
        prefsFestivalId: null,
        prefsScope: { stageIds: [], dayCount: 0 },
        byFestival: {},

        setSelectedDay: (dayIndex: number) => {
          set({ selectedDay: dayIndex });
        },

        setOnlyMine: (onlyMine: boolean) => update({ onlyMine }),

        setActiveStages: (stageIds: string[]) => update({ activeStages: stageIds }),

        setSearchQuery: (query: string) => update({ searchQuery: query }),

        setScheduleView: (view) => update({ scheduleView: view }),

        setHiddenDays: (days) => {
          const { selectedDay, prefsScope } = get();
          const moved = days.includes(selectedDay) ? firstVisibleDay(prefsScope.dayCount, days) : selectedDay;
          update({ hiddenDays: days }, { selectedDay: moved });
        },

        dismissPhaseBand: (phase) => update({ dismissedPhase: phase }),

        setScheduleGroupBy: (groupBy) => update({ scheduleGroupBy: groupBy }),

        restoreForFestival: (festivalId, { todayIdx, ...scope }) => {
          const s = get();
          const inRange = (i: number) => i >= 0 && i < scope.dayCount;
          if (s.prefsFestivalId === festivalId) {
            // A refresh of the same festival: keep the live fields, drop what no longer exists.
            const prefs = sanitizeSchedulePrefs(toPrefs(s), scope);
            const selectedDay = inRange(s.selectedDay)
              ? s.selectedDay
              : inRange(todayIdx)
                ? todayIdx
                : firstVisibleDay(scope.dayCount, prefs.hiddenDays);
            set({ ...fromPrefs(prefs), prefsScope: scope, selectedDay });
            return;
          }
          const prefs = sanitizeSchedulePrefs(s.byFestival[festivalId], scope);
          const selectedDay =
            inRange(todayIdx) && !prefs.hiddenDays.includes(todayIdx)
              ? todayIdx
              : firstVisibleDay(scope.dayCount, prefs.hiddenDays);
          set({ ...fromPrefs(prefs), prefsFestivalId: festivalId, prefsScope: scope, selectedDay });
        },
      };
    },
    {
      name: 'festie-schedule-prefs',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ byFestival: s.byFestival }),
      merge: (persisted, current) => {
        const stored = (persisted as { byFestival?: unknown } | null | undefined)?.byFestival;
        const storedByFestival =
          stored && typeof stored === 'object' && !Array.isArray(stored)
            ? (stored as Record<string, ScheduleFilterPrefs>)
            : {};
        const merged: FestivalUIStore = {
          ...current,
          byFestival: { ...storedByFestival, ...current.byFestival },
        };
        // Async storage can hydrate after restoreForFestival ran with no saved entry.
        const id = current.prefsFestivalId;
        if (id && !current.byFestival[id] && storedByFestival[id]) {
          const prefs = sanitizeSchedulePrefs(storedByFestival[id], current.prefsScope);
          Object.assign(merged, fromPrefs(prefs));
          if (prefs.hiddenDays.includes(current.selectedDay)) {
            merged.selectedDay = firstVisibleDay(current.prefsScope.dayCount, prefs.hiddenDays);
          }
        }
        return merged;
      },
    },
  ),
);
