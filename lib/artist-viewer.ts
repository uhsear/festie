// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import type { ArtistViewer } from './db/stores/artist-visibility';

/**
 * The artist viewer of a request: undefined for a platform admin (every artist is visible), otherwise the signed-in
 * member with every organization they belong to. `organizationId` is the one the request acts for: the festival's
 * (festivalAccess sets req.organizationId) or, failing that, `preferred` when the caller belongs to it, or their first.
 * Returns null for a caller that belongs to no organization.
 */
export async function artistViewerOf(
  stores: { organizations: { listForUser(userId: string): Promise<Array<{ id: string }>> } },
  req: { isAdmin?: boolean; user?: { userId?: string }; organizationId?: string | null },
  preferred?: string | null,
): Promise<ArtistViewer | undefined | null> {
  if (req.isAdmin === true) return undefined;
  const userId = req.user?.userId;
  if (!userId) return null;
  const organizationIds = (await stores.organizations.listForUser(userId)).map((org) => org.id);
  if (organizationIds.length === 0) return null;
  const wanted = [req.organizationId, preferred].find((id) => !!id && organizationIds.includes(id));
  return { userId, organizationIds, organizationId: wanted ?? organizationIds[0]! };
}
