import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { withTransaction } from '../connection';
import { sanitizeString } from '../../helpers/sanitize.js';
import { createLogger } from '../../logger.js';

const log = createLogger('db:crews');

/**
 * H3 (defense-in-depth, audit 2026-06-06): meeting-point label/location are user
 * free-text that the mobile map WebView interpolates into an inline <script>.
 * The WebView itself is being hardened separately, but neutralize the stored
 * value too: run it through sanitizeString (NFC + strip control/bidi/zero-width
 * + cap) AND strip angle brackets so a `</script>` breakout cannot be persisted.
 * Returns the cleaned string (or the original non-string value untouched, so
 * NULLs / undefined pass through to the existing `|| null` handling).
 */
function sanitizeMeetingPointText(value: any, maxLen: number) {
  if (typeof value !== 'string') return value;
  return sanitizeString(value, maxLen).replace(/[<>]/g, '');
}

/**
 * 080: a ride's passengers, oldest seat first. The crew_members join drops
 * people who left the crew, so their seat frees up without a cleanup job.
 * `offer` is a fixed table name or alias from this file, never user input.
 */
function ridePassengerIds(offer: string) {
  return `COALESCE(ARRAY(SELECT p.user_id FROM crew_ride_passengers p JOIN crew_members cm ON cm.user_id = p.user_id AND cm.crew_id = ${offer}.crew_id WHERE p.ride_id = ${offer}.id ORDER BY p.created_at), '{}') AS passenger_ids`;
}

/**
 * 090: user ids of members who tapped "I'll be there" on meeting point `mp`,
 * oldest tap first. Deleted users drop out. A fixed SQL fragment, no input.
 */
const MP_COMING = `COALESCE((SELECT array_agg(c.user_id ORDER BY c.created_at) FROM crew_meeting_point_coming c JOIN users u ON u.id = c.user_id AND u.deleted_at IS NULL WHERE c.meeting_point_id = mp.id), '{}') AS coming`;

