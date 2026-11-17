import type { InterestMark, Priority } from '../types';
import type { LineupCover } from './lineupCover';

/**
 * Fold a guest's picks into an account's picks for one festival. The account's
 * pick wins on a set both picked; guest picks only fill sets the account has not
 * picked. Set ids outside `validSetIds` are dropped, because the server rejects
 * the whole map when one id is unknown. `added` counts the guest picks kept.
 */
export function mergeGuestPickMaps(
  account: Record<string, Priority>,
  guest: Record<string, Priority>,
  validSetIds: ReadonlySet<string>,
): { merged: Record<string, Priority>; added: number } {
  const merged: Record<string, Priority> = { ...account };
  let added = 0;
  for (const [setId, priority] of Object.entries(guest)) {
    if (!validSetIds.has(setId) || setId in account) continue;
    merged[setId] = priority;
    added += 1;
  }
  return { merged, added };
}

/** At most this many covering sets are picked and recorded for one mark. The server applies the same cap. */
export const MAX_INTEREST_SETS = 10;

export interface InterestPlan {
  marks: Record<string, InterestMark>;
  /** Picks to add: set id to 'want-to-see'. Never a set that is already picked. */
  added: Record<string, Priority>;
  changed: boolean;
}

/**
 * What converting interest into picks does for one profile or one guest. A converted mark whose sets
 * are all gone reopens, then converts onto whatever covers the act now. An open mark on a covered,
 * non-cancelled act becomes `converted` with want-to-see picks on every covering set. A pick that
 * already exists is never touched, so a `must` is never downgraded. An act that would take the picks
 * past `maxPicks` stays open. lib/lineup.ts (planInterestConversion) is the server copy of this rule.
 */
export function planInterestConversion(input: {
  marks: Record<string, InterestMark>;
  picks: Record<string, Priority>;
  cover: Record<string, LineupCover>;
  existingSetIds: ReadonlySet<string>;
  maxPicks: number;
  now: string;
}): InterestPlan {
  const { marks, picks, cover, existingSetIds, maxPicks, now } = input;
  const next: Record<string, InterestMark> = { ...marks };
  const added: Record<string, Priority> = {};
  let pickCount = Object.keys(picks).length;
  let changed = false;
  for (const [entryId, mark] of Object.entries(marks)) {
    const entryCover = cover[entryId];
    if (!entryCover) continue;
    if (mark.state === 'converted') {
      if ((mark.sets ?? []).some((setId) => existingSetIds.has(setId))) continue;
      next[entryId] = { state: 'open' };
      changed = true;
    }
    if (entryCover.state !== 'scheduled') continue;
    const setIds = entryCover.setIds.slice(0, MAX_INTEREST_SETS);
    const fresh = setIds.filter((setId) => !(setId in picks) && !(setId in added));
    if (pickCount + fresh.length > maxPicks) continue;
    for (const setId of fresh) added[setId] = 'want-to-see';
    pickCount += fresh.length;
    next[entryId] = { state: 'converted', sets: setIds, at: now };
    changed = true;
  }
  return { marks: next, added, changed };
}

/**
 * The entry ids a guest's marks send at sign-in: open marks whose act is still in the lineup and that
 * the account has not marked. A guest `converted` mark is not sent: its picks are guest picks, which
 * mergeGuestPickMaps moves onto the account.
 */
export function guestInterestIdsToMerge(
  guest: Record<string, InterestMark>,
  account: Record<string, InterestMark> | undefined,
  lineupIds: ReadonlySet<string>,
): string[] {
  return Object.entries(guest)
    .filter(([entryId, mark]) => mark.state === 'open' && lineupIds.has(entryId) && !(account && entryId in account))
    .map(([entryId]) => entryId);
}

/** Acts whose mark went from open to converted between two reads: the count for the "now have sets" toast. */
export function newlyConvertedCount(
  before: Record<string, InterestMark> | undefined,
  after: Record<string, InterestMark> | undefined,
): number {
  if (!before || !after) return 0;
  return Object.entries(after).filter(([entryId, mark]) => mark.state === 'converted' && before[entryId]?.state === 'open').length;
}
