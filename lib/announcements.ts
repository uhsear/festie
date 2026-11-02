// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Festival announcement delivery (T44). deliverDue() expires late rows, claims
 * due rows and pushes each to everyone who joined its festival. The leader sweep
 * in lib/shutdown.ts and the "send now" route both call it; claimDue's SKIP
 * LOCKED keeps a row from going out twice. It never throws.
 */

import { appLink } from './notifications/links.js';

/** sendToOfflineUsers caps one call at 200 users, so the audience goes out in chunks of this size. */
const PUSH_CHUNK = 200;

const SCREEN_PATHS: Record<string, string> = {
  map: '/map',
  timeline: '/timeline',
  picks: '/picks',
  'festival-mode': '/festival-mode',
  crew: '/crew',
};

/** Push deep link for an announcement. Shared resolvePushTarget maps every one of these. */
export function announcementDeepLink(config: any, row: { festivalId: string; screen: string }): string {
  const path = SCREEN_PATHS[row.screen] ?? `/?festival=${encodeURIComponent(row.festivalId)}`;
  return appLink(config, path);
}

export function createAnnouncer({ stores, notificationService, config, log }: any) {
  async function deliver(row: any) {
    const festivalId = row.festivalId;
    // getById returns null for a deleted festival; a draft has no publishedAt.
    const festival = await stores.festivals.getById(festivalId);
    if (!festival?.publishedAt) {
      await stores.announcements.setRecipientCount(row.id, 0);
      return;
    }
    const audience: string[] = await stores.profiles.userIdsByFestival(festivalId);
    if (notificationService?.isConfigured) {
      const deepLink = announcementDeepLink(config, row);
      for (let i = 0; i < audience.length; i += PUSH_CHUNK) {
        await notificationService.sendToOfflineUsers({
          festivalId,
          type: 'festival_announcement',
          title: row.title,
          body: row.body,
          data: { festivalId, announcementId: row.id, deepLink },
          userIds: audience.slice(i, i + PUSH_CHUNK),
          topic: 'schedule',
          threadId: `announce-${festivalId}`,
        });
      }
    }
    // Set with or without push: the banner still shows.
    await stores.announcements.setRecipientCount(row.id, audience.length);
  }

  async function deliverDue(): Promise<number> {
    try {
      const expired = await stores.announcements.expireLate();
      if (expired > 0) log.warn('announcements expired unsent: more than 30 minutes late', { count: expired });
    } catch (err: any) {
      log.warn('announcement expiry failed', { error: err.message });
    }

    let rows: any[];
    try {
      rows = await stores.announcements.claimDue(10);
    } catch (err: any) {
      log.warn('announcement claim failed', { error: err.message });
      return 0;
    }
    for (const row of rows) {
      try {
        await deliver(row);
      } catch (err: any) {
        log.warn('announcement delivery failed', { error: err.message, announcementId: row.id });
      }
    }
    return rows.length;
  }

  return { deliverDue };
}
