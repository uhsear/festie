import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { getStorage } from '../platform/storage';
import { buildFestivalPickConflicts, conflictSetIds, type ConflictGroup } from '../utils/pickConflicts';
import { resolveFestivalTimeZone } from '../utils/festivalTime';
import {
  buildPicksRows,
  comparePicksByTime,
  effectivePicksFilter,
  picksStats,
  type PicksFilter,
  type PicksGroupMode,
  type PicksOrder,
  type PicksRow,
  type PicksStats,
} from '../utils/picksPlan';

/** Device-local key for the per-festival set order on My Picks. */
export const picksOrderStorageKey = (festivalId: string) => `festie-picks-order-v1:${festivalId}`;

/**
 * Shared My Picks plan state for web and mobile: filter chips, grouping mode,
 * search, folded groups, set order (remembered per festival on this device),
 * and the derived stats, clashes and flattened rows.
 * Clashes span every festival day (no day selector on Picks) and carry no crew
 * context.
 */
export function usePicksPlan(): {
  groupMode: PicksGroupMode;
  setGroupMode: (m: PicksGroupMode) => void;
  order: PicksOrder;
  setOrder: (o: PicksOrder) => void;
  filter: PicksFilter;
  effectiveFilter: PicksFilter;
  toggleFilter: (f: PicksFilter) => void;
  search: string;
  setSearch: (q: string) => void;
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (groupId: string) => void;
  clearFilters: () => void;
  filtersActive: boolean;
  stats: PicksStats;
  conflictGroups: ConflictGroup[];
  clashIds: ReadonlySet<string>;
  rows: PicksRow[];
} {
  const sets = useFestivalStore((s) => s.sets);
  const stages = useFestivalStore((s) => s.stages);
  const days = useFestivalStore((s) => s.days);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const picks = useFestivalStore((s) => s.currentProfile?.picks);

  const [groupMode, setGroupMode] = useState<PicksGroupMode>('day');
  const [filter, setFilter] = useState<PicksFilter>('all');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [order, setOrderState] = useState<PicksOrder>('openers');
  const festivalId = currentFestival?.id;

  useEffect(() => {
    setOrderState('openers');
    if (!festivalId) return;
    let live = true;
    // Deferred so a storage that throws synchronously (blocked localStorage) still lands in catch.
    Promise.resolve()
      .then(() => getStorage().getItem(picksOrderStorageKey(festivalId)))
      .then((saved) => {
        if (live && saved === 'headliners') setOrderState('headliners');
      })
      .catch((err) => console.warn('Could not read the saved picks order', err));
    return () => {
      live = false;
    };
  }, [festivalId]);

  const setOrder = useCallback(
    (o: PicksOrder) => {
      setOrderState(o);
      if (!festivalId) return;
      Promise.resolve()
        .then(() => getStorage().setItem(picksOrderStorageKey(festivalId), o))
        .catch((err) => console.warn('Could not save the picks order', err));
    },
    [festivalId],
  );

  const timeZone = resolveFestivalTimeZone(currentFestival);
  const b2bSeparator = currentFestival?.b2bSeparator;

  const conflictGroups = useMemo(
    () => (picks ? buildFestivalPickConflicts({ sets, myPicks: picks, days, timeZone }) : []),
    [sets, picks, days, timeZone],
  );
  const clashIds = useMemo(() => conflictSetIds(conflictGroups), [conflictGroups]);
  const stats = useMemo(() => picksStats(sets, picks, clashIds), [sets, picks, clashIds]);
  const effectiveFilter = effectivePicksFilter(filter, stats);
  const compare = useMemo(
    () => comparePicksByTime(days, timeZone, b2bSeparator, order),
    [days, timeZone, b2bSeparator, order],
  );

  const rows = useMemo(
    () =>
      buildPicksRows({ sets, picks, days, stages, groupMode, filter: effectiveFilter, search, collapsed, clashIds, compare }),
    [sets, picks, days, stages, groupMode, effectiveFilter, search, collapsed, clashIds, compare],
  );

  const toggleFilter = useCallback((f: PicksFilter) => setFilter((cur) => (cur === f ? 'all' : f)), []);
  const toggleCollapsed = useCallback(
    (groupId: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (!next.delete(groupId)) next.add(groupId);
        return next;
      }),
    [],
  );
  const clearFilters = useCallback(() => {
    setFilter('all');
    setSearch('');
  }, []);

  const filtersActive = effectiveFilter !== 'all' || search.trim() !== '';

  return {
    groupMode,
    setGroupMode,
    order,
    setOrder,
    filter,
    effectiveFilter,
    toggleFilter,
    search,
    setSearch,
    collapsed,
    toggleCollapsed,
    clearFilters,
    filtersActive,
    stats,
    conflictGroups,
    clashIds,
    rows,
  };
}
