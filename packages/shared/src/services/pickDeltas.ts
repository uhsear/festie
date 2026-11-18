import type { Priority } from '../types';

/** One delta per set: a priority sets the pick, null removes it. */
export type PickDeltas = Record<string, Priority | null>;

/**
 * Body of a pick write. The server applies `pickDeltas` to the picks it holds, so a replayed
 * offline write changes only the sets it names and cannot erase picks that arrived after the
 * device last synced. `legacyPicks` is the full map the old whole-map write would have sent.
 * Servers that know deltas ignore it (the schema strips unknown keys); a server that does not
 * know deltas rejects the write, and api.ts then resends it as `{ picks: legacyPicks }`.
 */
export function pickDeltaBody(deltas: PickDeltas, legacyPicks: Record<string, Priority>) {
  // The server rejects an empty delta as a validation error, which legacyPickBody must not mistake for an old server.
  if (Object.keys(deltas).length === 0) throw new Error('A pick delta write needs at least one set');
  return { pickDeltas: deltas, legacyPicks };
}

const OLD_SERVER_MESSAGE = 'At least one field required';

/**
 * The whole-map body to resend when a server that predates pick deltas rejected `body`, or null
 * when `body` is not a delta write. An old server strips `pickDeltas` and fails with a 400
 * VALIDATION_ERROR whose message is exactly "At least one field required". A server that knows
 * deltas also answers VALIDATION_ERROR for a bad delta (its message names the `pickDeltas` path),
 * and that must not turn into a whole-map write.
 */
export function legacyPickBody(
  body: unknown,
  err: { status?: number; code?: string; message?: string },
): { picks: Record<string, Priority> } | null {
  if (err.status !== 400 || err.code !== 'VALIDATION_ERROR' || err.message !== OLD_SERVER_MESSAGE) return null;
  const b = body as { pickDeltas?: unknown; legacyPicks?: Record<string, Priority> } | null | undefined;
  if (!b || typeof b !== 'object' || b.pickDeltas === undefined || !b.legacyPicks) return null;
  return { picks: b.legacyPicks };
}

/** Deltas for the sets whose pick in `after` differs from `before`. Never removes a pick. */
export function changedPickDeltas(before: Record<string, Priority>, after: Record<string, Priority>): PickDeltas {
  return Object.fromEntries(Object.entries(after).filter(([setId, priority]) => before[setId] !== priority));
}

let _writeSeq = 0;

/**
 * clientId for a multi-set pick write. Each write queues as its own entry: two bulk writes that
 * shared a clientId would coalesce, and the later delta would replace the earlier one's sets.
 */
export function bulkPickClientId(profileId: string): string {
  _writeSeq += 1;
  return `bulk-${profileId}-${Date.now().toString(36)}-${_writeSeq}`;
}
