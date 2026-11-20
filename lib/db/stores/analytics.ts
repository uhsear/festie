// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// Read-only admin reports. The SQL lives here so the routes only shape the response.
import type { Pool } from 'pg';

// "In scope": festival not deleted, plan not deleted, user not deleted, and the
// festival equals $1 when $1 is not NULL. Crew members count only live users.
const TOTALS_SQL = `
  WITH
    f AS (
      SELECT id FROM festivals
      WHERE deleted_at IS NULL AND ($1::TEXT IS NULL OR id = $1::TEXT)
    ),
    p AS (
      SELECT fp.id, fp.user_id
      FROM festival_profiles fp
        JOIN f ON f.id = fp.festival_id
        JOIN users u ON u.id = fp.user_id AND u.deleted_at IS NULL
      WHERE fp.deleted_at IS NULL
    ),
    pk AS (
      SELECT fpp.profile_id, fpp.priority, p.user_id
      FROM festival_profile_picks fpp JOIN p ON p.id = fpp.profile_id
    ),
    c AS (SELECT cr.id FROM crews cr JOIN f ON f.id = cr.festival_id),
    cm AS (
      SELECT m.crew_id, m.user_id
      FROM crew_members m
        JOIN c ON c.id = m.crew_id
        JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
    )
  SELECT
    (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL) AS "signedUp",
    (SELECT COUNT(DISTINCT user_id)::int FROM p) AS "usersWithPlan",
    (SELECT COUNT(*)::int FROM p) AS "plans",
    (SELECT COUNT(DISTINCT profile_id)::int FROM pk) AS "plansWithPicks",
    (SELECT COUNT(DISTINCT user_id)::int FROM pk) AS "usersWithPick",
    (SELECT COUNT(*)::int FROM pk) AS "picks",
    (SELECT COUNT(*)::int FROM c) AS "crews",
    (SELECT COUNT(*)::int FROM cm) AS "crewMembers",
    (SELECT COUNT(DISTINCT user_id)::int FROM cm) AS "usersInCrews",
    (SELECT COUNT(*)::int FROM (SELECT crew_id FROM cm GROUP BY crew_id HAVING COUNT(*) >= 2) big) AS "crewsWithTwoPlus",
    (SELECT COUNT(*)::int FROM pk WHERE priority = 'must') AS "must",
    (SELECT COUNT(*)::int FROM pk WHERE priority = 'want-to-see') AS "want",
    (SELECT COUNT(*)::int FROM pk WHERE priority = 'maybe') AS "maybe"
`;

const TOP_SETS_SQL = `
  SELECT
    fs.artist,
    fs.stage_id AS "stageId",
    fs.start_time AS "startTime",
    fs.end_time AS "endTime",
    fs.day_index AS "dayIndex",
    fs.festival_id AS "festivalId",
    f.name AS "festivalName",
    fd.label AS "dayLabel",
    COUNT(*)::int AS "pickCount",
    (COUNT(*) FILTER (WHERE fpp.priority = 'must'))::int AS "mustCount",
    (COUNT(*) FILTER (WHERE fpp.priority = 'want-to-see'))::int AS "wantCount",
    (COUNT(*) FILTER (WHERE fpp.priority = 'maybe'))::int AS "maybeCount"
  FROM
    festival_profile_picks fpp
    JOIN festival_sets fs ON fpp.set_id = fs.id
    JOIN festival_profiles fp ON fpp.profile_id = fp.id AND fp.deleted_at IS NULL
    JOIN users u ON u.id = fp.user_id AND u.deleted_at IS NULL
    JOIN festivals f ON f.id = fs.festival_id AND f.deleted_at IS NULL
    LEFT JOIN festival_days fd ON fd.festival_id = fs.festival_id AND fd.day_index = fs.day_index
  WHERE $1::TEXT IS NULL OR fs.festival_id = $1::TEXT
  GROUP BY
    fs.id, fs.artist, fs.stage_id, fs.start_time, fs.end_time, fs.day_index, fs.festival_id, f.name, fd.label
  ORDER BY "pickCount" DESC
  LIMIT 20
`;

// Per-set pick counts for one festival ($1), same scope as TOP_SETS_SQL.
const SET_PICK_COUNTS_SQL = `
  SELECT
    fpp.set_id AS "setId",
    COUNT(*)::int AS picks,
    (COUNT(*) FILTER (WHERE fpp.priority = 'must'))::int AS must,
    (COUNT(*) FILTER (WHERE fpp.priority = 'want-to-see'))::int AS want,
    (COUNT(*) FILTER (WHERE fpp.priority = 'maybe'))::int AS maybe
  FROM festival_profile_picks fpp
    JOIN festival_profiles fp ON fp.id = fpp.profile_id AND fp.festival_id = $1 AND fp.deleted_at IS NULL
    JOIN users u ON u.id = fp.user_id AND u.deleted_at IS NULL
  GROUP BY fpp.set_id
`;

