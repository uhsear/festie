import type { Pool } from 'pg';
import { withTransaction } from '../connection';
import { buildUpdate } from '../utils';

/**
 * 080: a ride's passengers, oldest seat first. The crew_members join drops
 * people who left the crew, so their seat frees up without a cleanup job.
 * `offer` is a fixed table name or alias from this file, never user input.
 */
function ridePassengerIds(offer: string) {
  return `COALESCE(ARRAY(SELECT p.user_id FROM crew_ride_passengers p JOIN crew_members cm ON cm.user_id = p.user_id AND cm.crew_id = ${offer}.crew_id WHERE p.ride_id = ${offer}.id ORDER BY p.created_at), '{}') AS passenger_ids`;
}

export function createCrewRidesStore(pool: Pool) {
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
      const sets: Array<[string, unknown]> = [];
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
          sets.push([col, val]);
        }
      }
      if (sets.length === 0) return null;
      const q = buildUpdate('crew_ride_offers', sets, id);
      await pool.query(q.text, q.values);
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

  return crewRides;
}
