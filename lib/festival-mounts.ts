// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import createAdminSiteplanRoutes from '../routes/admin-siteplan';
import createFestivalRoutes from '../routes/festivals';
import createLineupImportRoutes from '../routes/lineup-import';
import createLineupAnnounceRoutes from '../routes/lineup-announce';
import { createAdminAnnouncementRoutes, createPublicAnnouncementRoutes } from '../routes/festival-announcements';
import { createFestivalDiscoveryRoutes } from '../routes/festival-discovery';

export type FestivalMount = { prefix: string; guards: any[]; router: any };

/**
 * Every router that serves festival routes, in the order server.ts mounts them. One list
 * feeds both server.ts and the access-matrix test, so a new mount cannot skip the test.
 */
export function buildFestivalMounts(deps: any): FestivalMount[] {
  const festivalRoutes = createFestivalRoutes(deps);
  const festivalDiscoveryRoutes = createFestivalDiscoveryRoutes(deps);
  const lineupImportRoutes = createLineupImportRoutes(deps);
  const lineupAnnounceRoutes = createLineupAnnounceRoutes(deps);
  const adminAnnouncementRoutes = createAdminAnnouncementRoutes(deps);
  const publicAnnouncementRoutes = createPublicAnnouncementRoutes(deps);
  const adminSiteplanRoutes = createAdminSiteplanRoutes(deps);
  const adminGuard = [deps.adminAuth];
  return [
    { prefix: '/api/v1/admin', guards: [], router: adminSiteplanRoutes },
    { prefix: '/api/v1/admin/festivals', guards: adminGuard, router: festivalRoutes },
    { prefix: '/api/v1/admin/festivals', guards: adminGuard, router: lineupImportRoutes },
    { prefix: '/api/v1/admin/festivals', guards: adminGuard, router: lineupAnnounceRoutes },
    { prefix: '/api/v1/festivals', guards: [], router: festivalDiscoveryRoutes },
    { prefix: '/api/v1/admin/festivals', guards: adminGuard, router: adminAnnouncementRoutes },
    { prefix: '/api/v1/festivals', guards: [], router: publicAnnouncementRoutes },
    { prefix: '/api/v1/festivals', guards: [], router: festivalRoutes },
  ];
}
