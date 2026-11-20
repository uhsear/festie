import type { Pool, QueryResultRow } from 'pg';
import { withTransaction } from '../connection';
import { buildUpdate } from '../utils';
import { createLogger } from '../../logger.js';
import { createTopicSubscriptionsStore } from './crews-topic-subs.js';
import { createMeetingPointsStore } from './crews-meeting-points.js';
import { createCrewPackingStore } from './crews-packing.js';
import { createCrewRidesStore } from './crews-rides.js';
import { createCrewStatusStore } from './crews-status.js';
import { createCrewDaysStore } from './crews-days.js';

const log = createLogger('db:crews');

type NewCrew = {
  id: string;
  festivalId: string;
  name: string;
  createdBy: string;
  inviteCode: string;
  inviteExpiresAt?: string | null;
  maxMembers: number;
  reformedFrom?: string | null;
  totemName?: string | null;
  totemEmoji?: string | null;
};

type CrewUpdate = {
  id: string;
  name: string;
  maxMembers: number;
  totemName?: string | null;
  totemEmoji?: string | null;
  inviteLocked?: boolean;
};

type NewCrewMember = { crewId: string; userId: string; role: string };

export default function createCrewsStore(pool: Pool, _utils: unknown) {
  const CREW_COLUMNS =
    'id, festival_id AS "festivalId", name, created_by AS "createdBy", invite_code AS "inviteCode", invite_expires_at AS "inviteExpiresAt", max_members AS "maxMembers", reformed_from AS "reformedFrom", home_base_location AS "homeBaseLocation", home_base_time AS "homeBaseTime", home_base_updated_at AS "homeBaseUpdatedAt", photo_album_url AS "photoAlbumUrl", totem_name AS "totemName", totem_emoji AS "totemEmoji", invite_locked AS "inviteLocked", home_base_plan_b AS "homeBasePlanB", created_at AS "createdAt", updated_at AS "updatedAt"';

  // Phase 7: Crew system store
  const crews = {
    meetingPoints: createMeetingPointsStore(pool),

    async create(data: NewCrew) {
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
    async createWithOwner(data: NewCrew) {
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

    async update(data: CrewUpdate) {
      const sets: Array<[string, unknown]> = [
        ['name', data.name],
        ['max_members', data.maxMembers],
      ];
      // Totem fields follow the optional-field pattern: only written when the
      // caller supplies them, so an update that omits them leaves the crew's
      // existing totem untouched.
      if (data.totemName !== undefined) sets.push(['totem_name', data.totemName]);
      if (data.totemEmoji !== undefined) sets.push(['totem_emoji', data.totemEmoji]);
      if (data.inviteLocked !== undefined) sets.push(['invite_locked', data.inviteLocked]);
      const q = buildUpdate('crews', sets, data.id, { rawSets: ['updated_at = NOW()'] });
      await pool.query(q.text, q.values);
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
          c.invite_locked AS "inviteLocked",
          c.home_base_plan_b AS "homeBasePlanB",
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
          c.invite_locked AS "inviteLocked",
          c.home_base_plan_b AS "homeBasePlanB",
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
     * With `opts.inviteJoin` (the invite-code join) a locked crew returns
     * 'locked' (no insert), read under the same row lock so a lock flip cannot
     * race the join. Admin force-add and reform pass no opts and ignore the lock.
     * Without a cap (owner creation, reform) it's a plain insert.
     */
    async addMember(
      data: NewCrewMember,
      maxMembers?: number,
      opts?: { inviteJoin?: boolean },
    ): Promise<'added' | 'full' | 'locked'> {
      if (typeof maxMembers === 'number') {
        return withTransaction(pool, async (client) => {
          // Lock the crew row; all capped joiners for this crew serialize here.
          const lockRes = await client.query('SELECT invite_locked FROM crews WHERE id = $1 FOR UPDATE', [data.crewId]);
          if (opts?.inviteJoin && lockRes.rows[0]?.invite_locked) return 'locked';
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
    async getMembersForCrews(crewIds: string[]): Promise<Map<string, QueryResultRow[]>> {
      const membersByCrewId = new Map<string, QueryResultRow[]>();
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
      return Number(result.rows[0]?.count ?? 0);
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
      const ownedIds: string[] = owned.rows.map((r) => r.crew_id);
      if (ownedIds.length === 0) return handedOver;
      const members = await pool.query(
        `
          SELECT
            cm.crew_id,
            cm.user_id
          FROM
            crew_members cm
            JOIN users u ON u.id = cm.user_id
            AND u.deleted_at IS NULL
          WHERE
            cm.crew_id = ANY ($1::text[])
            AND cm.user_id <> $2
          ORDER BY
            cm.joined_at ASC,
            cm.user_id ASC
        `,
        [ownedIds, userId],
      );
      for (const crewId of ownedIds) {
        const candidates: string[] = members.rows.filter((r) => r.crew_id === crewId).map((r) => r.user_id);
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
          } catch (err) {
            if ((err as { code?: string } | null)?.code !== '23505') throw err;
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

    // 096: `planB` undefined keeps the stored Plan B; null or '' clears it. A
    // Home Base with no location always clears it, so old clients that remove
    // Home Base with { location: null, time: null } leave no hidden Plan B.
    async updateHomeBase(
      crewId: string,
      { location, time, planB }: { location?: string | null; time?: string | null; planB?: string | null },
    ) {
      if (location && planB === undefined) {
        await pool.query(
          'UPDATE crews SET home_base_location = $1, home_base_time = $2, home_base_updated_at = NOW(), updated_at = NOW() WHERE id = $3',
          [location, time || null, crewId],
        );
      } else {
        await pool.query(
          'UPDATE crews SET home_base_location = $1, home_base_time = $2, home_base_plan_b = $3, home_base_updated_at = NOW(), updated_at = NOW() WHERE id = $4',
          [location || null, time || null, location ? planB || null : null, crewId],
        );
      }
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

  return {
    crews,
    topicSubscriptions: createTopicSubscriptionsStore(pool),
    meetingPoints: crews.meetingPoints,
    crewPacking: createCrewPackingStore(pool),
    crewRides: createCrewRidesStore(pool),
    crewStatus: createCrewStatusStore(pool),
    crewDays: createCrewDaysStore(pool),
  };
}
