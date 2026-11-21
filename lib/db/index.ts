// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { openPlannerDatabase, parseJsonObject, serializeJson, withTransaction } from './connection.js';
import createUtils from './utils.js';
import createUsersStore from './stores/users.js';
import createFestivalsStore from './stores/festivals.js';
import createProfilesStore from './stores/profiles.js';
import createCrewsStore from './stores/crews.js';
import createSessionsStore from './stores/sessions.js';
import createNotificationsStore from './stores/notifications.js';
import createAuditStore from './stores/audit.js';
import createRolesStore from './stores/roles.js';
import createPollsStore from './stores/polls.js';
import { createRatingsStore } from './stores/ratings.js';
import { createExpensesStore } from './stores/expenses.js';
import { createActivityStore } from './stores/activity.js';
import { createCalendarTokensStore } from './stores/calendar-tokens.js';
import { createShareLinksStore } from './stores/share-links.js';
import { createEmailTokensStore } from './stores/email-tokens.js';
import { createLineupImportsStore } from './stores/lineup-imports.js';
import { createFollowsStore } from './stores/follows.js';
import { createTimeReleasesStore } from './stores/time-releases.js';
import { createAnnouncementsStore } from './stores/announcements.js';
import { createIdentitiesStore } from './stores/identities.js';
import { createArtistsStore } from './stores/artists.js';
import { createArtistMatchReviewStore } from './stores/artist-match-review.js';
import { createOrganizationsStore } from './stores/organizations.js';
import { createFestivalReviewStore } from './stores/festival-review.js';
import { createAnalyticsStore } from './stores/analytics.js';
import { createDbLatencyTracker } from './latency.js';
import type { Pool } from 'pg';

/**
 * Create data access stores for all database entities
 * Each store provides async CRUD operations for its table(s)
 */
function createStores(pool: Pool, { nodeEnv }: { nodeEnv?: string; sessionSecret?: string } = {}) {
  const utils = createUtils(pool);

  const users = createUsersStore(pool, utils);
  const festivals = createFestivalsStore(pool, utils);

  const profilesResult = createProfilesStore(pool, utils);
  const profiles = profilesResult.profiles;
  const picks = profilesResult.picks;

  const crewsResult = createCrewsStore(pool, utils);
  const crews = crewsResult.crews;
  const topicSubscriptions = crewsResult.topicSubscriptions;
  crews.meetingPoints = crewsResult.meetingPoints;
  const crewPacking = crewsResult.crewPacking;
  const crewRides = crewsResult.crewRides;
  const crewStatus = crewsResult.crewStatus;
  const crewDays = crewsResult.crewDays;

  const sessions = createSessionsStore(pool, utils);
  const refreshTokens = sessions.refreshTokens;
  const loginFailures = sessions.loginFailures;
  const metricsRollups = sessions.metricsRollups;

  const notificationsResult = createNotificationsStore(pool, utils);
  const deviceTokens = notificationsResult.deviceTokens;
  const notificationPrefs = notificationsResult.notificationPrefs;
  const notificationLog = notificationsResult.notificationLog;
  const notificationCounts = notificationsResult.notificationCounts;

  const auditLog = createAuditStore(pool, utils);
  const roles = createRolesStore(pool, { nodeEnv });
  const polls = createPollsStore(pool, utils);
  const ratings = createRatingsStore(pool);
  const expenses = createExpensesStore(pool);
  const activity = createActivityStore(pool);
  const calendarTokens = createCalendarTokensStore(pool);
  const shareLinks = createShareLinksStore(pool);
  const emailTokens = createEmailTokensStore(pool);
  const lineupImports = createLineupImportsStore(pool, { festivals });
  const follows = createFollowsStore(pool);
  const timeReleases = createTimeReleasesStore(pool);
  const announcements = createAnnouncementsStore(pool);
  const identities = createIdentitiesStore(pool);
  const artists = createArtistsStore(pool);
  const artistMatchReview = createArtistMatchReviewStore(pool, artists);
  const organizations = createOrganizationsStore(pool);
  const festivalReview = createFestivalReviewStore(pool);
  const analytics = createAnalyticsStore(pool);

  return {
    pool,
    users,
    festivals,
    profiles,
    picks,
    sessions,
    deviceTokens,
    notificationPrefs,
    notificationLog,
    notificationCounts,
    topicSubscriptions,
    crews,
    crewPacking,
    crewRides,
    crewStatus,
    crewDays,
    auditLog,
    roles,
    polls,
    ratings,
    expenses,
    activity,
    calendarTokens,
    shareLinks,
    refreshTokens,
    loginFailures,
    metricsRollups,
    emailTokens,
    lineupImports,
    follows,
    timeReleases,
    announcements,
    identities,
    artists,
    artistMatchReview,
    organizations,
    festivalReview,
    analytics,

    async counts() {
      const result = await pool.query('SELECT COUNT(*) AS count FROM festivals WHERE deleted_at IS NULL');
      const festivalCount = parseInt(result.rows[0].count, 10);
      const sessionCounts = await sessions.counts();
      return {
        festivals: festivalCount,
        ...sessionCounts,
      };
    },
  };
}

export { createStores, createDbLatencyTracker, openPlannerDatabase, parseJsonObject, serializeJson, withTransaction };
