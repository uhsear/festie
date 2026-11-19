import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { decodeTimeIdCursor, encodeTimeIdCursor, takePage } from '../../pagination';

/** Write a feed row, then push it to the crew room. Never throws: a feed failure is logged and must not fail the request. */
export function logCrewActivity(
  { stores, emitter, log }: any,
  entry: { crewId: string; userId: string; type: string; detail?: string | null },
) {
  return Promise.resolve()
    .then(() => stores.activity.log(entry))
    .then((id: string) => emitter?.crewActivityLogged({ crewId: entry.crewId, item: { id, ...entry } }))
    .catch((err: any) => log?.warn('crew activity log failed', { crewId: entry.crewId, type: entry.type, error: err?.message }));
}

export function createActivityStore(pool: Pool) {
  return {
    async log({ crewId, userId, type, detail }: any) {
      const id = randomUUID();
      await pool.query(
        `
  INSERT INTO
    crew_activity (id, crew_id, user_id, type, detail, created_at)
  VALUES
    ($1, $2, $3, $4, $5, NOW())
`,
        [id, crewId, userId, type, detail || null],
      );
      // Return the generated id so callers (e.g. SOS) can reference the durable
      // row in their broadcast payload. Existing callers ignore the return.
      return id;
    },

    async getByCrew(crewId: string, { cursor, limit = 50 }: any = {}) {
      const params: any[] = [crewId, limit + 1];
      let cursorClause = '';
      const decoded = decodeTimeIdCursor(cursor);
      if (decoded) {
        cursorClause = 'AND (a.created_at, a.id) < ($3::timestamptz, $4)';
        params.push(decoded.createdAt, decoded.id);
      }
      const { rows } = await pool.query(
        `SELECT a.id, a.crew_id, a.user_id, a.type, a.detail, a.created_at, u.username
         FROM crew_activity a
         JOIN users u ON u.id = a.user_id AND u.deleted_at IS NULL
         WHERE a.crew_id = $1
         ${cursorClause}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT $2`,
        params,
      );
      return takePage(rows, limit, (r) => encodeTimeIdCursor(r.created_at, r.id));
    },
  };
}
