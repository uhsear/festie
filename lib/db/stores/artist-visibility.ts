// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Which artists an organizer may see (artist plan section 8.5). Every answer is computed in SQL from the
 * sets and lineups, never from the festival cache, so a draft or a soft-deleted festival counts and a
 * stale cache cannot widen it. An admin has no viewer: pass `undefined` and nothing is filtered.
 *
 * A viewer sees an artist when it is used on a published festival, used on a festival of one of the
 * viewer's organizations (archived ones too), or created by a member of one of them. It may link an
 * unverified artist by name or Spotify id only when it also owns it (created by its organizations, or used on
 * their festivals). Any other unverified artist it must pick by hand.
 */

import type { Pool } from 'pg';
import type { ArtistUse } from './artists-helpers';

export interface ArtistViewer {
  userId: string;
  /** Every organization the user belongs to. "The caller's festivals" are the festivals of these. */
  organizationIds: string[];
  /** The organization a write is made for (an audit row and a suggestion carry it). One of `organizationIds`. */
  organizationId: string;
  /** True when the user is an owner or editor of `organizationId` and it is not suspended. Only then may a write be direct. */
  mayWrite: boolean;
}

/** SQL conditions over one artists row, written against the alias `a`. Params: the user id and the organization id list. */
function conditions(a: string, user: string, orgs: string) {
  const sets = (cond: string) =>
    `EXISTS (SELECT 1 FROM festival_sets s JOIN festivals f ON f.id = s.festival_id
              WHERE s.artists @> jsonb_build_array(jsonb_build_object('id', ${a}.id)) AND ${cond})`;
  const lineups = (cond: string) =>
    `EXISTS (SELECT 1 FROM festivals f
              WHERE f.lineup @> jsonb_build_array(jsonb_build_object('artists', jsonb_build_array(jsonb_build_object('id', ${a}.id)))) AND ${cond})`;
  const used = (cond: string) => `(${sets(cond)} OR ${lineups(cond)})`;
  const created = `(${a}.created_by = ${user} OR ${a}.created_by IN (SELECT user_id FROM organization_members WHERE organization_id = ANY(${orgs}::text[])))`;
  const own = used(`f.organization_id = ANY(${orgs}::text[])`);
  const published = used('f.published_at IS NOT NULL AND f.deleted_at IS NULL');
  return { visible: `(${created} OR ${own} OR ${published})`, owned: `(${created} OR ${own})` };
}

/** The WHERE condition for "this artists row is visible to the viewer", with its two parameters appended to `params`. */
export function visibleCondition(a: string, viewer: ArtistViewer, params: unknown[]): string {
  params.push(viewer.userId, viewer.organizationIds);
  return conditions(a, `$${params.length - 1}`, `$${params.length}`).visible;
}

/**
 * The visible artists among `ids`, each with whether the viewer may link it without picking it by hand
 * (verified, or owned). An id that is missing, merged or hidden is absent from the map, so the caller
 * cannot tell the three apart.
 */
export async function viewerMask(
  db: { query: Pool['query'] },
  viewer: ArtistViewer,
  ids: string[],
): Promise<Map<string, { linkable: boolean }>> {
  const out = new Map<string, { linkable: boolean }>();
  if (ids.length === 0) return out;
  const { visible, owned } = conditions('a', '$2', '$3');
  const { rows } = await db.query(
    `SELECT a.id, (a.verified OR ${owned}) AS linkable FROM artists a WHERE a.id = ANY($1::text[]) AND ${visible}`,
    [ids, viewer.userId, viewer.organizationIds],
  );
  for (const row of rows as Array<{ id: string; linkable: boolean }>) out.set(row.id, { linkable: row.linkable });
  return out;
}

/** True when a use is on a festival the viewer may be told about: published, or one of its own. Never a stranger's draft. */
export function useIsVisible(use: ArtistUse, viewer: ArtistViewer): boolean {
  if (use.organizationId && viewer.organizationIds.includes(use.organizationId)) return true;
  return use.published && !use.deleted;
}

/**
 * True when a use is on a festival that is not the acting organization's, archived ones included. A write counts only the
 * organization it is made for: a viewer seat or a suspended organization elsewhere gives no right to edit.
 */
export function useIsForeign(use: ArtistUse, viewer: ArtistViewer): boolean {
  return !viewer.mayWrite || use.organizationId !== viewer.organizationId;
}
