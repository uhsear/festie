// Batch INSERT helper — builds multi-row VALUES clause
export function batchInsert(client: any, table: string, columns: string[], rows: any[][]) {
  if (rows.length === 0) return Promise.resolve();
  if (!/^[a-z_]+$/.test(table)) throw new Error('invalid table name');
  for (const col of columns) {
    if (!/^[a-z_]+$/.test(col)) throw new Error('invalid column name');
  }
  const colStr = columns.join(', ');
  const values: any[] = [];
  const placeholders = rows.map((row, ri) => {
    const ph = columns.map((_, ci) => {
      values.push(row[ci]);
      return `$${ri * columns.length + ci + 1}`;
    });
    return `(${ph.join(', ')})`;
  });
  return client.query(`INSERT INTO ${table} (${colStr}) VALUES ${placeholders.join(', ')}`, values);
}

// Upsert and remove only the pick rows a delta names, then return the profile's whole pick map.
export async function applyPickDeltas(
  client: any,
  profileId: string,
  deltas: { set?: Record<string, string>; remove?: string[] },
) {
  const upserts = Object.entries(deltas.set ?? {});
  if (upserts.length > 0) {
    await client.query(
      `INSERT INTO festival_profile_picks (profile_id, set_id, priority)
       SELECT $1, u.set_id, u.priority FROM unnest($2::text[], $3::text[]) AS u(set_id, priority)
       ON CONFLICT (profile_id, set_id) DO UPDATE SET priority = EXCLUDED.priority`,
      [profileId, upserts.map(([setId]) => setId), upserts.map(([, priority]) => priority)],
    );
  }
  if (deltas.remove?.length) {
    await client.query('DELETE FROM festival_profile_picks WHERE profile_id = $1 AND set_id = ANY($2::text[])', [
      profileId,
      deltas.remove,
    ]);
  }
  const { rows } = await client.query('SELECT set_id, priority FROM festival_profile_picks WHERE profile_id = $1', [
    profileId,
  ]);
  return Object.fromEntries(rows.map((row: any) => [row.set_id, row.priority]));
}

// #24: Normalized read fragment — reconstructs picks/notes/reminders from
// dedicated tables instead of the legacy JSONB columns. JSONB columns remain
// for dual-write rollback safety but are no longer the read source.
export const PROFILE_SELECT = `
  fp.id,
  fp.festival_id AS "festivalId",
  fp.user_id     AS "userId",
  fp.name,
  COALESCE(
    (SELECT jsonb_object_agg(p.set_id, p.priority)
     FROM festival_profile_picks p WHERE p.profile_id = fp.id),
    '{}'::jsonb
  ) AS "picksJson",
  COALESCE(
    (SELECT jsonb_object_agg(n.set_id, n.text)
     FROM festival_profile_notes n WHERE n.profile_id = fp.id),
    '{}'::jsonb
  ) AS "notesJson",
  -- Reminders have no normalized table (dropped in migration 013); they live in
  -- the reminders_json JSONB column (write path + reminder-scheduler use it).
  -- Without this select the API always returned reminders: {} (read-back bug).
  COALESCE(fp.reminders_json, '{}'::jsonb) AS "remindersJson",
  -- Interest marks go to their owner only: PROFILE_SELECT_PICKS, which serves other users' rows, leaves them out.
  COALESCE(fp.interests_json, '{}'::jsonb) AS "interestsJson",
  fp.created_at AS "createdAt",
  fp.updated_at AS "updatedAt"
`;

// The festival list sends notes and reminders only to their owner, so this read
// skips them and returns empty objects under the same keys for mapProfileRow.
export const PROFILE_SELECT_PICKS = `
  fp.id,
  fp.festival_id AS "festivalId",
  fp.user_id     AS "userId",
  fp.name,
  COALESCE(
    (SELECT jsonb_object_agg(p.set_id, p.priority)
     FROM festival_profile_picks p WHERE p.profile_id = fp.id),
    '{}'::jsonb
  ) AS "picksJson",
  '{}'::jsonb AS "notesJson",
  '{}'::jsonb AS "remindersJson",
  fp.created_at AS "createdAt",
  fp.updated_at AS "updatedAt"
`;

// A converted mark protects its picks from a stale full-map pick write for this long. Old builds send
// the whole picks map and no `If-Match`, so a map that predates the conversion would erase its picks.
const CONVERTED_PICK_GUARD_MS = 72 * 60 * 60 * 1000;

/**
 * The picks a full-map write must keep: converted in the last 72 hours, still stored, and missing
 * from the incoming map. An explicit `interestRemove` deletes the mark, so it ends the protection.
 * An id in `removed` (the request's `pickRemove`) is the user clearing that pick on purpose, so it is not kept.
 */
export async function keepConvertedPicks(
  client: any,
  profileId: string,
  picks: Record<string, any>,
  removed: string[] = [],
) {
  const { rows } = await client.query(
    'SELECT interests_json AS interests FROM festival_profiles WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
    [profileId],
  );
  const cutoff = Date.now() - CONVERTED_PICK_GUARD_MS;
  const guarded = new Set<string>();
  for (const mark of Object.values<any>(rows[0]?.interests ?? {})) {
    if (mark?.state !== 'converted' || !(Date.parse(mark.at) >= cutoff)) continue;
    for (const setId of mark.added ?? []) if (!(setId in picks) && !removed.includes(setId)) guarded.add(setId);
  }
  if (guarded.size === 0) return picks;
  const stored = await client.query(
    'SELECT set_id, priority FROM festival_profile_picks WHERE profile_id = $1 AND set_id = ANY($2::text[])',
    [profileId, [...guarded]],
  );
  return { ...picks, ...Object.fromEntries(stored.rows.map((row: any) => [row.set_id, row.priority])) };
}

// One expression, one statement: a mark is added only when absent, so a converted mark stays converted,
// and a removed id leaves the map whatever its state. Two devices cannot erase each other's marks.
export const interestDeltaSql = (addParam: number, removeParam: number) => `(
  SELECT COALESCE(jsonb_object_agg(m.k, m.v), '{}'::jsonb)
  FROM (
    SELECT e.key AS k, e.value AS v
    FROM jsonb_each(COALESCE(interests_json, '{}'::jsonb)) e
    WHERE e.key <> ALL($${removeParam}::text[])
    UNION ALL
    SELECT a AS k, '{"state":"open"}'::jsonb AS v
    FROM unnest($${addParam}::text[]) AS a
    WHERE a <> ALL($${removeParam}::text[]) AND NOT (COALESCE(interests_json, '{}'::jsonb) ? a)
  ) m
)`;
