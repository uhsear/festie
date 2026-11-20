import type { Pool } from 'pg';

export function createCrewStatusStore(pool: Pool) {
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
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE(GREATEST(LEAST($10::timestamptz, NOW()), NOW() - INTERVAL '24 hours'), NOW()))
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
          updated_at = EXCLUDED.updated_at
        WHERE crew_member_status.updated_at <= EXCLUDED.updated_at
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
          data.capturedAt ?? null,
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

  return crewStatus;
}
