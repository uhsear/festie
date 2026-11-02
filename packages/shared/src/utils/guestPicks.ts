import type { Priority } from '../types';

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
