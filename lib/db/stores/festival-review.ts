// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The review of an organizer's publish request and the hold on attendee alerts (migration 108).
 *
 * A publish request is two columns on the festival. A held alert is a row per set in
 * festival_held_schedule_changes: an organizer's save that would push to attendees writes its changes
 * there instead, and an admin later releases or discards them (plan-v3 6.2).
 */

import type { Pool } from 'pg';
import { withTransaction } from '../connection.js';
import type { ScheduleChange } from '../../schedule-diff.js';

const ENTRY_PREFIX = 'entry:';

/** What a release needs to hand to emitter.scheduleChanged. */
export type HeldAlert = {
  changes: ScheduleChange[];
  pickersBySet: Map<string, string[]>;
  /** People whose open mark is on a cancelled act. Absent when the change has none (an import). */
  interestedByEntry?: Map<string, string[]>;
};

type HeldRow = {
  set_id: string;
  kind: 'moved' | 'removed' | 'entry_cancelled';
  artist: string;
  before_slot: unknown;
  after_slot: unknown;
  picker_ids: string[];
  interest_holder_ids: string[];
  covered_set_ids: string[];
};

/**
 * Rebuilds the alert from the held rows. A set that moved and then moved back (its first slot equals its last)
 * alerts nobody, so its row is left out. Returns null when nothing is left to send.
 */
export function heldRowsToAlert(rows: HeldRow[]): HeldAlert | null {
  const alert: HeldAlert = { changes: [], pickersBySet: new Map(), interestedByEntry: new Map() };
  for (const row of rows) {
    if (row.kind === 'entry_cancelled') {
      const entryId = row.set_id.slice(ENTRY_PREFIX.length);
      alert.changes.push({ kind: 'entry_cancelled', entryId, artist: row.artist, setIds: row.covered_set_ids });
      alert.interestedByEntry!.set(entryId, row.interest_holder_ids);
    } else if (row.kind === 'removed') {
      alert.changes.push({ kind: 'removed', setId: row.set_id, artist: row.artist });
      alert.pickersBySet.set(row.set_id, row.picker_ids);
    } else if (JSON.stringify(row.before_slot) !== JSON.stringify(row.after_slot) && row.before_slot && row.after_slot) {
      alert.changes.push({ kind: 'moved', setId: row.set_id, artist: row.artist, before: row.before_slot as any, after: row.after_slot as any });
      alert.pickersBySet.set(row.set_id, row.picker_ids);
    }
  }
  return alert.changes.length > 0 ? alert : null;
}