export default function createCrewsStore(pool: Pool, _utils: any) {
  // #29: Topic subscription store
  const topicSubscriptions = {
    async getForUser(userId: string, festivalId: string) {
      const result = await pool.query(
        `
        SELECT
          topic,
          subscribed
        FROM
          notification_topic_subs
        WHERE
          user_id = $1
          AND festival_id = $2
      `,
        [userId, festivalId],
      );
      const subs: Record<string, boolean> = Object.create(null);
      for (const row of result.rows) subs[row.topic] = !!row.subscribed;
      return subs;
    },

    async setSubscription(userId: string, festivalId: string, topic: string, subscribed: boolean) {
      await pool.query(
        `
        INSERT INTO notification_topic_subs (user_id, festival_id, topic, subscribed, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT(user_id, festival_id, topic) DO UPDATE SET
          subscribed = EXCLUDED.subscribed,
          updated_at = NOW()
      `,
        [userId, festivalId, topic, subscribed ? 1 : 0],
      );
    },

    async isSubscribed(userId: string, festivalId: string, topic: string) {
      const result = await pool.query(
        `
        SELECT
          subscribed
        FROM
          notification_topic_subs
        WHERE
          user_id = $1
          AND festival_id = $2
          AND topic = $3
      `,
        [userId, festivalId, topic],
      );
      // Default to subscribed if no explicit preference
      return result.rows[0] ? !!result.rows[0].subscribed : true;
    },

    async getUnsubscribedUsers(festivalId: string, topic: string) {
      const result = await pool.query(
        `
        SELECT
          user_id AS "userId"
        FROM
          notification_topic_subs
        WHERE
          festival_id = $1
          AND topic = $2
          AND subscribed = 0
      `,
        [festivalId, topic],
      );
      return new Set(result.rows.map((r: any) => r.userId));
    },
  };

  const CREW_COLUMNS =
    'id, festival_id AS "festivalId", name, created_by AS "createdBy", invite_code AS "inviteCode", invite_expires_at AS "inviteExpiresAt", max_members AS "maxMembers", reformed_from AS "reformedFrom", home_base_location AS "homeBaseLocation", home_base_time AS "homeBaseTime", home_base_updated_at AS "homeBaseUpdatedAt", photo_album_url AS "photoAlbumUrl", totem_name AS "totemName", totem_emoji AS "totemEmoji", created_at AS "createdAt", updated_at AS "updatedAt"';

  // Phase 7: Crew system store
  const crews: any = {
    async create(data: any) {
      await pool.query(
        `
        INSERT INTO
          crews (
            id,
            festival_id,
            name,
            created_by,
            invite_code,
            invite_expires_at,
            max_members,
            reformed_from,
            totem_name,
            totem_emoji,
            created_at,
            updated_at
          )
        VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            NOW(),
            NOW()
          )
      `,
        [
          data.id,
          data.festivalId,
          data.name,
          data.createdBy,
          data.inviteCode,
          data.inviteExpiresAt || null,
          data.maxMembers,
          data.reformedFrom || null,
          data.totemName ?? null,
          data.totemEmoji ?? null,
        ],
      );
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [data.id]);
      return result.rows[0] || null;
    },

    /**
     * Create a crew and add the owner as a member in a single transaction.
     * Prevents orphaned crews if addMember fails after create succeeds.
     */
    async createWithOwner(data: any) {
      return withTransaction(pool, async (client) => {
        await client.query(
          `
          INSERT INTO
            crews (
              id,
              festival_id,
              name,
              created_by,
              invite_code,
              invite_expires_at,
              max_members,
              reformed_from,
              totem_name,
              totem_emoji,
              created_at,
              updated_at
            )
          VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              $10,
              NOW(),
              NOW()
            )
        `,
          [
            data.id,
            data.festivalId,
            data.name,
            data.createdBy,
            data.inviteCode,
            data.inviteExpiresAt || null,
            data.maxMembers,
            data.reformedFrom || null,
            data.totemName ?? null,
            data.totemEmoji ?? null,
          ],
        );
        await client.query(
          `
          INSERT INTO
            crew_members (crew_id, user_id, role, joined_at)
          VALUES
            ($1, $2, 'owner', NOW())
        `,
          [data.id, data.createdBy],
        );
        const result = await client.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [data.id]);
        return result.rows[0] || null;
      });
    },

    async update(data: any) {
      const sets: string[] = ['name = $1', 'max_members = $2'];
      const vals: any[] = [data.name, data.maxMembers];
      let idx = 3;
      // Totem fields follow the optional-field pattern: only written when the
      // caller supplies them, so an update that omits them leaves the crew's
      // existing totem untouched.
      if (data.totemName !== undefined) {
        sets.push('totem_name = $' + idx);
        vals.push(data.totemName);
        idx++;
      }
      if (data.totemEmoji !== undefined) {
        sets.push('totem_emoji = $' + idx);
        vals.push(data.totemEmoji);
        idx++;
      }
      sets.push('updated_at = NOW()');
      vals.push(data.id);
      await pool.query('UPDATE crews SET ' + sets.join(', ') + ' WHERE id = $' + idx, vals);
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [data.id]);
      return result.rows[0] || null;
    },

    async delete(crewId: string) {
      await pool.query('DELETE FROM crews WHERE id = $1', [crewId]);
    },

    async getById(crewId: string) {
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [crewId]);
      return result.rows[0] || null;
    },

    async getByInviteCode(code: string) {
      const result = await pool.query(
        `SELECT ${CREW_COLUMNS} FROM crews WHERE invite_code = $1 AND (invite_expires_at IS NULL OR invite_expires_at > NOW())`,
        [code],
      );
      return result.rows[0] || null;
    },

    async getExpiredByInviteCode(code: string) {
      const result = await pool.query(
        `
        SELECT
          id
        FROM
          crews
        WHERE
          invite_code = $1
          AND invite_expires_at IS NOT NULL
          AND invite_expires_at <= NOW()
      `,
        [code],
      );
      return result.rows[0] || null;
    },

    async listByFestival(festivalId: string) {
      const result = await pool.query(
        `SELECT ${CREW_COLUMNS} FROM crews WHERE festival_id = $1 ORDER BY created_at ASC`,
        [festivalId],
      );
      return result.rows;
    },

    async listByUser(userId: string) {
      const result = await pool.query(
        `
        SELECT
          c.id,
          c.festival_id AS "festivalId",
          c.name,
          c.created_by AS "createdBy",
          c.invite_code AS "inviteCode",
          c.invite_expires_at AS "inviteExpiresAt",
          c.max_members AS "maxMembers",
          c.reformed_from AS "reformedFrom",
          c.home_base_location AS "homeBaseLocation",
          c.home_base_time AS "homeBaseTime",
          c.home_base_updated_at AS "homeBaseUpdatedAt",
          c.photo_album_url AS "photoAlbumUrl",
          c.totem_name AS "totemName",
          c.totem_emoji AS "totemEmoji",
          c.created_at AS "createdAt",
          c.updated_at AS "updatedAt",
          cm.role,
          cm.joined_at AS "joinedAt"
        FROM
          crews c
          JOIN crew_members cm ON cm.crew_id = c.id
        WHERE
          cm.user_id = $1
        ORDER BY
          c.created_at ASC
      `,
        [userId],
      );
      return result.rows;
    },

    async listByUserAndFestival(userId: string, festivalId: string) {
      const result = await pool.query(
        `
        SELECT
          c.id,
          c.festival_id AS "festivalId",
          c.name,
          c.created_by AS "createdBy",
          c.invite_code AS "inviteCode",
          c.invite_expires_at AS "inviteExpiresAt",
          c.max_members AS "maxMembers",
          c.reformed_from AS "reformedFrom",
          c.home_base_location AS "homeBaseLocation",
          c.home_base_time AS "homeBaseTime",
          c.home_base_updated_at AS "homeBaseUpdatedAt",
          c.photo_album_url AS "photoAlbumUrl",
          c.totem_name AS "totemName",
          c.totem_emoji AS "totemEmoji",
          c.created_at AS "createdAt",
          c.updated_at AS "updatedAt",
          cm.role,
          cm.joined_at AS "joinedAt"
        FROM
          crews c
          JOIN crew_members cm ON cm.crew_id = c.id
        WHERE
          cm.user_id = $1
          AND c.festival_id = $2
        ORDER BY
          c.created_at ASC
      `,
        [userId, festivalId],
      );
      return result.rows;
    },

    async regenerateInviteCode(crewId: string, newCode: string, expiresAt?: Date) {
      await pool.query(
        "UPDATE crews SET invite_code = $1, invite_expires_at = COALESCE($3::timestamptz, NOW() + INTERVAL '7 days'), updated_at = NOW() WHERE id = $2",
        [newCode, crewId, expiresAt ?? null],
      );
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [crewId]);
      return result.rows[0] || null;
    },

    /**
     * Add a member to a crew. When `maxMembers` is supplied the cap is enforced
     * ATOMICALLY: the parent crews row is locked so concurrent joins serialize,
     * the count is re-read under the lock, and the insert is skipped if the crew
     * is full — closing the count-then-insert race in the join/admin-add routes.
     * Returns 'full' if the cap was reached (no insert), otherwise 'added'.
     * Without a cap (owner creation, reform) it's a plain insert.
     */
    async addMember(data: any, maxMembers?: number): Promise<'added' | 'full'> {
      if (typeof maxMembers === 'number') {
        return withTransaction(pool, async (client) => {
          // Lock the crew row; all capped joiners for this crew serialize here.
          await client.query('SELECT 1 FROM crews WHERE id = $1 FOR UPDATE', [data.crewId]);
          const countRes = await client.query('SELECT COUNT(*)::int AS count FROM crew_members WHERE crew_id = $1', [
            data.crewId,
          ]);
          if ((countRes.rows[0]?.count ?? 0) >= maxMembers) return 'full';
          await client.query(
            'INSERT INTO crew_members (crew_id, user_id, role, joined_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (crew_id, user_id) DO NOTHING',
            [data.crewId, data.userId, data.role],
          );
          return 'added';
        });
      }
      await pool.query(
        `
        INSERT INTO
          crew_members (crew_id, user_id, role, joined_at)
        VALUES
          ($1, $2, $3, NOW())
      `,
        [data.crewId, data.userId, data.role],
      );
      return 'added';
    },

    async removeMember(crewId: string, userId: string) {
      await pool.query('DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2', [crewId, userId]);
    },

    async getMembers(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          cm.crew_id AS "crewId",
          cm.user_id AS "userId",
          cm.role,
          cm.joined_at AS "joinedAt",
          u.username,
          u.display_name AS "name",
          u.avatar_key AS "avatarKey",
          u.avatar_version AS "avatarVersion"
        FROM
          crew_members cm
          JOIN users u ON u.id = cm.user_id
          AND u.deleted_at IS NULL
        WHERE
          cm.crew_id = $1
        ORDER BY
          cm.joined_at ASC
      `,
        [crewId],
      );
      return result.rows;
    },

    /**
     * Batch-load members for multiple crews in a single query.
     * Returns a Map keyed by crewId, each value an array of member rows.
     * Used by the crew list endpoint to avoid N+1 queries.
     */
    async getMembersForCrews(crewIds: string[]): Promise<Map<string, any[]>> {
      const membersByCrewId = new Map<string, any[]>();
      if (crewIds.length === 0) return membersByCrewId;

      const result = await pool.query(
        `
        SELECT
          cm.crew_id AS "crewId",
          cm.user_id AS "userId",
          cm.role,
          cm.joined_at AS "joinedAt",
          u.username,
          u.display_name AS "name",
          u.avatar_key AS "avatarKey",
          u.avatar_version AS "avatarVersion"
        FROM
          crew_members cm
          JOIN users u ON u.id = cm.user_id
          AND u.deleted_at IS NULL
        WHERE
          cm.crew_id = ANY($1)
        ORDER BY
          cm.crew_id,
          cm.joined_at ASC
      `,
        [crewIds],
      );

      // Initialize empty arrays for all requested crew IDs
      for (const id of crewIds) membersByCrewId.set(id, []);
      // Group rows by crewId
      for (const row of result.rows) {
        const members = membersByCrewId.get(row.crewId);
        if (members) members.push(row);
      }
      return membersByCrewId;
    },

    async getMember(crewId: string, userId: string) {
      const result = await pool.query(
        'SELECT crew_id AS "crewId", user_id AS "userId", role, joined_at AS "joinedAt" FROM crew_members WHERE crew_id = $1 AND user_id = $2',
        [crewId, userId],
      );
      return result.rows[0] || null;
    },

    async getMemberCount(crewId: string) {
      const result = await pool.query('SELECT COUNT(*) AS count FROM crew_members WHERE crew_id = $1', [crewId]);
      return result.rows[0]?.count ?? 0;
    },

    async updateMemberRole(crewId: string, userId: string, role: string) {
      await pool.query('UPDATE crew_members SET role = $1 WHERE crew_id = $2 AND user_id = $3', [role, crewId, userId]);
    },

    /**
     * Transfer crew ownership atomically: demote current owner, promote target.
     * Prevents inconsistent state where both or neither are owner.
     * crews.created_by moves too: the API's `owner` field and the heir logic in
     * users.hardDelete and retention_cleanup() read it. When the new owner already
     * runs a reform of the same source in this festival, crews_reform_idem_uidx
     * raises 23505 and the whole transfer rolls back.
     */
    async transferOwnership(crewId: string, fromUserId: string, toUserId: string) {
      return withTransaction(pool, async (client) => {
        await client.query('UPDATE crew_members SET role = $1 WHERE crew_id = $2 AND user_id = $3', [
          'member',
          crewId,
          fromUserId,
        ]);
        await client.query('UPDATE crew_members SET role = $1 WHERE crew_id = $2 AND user_id = $3', [
          'owner',
          crewId,
          toUserId,
        ]);
        await client.query('UPDATE crews SET created_by = $1, updated_at = NOW() WHERE id = $2', [toUserId, crewId]);
      });
    },

    /**
     * Before an account is soft-deleted, hand each crew it owns to another active
     * member. A valid choice wins; otherwise the earliest-joined active member
     * takes over. A candidate whose transfer clashes on crews_reform_idem_uidx
     * (23505) is skipped. A crew with no usable candidate is left as it is: the
     * 30-day purge deletes a sole-member crew.
     */
    async handOverOwnedCrews(userId: string, choices: Array<{ crewId: string; newOwnerId: string }> = []) {
      const handedOver: Array<{ crewId: string; newOwnerId: string }> = [];
      const owned = await pool.query("SELECT crew_id FROM crew_members WHERE user_id = $1 AND role = 'owner'", [
        userId,
      ]);
      for (const { crew_id: crewId } of owned.rows) {
        const result = await pool.query(
          `
          SELECT
            cm.user_id
          FROM
            crew_members cm
            JOIN users u ON u.id = cm.user_id
            AND u.deleted_at IS NULL
          WHERE
            cm.crew_id = $1
            AND cm.user_id <> $2
          ORDER BY
            cm.joined_at ASC,
            cm.user_id ASC
        `,
          [crewId, userId],
        );
        const candidates: string[] = result.rows.map((r: any) => r.user_id);
        const choice = choices.find((c) => c.crewId === crewId)?.newOwnerId;
        if (choice && candidates.includes(choice)) {
          candidates.splice(candidates.indexOf(choice), 1);
          candidates.unshift(choice);
        }
        let newOwnerId: string | null = null;
        for (const candidate of candidates) {
          try {
            await crews.transferOwnership(crewId, userId, candidate);
            newOwnerId = candidate;
            break;
          } catch (err: any) {
            if (err?.code !== '23505') throw err;
          }
        }
        if (newOwnerId) handedOver.push({ crewId, newOwnerId });
        else log.warn('crew:handover-skipped', { crewId, candidates: candidates.length });
      }
      return handedOver;
    },

    async getCrewPickOverlap(festivalId: string, crewId: string) {
      const result = await pool.query(
        `
        SELECT
          fp.user_id AS "userId",
          fp.picks_json AS "picksJson",
          u.username,
          u.display_name AS "name"
        FROM
          festival_profiles fp
          JOIN crew_members cm ON cm.user_id = fp.user_id
          JOIN users u ON u.id = fp.user_id
          AND u.deleted_at IS NULL
        WHERE
          fp.festival_id = $1
          AND cm.crew_id = $2
          AND fp.deleted_at IS NULL
      `,
        [festivalId, crewId],
      );
      return result.rows;
    },

    async updateHomeBase(crewId: string, { location, time }: { location?: string; time?: string }) {
      await pool.query(
        'UPDATE crews SET home_base_location = $1, home_base_time = $2, home_base_updated_at = NOW(), updated_at = NOW() WHERE id = $3',
        [location || null, time || null, crewId],
      );
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [crewId]);
      return result.rows[0] || null;
    },

    // M6 Crew Photo Wall (Phase 1): set/clear the crew's shared-album URL. Pass
    // null (or a falsy url) to clear it. Cloned from updateHomeBase — a single
    // crew-field write that returns the refreshed crew. Member-gated at the
    // route (any member can set the album link, not owner-only).
    async updatePhotoAlbum(crewId: string, { photoAlbumUrl }: { photoAlbumUrl?: string | null }) {
      await pool.query('UPDATE crews SET photo_album_url = $1, updated_at = NOW() WHERE id = $2', [
        photoAlbumUrl || null,
        crewId,
      ]);
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [crewId]);
      return result.rows[0] || null;
    },

    async deleteByFestival(festivalId: string) {
      await pool.query('DELETE FROM crews WHERE festival_id = $1', [festivalId]);
    },
  };

  // Phase 1B: Meeting points store
  const meetingPoints = {
    async create(data: any) {
      await pool.query(
        `
        INSERT INTO
          crew_meeting_points (
            id,
            crew_id,
            created_by,
            label,
            location,
            type,
            meet_at,
            stage_reference,
            expires_at,
            latitude,
            longitude,
            recurs_daily,
            active,
            created_at,
            updated_at
          )
        VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            TRUE,
            NOW(),
            NOW()
          )
      `,
        [
          data.id,
          data.crewId,
          data.createdBy,
          sanitizeMeetingPointText(data.label, 100),
          sanitizeMeetingPointText(data.location, 200),
          data.type || 'during',
          data.meetAt || null,
          data.stageReference || null,
          data.expiresAt || null,
          data.latitude ?? null,
          data.longitude ?? null,
          data.recursDaily ?? false,
        ],
      );
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          location,
          type,
          meet_at,
          stage_reference,
          expires_at,
          latitude,
          longitude,
          recurs_daily,
          active,
          created_at,
          updated_at,
          ${MP_COMING}
        FROM
          crew_meeting_points mp
        WHERE
          id = $1
      `,
        [data.id],
      );
      return result.rows[0] || null;
    },

    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          mp.id,
          mp.crew_id,
          mp.created_by,
          mp.label,
          mp.location,
          mp.type,
          mp.meet_at,
          mp.stage_reference,
          mp.expires_at,
          mp.latitude,
          mp.longitude,
          mp.recurs_daily,
          mp.active,
          mp.created_at,
          mp.updated_at,
          u.username AS creator_name,
          ${MP_COMING}
        FROM
          crew_meeting_points mp
          JOIN users u ON u.id = mp.created_by
          AND u.deleted_at IS NULL
        WHERE
          mp.crew_id = $1
          AND mp.active = TRUE
        ORDER BY
          CASE mp.type
            WHEN 'emergency' THEN 0
            WHEN 'pre-show' THEN 1
            WHEN 'during' THEN 2
            WHEN 'post-show' THEN 3
            WHEN 'post-event' THEN 4
            ELSE 5
          END,
          mp.meet_at NULLS LAST,
          mp.created_at ASC
      `,
        [crewId],
      );
      return result.rows;
    },

    async update(id: string, fields: Record<string, any>) {
      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;
      for (const [key, val] of Object.entries(fields)) {
        const col = (
          {
            label: 'label',
            location: 'location',
            type: 'type',
            meetAt: 'meet_at',
            stageReference: 'stage_reference',
            expiresAt: 'expires_at',
            latitude: 'latitude',
            longitude: 'longitude',
            recursDaily: 'recurs_daily',
          } as Record<string, string>
        )[key];
        if (col) {
          // H3: sanitize free-text label/location on update too (see create).
          let outVal = val;
          if (key === 'label') outVal = sanitizeMeetingPointText(val, 100);
          else if (key === 'location') outVal = sanitizeMeetingPointText(val, 200);
          sets.push(col + ' = $' + idx);
          vals.push(outVal);
          idx++;
        }
      }
      if (sets.length === 0) return null;
      sets.push('updated_at = NOW()');
      vals.push(id);
      await pool.query('UPDATE crew_meeting_points SET ' + sets.join(', ') + ' WHERE id = $' + idx, vals);
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          location,
          type,
          meet_at,
          stage_reference,
          expires_at,
          latitude,
          longitude,
          recurs_daily,
          active,
          created_at,
          updated_at,
          ${MP_COMING}
        FROM
          crew_meeting_points mp
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async deactivate(id: string) {
      await pool.query('UPDATE crew_meeting_points SET active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
    },

    async getById(id: string) {
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          location,
          type,
          meet_at,
          stage_reference,
          expires_at,
          latitude,
          longitude,
          recurs_daily,
          active,
          created_at,
          updated_at,
          ${MP_COMING}
        FROM
          crew_meeting_points mp
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async countByCrew(crewId: string) {
      const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM crew_meeting_points WHERE crew_id = $1 AND active = TRUE',
        [crewId],
      );
      return result.rows[0].count;
    },

    // The updated_at >= expires_at test tells a swept point from one a user removed before its time.
    async listRecentlyExpired(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          mp.id,
          mp.crew_id,
          mp.created_by,
          mp.label,
          mp.location,
          mp.type,
          mp.meet_at,
          mp.stage_reference,
          mp.expires_at,
          mp.latitude,
          mp.longitude,
          mp.recurs_daily,
          mp.active,
          mp.created_at,
          mp.updated_at,
          u.username AS creator_name
        FROM
          crew_meeting_points mp
          JOIN users u ON u.id = mp.created_by
          AND u.deleted_at IS NULL
        WHERE
          mp.crew_id = $1
          AND mp.active = FALSE
          AND mp.recurs_daily IS NOT TRUE
          AND mp.expires_at IS NOT NULL
          AND mp.expires_at > NOW() - INTERVAL '12 hours'
          AND mp.updated_at >= mp.expires_at
        ORDER BY
          mp.meet_at DESC NULLS LAST
        LIMIT 20
      `,
        [crewId],
      );
      return result.rows;
    },

    async expireStale() {
      return pool.query(
        'UPDATE crew_meeting_points SET active = FALSE, updated_at = NOW() WHERE active = TRUE AND expires_at IS NOT NULL AND expires_at < NOW()',
      );
    },

    // 090: "I'll be there". Both directions are idempotent. Returns the point with `coming`.
    async setComing(mpId: string, crewId: string, userId: string, coming: boolean) {
      if (coming) {
        await pool.query(
          'INSERT INTO crew_meeting_point_coming (meeting_point_id, crew_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [mpId, crewId, userId],
        );
      } else {
        await pool.query('DELETE FROM crew_meeting_point_coming WHERE meeting_point_id = $1 AND user_id = $2', [
          mpId,
          userId,
        ]);
      }
      return meetingPoints.getById(mpId);
    },
  };

  // M2 logistics: Crew packing board store. Mirrors the meetingPoints sub-store
  // factory return — a flat per-crew checklist of items ("who's bringing what").
  const crewPacking = {
    async create(data: any) {
      await pool.query(
        `
        INSERT INTO
          crew_packing_items (
            id,
            crew_id,
            created_by,
            label,
            brought_by,
            claimed,
            created_at
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, NOW())
      `,
        [data.id, data.crewId, data.createdBy, data.label, data.broughtBy || null, data.claimed === true],
      );
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          brought_by,
          claimed,
          packed,
          created_at
        FROM
          crew_packing_items
        WHERE
          id = $1
      `,
        [data.id],
      );
      return result.rows[0] || null;
    },

    // One multi-row INSERT for a template or pasted list. Rows come back open.
    async createMany(crewId: string, createdBy: string, labels: string[]) {
      if (labels.length === 0) return [];
      const params: any[] = [crewId, createdBy];
      const values = labels.map((label) => {
        params.push('pack-' + randomUUID(), label);
        return `($${params.length - 1}, $1, $2, $${params.length}, NULL, false, false, NOW())`;
      });
      const result = await pool.query(
        `
        INSERT INTO
          crew_packing_items (id, crew_id, created_by, label, brought_by, claimed, packed, created_at)
        VALUES
          ${values.join(', ')}
        RETURNING
          id,
          crew_id,
          created_by,
          label,
          brought_by,
          claimed,
          packed,
          created_at
      `,
        params,
      );
      return result.rows;
    },

    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          pi.id,
          pi.crew_id,
          pi.created_by,
          pi.label,
          pi.brought_by,
          pi.claimed,
          pi.packed,
          pi.created_at,
          u.username AS creator_name
        FROM
          crew_packing_items pi
          JOIN users u ON u.id = pi.created_by
          AND u.deleted_at IS NULL
        WHERE
          pi.crew_id = $1
        ORDER BY
          pi.claimed ASC,
          pi.created_at ASC
      `,
        [crewId],
      );
      return result.rows;
    },

    async update(id: string, fields: Record<string, any>) {
      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;
      for (const [key, val] of Object.entries(fields)) {
        const col = (
          {
            label: 'label',
            broughtBy: 'brought_by',
            claimed: 'claimed',
            packed: 'packed',
          } as Record<string, string>
        )[key];
        if (col) {
          sets.push(col + ' = $' + idx);
          vals.push(val);
          idx++;
        }
      }
      if (sets.length === 0) return null;
      vals.push(id);
      await pool.query('UPDATE crew_packing_items SET ' + sets.join(', ') + ' WHERE id = $' + idx, vals);
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          brought_by,
          claimed,
          packed,
          created_at
        FROM
          crew_packing_items
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async delete(id: string) {
      await pool.query('DELETE FROM crew_packing_items WHERE id = $1', [id]);
    },

    async getById(id: string) {
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          brought_by,
          claimed,
          packed,
          created_at
        FROM
          crew_packing_items
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async countByCrew(crewId: string) {
      const result = await pool.query('SELECT COUNT(*)::int AS count FROM crew_packing_items WHERE crew_id = $1', [
        crewId,
      ]);
      return result.rows[0].count;
    },
  };

  // M2 logistics: Crew carpool / ride board store. Mirrors the crewPacking
  // sub-store factory return — a flat per-crew board of ride OFFERS ("who's
  // driving"). Cloned from crewPacking exactly.
  const crewRides = {
    async create(data: any) {
      await pool.query(
        `
        INSERT INTO
          crew_ride_offers (
            id,
            crew_id,
            created_by,
            driver,
            seats,
            depart_from,
            depart_at,
            note,
            direction,
            depart_time,
            created_at
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      `,
        [
          data.id,
          data.crewId,
          data.createdBy,
          data.driver ?? null,
          data.seats ?? null,
          data.departFrom ?? null,
          data.departAt ?? null,
          data.note ?? null,
          data.direction ?? null,
          data.departTime ?? null,
        ],
      );
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          driver,
          seats,
          depart_from,
          depart_at,
          note,
          direction,
          depart_time,
          created_at,
          ${ridePassengerIds('crew_ride_offers')}
        FROM
          crew_ride_offers
        WHERE
          id = $1
      `,
        [data.id],
      );
      return result.rows[0] || null;
    },

    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          ro.id,
          ro.crew_id,
          ro.created_by,
          ro.driver,
          ro.seats,
          ro.depart_from,
          ro.depart_at,
          ro.note,
          ro.direction,
          ro.depart_time,
          ro.created_at,
          ${ridePassengerIds('ro')},
          u.username AS creator_name
        FROM
          crew_ride_offers ro
          JOIN users u ON u.id = ro.created_by
          AND u.deleted_at IS NULL
        WHERE
          ro.crew_id = $1
        ORDER BY
          ro.created_at ASC
      `,
        [crewId],
      );
      return result.rows;
    },

    async update(id: string, fields: Record<string, any>) {
      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;
      for (const [key, val] of Object.entries(fields)) {
        const col = (
          {
            driver: 'driver',
            seats: 'seats',
            departFrom: 'depart_from',
            departAt: 'depart_at',
            note: 'note',
            direction: 'direction',
            departTime: 'depart_time',
          } as Record<string, string>
        )[key];
        if (col) {
          sets.push(col + ' = $' + idx);
          vals.push(val);
          idx++;
        }
      }
      if (sets.length === 0) return null;
      vals.push(id);
      await pool.query('UPDATE crew_ride_offers SET ' + sets.join(', ') + ' WHERE id = $' + idx, vals);
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          driver,
          seats,
          depart_from,
          depart_at,
          note,
          direction,
          depart_time,
          created_at,
          ${ridePassengerIds('crew_ride_offers')}
        FROM
          crew_ride_offers
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async delete(id: string) {
      await pool.query('DELETE FROM crew_ride_offers WHERE id = $1', [id]);
    },

    async getById(id: string) {
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          driver,
          seats,
          depart_from,
          depart_at,
          note,
          direction,
          depart_time,
          created_at,
          ${ridePassengerIds('crew_ride_offers')}
        FROM
          crew_ride_offers
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async countByCrew(crewId: string) {
      const result = await pool.query('SELECT COUNT(*)::int AS count FROM crew_ride_offers WHERE crew_id = $1', [
        crewId,
      ]);
      return result.rows[0].count;
    },

    // Returns 'full' when no seat is left, else the offer row. The row lock
    // serialises two people racing for the last seat. A repeat take succeeds.
    async takeSeat(rideId: string, userId: string) {
      const full = await withTransaction(pool, async (client) => {
        const offer = await client.query('SELECT seats, crew_id FROM crew_ride_offers WHERE id = $1 FOR UPDATE', [
          rideId,
        ]);
        const row = offer.rows[0];
        if (!row) return false;
        const taken = await client.query(
          `
          SELECT
            p.user_id
          FROM
            crew_ride_passengers p
            JOIN crew_members cm ON cm.user_id = p.user_id
            AND cm.crew_id = $2
          WHERE
            p.ride_id = $1
        `,
          [rideId, row.crew_id],
        );
        if (taken.rows.some((r: any) => r.user_id === userId)) return false;
        if (row.seats !== null && taken.rows.length >= row.seats) return true;
        await client.query(
          'INSERT INTO crew_ride_passengers (ride_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [rideId, userId],
        );
        return false;
      });
      if (full) return 'full';
      return crewRides.getById(rideId);
    },

    async leaveSeat(rideId: string, userId: string) {
      await pool.query('DELETE FROM crew_ride_passengers WHERE ride_id = $1 AND user_id = $2', [rideId, userId]);
      return crewRides.getById(rideId);
    },
  };

  // M5: Crew member status store — last-synced "on my way / ETA to [point]".
  // One row per (crew, user); upsert REPLACES the member's prior status (the
  // latest snapshot wins). This is a degraded-sync snapshot, NOT live GPS — the
  // UI renders `updated_at` as honest staleness ("as of N ago"), never "live".
  const crewStatus = {
    // Upsert the requesting member's own status. ON CONFLICT (crew_id, user_id)
    // overwrites so an offline toggle that replays simply lands the latest value.
    async upsert(data: any) {
      // 055: latitude/longitude/location_captured_at are the offline presence
      // breadcrumb (NOT live GPS). They are only overwritten when a position is
      // supplied (latitude !== undefined); a status-only update leaves the prior
      // breadcrumb intact via COALESCE so a member can clear their ETA without
      // wiping their last-known location. Default location_captured_at to NOW()
      // when a position arrives without an explicit (offline-stamped) capturedAt.
      const hasPosition = data.latitude !== undefined && data.latitude !== null;
      await pool.query(
        `
        INSERT INTO
          crew_member_status (
            crew_id,
            user_id,
            status,
            target_meeting_point_id,
            eta_minutes,
            note,
            latitude,
            longitude,
            location_captured_at,
            updated_at
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (crew_id, user_id) DO UPDATE SET
          status = EXCLUDED.status,
          target_meeting_point_id = EXCLUDED.target_meeting_point_id,
          eta_minutes = EXCLUDED.eta_minutes,
          note = EXCLUDED.note,
          latitude = COALESCE(EXCLUDED.latitude, crew_member_status.latitude),
          longitude = COALESCE(EXCLUDED.longitude, crew_member_status.longitude),
          location_captured_at = COALESCE(
            EXCLUDED.location_captured_at,
            crew_member_status.location_captured_at
          ),
          updated_at = NOW()
      `,
        [
          data.crewId,
          data.userId,
          data.status ?? null,
          data.targetMeetingPointId ?? null,
          data.etaMinutes ?? null,
          data.note ?? null,
          hasPosition ? data.latitude : null,
          hasPosition ? (data.longitude ?? null) : null,
          hasPosition ? (data.locationCapturedAt ?? null) : null,
        ],
      );
      const result = await pool.query(
        `
        SELECT
          crew_id,
          user_id,
          status,
          target_meeting_point_id,
          eta_minutes,
          note,
          latitude,
          longitude,
          location_captured_at,
          updated_at
        FROM
          crew_member_status
        WHERE
          crew_id = $1
          AND user_id = $2
      `,
        [data.crewId, data.userId],
      );
      return result.rows[0] || null;
    },

    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          s.crew_id,
          s.user_id,
          s.status,
          s.target_meeting_point_id,
          s.eta_minutes,
          s.note,
          s.latitude,
          s.longitude,
          s.location_captured_at,
          s.updated_at,
          u.username,
          u.display_name AS name,
          u.avatar_key AS avatar_key,
          u.avatar_version AS avatar_version
        FROM
          crew_member_status s
          JOIN users u ON u.id = s.user_id
          AND u.deleted_at IS NULL
          JOIN crew_members m ON m.crew_id = s.crew_id
          AND m.user_id = s.user_id
        WHERE
          s.crew_id = $1
        ORDER BY
          s.updated_at DESC
      `,
        [crewId],
      );
      return result.rows;
    },

    // GDPR export: return all status snapshots the given user has authored
    // across all their crews.
    // Includes the stored status location: it persists and crewmates can see it.
    async listByUser(userId: string) {
      const result = await pool.query(
        `
        SELECT
          s.crew_id,
          s.status,
          s.target_meeting_point_id,
          s.eta_minutes,
          s.note,
          s.latitude,
          s.longitude,
          s.location_captured_at,
          s.updated_at
        FROM
          crew_member_status s
        WHERE
          s.user_id = $1
        ORDER BY
          s.updated_at DESC
      `,
        [userId],
      );
      return result.rows;
    },

    // Stop all sharing: null the status location in every crew. updated_at is
    // left alone; clients accept an equal timestamp, so the broadcast applies.
    async clearLocationsForUser(userId: string) {
      const result = await pool.query(
        `
        UPDATE crew_member_status
        SET
          latitude = NULL,
          longitude = NULL,
          location_captured_at = NULL
        WHERE
          user_id = $1
          AND (
            latitude IS NOT NULL
            OR longitude IS NOT NULL
          )
        RETURNING
          crew_id,
          user_id,
          status,
          target_meeting_point_id,
          eta_minutes,
          note,
          latitude,
          longitude,
          location_captured_at,
          updated_at,
          EXISTS (
            SELECT
              1
            FROM
              crew_members m
            WHERE
              m.crew_id = crew_member_status.crew_id
              AND m.user_id = $1
          ) AS still_member
      `,
        [userId],
      );
      return result.rows;
    },

    // Privacy summary: crews the user still belongs to that hold a status
    // location of theirs. Never returns the coordinates.
    async listLocationsForUser(userId: string) {
      const result = await pool.query(
        `
        SELECT
          s.crew_id,
          c.name AS crew_name,
          s.location_captured_at
        FROM
          crew_member_status s
          JOIN crews c ON c.id = s.crew_id
          JOIN crew_members m ON m.crew_id = s.crew_id
          AND m.user_id = s.user_id
        WHERE
          s.user_id = $1
          AND s.latitude IS NOT NULL
        ORDER BY
          s.location_captured_at DESC NULLS LAST
      `,
        [userId],
      );
      return result.rows;
    },
  };

  // 090: which festival days each member attends. No row means no answer.
  // Rows of members who left are gone by the crew_members cascade.
  const crewDays = {
    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          d.user_id AS "userId",
          d.day_index AS "dayIndex",
          d.answer
        FROM
          crew_member_days d
          JOIN users u ON u.id = d.user_id
          AND u.deleted_at IS NULL
        WHERE
          d.crew_id = $1
        ORDER BY
          d.user_id,
          d.day_index
      `,
        [crewId],
      );
      return result.rows;
    },

    // Replaces the member's full answer set, so a replay of the same body is a no-op.
    async replaceMine(crewId: string, userId: string, days: Array<{ dayIndex: number; answer: string }>) {
      return withTransaction(pool, async (client) => {
        await client.query('DELETE FROM crew_member_days WHERE crew_id = $1 AND user_id = $2', [crewId, userId]);
        if (days.length) {
          await client.query(
            'INSERT INTO crew_member_days (crew_id, user_id, day_index, answer) SELECT $1, $2, d, a FROM unnest($3::int[], $4::text[]) AS t(d, a)',
            [crewId, userId, days.map((d) => d.dayIndex), days.map((d) => d.answer)],
          );
        }
        const result = await client.query(
          'SELECT user_id AS "userId", day_index AS "dayIndex", answer FROM crew_member_days WHERE crew_id = $1 AND user_id = $2 ORDER BY day_index',
          [crewId, userId],
        );
        return result.rows;
      });
    },

    async dayCount(crewId: string) {
      const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM festival_days WHERE festival_id = (SELECT festival_id FROM crews WHERE id = $1)',
        [crewId],
      );
      return result.rows[0].count as number;
    },
  };

  return { crews, topicSubscriptions, meetingPoints, crewPacking, crewRides, crewStatus, crewDays };
}
