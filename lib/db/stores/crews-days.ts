import type { Pool } from 'pg';
import { withTransaction } from '../connection';

export function createCrewDaysStore(pool: Pool) {
  // 090: which festival days each member attends. No row means no answer.
  // Rows of members who left are gone by the crew_members cascade.
  const crewDays = {
    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          d.user_id AS "userId",
          d.day_index AS "dayIndex",
          d.answer
        FROM
          crew_member_days d
          JOIN users u ON u.id = d.user_id
          AND u.deleted_at IS NULL
        WHERE
          d.crew_id = $1
        ORDER BY
          d.user_id,
          d.day_index
      `,
        [crewId],
      );
      return result.rows;
    },

    // Replaces the member's full answer set, so a replay of the same body is a no-op.
    async replaceMine(crewId: string, userId: string, days: Array<{ dayIndex: number; answer: string }>) {
      return withTransaction(pool, async (client) => {
        // Serialize concurrent PUTs (double tap): a second writer waits here, so its DELETE sees the first's rows.
        await client.query('SELECT 1 FROM crew_members WHERE crew_id = $1 AND user_id = $2 FOR UPDATE', [
          crewId,
          userId,
        ]);
        await client.query('DELETE FROM crew_member_days WHERE crew_id = $1 AND user_id = $2', [crewId, userId]);
        if (days.length) {
          await client.query(
            'INSERT INTO crew_member_days (crew_id, user_id, day_index, answer) SELECT $1, $2, d, a FROM unnest($3::int[], $4::text[]) AS t(d, a)',
            [crewId, userId, days.map((d) => d.dayIndex), days.map((d) => d.answer)],
          );
        }
        const result = await client.query(
          'SELECT user_id AS "userId", day_index AS "dayIndex", answer FROM crew_member_days WHERE crew_id = $1 AND user_id = $2 ORDER BY day_index',
          [crewId, userId],
        );
        return result.rows;
      });
    },

    async dayCount(crewId: string) {
      const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM festival_days WHERE festival_id = (SELECT festival_id FROM crews WHERE id = $1)',
        [crewId],
      );
      return result.rows[0].count as number;
    },
  };

  return crewDays;
}
