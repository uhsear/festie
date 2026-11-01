import type { SectionReadiness } from '@festie/shared/stores';

/**
 * C9: the offline checklist collapses to one summary row when nothing is left
 * to do (every step ready, or the festival is past) and at least one step has
 * a sync time to show. `notStarted` is true while every step is still idle,
 * so the card can hide the all-grey checklist before the first download.
 */
export function offlineSummary(
  sections: SectionReadiness[],
  festivalPast: boolean,
): { collapsed: boolean; lastSyncedAt: number | null; notStarted: boolean } {
  const lastSyncedAt = sections.reduce<number | null>(
    (max, s) => (s.status === 'ready' && s.syncedAt != null ? Math.max(max ?? 0, s.syncedAt) : max),
    null,
  );
  const collapsed = lastSyncedAt != null && (festivalPast || sections.every((s) => s.status === 'ready'));
  const notStarted = sections.every((s) => s.status === 'idle');
  return { collapsed, lastSyncedAt, notStarted };
}