export function createFestivalReviewStore(pool: Pool) {
  return {
    /** The review state of a festival: a pending request, or the note of the last decline. Null when the festival is missing. */
    async reviewState(festivalId: string) {
      const { rows } = await pool.query(
        `
  SELECT
    publish_requested_at AS "requestedAt",
    publish_review_note AS "note"
  FROM
    festivals
  WHERE
    id = $1
`,
        [festivalId],
      );
      return (rows[0] as { requestedAt: Date | null; note: string | null } | undefined) ?? null;
    },

    /**
     * Marks a draft as waiting for review and clears the last decline note. A second request keeps the first
     * time and reports `already`. Null when the festival is live, deleted or missing.
     */
    async requestPublish(festivalId: string) {
      const { rows } = await pool.query(
        `WITH prior AS (
           SELECT publish_requested_at FROM festivals
            WHERE id = $1 AND published_at IS NULL AND deleted_at IS NULL FOR UPDATE
         )
         UPDATE festivals f
            SET publish_requested_at = COALESCE(prior.publish_requested_at, NOW()), publish_review_note = NULL
           FROM prior
          WHERE f.id = $1
          RETURNING f.publish_requested_at AS "requestedAt", prior.publish_requested_at IS NOT NULL AS "already"`,
        [festivalId],
      );
      return (rows[0] as { requestedAt: Date; already: boolean } | undefined) ?? null;
    },

    /** Takes a waiting request back. False when none was waiting. */
    async withdrawPublish(festivalId: string) {
      const { rowCount } = await pool.query(
        'UPDATE festivals SET publish_requested_at = NULL WHERE id = $1 AND publish_requested_at IS NOT NULL AND published_at IS NULL',
        [festivalId],
      );
      return (rowCount ?? 0) > 0;
    },

    /** Declines a waiting request with a note. Null when no request was waiting. */
    async declinePublish(festivalId: string, note: string) {
      const { rows } = await pool.query(
        `
  UPDATE festivals
  SET
    publish_requested_at = NULL,
    publish_review_note = $2
  WHERE
    id = $1
    AND publish_requested_at IS NOT NULL
    AND published_at IS NULL
    AND deleted_at IS NULL
  RETURNING
    name,
    organization_id AS "organizationId"
`,
        [festivalId, note],
      );
      return (rows[0] as { name: string; organizationId: string | null } | undefined) ?? null;
    },

    /** Requests that wait for a decision, oldest first. */
    async reviewQueue() {
      const { rows } = await pool.query(
        `
  SELECT
    f.id AS "festivalId",
    f.name,
    f.organization_id AS "organizationId",
    o.name AS "organizationName",
    (o.verified_at IS NOT NULL) AS "verified",
    f.publish_requested_at AS "requestedAt"
  FROM
    festivals f
    LEFT JOIN organizations o ON o.id = f.organization_id
  WHERE
    f.publish_requested_at IS NOT NULL
    AND f.published_at IS NULL
    AND f.deleted_at IS NULL
  ORDER BY
    f.publish_requested_at,
    f.id
  LIMIT
    200
`,
      );
      return rows;
    },

    /**
     * What organization members changed on live festivals in the last 14 days, newest first, for the admin review
     * list (plan-v3 6.3). Publish requests are left out: the queue above them already lists those.
     */
    async recentOrganizerEdits(limit = 30) {
      const { rows } = await pool.query(
        `
  SELECT
    a.id,
    a.created_at AS "createdAt",
    a.action,
    a.target_id AS "festivalId",
    f.name,
    a.organization_id AS "organizationId",
    o.name AS "organizationName",
    a.details_json AS "details"
  FROM
    audit_log a
    JOIN festivals f ON f.id = a.target_id AND f.published_at IS NOT NULL AND f.deleted_at IS NULL
    LEFT JOIN organizations o ON o.id = a.organization_id
  WHERE
    a.actor_type = 'organizer'
    AND a.target_type = 'festival'
    AND a.action LIKE 'festival.%'
    AND a.action NOT IN ('festival.publish_requested', 'festival.publish_withdrawn')
    AND a.created_at > NOW() - INTERVAL '14 days'
  ORDER BY
    a.created_at DESC,
    a.id DESC
  LIMIT
    $1
`,
        [limit],
      );
      // audit_log.details_json is text, so parse it the way the audit store does.
      return rows.map((row: any) => {
        try {
          return { ...row, details: row.details ? JSON.parse(row.details) : null };
        } catch {
          return { ...row, details: null };
        }
      });
    },

    /** When the festival was last edited by a form save, and by whom. Read for the 409 body. */
    async editInfo(festivalId: string) {
      const { rows } = await pool.query(
        'SELECT COALESCE(edited_at, updated_at) AS "editedAt", updated_by AS "updatedBy" FROM festivals WHERE id = $1',
        [festivalId],
      );
      return (rows[0] as { editedAt: Date; updatedBy: string | null } | undefined) ?? null;
    },

    /**
     * Holds the changes of one save for an admin to release. A change nobody would hear about is dropped.
     * Each save merges into the row of its set: the first before-slot stays, the latest kind, artist and
     * after-slot win, and the people are united. Returns how many rows the festival now holds for this save
     * and how many people would hear.
     */
    async hold(festivalId: string, alert: HeldAlert) {
      const people = new Set<string>();
      let held = 0;
      await withTransaction(pool, async (client) => {
        for (const change of alert.changes) {
          const pickers = change.kind === 'entry_cancelled' ? [] : [...new Set(alert.pickersBySet.get(change.setId) ?? [])];
          const interested = change.kind === 'entry_cancelled' ? [...new Set(alert.interestedByEntry?.get(change.entryId) ?? [])] : [];
          if (pickers.length + interested.length === 0) continue;
          held++;
          for (const id of [...pickers, ...interested]) people.add(id);
          const key = change.kind === 'entry_cancelled' ? `${ENTRY_PREFIX}${change.entryId}` : change.setId;
          await client.query(
            `INSERT INTO festival_held_schedule_changes AS h
               (festival_id, set_id, kind, artist, before_slot, after_slot, picker_ids, interest_holder_ids, covered_set_ids)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::text[], $8::text[], $9::text[])
             ON CONFLICT (festival_id, set_id) DO UPDATE SET
               kind = EXCLUDED.kind,
               artist = EXCLUDED.artist,
               before_slot = COALESCE(h.before_slot, EXCLUDED.before_slot),
               after_slot = EXCLUDED.after_slot,
               picker_ids = ARRAY(SELECT DISTINCT x FROM unnest(h.picker_ids || EXCLUDED.picker_ids) AS x),
               interest_holder_ids = ARRAY(SELECT DISTINCT x FROM unnest(h.interest_holder_ids || EXCLUDED.interest_holder_ids) AS x),
               covered_set_ids = ARRAY(SELECT DISTINCT x FROM unnest(h.covered_set_ids || EXCLUDED.covered_set_ids) AS x),
               updated_at = NOW()`,
            [
              festivalId,
              key,
              change.kind,
              change.artist,
              change.kind === 'moved' ? JSON.stringify(change.before) : null,
              change.kind === 'moved' ? JSON.stringify(change.after) : null,
              pickers,
              interested,
              change.kind === 'entry_cancelled' ? (change.setIds ?? []) : [],
            ],
          );
        }
      });
      return { held, people: people.size };
    },

    /**
     * Claims the once-a-day lineup announcement of a festival for an organization: the claim id, or null when one was
     * taken in the last 24 hours. The advisory lock makes two requests at once count each other. Release the claim
     * when the send fails, so the organization can try again.
     */
    async claimLineupAnnounce(festivalId: string): Promise<number | null> {
      return withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`lineup-announce:${festivalId}`]);
        const { rows: taken } = await client.query(
          "SELECT 1 FROM festival_lineup_announce_claims WHERE festival_id = $1 AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1",
          [festivalId],
        );
        if (taken.length > 0) return null;
        await client.query("DELETE FROM festival_lineup_announce_claims WHERE created_at < NOW() - INTERVAL '2 days'");
        const { rows } = await client.query('INSERT INTO festival_lineup_announce_claims (festival_id) VALUES ($1) RETURNING id', [festivalId]);
        return Number(rows[0].id);
      });
    },

    async releaseLineupAnnounce(claimId: number): Promise<void> {
      await pool.query('DELETE FROM festival_lineup_announce_claims WHERE id = $1', [claimId]);
    },

    /**
     * Takes one moved-set alert run for a festival, for a verified organization: false when `cap` runs already went
     * out in the last hour. The advisory lock makes two saves at once count each other.
     */
    async takeAlertRun(festivalId: string, cap: number): Promise<boolean> {
      return withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`schedule-alert:${festivalId}`]);
        const { rows } = await client.query(
          `
  SELECT
    COUNT(*)::int AS n
  FROM
    festival_schedule_alert_runs
  WHERE
    festival_id = $1
    AND created_at > NOW() - INTERVAL '1 hour'
`,
          [festivalId],
        );
        if (rows[0].n >= cap) return false;
        await client.query('INSERT INTO festival_schedule_alert_runs (festival_id) VALUES ($1)', [festivalId]);
        return true;
      });
    },

    /** How many more runs a verified organization's festival may send this hour. */
    async alertRunsLeft(festivalId: string, cap: number): Promise<number> {
      const { rows } = await pool.query(
        `
  SELECT
    COUNT(*)::int AS n
  FROM
    festival_schedule_alert_runs
  WHERE
    festival_id = $1
    AND created_at > NOW() - INTERVAL '1 hour'
`,
        [festivalId],
      );
      return Math.max(0, cap - rows[0].n);
    },

    async listHeld() {
      const { rows } = await pool.query(
        `
  SELECT
    h.festival_id AS "festivalId",
    f.name,
    f.organization_id AS "organizationId",
    o.name AS "organizationName",
    COUNT(*)::int AS "changes",
    (
      SELECT
        COUNT(DISTINCT x)::int
      FROM
        festival_held_schedule_changes h2,
        unnest(h2.picker_ids || h2.interest_holder_ids) AS x
      WHERE
        h2.festival_id = h.festival_id
    ) AS "people",
    -- What each held change is, so the admin sees what Send alert would tell people.
    jsonb_agg(
      jsonb_build_object('kind', h.kind, 'artist', h.artist, 'before', h.before_slot, 'after', h.after_slot)
      ORDER BY
        h.artist,
        h.set_id
    ) AS "items",
    MAX(h.updated_at) AS "updatedAt"
  FROM
    festival_held_schedule_changes h
    JOIN festivals f ON f.id = h.festival_id
    LEFT JOIN organizations o ON o.id = f.organization_id
  GROUP BY
    h.festival_id,
    f.name,
    f.organization_id,
    o.name
  ORDER BY
    MAX(h.updated_at),
    h.festival_id
  LIMIT
    200
`,
      );
      return rows;
    },

    /**
     * Takes every held row of a festival out of the table and returns the alert they make. The delete is the
     * claim, so two admins who press Send at once cannot both send. `rows` counts what was held, `alert` is
     * null when only moved-back sets were left.
     */
    async claimHeld(festivalId: string): Promise<{ rows: number; alert: HeldAlert | null }> {
      const { rows } = await pool.query(
        `
  DELETE FROM festival_held_schedule_changes
  WHERE
    festival_id = $1
  RETURNING
    set_id,
    kind,
    artist,
    before_slot,
    after_slot,
    picker_ids,
    interest_holder_ids,
    covered_set_ids
`,
        [festivalId],
      );
      return { rows: rows.length, alert: heldRowsToAlert(rows as HeldRow[]) };
    },
  };
}
