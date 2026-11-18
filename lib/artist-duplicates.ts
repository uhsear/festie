// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * "Possible duplicates" on the Artists screen: live artists that share a name key (they differ by
 * note) and artists whose keys differ by one character. Pure, so a test can pin it.
 */

/** Keys shorter than this are never compared by edit distance: "abc" and "abd" are different acts. */
export const MIN_FUZZY_KEY_LENGTH = 5;

/** The key itself and the key with each single character removed. Two keys at edit distance 1 share one. */
function neighbourhood(key: string): string[] {
  const out = new Set<string>([key]);
  for (let i = 0; i < key.length; i++) out.add(key.slice(0, i) + key.slice(i + 1));
  return [...out];
}

export function possibleDuplicateIds(rows: ReadonlyArray<{ id: string; name_key: string }>): Set<string> {
  const idsByKey = new Map<string, string[]>();
  for (const row of rows) idsByKey.set(row.name_key, [...(idsByKey.get(row.name_key) ?? []), row.id]);
  const out = new Set<string>();
  for (const ids of idsByKey.values()) if (ids.length > 1) ids.forEach((id) => out.add(id));
  const keysByVariant = new Map<string, Set<string>>();
  for (const key of idsByKey.keys()) {
    if (key.length < MIN_FUZZY_KEY_LENGTH) continue;
    for (const variant of neighbourhood(key)) keysByVariant.set(variant, (keysByVariant.get(variant) ?? new Set()).add(key));
  }
  for (const keys of keysByVariant.values()) {
    if (keys.size < 2) continue;
    for (const key of keys) idsByKey.get(key)!.forEach((id) => out.add(id));
  }
  return out;
}
