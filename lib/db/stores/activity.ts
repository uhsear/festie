import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

/** Write a feed row, then push it to the crew room. Never throws: a feed failure must not fail the request. */
export function logCrewActivity(
  { stores, emitter }: any,
  entry: { crewId: string; userId: string; type: string; detail?: string | null },
) {
  return Promise.resolve()
    .then(() => stores.activity.log(entry))
    .then((id: string) => emitter?.crewActivityLogged({ crewId: entry.crewId, item: { id, ...entry } }))
    .catch(() => {});
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
      // Cursor is `<created_at ISO>|<id>`; one without `|` is ignored (first page).
      const sep = typeof cursor === 'string' ? cursor.lastIndexOf('|') : -1;
      if (sep > 0) {
        cursorClause = 'AND (a.created_at, a.id) < ($3::timestamptz, $4)';
        params.push(cursor.slice(0, sep), cursor.slice(sep + 1));
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
      const hasMore = rows.length > limit;
      if (hasMore) rows.pop();
      return {
        items: rows,
        nextCursor: hasMore
          ? `${new Date(rows[rows.length - 1].created_at).toISOString()}|${rows[rows.length - 1].id}`
          : null,
      };
    },
  };
}
