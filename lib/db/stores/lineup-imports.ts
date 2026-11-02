// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Lineup import records: commit an import plan, list import history, undo the newest import.
 * Each import keeps the ids it created and the before/after values of the sets it changed,
 * because the festival editor save rewrites every festival_sets row.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import { withTransaction } from '../connection';
import { buildMultiInsert, insertSetsBatch } from './festivals';
import type { LineupImportPlan, LineupImportWrites, SetValues } from '../../lineup-import-plan';

export type BuildPlan = (festival: any) => { plan: LineupImportPlan; writes: LineupImportWrites };

export interface UndoResult {
  removed: number;
  restored: number;
  removedStages: number;
  removedDays: number;
  kept: { setId: string; artist: string; reason: 'picked' | 'edited' }[];
}

const sameText = (a: any, b: any) => (a ?? '') === (b ?? '');

async function lockFestival(client: any, festivalId: string) {
  const { rows } = await client.query('SELECT id FROM festivals WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [
    festivalId,
  ]);
  return rows.length > 0;
}

async function insertNewStages(client: any, festivalId: string, stages: LineupImportWrites['newStages']) {
  if (stages.length === 0) return;
  const { rows } = await client.query(
    'SELECT COALESCE(MAX(sort_order), -1)::int AS m FROM festival_stages WHERE festival_id = $1',
    [festivalId],
  );
  const first = rows[0].m + 1;
  const { clause, params } = buildMultiInsert(
    stages.map((s, i) => [festivalId, s.id, s.name, s.color, first + i]),
  );
  await client.query(`INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ${clause}`, params);
}

async function insertNewDays(client: any, festivalId: string, days: LineupImportWrites['newDays']) {
  if (days.length === 0) return;
  const { clause, params } = buildMultiInsert(days.map((d) => [festivalId, d.dayIndex, d.label, d.date]));
  await client.query(`INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ${clause}`, params);
}

async function insertNewSets(client: any, festivalId: string, inserts: LineupImportWrites['inserts']) {
  if (inserts.length === 0) return;
  const { rows } = await client.query(
    'SELECT day_index, MAX(sort_order)::int AS m FROM festival_sets WHERE festival_id = $1 GROUP BY day_index',
    [festivalId],
  );
  const next = new Map<number, number>(rows.map((r: any) => [r.day_index, r.m + 1]));
  const setRows = inserts.map((s) => {
    const sortOrder = next.get(s.dayIndex) ?? 0;
    next.set(s.dayIndex, sortOrder + 1);
    return [s.id, festivalId, s.dayIndex, s.artist, s.stageId, s.startTime, s.endTime, sortOrder, s.linkUrl, JSON.stringify(s.artists)];
  });
  await insertSetsBatch(client, setRows);
}

async function writeSetValues(client: any, festivalId: string, setId: string, v: SetValues) {
  await client.query(
    `
  UPDATE festival_sets
  SET
    stage_id = $1,
    start_time = $2,
    end_time = $3,
    artist = $4,
    artists = $5,
    link_url = $6
  WHERE
    id = $7
    AND festival_id = $8
`,
    [v.stageId, v.startTime, v.endTime, v.artist, JSON.stringify(v.artists), v.linkUrl, setId, festivalId],
  );
}

async function newestOpenImportId(client: any, festivalId: string): Promise<string | null> {
  const { rows } = await client.query(
    `
  SELECT
    id
  FROM
    lineup_imports
  WHERE
    festival_id = $1
    AND undone_at IS NULL
  ORDER BY
    created_at DESC,
    id DESC
  LIMIT
    1
`,
    [festivalId],
  );
  return rows[0]?.id ?? null;
}

