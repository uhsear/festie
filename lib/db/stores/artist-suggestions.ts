// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The rules for an organizer's artist edit, and the suggestion rows (artist plan sections 8.3 and 6.9). The
 * store (artists.ts) calls these inside the edit's transaction, after the festivals and the artist row are locked,
 * so "who else uses this artist" is read once and stays true until the commit.
 */

import type { Pool } from 'pg';
import { isoOrNull } from '../connection';
import { createOpaqueId } from '../../helpers';
import { detectPlatform } from '../../artist-links';
import { AUDIT_ACTIONS } from '../../audit-actions';
import {
  ArtistError,
  artistUses,
  insertArtistAudit,
  type ArtistChanges,
  type ArtistRecord,
} from './artists-helpers';
import { type ArtistViewer, viewerMask, useIsForeign } from './artist-visibility';

/**
 * What an organizer's change does:
 *   direct:  saved at once (every festival that lists the artist belongs to the organizer's organizations).
 *   fill:    saved at once and flagged for review: it fills an empty non-Spotify link of an artist that other
 *            tenants or the platform also use (the one carve-out, master plan C6).
 *   suggest: becomes an artist_suggestions row that an admin decides. Every Spotify change is one, and so is
 *            any other change to an artist that a festival outside the organizer's organizations lists.
 * An artist the viewer cannot see is a 404, the same as one that does not exist.
 */
export type Verdict = 'direct' | 'fill' | 'suggest';

const touchesSpotify = (changes: ArtistChanges) =>
  changes.spotifyLink !== undefined ||
  !!changes.removeLinks?.includes('spotify') ||
  (changes.addLink !== undefined && detectPlatform(changes.addLink) === 'spotify');

export async function organizerVerdict(
  client: { query: Pool['query'] },
  before: ArtistRecord,
  viewer: ArtistViewer,
  changes: ArtistChanges,
): Promise<Verdict> {
  if (!(await viewerMask(client, viewer, [before.id])).has(before.id)) {
    throw new ArtistError(404, 'NOT_FOUND', 'Artist not found.');
  }
  if (touchesSpotify(changes)) return 'suggest';
  // Every festival counts here, drafts and archived ones too: the answer is about who is affected, not who may be told.
  const uses = (await artistUses(client, [before.id])).get(before.id) ?? [];
  if (!uses.some((use) => useIsForeign(use, viewer))) return 'direct';
  const platform = changes.addLink !== undefined ? (detectPlatform(changes.addLink) ?? 'website') : null;
  const fillsEmptyLink =
    platform !== null &&
    !before.links?.[platform] &&
    changes.name === undefined &&
    changes.label === undefined &&
    !changes.removeLinks?.length;
  return fillsEmptyLink ? 'fill' : 'suggest';
}

/** The changes a suggestion keeps: only the keys the organizer sent. */
const keptChanges = (changes: ArtistChanges): ArtistChanges =>
  Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));

/** Stores a pending suggestion, or returns the id of the same one the user already sent. Writes its audit row. */
export async function insertSuggestion(
  client: any,
  before: ArtistRecord,
  viewer: ArtistViewer,
  changes: ArtistChanges,
  festivalId: string | null,
  ip: string | null | undefined,
): Promise<string> {
  const kept = keptChanges(changes);
  const { rows: same } = await client.query(
    `SELECT id FROM artist_suggestions WHERE artist_id = $1 AND created_by = $2 AND status = 'pending' AND changes = $3::jsonb LIMIT 1`,
    [before.id, viewer.userId, JSON.stringify(kept)],
  );
  if (same[0]) return same[0].id as string;
  const id = createOpaqueId('sug');
  await client.query(
    `
  INSERT INTO
    artist_suggestions (
      id,
      artist_id,
      festival_id,
      organization_id,
      changes,
      created_by
    )
  VALUES
    ($1, $2, $3, $4, $5::jsonb, $6)
`,
    [id, before.id, festivalId, viewer.organizationId, JSON.stringify(kept), viewer.userId],
  );
  await insertArtistAudit(
    client,
    before.id,
    { userId: viewer.userId, ip, actorType: 'organizer', organizationId: viewer.organizationId },
    { suggestionId: id, name: before.name, changes: kept, festivalId },
    AUDIT_ACTIONS.ARTIST_SUGGESTED,
  );
  return id;
}

/** One suggestion as an admin reads it. The author is a username, never an email address. */
export function adminSuggestion(row: any, festivalCount: number) {
  return {
    id: row.id as string,
    status: row.status as 'pending' | 'accepted' | 'rejected',
    changes: row.changes as ArtistChanges,
    note: (row.note as string | null) ?? null,
    createdAt: isoOrNull(row.created_at) as string,
    decidedAt: isoOrNull(row.decided_at),
    artist: {
      id: row.artist_id as string,
      name: row.artist_name as string,
      label: row.artist_label as string,
      links: (row.artist_links ?? {}) as Record<string, string>,
      mergedInto: (row.merged_into as string | null) ?? null,
    },
    organization: row.organization_id ? { id: row.organization_id as string, name: row.organization_name as string } : null,
    festival: row.festival_id ? { id: row.festival_id as string, name: row.festival_name as string } : null,
    createdBy: (row.created_by_name as string | null) ?? null,
    festivalCount,
  };
}

/** One suggestion as the organization that sent it reads it. */
export function ownSuggestion(row: any) {
  return {
    id: row.id as string,
    artistId: row.artist_id as string,
    artistName: row.artist_name as string,
    status: row.status as 'pending' | 'accepted' | 'rejected',
    changes: row.changes as ArtistChanges,
    note: (row.note as string | null) ?? null,
    createdAt: isoOrNull(row.created_at) as string,
    decidedAt: isoOrNull(row.decided_at),
  };
}
