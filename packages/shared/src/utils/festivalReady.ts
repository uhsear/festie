import { FESTIVAL_READY_COPY } from '../constants/config';
import type { FestivalReadiness } from '../stores/offlineReadinessStore';

export type FestivalReadyKey = 'picks' | 'crew' | 'reminders' | 'offline';
export interface FestivalReadyItem {
  key: FestivalReadyKey;
  label: string;
  hint: string;
  done: boolean;
  a11y: string;
}

/** True when readiness.schedule and readiness.picks both have status 'ready'. False for undefined. */
export function isFestivalDownloaded(readiness: FestivalReadiness | undefined): boolean {
  return readiness?.schedule.status === 'ready' && readiness.picks.status === 'ready';
}

/** Items in the order picks, crew, reminders, offline. Labels and hints from FESTIVAL_READY_COPY. */
export function getFestivalReadyChecklist(input: {
  pickCount: number;
  hasCrew: boolean;
  remindersOn: boolean;
  offlineReady: boolean;
}): { items: FestivalReadyItem[]; doneCount: number; total: number } {
  const doneByKey: Record<FestivalReadyKey, boolean> = {
    picks: input.pickCount > 0,
    crew: input.hasCrew,
    reminders: input.remindersOn,
    offline: input.offlineReady,
  };
  const keys: FestivalReadyKey[] = ['picks', 'crew', 'reminders', 'offline'];
  const items = keys.map((key) => {
    const { label, hint } = FESTIVAL_READY_COPY.items[key];
    const done = doneByKey[key];
    return { key, label, hint, done, a11y: `${label}, ${done ? 'done' : 'not done yet'}` };
  });
  return { items, doneCount: items.filter((i) => i.done).length, total: items.length };
}

/** '2 of 4 done' */
export function formatReadyProgress(done: number, total: number): string {
  return `${done} of ${total} done`;
}
