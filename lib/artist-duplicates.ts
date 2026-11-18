// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * "Possible duplicates" on the Artists screen: live artists that share a name key (they differ by
 * note) and artists whose keys differ by one character (one substitution, insertion or deletion).
 * Pure, so a test can pin it.
 */

/** Keys shorter than this are never compared by edit distance: "abc" and "abd" are different acts. */
export const MIN_FUZZY_KEY_LENGTH = 5;

/**
 * For each artist that has a possible duplicate, the ids of those duplicates. An artist with none is absent.
 */
export function duplicatePartners(rows: ReadonlyArray<{ id: string; name_key: string }>): Map<string, string[]> {
  const idsByKey = new Map<string, string[]>();
  for (const row of rows) idsByKey.set(row.name_key, [...(idsByKey.get(row.name_key) ?? []), row.id]);
  const partnerKeys = new Map<string, Set<string>>();
  const pair = (a: string, b: string) => {
    partnerKeys.set(a, (partnerKeys.get(a) ?? new Set()).add(b));
    partnerKeys.set(b, (partnerKeys.get(b) ?? new Set()).add(a));
  };
  // Same length: deleting the same position from both leaves one string, so they differ by one substitution.
  // A transposition deletes different positions, so it is not paired. Insertion: the longer key minus one character is the shorter key.
  const sameSlot = new Map<string, string[]>();
  for (const key of idsByKey.keys()) {
    if (key.length < MIN_FUZZY_KEY_LENGTH) continue;
    for (let i = 0; i < key.length; i++) {
      const rest = key.slice(0, i) + key.slice(i + 1);
      const slot = `${i}:${rest}`;
      for (const other of sameSlot.get(slot) ?? []) pair(key, other);
      sameSlot.set(slot, [...(sameSlot.get(slot) ?? []), key]);
      if (idsByKey.has(rest) && rest.length >= MIN_FUZZY_KEY_LENGTH) pair(key, rest);
    }
  }
  const out = new Map<string, string[]>();
  for (const [key, ids] of idsByKey) {
    const partners = [...(partnerKeys.get(key) ?? [])].flatMap((other) => idsByKey.get(other)!);
    for (const id of ids) {
      const sameKey = ids.filter((other) => other !== id);
      const all = [...sameKey, ...partners];
      if (all.length > 0) out.set(id, all);
    }
  }
  return out;
}