/** Deletes the created sets nobody picked, noted, rated or set a reminder on. */
async function removeCreatedSets(client: any, festivalId: string, setIds: string[], result: UndoResult) {
  if (setIds.length === 0) return;
  const { rows } = await client.query(
    `
  SELECT
    s.id,
    s.artist,
    EXISTS (
      SELECT
        1
      FROM
        festival_profile_picks p
      WHERE
        p.set_id = s.id
    )
    OR EXISTS (
      SELECT
        1
      FROM
        festival_profile_notes n
      WHERE
        n.set_id = s.id
    )
    OR EXISTS (
      SELECT
        1
      FROM
        festival_profiles fp
      WHERE
        fp.festival_id = $1
        AND fp.reminders_json ? s.id
    )
    OR EXISTS (
      SELECT
        1
      FROM
        set_ratings sr
      WHERE
        sr.set_id = s.id
    ) AS referenced
  FROM
    festival_sets s
  WHERE
    s.festival_id = $1
    AND s.id = ANY ($2::text[])
`,
    [festivalId, setIds],
  );
  const removable = rows.filter((r: any) => !r.referenced).map((r: any) => r.id);
  for (const r of rows) if (r.referenced) result.kept.push({ setId: r.id, artist: r.artist, reason: 'picked' });
  if (removable.length === 0) return;
  result.removed = removable.length;
  await client.query('DELETE FROM festival_sets WHERE festival_id = $1 AND id = ANY($2::text[])', [festivalId, removable]);
}

/** Puts back each changed set that nobody edited after the import. */
async function restoreUpdatedSets(client: any, festivalId: string, updated: any[], result: UndoResult) {
  for (const u of updated) {
    const { rows } = await client.query(
      'SELECT stage_id, start_time, end_time, artist, link_url FROM festival_sets WHERE id = $1 AND festival_id = $2',
      [u.id, festivalId],
    );
    const cur = rows[0];
    const untouched =
      cur &&
      sameText(cur.stage_id, u.after.stageId) &&
      sameText(cur.start_time, u.after.startTime) &&
      sameText(cur.end_time, u.after.endTime) &&
      sameText(cur.artist, u.after.artist) &&
      sameText(cur.link_url, u.after.linkUrl);
    if (!untouched) {
      result.kept.push({ setId: u.id, artist: cur?.artist ?? u.after.artist, reason: 'edited' });
      continue;
    }
    await writeSetValues(client, festivalId, u.id, u.before);
    result.restored++;
  }
}

/** Removes created stages no set uses, then trailing created days that are empty. */
async function removeCreatedStagesAndDays(client: any, festivalId: string, record: any, result: UndoResult) {
  if (record.created_stage_ids.length > 0) {
    const del = await client.query(
      `DELETE FROM festival_stages st WHERE st.festival_id = $1 AND st.id = ANY($2::text[])
         AND NOT EXISTS (SELECT 1 FROM festival_sets s WHERE s.festival_id = st.festival_id AND s.stage_id = st.id)`,
      [festivalId, record.created_stage_ids],
    );
    result.removedStages = del.rowCount ?? 0;
  }
  const created = [...record.created_day_indexes].sort((a: number, b: number) => b - a);
  for (const dayIndex of created) {
    const { rows } = await client.query(
      `
  SELECT
    (
      SELECT
        MAX(day_index)
      FROM
        festival_days
      WHERE
        festival_id = $1
    ) AS last,
    EXISTS (
      SELECT
        1
      FROM
        festival_sets
      WHERE
        festival_id = $1
        AND day_index = $2
    ) AS used
`,
      [festivalId, dayIndex],
    );
    if (rows[0].last !== dayIndex || rows[0].used) break;
    await client.query('DELETE FROM festival_days WHERE festival_id = $1 AND day_index = $2', [festivalId, dayIndex]);
    result.removedDays++;
  }
}

