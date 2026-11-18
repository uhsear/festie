// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// Its own module so the artist store can take the festival lock without importing lineup-imports,
// which imports artist-refs, which imports the artist store.

/**
 * Like lockFestival, but it also locks a soft-deleted festival. Artist sync, merge and the
 * backfill use it so a restored festival shows current copies with no rebuild.
 */
export async function lockFestivalAny(client: any, festivalId: string) {
  const { rows } = await client.query(
    'SELECT id, published_at, deleted_at FROM festivals WHERE id = $1 FOR UPDATE',
    [festivalId],
  );
  return (rows[0] as { id: string; published_at: Date | null; deleted_at: Date | null } | undefined) ?? null;
}
