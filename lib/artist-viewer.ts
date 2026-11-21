// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import type { ArtistViewer } from './db/stores/artist-visibility';

type OrgSeat = { id: string; role: 'owner' | 'editor' | 'viewer'; status: 'pending' | 'active' | 'suspended' };

/** The one rule for who may change artists: an owner or editor of an organization that is not suspended. */
export const mayWriteArtists = (org: Pick<OrgSeat, 'role' | 'status'>) => org.role !== 'viewer' && org.status !== 'suspended';

/**
 * The artist viewer of a request: undefined for a platform admin (every artist is visible), otherwise the signed-in
 * member with every organization they belong to. `organizationId` is the one the request acts for: the festival's
 * (festivalAccess sets req.organizationId) or, failing that, `preferred` when the caller belongs to it, or their first.
 * Returns null for a caller that belongs to no organization.
 */
export async function artistViewerOf(
  stores: { organizations: { listForUser(userId: string): Promise<OrgSeat[]> } },
  req: { isAdmin?: boolean; user?: { userId?: string }; organizationId?: string | null },
  preferred?: string | null,
): Promise<ArtistViewer | undefined | null> {
  if (req.isAdmin === true) return undefined;
  const userId = req.user?.userId;
  if (!userId) return null;
  const orgs = await stores.organizations.listForUser(userId);
  if (orgs.length === 0) return null;
  const organizationIds = orgs.map((org) => org.id);
  const wanted = [req.organizationId, preferred].find((id) => !!id && organizationIds.includes(id));
  const acting = orgs.find((org) => org.id === wanted) ?? orgs[0]!;
  return { userId, organizationIds, organizationId: acting.id, mayWrite: mayWriteArtists(acting) };
}
