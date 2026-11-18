// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Per-date set-time releases (festival_time_releases, migration 106). A row is the claim for one
 * festival date: the route claims first, then enqueues the send, and the executor stamps `sent_at`.
 */

import type { Pool } from 'pg';

/** A claim older than this with no `sent_at` is stuck, and the admin may reclaim it. */
export const STUCK_AFTER_MINUTES = 10;

export type ClaimedRelease = { date: string; eventKey: string };

export function createTimeReleasesStore(pool: Pool) {
  return {
    /** Every release row of a festival, oldest date first. */
    async list(festivalId: string) {
      const { rows } = await pool.query(
        `
  SELECT
    day_date AS date,
    event_key AS "eventKey",
    note,
    claimed_at AS "claimedAt",
    sent_at AS "sentAt",
    recipients
  FROM
    festival_time_releases
  WHERE
    festival_id = $1
  ORDER BY
    day_date
`,
        [festivalId],
      );
      return rows as Array<{
        date: string;
        eventKey: string;
        note: string | null;
        claimedAt: Date;
        sentAt: Date | null;
        recipients: number | null;
      }>;
    },

    /** The dates that have a release row, claimed or sent. A set timed on one of them alerts its pickers. */
    async releasedDates(festivalId: string): Promise<Set<string>> {
      const { rows } = await pool.query('SELECT day_date AS date FROM festival_time_releases WHERE festival_id = $1', [
        festivalId,
      ]);
      return new Set(rows.map((r: any) => r.date));
    },

    /**
     * Claim dates in one statement. A date that already has a row is not returned, so two requests
     * for one date cannot both win. `eventKey` is shared by every row this request claims.
     */
    async claim(festivalId: string, dates: string[], eventKey: string, note: string | null): Promise<ClaimedRelease[]> {
      const { rows } = await pool.query(
        `
  INSERT INTO
    festival_time_releases (festival_id, day_date, event_key, note)
  SELECT
    $1,
    d,
    $2,
    $3
  FROM
    unnest($4::text[]) AS d
  ON CONFLICT DO NOTHING
  RETURNING
    day_date AS date,
    event_key AS "eventKey"
`,
        [festivalId, eventKey, note, dates],
      );
      return rows;
    },

    /** Take over this request's dates whose earlier claim never finished. The row keeps its stored key. */
    async reclaimStuck(festivalId: string, dates: string[]): Promise<ClaimedRelease[]> {
      const { rows } = await pool.query(
        `
  UPDATE
    festival_time_releases
  SET
    claimed_at = NOW()
  WHERE
    festival_id = $1
    AND day_date = ANY($2::text[])
    AND sent_at IS NULL
    AND claimed_at < NOW() - make_interval(mins => $3)
  RETURNING
    day_date AS date,
    event_key AS "eventKey"
`,
        [festivalId, dates, STUCK_AFTER_MINUTES],
      );
      return rows;
    },
  };
}
