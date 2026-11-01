import type { Priority } from '../types/domain';
import { fromPickPriority, type PlanSnapshot } from './planSnapshot';

/** What scanning a friend's plan would change, computed before anything is written. */
export interface PlanImportPreview {
  festivalMismatch: boolean;
  /** New or upgraded picks. */
  toAdd: Array<{ setId: string; priority: Priority }>;
  /** Equal or stronger pick already in my plan. */
  alreadyHave: number;
  /** Set id not in the loaded lineup. */
  notInLineup: number;
  /** snapshot.picks.length */
  total: number;
  /** My old value for each toAdd set (undefined = unpicked), for undo via restorePicks. */
  previous: Record<string, Priority | undefined>;
}

// Same "never downgrade" order as bulkSavePicks: must > want-to-see > maybe.
const RANK: Record<Priority, number> = { maybe: 1, 'want-to-see': 2, must: 3 };

/**
 * Preview a scanned plan against mine. Pure: writes nothing. Returns
 * `festivalMismatch: true` with nothing to add when the snapshot is for another
 * festival or there is no profile (`picks` undefined).
 */
export function previewPlanImport(
  snapshot: PlanSnapshot,
  mine: {
    currentFestivalId: string | null;
    picks: Record<string, Priority> | undefined;
    setIds: ReadonlySet<string>;
  },
): PlanImportPreview {
  const preview: PlanImportPreview = {
    festivalMismatch: false,
    toAdd: [],
    alreadyHave: 0,
    notInLineup: 0,
    total: snapshot.picks.length,
    previous: {},
  };
  const myPicks = mine.picks;
  if (!myPicks || snapshot.festivalId !== mine.currentFestivalId) {
    preview.festivalMismatch = true;
    return preview;
  }

  // Strongest wanted priority per set; the snapshot is untrusted and may repeat a set.
  const wanted = new Map<string, Priority>();
  for (const pick of snapshot.picks) {
    if (!mine.setIds.has(pick.setId)) {
      preview.notInLineup += 1;
      continue;
    }
    const priority = fromPickPriority(pick.priority);
    const best = wanted.get(pick.setId);
    if (!best || RANK[priority] > RANK[best]) wanted.set(pick.setId, priority);
  }

  for (const [setId, priority] of wanted) {
    const existing = myPicks[setId];
    if (existing && RANK[existing] >= RANK[priority]) {
      preview.alreadyHave += 1;
      continue;
    }
    preview.toAdd.push({ setId, priority });
    preview.previous[setId] = existing;
  }
  return preview;
}
