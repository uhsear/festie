import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

// Safe JSON parse — returns fallback on any error
function safeParseJson(value: any, fallback: any) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const COLUMNS =
  'id, crew_id, created_by, question, options, closes_at, closed, created_at, set_refs, multi_answer, closed_at, nudged_at';

export default function createPollsStore(pool: Pool, _utils: any) {
  return {
    async create({ crewId, createdBy, question, options, closesAt, setRefs, multiAnswer }: any) {
      const id = 'poll-' + randomUUID();
      const result = await pool.query(
        `
        INSERT INTO crew_polls (id, crew_id, created_by, question, options, closes_at, closed, created_at, set_refs, multi_answer)
        VALUES ($1, $2, $3, $4, $5, $6, FALSE, NOW(), $7, $8)
        RETURNING ${COLUMNS}
      `,
        [
          id,
          crewId,
          createdBy,
          question,
          JSON.stringify(options),
          closesAt,
          setRefs ? JSON.stringify(setRefs) : null,
          multiAnswer === true,
        ],
      );
      return result.rows[0];
    },

    // Every open poll plus the 10 most recently ended. `votes` has one entry per chosen option.
    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        WITH picked AS (
          (SELECT id FROM crew_polls WHERE crew_id = $1 AND closed = FALSE AND (closes_at IS NULL OR closes_at > NOW()))
          UNION ALL
          (SELECT id FROM crew_polls WHERE crew_id = $1 AND (closed = TRUE OR closes_at <= NOW())
           ORDER BY COALESCE(closed_at, closes_at, created_at) DESC LIMIT 10)
        )
        SELECT p.*, COUNT(DISTINCT v.user_id) AS vote_count,
          COALESCE(json_agg(json_build_object('option', o.idx, 'user_id', v.user_id))
                   FILTER (WHERE v.user_id IS NOT NULL), '[]') AS votes
        FROM crew_polls p
        JOIN picked ON picked.id = p.id
        LEFT JOIN crew_poll_votes v ON v.poll_id = p.id
        LEFT JOIN LATERAL unnest(COALESCE(v.option_indexes, ARRAY[v.option_index])) AS o(idx) ON TRUE
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `,
        [crewId],
      );
      return result.rows.map((row: any) => ({
        ...row,
        options: Array.isArray(row.options) ? row.options : safeParseJson(row.options, []),
        votes: Array.isArray(row.votes) ? row.votes : safeParseJson(row.votes, []),
      }));
    },

    // option_index keeps the first choice so readers of the old column still work.
    async vote(pollId: string, userId: string, indexes: number[]) {
      const result = await pool.query(
        `
        INSERT INTO crew_poll_votes (poll_id, user_id, option_index, option_indexes, voted_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (poll_id, user_id)
        DO UPDATE SET option_index = $3, option_indexes = $4, voted_at = NOW()
        RETURNING poll_id, user_id, option_index, option_indexes, voted_at
      `,
        [pollId, userId, indexes[0], indexes],
      );
      return result.rows[0];
    },

    async removeVote(pollId: string, userId: string) {
      await pool.query('DELETE FROM crew_poll_votes WHERE poll_id = $1 AND user_id = $2', [pollId, userId]);
    },

    async getResults(pollId: string) {
      const result = await pool.query(
        `
        SELECT
          p.*,
          json_agg(json_build_object(
            'option_index', v.option_index,
            'user_id', u.id,
            'username', u.username
          )) FILTER (WHERE v.option_index IS NOT NULL) as votes
        FROM crew_polls p
        LEFT JOIN crew_poll_votes v ON p.id = v.poll_id
        LEFT JOIN users u ON v.user_id = u.id AND u.deleted_at IS NULL
        WHERE p.id = $1
        GROUP BY p.id
      `,
        [pollId],
      );

      if (!result.rows.length) return null;
      const row = result.rows[0];
      return {
        ...row,
        options: Array.isArray(row.options) ? row.options : safeParseJson(row.options, []),
        votes: Array.isArray(row.votes) ? row.votes : safeParseJson(row.votes, []),
      };
    },

    async close(pollId: string) {
      const result = await pool.query(
        `UPDATE crew_polls SET closed = TRUE, closed_at = NOW() WHERE id = $1 AND closed = FALSE RETURNING ${COLUMNS}`,
        [pollId],
      );
      return result.rows[0];
    },

    // Ends every poll whose end time has passed. The single UPDATE claims each row once.
    async closeExpired() {
      const result = await pool.query(
        'UPDATE crew_polls SET closed = TRUE, closed_at = closes_at ' +
          'WHERE closed = FALSE AND closes_at IS NOT NULL AND closes_at <= NOW() ' +
          'RETURNING id, crew_id, created_by, question, options, set_refs, closes_at, closed, closed_at, created_at',
      );
      return result.rows;
    },

    // True only for the first reminder on a poll.
    async markNudged(pollId: string) {
      const result = await pool.query(
        'UPDATE crew_polls SET nudged_at = NOW() WHERE id = $1 AND nudged_at IS NULL RETURNING id',
        [pollId],
      );
      return result.rows.length > 0;
    },

    async nonVoterIds(pollId: string, crewId: string): Promise<string[]> {
      const result = await pool.query(
        `
        SELECT cm.user_id
        FROM crew_members cm
        JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
        WHERE cm.crew_id = $2
          AND NOT EXISTS (SELECT 1 FROM crew_poll_votes v WHERE v.poll_id = $1 AND v.user_id = cm.user_id)
      `,
        [pollId, crewId],
      );
      return result.rows.map((row: any) => row.user_id);
    },

    // Vote counts indexed by option; options with no votes stay 0. A multi-answer vote counts once per option.
    async tallyVotes(pollId: string) {
      const result = await pool.query(
        `SELECT o.idx AS option_index, COUNT(*)::int AS n
         FROM crew_poll_votes v, unnest(COALESCE(v.option_indexes, ARRAY[v.option_index])) AS o(idx)
         WHERE v.poll_id = $1 GROUP BY o.idx`,
        [pollId],
      );
      const counts: number[] = [];
      for (const row of result.rows) counts[row.option_index] = row.n;
      return Array.from(counts, (n) => n ?? 0);
    },

    async countActiveByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          COUNT(*) as count
        FROM
          crew_polls
        WHERE
          crew_id = $1
          AND closed = FALSE
          AND (closes_at IS NULL OR closes_at > NOW())
      `,
        [crewId],
      );
      return result.rows[0]?.count ?? 0;
    },

    async getById(pollId: string) {
      const result = await pool.query(
        `
  SELECT
    id,
    crew_id,
    created_by,
    question,
    options,
    closes_at,
    closed,
    created_at,
    set_refs,
    multi_answer,
    closed_at,
    nudged_at
  FROM
    crew_polls
  WHERE
    id = $1
`,
        [pollId],
      );
      if (!result.rows.length) return null;
      const row = result.rows[0];
      return {
        ...row,
        options: Array.isArray(row.options) ? row.options : safeParseJson(row.options, []),
        set_refs: safeParseJson(row.set_refs, null),
      };
    },
  };
}
