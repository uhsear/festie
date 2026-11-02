import type { Pool } from 'pg';

export function createFollowsStore(pool: Pool) {
  return {
    /** Festival ids the user follows, newest first. Drafts and deleted festivals are left out. */
    async list(userId: string): Promise<string[]> {
      const { rows } = await pool.query(
        `
  SELECT
    ff.festival_id AS "festivalId"
  FROM
    festival_follows ff
    JOIN festivals f ON f.id = ff.festival_id
    AND f.deleted_at IS NULL
    AND f.published_at IS NOT NULL
  WHERE
    ff.user_id = $1
  ORDER BY
    ff.created_at DESC,
    ff.festival_id
`,
        [userId],
      );
      return rows.map((r: any) => r.festivalId);
    },

    async follow(userId: string, festivalId: string) {
      await pool.query(
        'INSERT INTO festival_follows (user_id, festival_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, festivalId],
      );
    },

    async unfollow(userId: string, festivalId: string) {
      await pool.query('DELETE FROM festival_follows WHERE user_id = $1 AND festival_id = $2', [userId, festivalId]);
    },

    /**
     * Sets that people who picked `setId` also picked, best first, max 8.
     * Privacy floor: a pair counts only when at least `minUsers` distinct,
     * non-deleted users picked both. Returns set ids only, never counts.
     */
    async alsoPicked(festivalId: string, setId: string, minUsers: number): Promise<string[]> {
      const { rows } = await pool.query(
        `
  SELECT
    pp2.set_id AS "setId",
    COUNT(DISTINCT p.user_id)::int AS n
  FROM
    festival_profile_picks pp1
    JOIN festival_profiles p ON p.id = pp1.profile_id
    AND p.festival_id = $1
    AND p.deleted_at IS NULL
    AND p.user_id IS NOT NULL
    JOIN users u ON u.id = p.user_id
    AND u.deleted_at IS NULL
    JOIN festival_profile_picks pp2 ON pp2.profile_id = pp1.profile_id
    AND pp2.set_id <> pp1.set_id
    JOIN festival_sets s ON s.id = pp2.set_id
    AND s.festival_id = $1
  WHERE
    pp1.set_id = $2
  GROUP BY
    pp2.set_id
  HAVING
    COUNT(DISTINCT p.user_id) >= $3
  ORDER BY
    n DESC,
    pp2.set_id
  LIMIT
    8
`,
        [festivalId, setId, minUsers],
      );
      return rows.map((r: any) => r.setId);
    },
  };
}
