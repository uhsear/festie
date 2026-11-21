// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import createAdminSiteplanRoutes from '../routes/admin-siteplan';
import createFestivalRoutes from '../routes/festivals';
import createLineupImportRoutes from '../routes/lineup-import';
import createLineupAnnounceRoutes from '../routes/lineup-announce';
import createTimeReleasesRoutes from '../routes/time-releases';
import createLineupInterestRoutes from '../routes/lineup-interest';
import createManageRoutes from '../routes/manage';
import createManageArtistsRoutes from '../routes/manage-artists';
import createOrganizationsRoutes from '../routes/organizations';
import { createAdminAnnouncementRoutes, createPublicAnnouncementRoutes } from '../routes/festival-announcements';
import { createFestivalDiscoveryRoutes } from '../routes/festival-discovery';

export type FestivalMount = {
  prefix: string;
  guards: any[];
  router: any;
  /** Set on the /manage mount: the routers it forwards to, which the matrix test reads for its rows. */
  forwarded?: Record<'festivals' | 'lineupImport' | 'siteplan' | 'announcements' | 'lineupAnnounce', any>;
};

/**
 * Every router that serves festival or organization routes, in the order server.ts mounts them. One list
 * feeds both server.ts and the access-matrix test, so a new mount cannot skip the test. The /manage mount
 * exists only while ORGANIZER_PLATFORM_ENABLED is on.
 */
export function buildFestivalMounts(deps: any): FestivalMount[] {
  const festivalRoutes = createFestivalRoutes(deps);
  const festivalDiscoveryRoutes = createFestivalDiscoveryRoutes(deps);
  const lineupImportRoutes = createLineupImportRoutes(deps);
  const lineupAnnounceRoutes = createLineupAnnounceRoutes(deps);
  const timeReleasesRoutes = createTimeReleasesRoutes(deps);
  const lineupInterestRoutes = createLineupInterestRoutes(deps);
  const adminAnnouncementRoutes = createAdminAnnouncementRoutes(deps);
  const publicAnnouncementRoutes = createPublicAnnouncementRoutes(deps);
  const adminSiteplanRoutes = createAdminSiteplanRoutes(deps);
  const adminGuard = [deps.adminAuth];
  const forwarded = {
    festivals: festivalRoutes,
    lineupImport: lineupImportRoutes,
    siteplan: adminSiteplanRoutes,
    announcements: adminAnnouncementRoutes,
    lineupAnnounce: lineupAnnounceRoutes,
  };
  const organizerOn = deps.config.ORGANIZER_PLATFORM_ENABLED === true;
  const manage: FestivalMount[] =
    organizerOn
      ? [
          {
            prefix: '/api/v1/manage',
            guards: [deps.userAuth],
            router: createManageRoutes(deps, {
              festivalRoutes,
              lineupImportRoutes,
              siteplanRoutes: adminSiteplanRoutes,
              announcementRoutes: adminAnnouncementRoutes,
              lineupAnnounceRoutes,
              artistRoutes: createManageArtistsRoutes(deps),
            }),
            forwarded,
          },
        ]
      : [];
  // The admin organizations router is part of the flagged surface: off means no tab, no queue and no member routes.
  const adminOrganizations: FestivalMount[] = organizerOn
    ? [{ prefix: '/api/v1/admin/organizations', guards: adminGuard, router: createOrganizationsRoutes(deps) }]
    : [];
  return [
    { prefix: '/api/v1/admin', guards: [], router: adminSiteplanRoutes },
    { prefix: '/api/v1/admin/festivals', guards: adminGuard, router: festivalRoutes },
    { prefix: '/api/v1/admin/festivals', guards: adminGuard, router: lineupImportRoutes },
    { prefix: '/api/v1/admin/festivals', guards: adminGuard, router: lineupAnnounceRoutes },
    { prefix: '/api/v1/admin/festivals', guards: adminGuard, router: timeReleasesRoutes },
    { prefix: '/api/v1/admin/festivals', guards: adminGuard, router: lineupInterestRoutes },
    { prefix: '/api/v1/festivals', guards: [], router: festivalDiscoveryRoutes },
    { prefix: '/api/v1/admin/festivals', guards: adminGuard, router: adminAnnouncementRoutes },
    { prefix: '/api/v1/festivals', guards: [], router: publicAnnouncementRoutes },
    { prefix: '/api/v1/festivals', guards: [], router: festivalRoutes },
    ...adminOrganizations,
    ...manage,
  ];
}
