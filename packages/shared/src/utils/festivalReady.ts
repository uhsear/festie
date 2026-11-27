import { FESTIVAL_READY_COPY } from '../constants/config';
import type { FestivalReadiness, SectionReadiness } from '../stores/offlineReadinessStore';
import type { InterestMark } from '../types';

export type FestivalReadyKey = 'picks' | 'crew' | 'reminders' | 'offline';
export interface FestivalReadyItem {
  key: FestivalReadyKey;
  label: string;
  hint: string;
  done: boolean;
  a11y: string;
}

/**
 * True when readiness.schedule and readiness.picks both have status 'ready'. False for undefined.
 * A festival with an offline map (mobile) also needs that step saved; pass null when it has none.
 */
export function isFestivalDownloaded(
  readiness: FestivalReadiness | undefined,
  offlineMap: SectionReadiness | null = null,
): boolean {
  if (offlineMap && offlineMap.status !== 'ready') return false;
  return readiness?.schedule.status === 'ready' && readiness.picks.status === 'ready';
}

/** Items in the order picks, crew, reminders, offline. Labels and hints from FESTIVAL_READY_COPY. */
export function getFestivalReadyChecklist(input: {
  pickCount: number;
  /** Open marks on acts that are in the festival's lineup. They count like picks. */
  interestCount?: number;
  /** The festival has an announced lineup, so the picks item says "Mark acts or pick sets". */
  hasLineup?: boolean;
  hasCrew: boolean;
  remindersOn: boolean;
  offlineReady: boolean;
  /** No set has a time yet: picking and downloading are impossible, so those steps are left out. */
  timesPending?: boolean;
}): { items: FestivalReadyItem[]; doneCount: number; total: number } {
  const doneByKey: Record<FestivalReadyKey, boolean> = {
    picks: input.pickCount + (input.interestCount ?? 0) > 0,
    crew: input.hasCrew,
    reminders: input.remindersOn,
    offline: input.offlineReady,
  };
  const keys: FestivalReadyKey[] = input.timesPending ? ['crew', 'reminders'] : ['picks', 'crew', 'reminders', 'offline'];
  const items = keys.map((key) => {
    const { label, hint } = FESTIVAL_READY_COPY.items[key];
    if (key === 'picks' && input.hasLineup) {
      const done = doneByKey[key];
      return { key, label: FESTIVAL_READY_COPY.markOrPickLabel, hint: FESTIVAL_READY_COPY.markOrPickHint, done, a11y: `${FESTIVAL_READY_COPY.markOrPickLabel}, ${done ? 'done' : 'not done yet'}` };
    }
    const done = doneByKey[key];
    return { key, label, hint, done, a11y: `${label}, ${done ? 'done' : 'not done yet'}` };
  });
  return { items, doneCount: items.filter((i) => i.done).length, total: items.length };
}

/** Open marks whose act is still in the lineup. A mark on a removed act does not count. */
export function countOpenInterests(
  interests: Record<string, InterestMark> | undefined,
  lineup: readonly { id: string }[] | undefined,
): number {
  if (!interests || !lineup) return 0;
  const ids = new Set(lineup.map((entry) => entry.id));
  return Object.entries(interests).filter(([entryId, mark]) => mark.state === 'open' && ids.has(entryId)).length;
}

/** '2 of 4 done' */
export function formatReadyProgress(done: number, total: number): string {
  return `${done} of ${total} done`;
}