// Same-day set pairs that $2 or more distinct users picked. The floor is applied
// here so no client ever receives a smaller pair; overlap is checked in the route.
const CO_PICKED_PAIRS_SQL = `
  WITH pk AS (
    SELECT DISTINCT fp.user_id, fs.id AS set_id, fs.day_index
    FROM festival_profile_picks fpp
      JOIN festival_profiles fp ON fp.id = fpp.profile_id AND fp.festival_id = $1 AND fp.deleted_at IS NULL
      JOIN users u ON u.id = fp.user_id AND u.deleted_at IS NULL
      JOIN festival_sets fs ON fs.id = fpp.set_id AND fs.festival_id = $1
    WHERE fs.start_time IS NOT NULL AND fs.end_time IS NOT NULL
  )
  SELECT a.set_id AS "aId", b.set_id AS "bId", COUNT(*)::int AS people
  FROM pk a
    JOIN pk b ON b.user_id = a.user_id AND b.day_index = a.day_index AND b.set_id > a.set_id
  GROUP BY a.set_id, b.set_id
  HAVING COUNT(*) >= $2
`;

const ACTIVE_USERS_SQL = `
  SELECT
    u.id,
    u.username,
    u.avatar_key AS "avatarKey",
    COUNT(DISTINCT fp.id)::int AS "profileCount",
    COUNT(fpp.set_id)::int AS "totalPicks",
    MAX(fp.updated_at) AS "lastActive"
  FROM
    users u
    JOIN festival_profiles fp ON fp.user_id = u.id AND fp.deleted_at IS NULL
    JOIN festivals f ON f.id = fp.festival_id AND f.deleted_at IS NULL
    LEFT JOIN festival_profile_picks fpp ON fpp.profile_id = fp.id
  WHERE u.deleted_at IS NULL AND ($1::TEXT IS NULL OR fp.festival_id = $1::TEXT)
  GROUP BY u.id, u.username, u.avatar_key
  ORDER BY "lastActive" DESC NULLS LAST
  LIMIT 50
`;

const CREWS_SQL = `
  SELECT
    c.id,
    c.name,
    c.festival_id AS "festivalId",
    f.name AS "festivalName",
    COUNT(u.id)::int AS "memberCount",
    c.created_at AS "createdAt"
  FROM
    crews c
    JOIN festivals f ON f.id = c.festival_id AND f.deleted_at IS NULL
    LEFT JOIN crew_members cm ON cm.crew_id = c.id
    LEFT JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
  WHERE $1::TEXT IS NULL OR c.festival_id = $1::TEXT
  GROUP BY c.id, c.name, c.festival_id, f.name, c.created_at
  ORDER BY "memberCount" DESC
  LIMIT 20
`;

const INSTALL_SQL = `
  SELECT
    event,
    COUNT(*)::int AS n
  FROM
    install_events
  WHERE
    created_at >= NOW() - INTERVAL '30 days'
  GROUP BY
    event
`;

const FESTIVAL_STATS_SQL = `
  SELECT
    f.id,
    f.name,
    COUNT(DISTINCT fp.id)::int AS "profileCount",
    COUNT(DISTINCT fpp.set_id)::int AS "uniqueSetsPicked",
    COUNT(fpp.*)::int AS "totalPicks"
  FROM
    festivals f
    LEFT JOIN festival_profiles fp ON fp.festival_id = f.id AND fp.deleted_at IS NULL
    LEFT JOIN festival_profile_picks fpp ON fpp.profile_id = fp.id
  WHERE f.deleted_at IS NULL
  GROUP BY f.id, f.name
  ORDER BY "profileCount" DESC
`;
const REF_COUNTS_SQL = `
SELECT
  to_char(day, 'YYYY-MM-DD') AS day,
  ref,
  signups
FROM
  signup_ref_counts
WHERE
  day > CURRENT_DATE - $1::int
ORDER BY
  day DESC,
  signups DESC,
  ref ASC
`;

const FOLLOWS_PER_DAY_SQL = `
  SELECT
    to_char(ff.created_at::date, 'YYYY-MM-DD') AS day,
    ff.festival_id AS "festivalId",
    f.name AS "festivalName",
    COUNT(*)::int AS follows
  FROM
    festival_follows ff
    JOIN festivals f ON f.id = ff.festival_id
  WHERE
    ff.created_at >= CURRENT_DATE - ($1::int - 1)
  GROUP BY
    1,
    2,
    3
  ORDER BY
    1 DESC,
    4 DESC,
    3 ASC
`;

