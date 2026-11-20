import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { buildUpdate } from '../utils';

export function createCrewPackingStore(pool: Pool) {
  // M2 logistics: Crew packing board store. Mirrors the meetingPoints sub-store
  // factory return — a flat per-crew checklist of items ("who's bringing what").
  const crewPacking = {
    async create(data: any) {
      await pool.query(
        `
        INSERT INTO
          crew_packing_items (
            id,
            crew_id,
            created_by,
            label,
            brought_by,
            claimed,
            created_at
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, NOW())
      `,
        [data.id, data.crewId, data.createdBy, data.label, data.broughtBy || null, data.claimed === true],
      );
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          brought_by,
          claimed,
          packed,
          created_at
        FROM
          crew_packing_items
        WHERE
          id = $1
      `,
        [data.id],
      );
      return result.rows[0] || null;
    },

    // One multi-row INSERT for a template or pasted list. Rows come back open.
    async createMany(crewId: string, createdBy: string, labels: string[]) {
      if (labels.length === 0) return [];
      const params: any[] = [crewId, createdBy];
      const values = labels.map((label) => {
        params.push('pack-' + randomUUID(), label);
        return `($${params.length - 1}, $1, $2, $${params.length}, NULL, false, false, NOW())`;
      });
      const result = await pool.query(
        `
        INSERT INTO
          crew_packing_items (id, crew_id, created_by, label, brought_by, claimed, packed, created_at)
        VALUES
          ${values.join(', ')}
        RETURNING
          id,
          crew_id,
          created_by,
          label,
          brought_by,
          claimed,
          packed,
          created_at
      `,
        params,
      );
      return result.rows;
    },

    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          pi.id,
          pi.crew_id,
          pi.created_by,
          pi.label,
          pi.brought_by,
          pi.claimed,
          pi.packed,
          pi.created_at,
          u.username AS creator_name
        FROM
          crew_packing_items pi
          JOIN users u ON u.id = pi.created_by
          AND u.deleted_at IS NULL
        WHERE
          pi.crew_id = $1
        ORDER BY
          pi.claimed ASC,
          pi.created_at ASC
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
            label: 'label',
            broughtBy: 'brought_by',
            claimed: 'claimed',
            packed: 'packed',
          } as Record<string, string>
        )[key];
        if (col) {
          sets.push([col, val]);
        }
      }
      if (sets.length === 0) return null;
      const q = buildUpdate('crew_packing_items', sets, id);
      await pool.query(q.text, q.values);
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          brought_by,
          claimed,
          packed,
          created_at
        FROM
          crew_packing_items
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async delete(id: string) {
      await pool.query('DELETE FROM crew_packing_items WHERE id = $1', [id]);
    },

    async getById(id: string) {
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          brought_by,
          claimed,
          packed,
          created_at
        FROM
          crew_packing_items
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async countByCrew(crewId: string) {
      const result = await pool.query('SELECT COUNT(*)::int AS count FROM crew_packing_items WHERE crew_id = $1', [
        crewId,
      ]);
      return result.rows[0].count;
    },
  };

  return crewPacking;
}
