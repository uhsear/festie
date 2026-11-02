import { randomBytes } from 'crypto';
import type { Pool } from 'pg';
import { withTransaction } from '../connection';

/**
 * Revocable picks links. A profile's link is /s/<share_token>. Legacy
 * /s/<profileId> links resolve until the owner resets (users.share_links_reset_at).
 */
export function createShareLinksStore(pool: Pool) {
  return {
    async getOrCreateToken(profileId: string): Promise<string | null> {
      // One statement, so two parallel callers cannot mint two tokens.
      const { rows } = await pool.query(
        `
  UPDATE festival_profiles
  SET
    share_token = COALESCE(share_token, $2)
  WHERE
    id = $1
    AND deleted_at IS NULL
  RETURNING
    share_token
`,
        [profileId, randomBytes(16).toString('base64url')],
      );
      return rows[0]?.share_token ?? null;
    },

    async findProfileId(shareId: string): Promise<string | null> {
      const { rows } = await pool.query(
        `SELECT fp.id FROM festival_profiles fp JOIN users u ON u.id = fp.user_id
         WHERE fp.deleted_at IS NULL
           AND (fp.share_token = $1 OR (fp.id = $1 AND u.share_links_reset_at IS NULL))
         LIMIT 1`,
        [shareId],
      );
      return rows[0]?.id ?? null;
    },

    async newestProfile(
      userId: string,
    ): Promise<{ profileId: string; festivalId: string; festivalName: string } | null> {
      const { rows } = await pool.query(
        `
  SELECT
    fp.id AS profile_id,
    f.id AS festival_id,
    f.name AS festival_name
  FROM
    festival_profiles fp
    JOIN festivals f ON f.id = fp.festival_id
  WHERE
    fp.user_id = $1
    AND fp.deleted_at IS NULL
    AND f.deleted_at IS NULL
  ORDER BY
    fp.created_at DESC
  LIMIT
    1
`,
        [userId],
      );
      const row = rows[0];
      return row ? { profileId: row.profile_id, festivalId: row.festival_id, festivalName: row.festival_name } : null;
    },

    async getStatus(userId: string): Promise<{ publicSchedule: boolean; linksResetAt: string | null } | null> {
      const { rows } = await pool.query('SELECT public_schedule, share_links_reset_at FROM users WHERE id = $1', [
        userId,
      ]);
      const row = rows[0];
      if (!row) return null;
      return {
        publicSchedule: row.public_schedule === true,
        linksResetAt: row.share_links_reset_at ? new Date(row.share_links_reset_at).toISOString() : null,
      };
    },

    /** Kills every picks link and calendar feed the user sent. Returns the ISO reset time. */
    async resetForUser(userId: string): Promise<string> {
      return withTransaction(pool, async (client) => {
        await client.query('UPDATE festival_profiles SET share_token = NULL WHERE user_id = $1', [userId]);
        const { rows } = await client.query(
          'UPDATE users SET share_links_reset_at = NOW() WHERE id = $1 RETURNING share_links_reset_at',
          [userId],
        );
        await client.query('DELETE FROM calendar_tokens WHERE user_id = $1', [userId]);
        if (!rows[0]) throw new Error('user not found');
        return new Date(rows[0].share_links_reset_at).toISOString();
      });
    },
  };
}
