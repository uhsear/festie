import type { Pool } from 'pg';
import { buildUpdate } from '../utils';
import { sanitizeString } from '../../helpers/sanitize.js';

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
 * 090: user ids of members who tapped "I'll be there" on meeting point `mp`,
 * oldest tap first. Deleted users drop out. A fixed SQL fragment, no input.
 */
const MP_COMING = `COALESCE((SELECT array_agg(c.user_id ORDER BY c.created_at) FROM crew_meeting_point_coming c JOIN users u ON u.id = c.user_id AND u.deleted_at IS NULL WHERE c.meeting_point_id = mp.id), '{}') AS coming`;

/**
 * 096: username of the member who made the last time or place edit of
 * meeting point `mp`. Null when the editor is soft-deleted or gone. A fixed
 * SQL fragment, no input.
 */
const MP_EDITOR = '(SELECT e.username FROM users e WHERE e.id = mp.edited_by AND e.deleted_at IS NULL) AS editor_name';

export function createMeetingPointsStore(pool: Pool) {
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
          edited_by,
          edited_at,
          edit_was,
          ${MP_COMING},
          ${MP_EDITOR}
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
          mp.edited_by,
          mp.edited_at,
          mp.edit_was,
          u.username AS creator_name,
          ${MP_COMING},
          ${MP_EDITOR}
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
      const sets: Array<[string, unknown] | [string, unknown, string]> = [];
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
            // 096: written only by the PUT route from req.user, never from a client body.
            editedBy: 'edited_by',
            editedAt: 'edited_at',
            editWas: 'edit_was',
          } as Record<string, string>
        )[key];
        if (col) {
          // H3: sanitize free-text label/location on update too (see create).
          let outVal = val;
          if (key === 'label') outVal = sanitizeMeetingPointText(val, 100);
          else if (key === 'location') outVal = sanitizeMeetingPointText(val, 200);
          if (key === 'editWas') sets.push([col, val == null ? null : JSON.stringify(val), '::jsonb']);
          else sets.push([col, outVal]);
        }
      }
      if (sets.length === 0) return null;
      const q = buildUpdate('crew_meeting_points', sets, id, { rawSets: ['updated_at = NOW()'] });
      await pool.query(q.text, q.values);
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
          edited_by,
          edited_at,
          edit_was,
          ${MP_COMING},
          ${MP_EDITOR}
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
          edited_by,
          edited_at,
          edit_was,
          ${MP_COMING},
          ${MP_EDITOR}
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

  return meetingPoints;
}
