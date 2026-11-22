import type { Pool } from 'pg';
import { withTransaction, serializeJson } from '../connection';
import { decodeCursor, encodeCursor } from '../../pagination';
import {
  batchInsert,
  applyPickDeltas,
  PROFILE_SELECT,
  PROFILE_SELECT_PICKS,
  keepConvertedPicks,
  interestDeltaSql,
} from './profiles-helpers.js';

export default function createProfilesStore(pool: Pool, utils: any) {
  const { mapProfileRow } = utils;

  const profiles = {
    // No default cap: callers (metrics, account export, profile counts) need every row, and a silent
    // cap under-counts past it. Pass `limit` only to bound a read on purpose.
    async readAll({ limit }: { limit?: number } = {}) {
      const result = await pool.query(
        `
        SELECT ${PROFILE_SELECT}
        FROM festival_profiles fp
        WHERE fp.deleted_at IS NULL
        ORDER BY fp.created_at ASC, fp.id ASC
        LIMIT $1
      `,
        [limit ?? null],
      );
      return result.rows.map(mapProfileRow);
    },

    async getByFestival(festivalId: string) {
      const result = await pool.query(
        `
        SELECT ${PROFILE_SELECT}
        FROM festival_profiles fp
        WHERE fp.festival_id = $1 AND fp.deleted_at IS NULL
        ORDER BY fp.created_at ASC, fp.id ASC
      `,
        [festivalId],
      );
      return result.rows.map(mapProfileRow);
    },

    async listPicksByFestival(festivalId: string) {
      const result = await pool.query(
        `
        SELECT ${PROFILE_SELECT_PICKS}
        FROM festival_profiles fp
        WHERE fp.festival_id = $1 AND fp.deleted_at IS NULL
        ORDER BY fp.created_at ASC, fp.id ASC
      `,
        [festivalId],
      );
      return result.rows.map(mapProfileRow);
    },

    /**
     * One keyset page of the picks-only list, in the order paginateArray uses: created_at (cut to the
     * milliseconds a JS Date keeps, so a cursor round-trips), then id. An unusable cursor starts at the top.
     */
    async listPicksPageByFestival(
      festivalId: string,
      { limit, cursor, userIds }: { limit: number; cursor?: string | null; userIds: string[] },
    ) {
      const decoded = decodeCursor(cursor);
      const usable = typeof decoded?.id === 'string' && !Number.isNaN(Date.parse(decoded.value));
      // $3 limits both the page and the total to the given users (the viewer and their crew mates).
      const params: any[] = [festivalId, limit + 1, userIds];
      if (usable) params.push(decoded.value, decoded.id);
      const [page, total] = await Promise.all([
        pool.query(
          `
          SELECT ${PROFILE_SELECT_PICKS}
          FROM festival_profiles fp
          WHERE fp.festival_id = $1 AND fp.deleted_at IS NULL AND fp.user_id = ANY($3::text[])
            ${usable ? "AND (date_trunc('milliseconds', fp.created_at), fp.id) > ($4::timestamptz, $5::text)" : ''}
          ORDER BY date_trunc('milliseconds', fp.created_at) ASC, fp.id ASC
          LIMIT $2
        `,
          params,
        ),
        pool.query(
          'SELECT count(*)::int AS n FROM festival_profiles WHERE festival_id = $1 AND deleted_at IS NULL AND user_id = ANY($2::text[])',
          [festivalId, userIds],
        ),
      ]);
      const hasMore = page.rows.length > limit;
      const items: any[] = page.rows.slice(0, limit).map(mapProfileRow);
      const last = items[items.length - 1];
      return {
        profiles: items,
        pagination: {
          hasMore,
          nextCursor: hasMore && last ? encodeCursor({ value: last.createdAt, id: last.id }) : null,
          pageSize: limit,
          total: total.rows[0].n,
        },
      };
    },

    /** How many profiles other than the viewer's picked each set, keyed by set id. */
    async pickCountsByFestival(festivalId: string, excludeUserId: string): Promise<Record<string, number>> {
      const result = await pool.query(
        `
        SELECT p.set_id AS "setId", count(*)::int AS n
        FROM festival_profile_picks p
        JOIN festival_profiles fp ON fp.id = p.profile_id
        WHERE fp.festival_id = $1 AND fp.deleted_at IS NULL AND fp.user_id IS DISTINCT FROM $2
        GROUP BY p.set_id
      `,
        [festivalId, excludeUserId],
      );
      return Object.fromEntries(result.rows.map((row: any) => [row.setId, row.n]));
    },

    async userIdsByFestival(festivalId: string) {
      const result = await pool.query(
        'SELECT user_id AS "userId" FROM festival_profiles WHERE festival_id = $1 AND user_id IS NOT NULL AND deleted_at IS NULL',
        [festivalId],
      );
      return result.rows.map((row: any) => row.userId);
    },

    /**
     * User ids who picked each set or set a reminder on it, keyed by set id. Each user
     * appears once per set. Sets nobody picked or set a reminder on are absent.
     */
    async pickersBySet(festivalId: string, setIds: string[]): Promise<Map<string, string[]>> {
      const bySet = new Map<string, string[]>();
      if (setIds.length === 0) return bySet;
      // UNION removes a user who both picked a set and set a reminder on it. The CASE guards a non-object reminders_json.
      const result = await pool.query(
        `
        SELECT
          p.set_id AS "setId",
          fp.user_id AS "userId"
        FROM
          festival_profile_picks p
          JOIN festival_profiles fp ON fp.id = p.profile_id
        WHERE
          fp.festival_id = $1
          AND p.set_id = ANY ($2)
          AND fp.deleted_at IS NULL
          AND fp.user_id IS NOT NULL
        UNION
        SELECT
          k AS "setId",
          fp.user_id AS "userId"
        FROM
          festival_profiles fp,
          jsonb_object_keys(
            CASE
              WHEN jsonb_typeof(fp.reminders_json) = 'object' THEN fp.reminders_json
              ELSE '{}'::jsonb
            END
          ) AS k
        WHERE
          fp.festival_id = $1
          AND k = ANY ($2)
          AND fp.deleted_at IS NULL
          AND fp.user_id IS NOT NULL
      `,
        [festivalId, setIds],
      );
      for (const row of result.rows) {
        const list = bySet.get(row.setId) || [];
        list.push(row.userId);
        bySet.set(row.setId, list);
      }
      return bySet;
    },

    /**
     * User ids whose mark on each entry is still `open`, keyed by entry id. Conversion turns a mark
     * into picks, so an open mark here means conversion has not run for it, or the picks were full.
     */
    async interestedProfilesByEntry(festivalId: string, entryIds: string[]): Promise<Map<string, string[]>> {
      const byEntry = new Map<string, string[]>();
      if (entryIds.length === 0) return byEntry;
      const result = await pool.query(
        `
        SELECT e.key AS "entryId", fp.user_id AS "userId"
        FROM festival_profiles fp, jsonb_each(fp.interests_json) e
        WHERE fp.festival_id = $1
          AND fp.deleted_at IS NULL
          AND fp.user_id IS NOT NULL
          AND e.key = ANY ($2::text[])
          AND e.value ->> 'state' = 'open'
      `,
        [festivalId, entryIds],
      );
      for (const row of result.rows) byEntry.set(row.entryId, [...(byEntry.get(row.entryId) ?? []), row.userId]);
      return byEntry;
    },

    /** Marks per entry for the admin demand view: { [entryId]: { open, converted } }. */
    async interestCounts(festivalId: string): Promise<Record<string, { open: number; converted: number }>> {
      const result = await pool.query(
        `
        SELECT e.key AS "entryId", e.value ->> 'state' AS state, count(*)::int AS n
        FROM festival_profiles fp, jsonb_each(fp.interests_json) e
        WHERE fp.festival_id = $1 AND fp.deleted_at IS NULL
        GROUP BY e.key, state
      `,
        [festivalId],
      );
      const counts: Record<string, { open: number; converted: number }> = {};
      for (const row of result.rows) {
        if (row.state !== 'open' && row.state !== 'converted') continue;
        counts[row.entryId] ??= { open: 0, converted: 0 };
        counts[row.entryId]![row.state as 'open' | 'converted'] = row.n;
      }
      return counts;
    },

    async getByUserId(userId: string) {
      const result = await pool.query(
        `
        SELECT
          fp.id,
          fp.festival_id AS "festivalId",
          fp.user_id AS "userId",
          fp.name,
          COALESCE(fp.interests_json, '{}'::jsonb) AS interests,
          fp.created_at AS "createdAt",
          fp.updated_at AS "updatedAt"
        FROM
          festival_profiles fp
        WHERE
          fp.user_id = $1
          AND fp.deleted_at IS NULL
        ORDER BY
          fp.created_at ASC
      `,
        [userId],
      );
      return result.rows;
    },

    async readByUserAndFestival(userId: string, festivalId: string) {
      const result = await pool.query(
        'SELECT id FROM festival_profiles WHERE user_id = $1 AND festival_id = $2 AND deleted_at IS NULL LIMIT 1',
        [userId, festivalId],
      );
      return result.rows[0] || null;
    },

    async create({ id, festivalId, userId, name, picks, notes, reminders, interests, createdAt }: any) {
      // Use transaction to ensure main record and normalized tables stay in sync
      return withTransaction(pool, async (client) => {
        await client.query(
          `
  INSERT INTO
    festival_profiles (
      id,
      festival_id,
      user_id,
      name,
      picks_json,
      notes_json,
      reminders_json,
      interests_json,
      created_at
    )
  VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`,
          [
            id,
            festivalId,
            userId || null,
            name,
            serializeJson(picks || {}),
            serializeJson(notes || {}),
            serializeJson(reminders || {}),
            serializeJson(interests || {}),
            createdAt || new Date().toISOString(),
          ],
        );
        // Sync normalized picks/notes/reminders tables (batch)
        if (picks && Object.keys(picks).length > 0) {
          const pickRows = Object.entries(picks).map(([setId, priority]) => [id, setId, priority]);
          await batchInsert(client, 'festival_profile_picks', ['profile_id', 'set_id', 'priority'], pickRows);
        }
        if (notes && Object.keys(notes).length > 0) {
          const noteRows = Object.entries(notes).map(([setId, text]) => [id, setId, text]);
          await batchInsert(client, 'festival_profile_notes', ['profile_id', 'set_id', 'text'], noteRows);
        }

        const result = await client.query(
          `
          SELECT ${PROFILE_SELECT}
          FROM festival_profiles fp WHERE fp.id = $1 AND fp.deleted_at IS NULL
        `,
          [id],
        );
        return result.rows[0] ? mapProfileRow(result.rows[0]) : null;
      });
    },

    async getById(profileId: string) {
      const { rows } = await pool.query(
        `
        SELECT ${PROFILE_SELECT}
        FROM festival_profiles fp WHERE fp.id = $1 AND fp.deleted_at IS NULL
      `,
        [profileId],
      );
      if (!rows[0]) return null;
      return mapProfileRow(rows[0]);
    },

    async update(
      profileId: string,
      fields: any,
      { expectedEtag, maxPicks }: { expectedEtag?: string; maxPicks?: number } = {},
    ) {
      // fields: picks, pickRemove, pickDeltas, notes, reminders, interestAdd, interestRemove, userId, name, updatedAt
      // pickDeltas ({ set: {setId: priority}, remove: [setId] }) changes only the sets it names.
      // expectedEtag (the If-Match value) is checked under the row lock, so two writes that both
      // read the same version cannot both pass. A mismatch throws code VERSION_MISMATCH with the
      // current profile; a delta that pushes the pick map past maxPicks throws TOO_MANY_PICKS.
      // Either throw rolls the transaction back.
      // Use transaction to ensure main record and normalized tables stay in sync (#CRITICAL)
      return withTransaction(pool, async (client) => {
        const sets: string[] = [];
        const values: any[] = [];
        let idx = 1;
        let deltaPicks: Record<string, string> | undefined;
        if (fields.pickDeltas !== undefined || expectedEtag) {
          // Lock the row so writes to one profile apply one after the other.
          const locked = await client.query(
            `SELECT ${PROFILE_SELECT} FROM festival_profiles fp WHERE fp.id = $1 AND fp.deleted_at IS NULL FOR UPDATE OF fp`,
            [profileId],
          );
          if (locked.rows.length === 0) return null;
          const current = mapProfileRow(locked.rows[0]);
          if (expectedEtag && current.updatedAt && expectedEtag !== `"${current.updatedAt}"`) {
            throw Object.assign(new Error('Profile was modified since your last fetch'), {
              code: 'VERSION_MISMATCH',
              current,
            });
          }
        }
        if (fields.pickDeltas !== undefined) {
          deltaPicks = await applyPickDeltas(client, profileId, fields.pickDeltas);
          if (maxPicks !== undefined && Object.keys(deltaPicks).length > maxPicks) {
            throw Object.assign(new Error('Too many picks'), { code: 'TOO_MANY_PICKS' });
          }
        }
        const picks =
          fields.picks === undefined
            ? undefined
            : await keepConvertedPicks(client, profileId, fields.picks, fields.pickRemove);
        if (picks !== undefined) {
          sets.push(`picks_json = $${idx}`);
          values.push(serializeJson(picks));
          idx++;
        } else if (deltaPicks !== undefined) {
          sets.push(`picks_json = $${idx}`);
          values.push(serializeJson(deltaPicks));
          idx++;
        }
        if (fields.notes !== undefined) {
          sets.push(`notes_json = $${idx}`);
          values.push(serializeJson(fields.notes));
          idx++;
        }
        if (fields.reminders !== undefined) {
          sets.push(`reminders_json = $${idx}`);
          values.push(serializeJson(fields.reminders));
          idx++;
        }
        if (fields.interestAdd !== undefined || fields.interestRemove !== undefined) {
          sets.push(`interests_json = ${interestDeltaSql(idx, idx + 1)}`);
          values.push(fields.interestAdd ?? [], fields.interestRemove ?? []);
          idx += 2;
        }
        if (fields.userId !== undefined) {
          sets.push(`user_id = $${idx}`);
          values.push(fields.userId);
          idx++;
        }
        if (fields.name !== undefined) {
          sets.push(`name = $${idx}`);
          values.push(fields.name);
          idx++;
        }
        sets.push(`updated_at = $${idx}`);
        values.push(new Date().toISOString());
        idx++;
        values.push(profileId);
        await client.query(
          `UPDATE festival_profiles SET ${sets.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`,
          values,
        );
        // Sync normalized tables (batch inserts)
        if (picks !== undefined) {
          await client.query('DELETE FROM festival_profile_picks WHERE profile_id = $1', [profileId]);
          const pickRows = Object.entries(picks).map(([setId, priority]) => [profileId, setId, priority]);
          await batchInsert(client, 'festival_profile_picks', ['profile_id', 'set_id', 'priority'], pickRows);
        }
        if (fields.notes !== undefined) {
          await client.query('DELETE FROM festival_profile_notes WHERE profile_id = $1', [profileId]);
          const noteRows = Object.entries(fields.notes).map(([setId, text]) => [profileId, setId, text]);
          await batchInsert(client, 'festival_profile_notes', ['profile_id', 'set_id', 'text'], noteRows);
        }
        const result = await client.query(
          `
          SELECT ${PROFILE_SELECT}
          FROM festival_profiles fp WHERE fp.id = $1 AND fp.deleted_at IS NULL
        `,
          [profileId],
        );
        return result.rows[0] ? mapProfileRow(result.rows[0]) : null;
      });
    },

    async delete(profileId: string, { deletedBy, reason }: { deletedBy?: string; reason?: string } = {}) {
      const profile = await this.getById(profileId);
      if (!profile) return null;
      await withTransaction(pool, async (client) => {
        await client.query(
          'UPDATE festival_profiles SET deleted_at = NOW(), updated_at = NOW(), deleted_by = $2, deletion_reason = $3 WHERE id = $1 AND deleted_at IS NULL',
          [profileId, deletedBy || null, reason || null],
        );
        await client.query('DELETE FROM festival_profile_picks WHERE profile_id = $1', [profileId]);
        await client.query('DELETE FROM festival_profile_notes WHERE profile_id = $1', [profileId]);
      });
      return profile;
    },

    // `keepPicks` (self-service account delete) leaves picks and notes in place
    // so a sign-in inside the grace window can restore them; admin delete purges.
    async deleteByUserId(
      userId: string,
      { deletedBy, reason, keepPicks = false }: { deletedBy?: string; reason?: string; keepPicks?: boolean } = {},
    ) {
      const { rows } = await pool.query(
        `
        SELECT
          id,
          festival_id AS "festivalId",
          user_id AS "userId",
          name
        FROM
          festival_profiles
        WHERE
          user_id = $1
          AND deleted_at IS NULL
      `,
        [userId],
      );
      if (rows.length > 0) {
        const profileIds = rows.map((r: any) => r.id);
        await withTransaction(pool, async (client) => {
          await client.query(
            'UPDATE festival_profiles SET deleted_at = NOW(), updated_at = NOW(), deleted_by = $2, deletion_reason = $3 WHERE user_id = $1 AND deleted_at IS NULL',
            [userId, deletedBy || null, reason || null],
          );
          if (keepPicks) return;
          await client.query('DELETE FROM festival_profile_picks WHERE profile_id = ANY($1)', [profileIds]);
          await client.query('DELETE FROM festival_profile_notes WHERE profile_id = ANY($1)', [profileIds]);
          await client.query("UPDATE festival_profiles SET interests_json = '{}'::jsonb WHERE id = ANY($1)", [
            profileIds,
          ]);
        });
      }
      return rows.map(mapProfileRow);
    },

    // Undo an account-deleted soft delete. NOT EXISTS skips a festival where the
    // user already has a live profile, and DISTINCT ON restores only the newest
    // row per festival, so the partial unique index cannot fail.
    async restoreByUserId(userId: string) {
      const { rowCount } = await pool.query(
        `
        UPDATE festival_profiles fp
        SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL, updated_at = NOW()
        WHERE fp.id IN (
            SELECT DISTINCT ON (festival_id) id FROM festival_profiles
            WHERE user_id = $1 AND deleted_at IS NOT NULL AND deletion_reason = 'account-deleted'
            ORDER BY festival_id, deleted_at DESC
          )
          AND NOT EXISTS (
            SELECT 1 FROM festival_profiles live
            WHERE live.user_id = fp.user_id AND live.festival_id = fp.festival_id AND live.deleted_at IS NULL
          )
      `,
        [userId],
      );
      return rowCount ?? 0;
    },

    async claimOrphan(festivalId: string, userId: string, username: string) {
      // Find orphan profile matching username
      const { rows } = await pool.query(
        `
        SELECT id FROM festival_profiles
        WHERE festival_id = $1 AND user_id IS NULL AND LOWER(name) = LOWER($2) AND deleted_at IS NULL
        LIMIT 1
      `,
        [festivalId, username],
      );
      if (rows[0]) {
        await pool.query(
          'UPDATE festival_profiles SET user_id = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL',
          [userId, rows[0].id],
        );
        return this.getById(rows[0].id);
      }
      return null;
    },

    async countByFestival(festivalId: string) {
      const { rows } = await pool.query(
        'SELECT COUNT(*) AS count FROM festival_profiles WHERE festival_id = $1 AND deleted_at IS NULL',
        [festivalId],
      );
      return parseInt(rows[0]?.count ?? 0, 10);
    },

    async claimOrphanProfiles(userId: string, name: string) {
      const { rowCount } = await pool.query(
        'UPDATE festival_profiles SET user_id = $1, updated_at = NOW() WHERE user_id IS NULL AND LOWER(name) = LOWER($2) AND deleted_at IS NULL',
        [userId, name],
      );
      return rowCount;
    },
  };

  // #24: Picks store for querying normalized picks data
  const picks = {
    async bySetId(setId: string) {
      const result = await pool.query(
        `
        SELECT
          p.profile_id AS "profileId",
          fp.user_id AS "userId",
          fp.name AS "profileName",
          p.priority
        FROM
          festival_profile_picks p
          JOIN festival_profiles fp ON fp.id = p.profile_id
        WHERE
          p.set_id = $1
          AND fp.deleted_at IS NULL
      `,
        [setId],
      );
      return result.rows;
    },

    async byFestival(festivalId: string) {
      const result = await pool.query(
        `
        SELECT
          p.set_id AS "setId",
          p.priority,
          fp.user_id AS "userId"
        FROM
          festival_profile_picks p
          JOIN festival_profiles fp ON fp.id = p.profile_id
        WHERE
          fp.festival_id = $1
          AND fp.deleted_at IS NULL
      `,
        [festivalId],
      );
      return result.rows;
    },
  };

  return { profiles, picks };
}