export function createLineupImportsStore(pool: Pool, { festivals }: { festivals: any }) {
  return {
    /**
     * Re-plans against the locked festival and writes the plan in one transaction.
     * Writes nothing when the fresh plan has errors or problems.
     */
    async commit(festivalId: string, buildPlan: BuildPlan, meta: { createdBy: string | null }) {
      return withTransaction(pool, async (client) => {
        if (!(await lockFestival(client, festivalId))) return { notFound: true as const };
        const festival = await festivals.getById(festivalId, client);
        const { plan, writes } = buildPlan(festival);
        if (plan.counts.error > 0 || plan.problems.length > 0) return { committed: false as const, plan };

        await insertNewStages(client, festivalId, writes.newStages);
        await insertNewDays(client, festivalId, writes.newDays);
        await insertNewSets(client, festivalId, writes.inserts);
        for (const u of writes.updates) await writeSetValues(client, festivalId, u.setId, u.after);
        await client.query('UPDATE festivals SET updated_at = NOW() WHERE id = $1', [festivalId]);

        const importId = `import-${crypto.randomBytes(8).toString('hex')}`;
        const counts = {
          created: writes.inserts.length,
          updated: writes.updates.length,
          newStages: writes.newStages.length,
          newDays: writes.newDays.length,
        };
        await client.query(
          `
  INSERT INTO
    lineup_imports (
      id,
      festival_id,
      created_by,
      counts,
      created_set_ids,
      created_stage_ids,
      created_day_indexes,
      updated_sets
    )
  VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8)
`,
          [
            importId,
            festivalId,
            meta.createdBy,
            JSON.stringify(counts),
            writes.inserts.map((s) => s.id),
            writes.newStages.map((s) => s.id),
            writes.newDays.map((d) => d.dayIndex),
            JSON.stringify(writes.updates.map((u) => ({ id: u.setId, before: u.before, after: u.after }))),
          ],
        );
        return { committed: true as const, plan, writes, importId };
      });
    },

    /** The newest 20 imports, or null when the festival does not exist. */
    async list(festivalId: string) {
      const fest = await pool.query('SELECT name FROM festivals WHERE id = $1 AND deleted_at IS NULL', [festivalId]);
      if (fest.rows.length === 0) return null;
      const { rows } = await pool.query(
        `
  SELECT
    li.id,
    li.created_at,
    li.counts,
    li.undone_at,
    u.username
  FROM
    lineup_imports li
    LEFT JOIN users u ON u.id = li.created_by
  WHERE
    li.festival_id = $1
  ORDER BY
    li.created_at DESC,
    li.id DESC
  LIMIT
    20
`,
        [festivalId],
      );
      const newestOpen = rows.find((r: any) => r.undone_at === null)?.id ?? null;
      return {
        festivalName: fest.rows[0].name as string,
        imports: rows.map((r: any) => ({
          id: r.id,
          createdAt: new Date(r.created_at).toISOString(),
          createdBy: r.username ?? null,
          counts: {
            created: r.counts?.created ?? 0,
            updated: r.counts?.updated ?? 0,
            newStages: r.counts?.newStages ?? 0,
            newDays: r.counts?.newDays ?? 0,
          },
          undoneAt: r.undone_at ? new Date(r.undone_at).toISOString() : null,
          canUndo: r.id === newestOpen,
        })),
      };
    },

    /** Undoes the newest import that is not undone yet. */
    async undo(festivalId: string, importId: string) {
      return withTransaction(pool, async (client) => {
        if (!(await lockFestival(client, festivalId))) return { notFound: true as const };
        const { rows } = await client.query(
          'SELECT * FROM lineup_imports WHERE id = $1 AND festival_id = $2 FOR UPDATE',
          [importId, festivalId],
        );
        const record = rows[0];
        if (!record) return { notFound: true as const };
        if (record.undone_at || (await newestOpenImportId(client, festivalId)) !== importId) {
          return { refused: true as const };
        }

        const result: UndoResult = { removed: 0, restored: 0, removedStages: 0, removedDays: 0, kept: [] };
        await removeCreatedSets(client, festivalId, record.created_set_ids, result);
        await restoreUpdatedSets(client, festivalId, record.updated_sets || [], result);
        await removeCreatedStagesAndDays(client, festivalId, record, result);
        await client.query('UPDATE lineup_imports SET undone_at = NOW(), undo_summary = $2 WHERE id = $1', [
          importId,
          JSON.stringify(result),
        ]);
        await client.query('UPDATE festivals SET updated_at = NOW() WHERE id = $1', [festivalId]);
        return { result };
      });
    },
  };
}
