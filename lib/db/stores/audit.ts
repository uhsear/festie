import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

// New audit action names live here so a later rename touches one place.
export const AUDIT_ACTION_USER_PRIVATE_DATA_VIEWED = 'user.private_data.viewed';
export const AUDIT_ACTION_CREW_ADD_MEMBER = 'crew_add_member';

const ROW_COLUMNS = `
  id,
  actor_type AS "actorType",
  actor_id AS "actorId",
  action,
  target_type AS "targetType",
  target_id AS "targetId",
  details_json AS "detailsJson",
  ip,
  user_agent AS "userAgent",
  request_id AS "requestId",
  status,
  created_at AS "createdAt"
`;

function withDetails(row: any) {
  let details = null;
  if (row.detailsJson) {
    if (typeof row.detailsJson === 'object') {
      details = row.detailsJson;
    } else {
      try { details = JSON.parse(row.detailsJson); } catch { details = null; }
    }
  }
  return { ...row, details };
}

export default function createAuditStore(pool: Pool, _utils: any) {
  const auditLog = {
    async insert(entry: any) {
      const id = entry.id || randomUUID();
      const actorType = entry.actor_type || entry.actorType || 'unknown';
      const actorId = entry.actor_id || entry.actorId || null;
      const targetType = entry.target_type || entry.targetType || 'unknown';
      const targetId = entry.target_id || entry.targetId || null;
      let detailsJson = null;
      if (entry.details_json || entry.detailsJson) {
        detailsJson = typeof entry.details_json === 'string' ? entry.details_json : JSON.stringify(entry.details_json || entry.detailsJson);
      }

      const userAgent = entry.user_agent || entry.userAgent || null;
      const requestId = entry.request_id || entry.requestId || null;
      const status = entry.status || 'success';

      await pool.query(`
        INSERT INTO
          audit_log (
            id,
            actor_type,
            actor_id,
            action,
            target_type,
            target_id,
            details_json,
            ip,
            user_agent,
            request_id,
            status,
            created_at
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
            NOW()
          )
      `, [id, actorType, actorId, entry.action, targetType, targetId, detailsJson, entry.ip || null, userAgent, requestId, status]);

      return id;
    },

    async query({ actorId, actorType, action, resourceType, from, to, limit = 50, cursor = null }: any = {}) {
      const maxLimit = 200;
      const finalLimit = Math.min(Math.max(1, limit || 50), maxLimit);

      // Keyset cursor is `${createdAt ISO}|${id}` so pagination walks the same
      // (created_at DESC, id DESC) order as the ORDER BY below -- id alone is a
      // random UUID (see insert()/randomUUID()) with no time ordering, so a
      // single-column id sort/cursor scrambled history. A stale pre-fix cursor
      // (bare id, no '|') has no createdAt half and is dropped, so callers
      // holding one just restart from page 1 instead of crashing the cast.
      let cursorCreatedAt: string | null = null;
      let cursorId: string | null = null;
      if (typeof cursor === 'string' && cursor.includes('|')) {
        const sep = cursor.indexOf('|');
        cursorCreatedAt = cursor.slice(0, sep) || null;
        cursorId = cursor.slice(sep + 1) || null;
      }

      const params: any[] = [
        actorId || null,
        action || null,
        resourceType || null,
        from || null,
        to || null,
        cursorCreatedAt,
        cursorId,
        finalLimit,
        actorType || null,
      ];

      const result = await pool.query(`
        SELECT ${ROW_COLUMNS}
        FROM audit_log
        WHERE ($1::TEXT IS NULL OR actor_id = $1::TEXT)
          AND ($2::TEXT IS NULL OR starts_with(action, $2::TEXT))
          AND ($3::TEXT IS NULL OR target_type = $3::TEXT)
          AND ($4::TIMESTAMPTZ IS NULL OR created_at >= $4::TIMESTAMPTZ)
          AND ($5::TIMESTAMPTZ IS NULL OR created_at <= $5::TIMESTAMPTZ)
          AND ($6::TIMESTAMPTZ IS NULL OR (created_at, id) < ($6::TIMESTAMPTZ, $7::TEXT))
          AND ($9::TEXT IS NULL OR actor_type = $9::TEXT)
        ORDER BY created_at DESC, id DESC
        LIMIT $8
      `, params);

      const rows = result.rows.map(withDetails);

      const nextCursor = rows.length === finalLimit
        ? `${new Date(rows[rows.length - 1].createdAt).toISOString()}|${rows[rows.length - 1].id}`
        : null;

      return { rows, nextCursor };
    },

    async count({ actorId, actorType, action, resourceType, from, to }: any = {}) {
      const params: any[] = [
        actorId || null,
        action || null,
        resourceType || null,
        from || null,
        to || null,
        actorType || null,
      ];

      const result = await pool.query(`
        SELECT COUNT(*) AS total
        FROM audit_log
        WHERE ($1::TEXT IS NULL OR actor_id = $1::TEXT)
          AND ($2::TEXT IS NULL OR starts_with(action, $2::TEXT))
          AND ($3::TEXT IS NULL OR target_type = $3::TEXT)
          AND ($4::TIMESTAMPTZ IS NULL OR created_at >= $4::TIMESTAMPTZ)
          AND ($5::TIMESTAMPTZ IS NULL OR created_at <= $5::TIMESTAMPTZ)
          AND ($6::TEXT IS NULL OR actor_type = $6::TEXT)
      `, params);

      return parseInt(result.rows[0]?.total || 0, 10);
    },

    // Rows where the user acted, was the target, or was the member in a crew_member row.
    async listForUser(userId: string, limit: number = 20) {
      const finalLimit = Math.min(Math.max(1, Math.trunc(Number(limit)) || 20), 50);
      const result = await pool.query(`
        SELECT ${ROW_COLUMNS}
        FROM audit_log
        WHERE actor_id = $1
           OR target_id = $1
           OR (target_type = 'crew_member' AND split_part(target_id, ':', 2) = $1)
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `, [userId, finalLimit]);
      return result.rows.map(withDetails);
    },

    async cleanup(retentionDays: any = 90) {
      const days = Math.max(1, Math.min(3650, Number.parseInt(retentionDays, 10) || 90));
      const result = await pool.query(
        `DELETE FROM audit_log WHERE created_at < NOW() - make_interval(days => $1)`,
        [days],
      );
      return result.rowCount;
    },
  };

  return auditLog;
}
