// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Festival announcements (migration 091): admin notices to everyone who joined
 * a festival. sent_at is set when a worker claims a row, so a row goes out once.
 */

import type { Pool } from 'pg';

export interface AnnouncementRow {
  id: string;
  festivalId: string;
  severity: 'info' | 'urgent';
  title: string;
  body: string;
  screen: string;
  sendAt: string;
  sentAt: string | null;
  cancelledAt: string | null;
  recipientCount: number | null;
  createdBy: string | null;
  createdAt: string;
}

const iso = (v: any) => (v ? new Date(v).toISOString() : null);

function mapRow(r: any): AnnouncementRow {
  return {
    id: r.id,
    festivalId: r.festival_id,
    severity: r.severity,
    title: r.title,
    body: r.body,
    screen: r.screen,
    sendAt: iso(r.send_at)!,
    sentAt: iso(r.sent_at),
    cancelledAt: iso(r.cancelled_at),
    recipientCount: r.recipient_count ?? null,
    createdBy: r.created_by ?? null,
    createdAt: iso(r.created_at)!,
  };
}

export function createAnnouncementsStore(pool: Pool) {
  return {
    async create(a: {
      id: string;
      festivalId: string;
      severity: string;
      title: string;
      body: string;
      screen: string;
      sendAt: string;
      createdBy: string | null;
    }): Promise<AnnouncementRow> {
      const { rows } = await pool.query(
        `INSERT INTO festival_announcements (id, festival_id, severity, title, body, screen, send_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [a.id, a.festivalId, a.severity, a.title, a.body, a.screen, a.sendAt, a.createdBy],
      );
      return mapRow(rows[0]);
    },

    /** Non-cancelled rows whose send_at is less than an hour from sendAt (the per-festival limit). */
    async countNear(festivalId: string, sendAt: string): Promise<number> {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM festival_announcements
         WHERE festival_id = $1 AND cancelled_at IS NULL
           AND ABS(EXTRACT(EPOCH FROM (send_at - $2::timestamptz))) < 3600`,
        [festivalId, sendAt],
      );
      return rows[0].n;
    },

    async listForAdmin(festivalId: string): Promise<AnnouncementRow[]> {
      const { rows } = await pool.query(
        'SELECT * FROM festival_announcements WHERE festival_id = $1 ORDER BY send_at DESC LIMIT 20',
        [festivalId],
      );
      return rows.map(mapRow);
    },

    /** Banner feed: sent in the last 24 h, not cancelled, newest first, at most 3. */
    async listActive(festivalId: string): Promise<AnnouncementRow[]> {
      const { rows } = await pool.query(
        `
  SELECT
    *
  FROM
    festival_announcements
  WHERE
    festival_id = $1
    AND cancelled_at IS NULL
    AND sent_at > NOW() - INTERVAL '24 hours'
  ORDER BY
    sent_at DESC
  LIMIT
    3
`,
        [festivalId],
      );
      return rows.map(mapRow);
    },

    /** Cancel unsent rows more than 30 minutes past send_at: a late "gates open in 10 minutes" must not go out. */
    async expireLate(): Promise<number> {
      const { rowCount } = await pool.query(
        `
  UPDATE festival_announcements
  SET
    cancelled_at = NOW()
  WHERE
    sent_at IS NULL
    AND cancelled_at IS NULL
    AND send_at < NOW() - INTERVAL '30 minutes'
`,
      );
      return rowCount ?? 0;
    },

    /** Mark due rows sent and return them. SKIP LOCKED lets parallel workers claim disjoint rows. */
    async claimDue(limit = 10): Promise<AnnouncementRow[]> {
      const { rows } = await pool.query(
        `
  UPDATE festival_announcements
  SET
    sent_at = NOW()
  WHERE
    id IN (
      SELECT
        id
      FROM
        festival_announcements
      WHERE
        sent_at IS NULL
        AND cancelled_at IS NULL
        AND send_at <= NOW()
      ORDER BY
        send_at
      LIMIT
        $1
      FOR UPDATE
        SKIP LOCKED
    )
  RETURNING
    *
`,
        [limit],
      );
      return rows.map(mapRow);
    },

    async setRecipientCount(id: string, n: number): Promise<void> {
      await pool.query('UPDATE festival_announcements SET recipient_count = $2 WHERE id = $1', [id, n]);
    },

    /** Idempotent: a second cancel keeps the first cancelled_at. Null when no row in this festival. */
    async cancel(festivalId: string, id: string): Promise<AnnouncementRow | null> {
      const { rows } = await pool.query(
        `
  UPDATE festival_announcements
  SET
    cancelled_at = COALESCE(cancelled_at, NOW())
  WHERE
    id = $2
    AND festival_id = $1
  RETURNING
    *
`,
        [festivalId, id],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    },
  };
}
