import { api } from './api';

/**
 * Mark a picked set as seen (true), skipped (false) or unknown (null).
 * Queues offline; the deterministic clientId collapses repeated taps on one set.
 */
export function markCaught(setId: string, caught: boolean | null, userId: string): Promise<unknown> {
  return api.put(
    `/ratings/${setId}/caught`,
    { caught },
    { clientId: `caught-${userId}-${setId}`, offlineLabel: 'Mark a set as seen' },
  );
}
