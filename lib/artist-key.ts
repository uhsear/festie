// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The artist identity key (artists.name_key) and the name a set shows.
 * Only the server computes keys. The key uses the one fold core in lib/lineup.ts and, unlike
 * lineupNameKey, keeps a leading "the": "The Chainsmokers" and "Chainsmokers" are two artists.
 * The key depends on the Node ICU and Unicode version. A change to the fold, or a Node upgrade that
 * changes the output, needs a deliberate key rebuild. tests/artist-key.test.ts pins the output.
 * The key never splits B2B strings: split on the festival separator and " b2b " first.
 */

import { foldNameCore } from './lineup';

export function artistNameKey(name: string): string {
  return foldNameCore(name);
}

/**
 * The name a set shows, a backend copy of shared artistDisplayName (packages/shared/src/utils/format.ts).
 * It honours displayName and a flat artist that differs from the joined artist names. The backend
 * artistDisplayName in lib/schemas.ts only joins names, so a rename report must not use it.
 */
export function shownSetName(
  set: { displayName?: string | null; artist?: string | null; artists?: Array<{ name?: string }> | null },
  separator?: string,
): string {
  if (set.displayName) return set.displayName;
  const sep = separator || 'b2b';
  const joined = set.artists?.length ? set.artists.map((a) => a.name).join(` ${sep} `) : '';

  if (set.artist && (!joined || set.artist !== joined)) return set.artist;
  if (joined) return joined;
  return set.artist || 'Unknown';
}