const FOLLOWERS_SQL = `
  SELECT
    ff.festival_id AS "festivalId",
    f.name AS "festivalName",
    COUNT(*)::int AS followers
  FROM
    festival_follows ff
    JOIN festivals f ON f.id = ff.festival_id
  GROUP BY
    1,
    2
  ORDER BY
    3 DESC,
    2 ASC
`;

// People, not rows: send.ts logs one row per device and reengagement.ts one per email.
const NEWS_REACH_SQL = `
  SELECT
    type,
    CASE
      WHEN status = 'held' THEN 'held'
      WHEN platform = 'email' THEN 'email'
      ELSE 'push'
    END AS channel,
    COUNT(DISTINCT user_id)::int AS count
  FROM
    notification_log
  WHERE
    type = ANY ($2::text[])
    AND status IN ('sent', 'held')
    AND created_at >= CURRENT_DATE - ($1::int - 1)
  GROUP BY
    1,
    2
  ORDER BY
    1 ASC,
    2 ASC
`;

// Re-engagement news types the growth report counts. Add a type here when it joins the news set.
const GROWTH_NEWS_TYPES = ['lineup_drop', 'set_times_out', 'days_out'];

const PICKS_PER_SET_SQL = `
  SELECT
    fpp.set_id AS "setId",
    COUNT(*)::int AS picks
  FROM
    festival_profile_picks fpp
    JOIN festival_profiles fp ON fp.id = fpp.profile_id
  WHERE
    fp.festival_id = $1
    AND fp.deleted_at IS NULL
  GROUP BY
    fpp.set_id
`;

const REMINDERS_PER_SET_SQL = `
  SELECT k AS "setId", COUNT(*)::int AS reminders
  FROM festival_profiles fp,
       jsonb_object_keys(fp.reminders_json) AS k
  WHERE fp.festival_id = $1 AND fp.deleted_at IS NULL
    AND jsonb_typeof(fp.reminders_json) = 'object'
  GROUP BY k
`;

export function createAnalyticsStore(pool: Pool) {
  return {
    async refCounts(days: number) {
      return (await pool.query(REF_COUNTS_SQL, [days])).rows;
    },

    async growth(days: number) {
      const [signups, followsPerDay, followers, news] = await Promise.all([
        pool.query(REF_COUNTS_SQL, [days]),
        pool.query(FOLLOWS_PER_DAY_SQL, [days]),
        pool.query(FOLLOWERS_SQL),
        pool.query(NEWS_REACH_SQL, [days, GROWTH_NEWS_TYPES]),
      ]);
      return { signups: signups.rows, followsPerDay: followsPerDay.rows, followers: followers.rows, news: news.rows };
    },

    /** Picks and reminders per set id, as the two raw row lists. */
    async setEngagement(festivalId: string) {
      const [picks, reminders] = await Promise.all([
        pool.query(PICKS_PER_SET_SQL, [festivalId]),
        pool.query(REMINDERS_PER_SET_SQL, [festivalId]),
      ]);
      return { picks: picks.rows, reminders: reminders.rows };
    },

    /** The festival's name, or null when it is missing or soft-deleted. */
    async festivalName(festivalId: string): Promise<string | null> {
      const found = await pool.query('SELECT name FROM festivals WHERE id = $1 AND deleted_at IS NULL', [festivalId]);
      return found.rows[0]?.name ?? null;
    },

    async dashboard(festivalId: string | null) {
      const params = [festivalId];
      const [totals, topSets, activeUsers, crews, install, festivalStats] = await Promise.all([
        pool.query(TOTALS_SQL, params),
        pool.query(TOP_SETS_SQL, params),
        pool.query(ACTIVE_USERS_SQL, params),
        pool.query(CREWS_SQL, params),
        pool.query(INSTALL_SQL),
        pool.query(FESTIVAL_STATS_SQL),
      ]);
      return {
        totals: totals.rows,
        topSets: topSets.rows,
        activeUsers: activeUsers.rows,
        crews: crews.rows,
        install: install.rows,
        festivalStats: festivalStats.rows,
      };
    },

    async pickInsight(festivalId: string, minPairPeople: number) {
      const [counts, pairs] = await Promise.all([
        pool.query(SET_PICK_COUNTS_SQL, [festivalId]),
        pool.query(CO_PICKED_PAIRS_SQL, [festivalId, minPairPeople]),
      ]);
      return { counts: counts.rows, pairs: pairs.rows };
    },
  };
}
