import type { Pool } from 'pg';
import { withTransaction } from '../connection';
import { planMoveMarks } from '../../set-moves';

/**
 * Build a multi-row VALUES clause with parameterized placeholders.
 * @param rows - Array of row arrays, each with the same column count
 * @param startIdx - Starting $N index (1-based)
 * @returns { clause, params }
 */
export function buildMultiInsert(rows: any[][], startIdx: number = 1): { clause: string; params: any[] } {
  const params: any[] = [];
  let idx = startIdx;
  const tuples = rows.map((row) => {
    const placeholders = row.map((val) => {
      params.push(val);
      return `$${idx++}`;
    });
    return `(${placeholders.join(',')})`;
  });
  return { clause: tuples.join(','), params };
}

/**
 * Collect stages, days, and sets from a festival into flat row arrays
 * ready for batch INSERT. Returns { stageRows, dayRows, setRows, newSetIds, setIdentityMap }.
 */
function collectFestivalChildren(festivalId: string, festival: any) {
  const stageRows = (festival.stages || []).map((stage: any, sortOrder: number) => [
    festivalId,
    stage.id,
    stage.name,
    stage.color,
    sortOrder,
    stage.latitude ?? null,
    stage.longitude ?? null,
  ]);

  const dayRows: any[][] = [];
  const setRows: any[][] = [];
  const newSetIds = new Set<string>();
  const setIdentityMap = new Map<string, string>();

  for (const [dayIndex, day] of (festival.days || []).entries()) {
    dayRows.push([festivalId, dayIndex, day.label || '', day.date || '']);

    for (const [sortOrder, set] of (day.sets || []).entries()) {
      setRows.push([
        set.id,
        festivalId,
        dayIndex,
        set.artist,
        set.stageId,
        set.startTime,
        set.endTime,
        sortOrder,
        set.linkUrl || null,
        JSON.stringify(set.artists || []),
      ]);
      newSetIds.add(set.id);
      const key = `${set.artist}|${set.startTime}`;
      setIdentityMap.set(key, set.id);
    }
  }

  return { stageRows, dayRows, setRows, newSetIds, setIdentityMap };
}

/** Batch-insert stages in a single multi-row query. */
async function insertStagesBatch(client: any, rows: any[][]) {
  if (rows.length === 0) return;
  const { clause, params } = buildMultiInsert(rows);
  await client.query(
    `INSERT INTO festival_stages (festival_id, id, name, color, sort_order, latitude, longitude) VALUES ${clause}`,
    params,
  );
}

/** Batch-upsert stages by (festival_id, id), so existing stage rows (and their sets) survive. */
async function upsertStagesBatch(client: any, rows: any[][]) {
  if (rows.length === 0) return;
  const { clause, params } = buildMultiInsert(rows);
  await client.query(
    `INSERT INTO festival_stages (festival_id, id, name, color, sort_order, latitude, longitude) VALUES ${clause}
     ON CONFLICT (festival_id, id) DO UPDATE SET
       name = EXCLUDED.name,
       color = EXCLUDED.color,
       sort_order = EXCLUDED.sort_order,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude`,
    params,
  );
}

/** Batch-insert days in a single multi-row query. */
async function insertDaysBatch(client: any, rows: any[][]) {
  if (rows.length === 0) return;
  const { clause, params } = buildMultiInsert(rows);
  await client.query(`INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ${clause}`, params);
}

/** Batch-insert sets in a single multi-row query. */
export async function insertSetsBatch(client: any, rows: any[][]) {
  if (rows.length === 0) return;
  const { clause, params } = buildMultiInsert(rows);
  await client.query(
    `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, link_url, artists) VALUES ${clause}`,
    params,
  );
}

/** Batch-restore picks that still map to surviving set IDs. */
async function restorePicksBatch(client: any, pickRows: any[], newSetIds: Set<string>) {
  const surviving = pickRows.filter((p: any) => newSetIds.has(p.set_id));
  if (surviving.length === 0) return;
  const rows = surviving.map((p: any) => [p.profile_id, p.set_id, p.priority]);
  const { clause, params } = buildMultiInsert(rows);
  await client.query(
    `INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ${clause} ON CONFLICT DO NOTHING`,
    params,
  );
}

/** Read a festival's per-set notes and caught marks before its sets are deleted. */
async function readSetNotesAndCaught(client: any, festivalId: string) {
  const notes = await client.query(
    `
  SELECT
    n.profile_id,
    n.set_id,
    n.text
  FROM
    festival_profile_notes n
    JOIN festival_sets s ON s.id = n.set_id
  WHERE
    s.festival_id = $1
`,
    [festivalId],
  );
  const caught = await client.query(
    `
  SELECT
    c.user_id,
    c.set_id,
    c.caught,
    c.updated_at
  FROM
    set_caught c
    JOIN festival_sets s ON s.id = c.set_id
  WHERE
    s.festival_id = $1
`,
    [festivalId],
  );
  return { notes: notes.rows, caught: caught.rows };
}

/** Batch-restore notes and caught marks whose set ID survives the save. */
async function restoreNotesAndCaughtBatch(client: any, kept: { notes: any[]; caught: any[] }, newSetIds: Set<string>) {
  const notes = kept.notes
    .filter((n: any) => newSetIds.has(n.set_id))
    .map((n: any) => [n.profile_id, n.set_id, n.text]);
  if (notes.length > 0) {
    const { clause, params } = buildMultiInsert(notes);
    await client.query(
      `INSERT INTO festival_profile_notes (profile_id, set_id, text) VALUES ${clause} ON CONFLICT DO NOTHING`,
      params,
    );
  }
  const caught = kept.caught
    .filter((c: any) => newSetIds.has(c.set_id))
    .map((c: any) => [c.user_id, c.set_id, c.caught, c.updated_at]);
  if (caught.length > 0) {
    const { clause, params } = buildMultiInsert(caught);
    await client.query(
      `INSERT INTO set_caught (user_id, set_id, caught, updated_at) VALUES ${clause} ON CONFLICT DO NOTHING`,
      params,
    );
  }
}

/**
 * Batch-restore ratings. A rating stays on its set ID when that ID survives, so a
 * moved set keeps it; otherwise it maps to a new set by (artist, start_time).
 */
async function restoreRatingsBatch(
  client: any,
  ratingRows: any[],
  newSetIds: Set<string>,
  setIdentityMap: Map<string, string>,
) {
  const mapped: any[][] = [];
  for (const r of ratingRows) {
    const key = `${r.artist}|${r.start_time}`;
    const newSetId = newSetIds.has(r.set_id) ? r.set_id : setIdentityMap.get(key);
    if (newSetId) {
      mapped.push([r.user_id, newSetId, r.rating, r.note, r.created_at, r.updated_at]);
    }
  }
  if (mapped.length === 0) return;
  const { clause, params } = buildMultiInsert(mapped);
  await client.query(
    `INSERT INTO set_ratings (user_id, set_id, rating, note, created_at, updated_at) VALUES ${clause} ON CONFLICT (user_id, set_id) DO NOTHING`,
    params,
  );
}

/** Old days and set slots with their marks, read before the delete. Null for a draft, which gets no marks. */
async function readPriorSlots(client: any, festivalId: string) {
  const fest = await client.query('SELECT published_at FROM festivals WHERE id = $1', [festivalId]);
  if (!fest.rows[0]?.published_at) return null;
  const days = await client.query(
    'SELECT day_index AS "dayIndex", label, date FROM festival_days WHERE festival_id = $1',
    [festivalId],
  );
  const sets = await client.query(
    `
  SELECT
    id,
    day_index AS "dayIndex",
    stage_id AS "stageId",
    start_time AS "start",
    end_time AS "end",
    moved_at AS "movedAt",
    moved_from AS "movedFrom"
  FROM
    festival_sets
  WHERE
    festival_id = $1
`,
    [festivalId],
  );
  return { days: days.rows, sets: sets.rows };
}

/** Compute and write the "moved" marks for sets that survive the save, in one statement. */
async function writeMoveMarks(client: any, festivalId: string, prior: any, children: any) {
  if (!prior) return;
  const newDays = children.dayRows.map((r: any[]) => ({ dayIndex: r[1], label: r[2], date: r[3] }));
  const newSets = children.setRows.map((r: any[]) => ({
    id: r[0],
    dayIndex: r[2],
    stageId: r[4],
    start: r[5],
    end: r[6],
  }));
  const marks = planMoveMarks(prior.days, prior.sets, newDays, newSets, new Date());
  if (marks.length === 0) return;
  await client.query(
    `
  UPDATE festival_sets AS fs
  SET
    moved_at = m.moved_at,
    moved_from = m.moved_from
  FROM
    unnest($2::text[], $3::timestamptz[], $4::jsonb[]) AS m (id, moved_at, moved_from)
  WHERE
    fs.festival_id = $1
    AND fs.id = m.id
`,
    [
      festivalId,
      marks.map((m) => m.id),
      marks.map((m) => m.movedAt.toISOString()),
      marks.map((m) => JSON.stringify(m.movedFrom)),
    ],
  );
}

/**
 * Preserve picks, ratings, notes, and caught marks, delete old child rows,
 * batch-insert new days/sets, then restore them and write "moved" marks.
 * Used by replaceAll and update.
 */
async function replaceChildRows(client: any, festivalId: string, children: any) {
  const { dayRows, setRows, newSetIds, setIdentityMap } = children;
  const priorSlots = await readPriorSlots(client, festivalId);

  // Preserve picks before deleting sets
  const existingPicks = await client.query(
    `
  SELECT
    p.profile_id,
    p.set_id,
    p.priority
  FROM
    festival_profile_picks p
    JOIN festival_sets s ON s.id = p.set_id
  WHERE
    s.festival_id = $1
`,
    [festivalId],
  );

  // Preserve ratings before deleting sets
  const existingRatings = await client.query(
    `
  SELECT
    r.user_id,
    r.set_id,
    r.rating,
    r.note,
    r.created_at,
    r.updated_at,
    s.artist,
    s.start_time
  FROM
    set_ratings r
    JOIN festival_sets s ON s.id = r.set_id
  WHERE
    s.festival_id = $1
`,
    [festivalId],
  );

  await client.query(
    `
  DELETE FROM set_ratings
  WHERE
    set_id IN (
      SELECT
        id
      FROM
        festival_sets
      WHERE
        festival_id = $1
    )
`,
    [festivalId],
  );
  const keptNotesAndCaught = await readSetNotesAndCaught(client, festivalId);

  // festival_profile_notes.set_id is ON DELETE NO ACTION, so notes must go before their sets.
  await client.query(
    'DELETE FROM festival_profile_notes WHERE set_id IN (SELECT id FROM festival_sets WHERE festival_id = $1)',
    [festivalId],
  );
  await client.query(
    `
  DELETE FROM festival_profile_picks
  WHERE
    set_id IN (
      SELECT
        id
      FROM
        festival_sets
      WHERE
        festival_id = $1
    )
`,
    [festivalId],
  );
  await client.query('DELETE FROM festival_sets WHERE festival_id = $1', [festivalId]);
  await client.query('DELETE FROM festival_days WHERE festival_id = $1', [festivalId]);

  // Batch insert days and sets
  await insertDaysBatch(client, dayRows);
  await insertSetsBatch(client, setRows);

  // Restore picks and ratings
  await restorePicksBatch(client, existingPicks.rows, newSetIds);
  await restoreRatingsBatch(client, existingRatings.rows, newSetIds, setIdentityMap);
  await restoreNotesAndCaughtBatch(client, keptNotesAndCaught, newSetIds);
  await writeMoveMarks(client, festivalId, priorSlots, children);
}

export default function createFestivalsStore(pool: Pool, utils: any) {
  const { buildFestivalRecords } = utils;

  const festivals = {
    async readAll() {
      return buildFestivalRecords();
    },

    async replaceAll(nextFestivals: any[]) {
      return withTransaction(pool, async (client) => {
        if (nextFestivals.length === 0) {
          await client.query('DELETE FROM festivals');
          return;
        }

        const festivalIds = nextFestivals.map((festival: any) => festival.id);
        await client.query(
          `DELETE FROM festivals WHERE id NOT IN (${festivalIds.map((_: any, i: number) => `$${i + 1}`).join(',')})`,
          festivalIds,
        );

        for (const festival of nextFestivals) {
          const createdAt = festival.createdAt || new Date().toISOString();
          const updatedAt = festival.updatedAt || createdAt;

          await client.query(
            `
            INSERT INTO festivals (id, name, location, created_at, updated_at, b2b_separator, latitude, longitude, time_zone, map_config)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT(id) DO UPDATE SET
              name = EXCLUDED.name,
              location = EXCLUDED.location,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at,
              b2b_separator = EXCLUDED.b2b_separator,
              latitude = EXCLUDED.latitude,
              longitude = EXCLUDED.longitude,
              time_zone = EXCLUDED.time_zone,
              map_config = EXCLUDED.map_config
          `,
            [
              festival.id,
              festival.name,
              festival.location || '',
              createdAt,
              updatedAt,
              festival.b2bSeparator || 'b2b',
              festival.latitude || null,
              festival.longitude || null,
              festival.timeZone ?? null,
              festival.mapConfig == null ? null : JSON.stringify(festival.mapConfig),
            ],
          );

          // Delete old stages and batch-insert new ones
          await client.query('DELETE FROM festival_stages WHERE festival_id = $1', [festival.id]);
          const children = collectFestivalChildren(festival.id, festival);
          await insertStagesBatch(client, children.stageRows);

          // Replace days, sets, picks, and ratings in batch
          await replaceChildRows(client, festival.id, children);
        }
      });
    },

    async softDelete(festivalId: string) {
      await pool.query('UPDATE festivals SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [festivalId]);
    },

    async restore(festivalId: string, userId: string | null = null) {
      const result = await pool.query(
        `
  UPDATE festivals
  SET
    deleted_at = NULL,
    updated_at = NOW(),
    updated_by = $2
  WHERE
    id = $1
    AND deleted_at IS NOT NULL
  RETURNING
    id,
    published_at AS "publishedAt"
`,
        [festivalId, userId],
      );
      return result.rows[0] || null;
    },

    // Keeps an earlier published_at and slug, so a second publish changes nothing visible.
    async publish(
      festivalId: string,
      userId: string | null = null,
    ): Promise<{ publishedAt: string; slug: string | null } | null> {
      const run = () =>
        pool.query(
          `
  UPDATE festivals
  SET
    published_at = COALESCE(published_at, NOW()),
    slug = COALESCE(slug, festival_next_slug (id)),
    updated_at = NOW(),
    updated_by = $2
  WHERE
    id = $1
    AND deleted_at IS NULL
  RETURNING
    published_at AS "publishedAt",
    slug
`,
          [festivalId, userId],
        );
      let result;
      try {
        result = await run();
      } catch (error: any) {
        // Two publishes raced to one free slug; the retry sees the winner's row.
        if (error?.code !== '23505') throw error;
        result = await run();
      }
      return result.rows[0] || null;
    },

    /** The festival id behind a public page slug: published and not archived, else null. */
    async findPublicIdBySlug(slug: string): Promise<string | null> {
      const result = await pool.query(
        'SELECT id FROM festivals WHERE slug = $1 AND deleted_at IS NULL AND published_at IS NOT NULL',
        [slug],
      );
      return result.rows[0]?.id ?? null;
    },

    /** Slugs of every public festival, for the sitemap. */
    async listPublicSlugs(): Promise<Array<{ slug: string; updatedAt: string }>> {
      const result = await pool.query(
        `
  SELECT
    slug,
    updated_at AS "updatedAt"
  FROM
    festivals
  WHERE
    slug IS NOT NULL
    AND deleted_at IS NULL
    AND published_at IS NOT NULL
  ORDER BY
    published_at,
    id
  LIMIT
    5000
`,
      );
      return result.rows.map((row: any) => ({ slug: row.slug, updatedAt: new Date(row.updatedAt).toISOString() }));
    },

    async listDeleted() {
      const result = await pool.query(
        `
  SELECT
    id,
    name,
    COALESCE(location, '') AS location,
    deleted_at AS "deletedAt",
    published_at AS "publishedAt"
  FROM
    festivals
  WHERE
    deleted_at IS NOT NULL
  ORDER BY
    deleted_at DESC
  LIMIT
    100
`,
      );
      return result.rows;
    },

    /** When the "set times are out" alert went out (migration 089), or null if it has not. */
    async getSetTimesOutAt(festivalId: string): Promise<string | null> {
      const result = await pool.query('SELECT set_times_out_at AS "setTimesOutAt" FROM festivals WHERE id = $1', [
        festivalId,
      ]);
      const value = result.rows[0]?.setTimesOutAt;
      return value ? new Date(value).toISOString() : null;
    },

    /** The id of the admin who last saved, published or restored the festival. */
    async getEditor(festivalId: string) {
      const result = await pool.query('SELECT updated_by AS "updatedBy" FROM festivals WHERE id = $1', [festivalId]);
      return result.rows[0]?.updatedBy ?? null;
    },

    /** Who loses access when the festival is deleted. */
    async countImpact(festivalId: string) {
      const result = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM festival_profiles WHERE festival_id = $1) AS profiles,
           (SELECT COUNT(*) FROM crews WHERE festival_id = $1) AS crews,
           (SELECT COUNT(*) FROM festival_profile_picks p
              JOIN festival_profiles fp ON fp.id = p.profile_id
             WHERE fp.festival_id = $1) AS picks`,
        [festivalId],
      );
      const row = result.rows[0] || {};
      return { profiles: Number(row.profiles) || 0, crews: Number(row.crews) || 0, picks: Number(row.picks) || 0 };
    },

    async getById(festivalId: string, db: { query: Pool['query'] } = pool) {
      const result = await db.query(
        `
        SELECT
          f.id,
          f.name,
          COALESCE(f.location, '') AS location,
          COALESCE(f.b2b_separator, 'b2b') AS "b2bSeparator",
          f.time_zone AS "timeZone",
          f.latitude,
          f.longitude,
          f.map_config AS "mapConfig",
          f.created_at AS "createdAt",
          f.updated_at AS "updatedAt",
          f.published_at AS "publishedAt",
          f.slug,
          COALESCE(
            (SELECT json_agg(
              json_build_object(
                'id', s.id, 'name', s.name, 'color', s.color,
                'latitude', s.latitude, 'longitude', s.longitude
              )
              ORDER BY s.sort_order ASC
            )
            FROM festival_stages s WHERE s.festival_id = f.id),
            '[]'::json
          ) AS stages,
          COALESCE(
            (SELECT json_agg(day_with_sets ORDER BY day_with_sets."dayIndex" ASC)
             FROM (
               SELECT
                 d.day_index AS "dayIndex",
                 COALESCE(d.label, '') AS label,
                 COALESCE(d.date, '') AS date,
                 COALESCE(
                   (SELECT json_agg(
                     (json_build_object(
                       'id', fs.id,
                       'artist', fs.artist,
                       'artists', COALESCE(fs.artists, '[]'::jsonb),
                       'stageId', fs.stage_id,
                       'startTime', fs.start_time,
                       'endTime', fs.end_time,
                       'linkUrl', fs.link_url
                     )::jsonb
                       || CASE WHEN fs.moved_at IS NULL THEN '{}'::jsonb
                               ELSE jsonb_build_object('movedAt', fs.moved_at, 'movedFrom', fs.moved_from) END)
                     ORDER BY fs.sort_order ASC
                   )
                   FROM festival_sets fs
                   WHERE fs.festival_id = f.id AND fs.day_index = d.day_index),
                   '[]'::json
                 ) AS sets
               FROM festival_days d
               WHERE d.festival_id = f.id
             ) day_with_sets
            ),
            '[]'::json
          ) AS days
        FROM festivals f
        WHERE f.id = $1 AND f.deleted_at IS NULL
      `,
        [festivalId],
      );
      return result.rows[0] || null;
    },

    async hardDelete(festivalId: string) {
      return withTransaction(pool, async (client) => {
        // Crew grandchild rows (FK CASCADE from crews, but crews FK is RESTRICT from festivals)
        await client.query(
          'DELETE FROM crew_poll_votes WHERE poll_id IN (SELECT id FROM crew_polls WHERE crew_id IN (SELECT id FROM crews WHERE festival_id = $1))',
          [festivalId],
        );
        await client.query('DELETE FROM crew_polls WHERE crew_id IN (SELECT id FROM crews WHERE festival_id = $1)', [
          festivalId,
        ]);
        await client.query(
          'DELETE FROM crew_meeting_points WHERE crew_id IN (SELECT id FROM crews WHERE festival_id = $1)',
          [festivalId],
        );
        await client.query('DELETE FROM crew_expenses WHERE crew_id IN (SELECT id FROM crews WHERE festival_id = $1)', [
          festivalId,
        ]);
        await client.query('DELETE FROM crew_activity WHERE crew_id IN (SELECT id FROM crews WHERE festival_id = $1)', [
          festivalId,
        ]);
        await client.query('DELETE FROM crew_members WHERE crew_id IN (SELECT id FROM crews WHERE festival_id = $1)', [
          festivalId,
        ]);
        // Crews (FK RESTRICT from festivals)
        await client.query('DELETE FROM crews WHERE festival_id = $1', [festivalId]);
        // Child rows of festival_sets (FK RESTRICT — must delete before sets)
        await client.query(
          'DELETE FROM set_ratings WHERE set_id IN (SELECT id FROM festival_sets WHERE festival_id = $1)',
          [festivalId],
        );
        await client.query(
          'DELETE FROM festival_profile_picks WHERE set_id IN (SELECT id FROM festival_sets WHERE festival_id = $1)',
          [festivalId],
        );
        await client.query(
          'DELETE FROM festival_profile_notes WHERE set_id IN (SELECT id FROM festival_sets WHERE festival_id = $1)',
          [festivalId],
        );
        // Festival child tables
        await client.query('DELETE FROM festival_sets WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM festival_stages WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM festival_days WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM festival_profiles WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM calendar_tokens WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM notification_counts WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM notification_topic_subs WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM lineup_imports WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM festivals WHERE id = $1', [festivalId]);
      });
    },

    async create(festival: any) {
      // Insert festival with stages, days, sets (wrapped in transaction for consistency)
      return withTransaction(pool, async (client) => {
        const createdAt = festival.createdAt || new Date().toISOString();
        const updatedAt = festival.updatedAt || createdAt;

        await client.query(
          'INSERT INTO festivals (id, name, location, created_at, updated_at, b2b_separator, latitude, longitude, time_zone, map_config, published_at, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
          [
            festival.id,
            festival.name,
            festival.location || '',
            createdAt,
            updatedAt,
            festival.b2bSeparator || 'b2b',
            festival.latitude || null,
            festival.longitude || null,
            festival.timeZone ?? null,
            festival.mapConfig == null ? null : JSON.stringify(festival.mapConfig),
            // Only the admin create route passes null (a draft); every other caller publishes.
            festival.publishedAt === undefined ? new Date().toISOString() : festival.publishedAt,
            festival.updatedBy ?? null,
          ],
        );

        // Batch insert stages, days, and sets
        const { stageRows, dayRows, setRows } = collectFestivalChildren(festival.id, festival);
        await insertStagesBatch(client, stageRows);
        await insertDaysBatch(client, dayRows);
        await insertSetsBatch(client, setRows);
        // After the days, so the slug takes the first day's year. Drafts stay without one.
        await client.query(
          'UPDATE festivals SET slug = festival_next_slug(id) WHERE id = $1 AND slug IS NULL AND published_at IS NOT NULL',
          [festival.id],
        );

        const result = await client.query(
          `
          SELECT
            id,
            name,
            location,
            time_zone AS "timeZone",
            latitude,
            longitude,
            map_config AS "mapConfig",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            published_at AS "publishedAt",
            slug
          FROM
            festivals
          WHERE
            id = $1
            AND deleted_at IS NULL
        `,
          [festival.id],
        );
        return result.rows[0] || null;
      });
    },

    async update(festivalId: string, fields: any) {
      // fields: name, location, stages, days (wrapped in transaction for consistency)
      return withTransaction(pool, async (client) => {
        const sets: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (fields.name !== undefined) {
          sets.push(`name = $${idx}`);
          values.push(fields.name);
          idx++;
        }
        if (fields.location !== undefined) {
          sets.push(`location = $${idx}`);
          values.push(fields.location);
          idx++;
        }
        if (fields.b2bSeparator !== undefined) {
          sets.push(`b2b_separator = $${idx}`);
          values.push(fields.b2bSeparator);
          idx++;
        }
        if (fields.latitude !== undefined) {
          sets.push(`latitude = $${idx}`);
          values.push(fields.latitude);
          idx++;
        }
        if (fields.longitude !== undefined) {
          sets.push(`longitude = $${idx}`);
          values.push(fields.longitude);
          idx++;
        }
        if (fields.timeZone !== undefined) {
          sets.push(`time_zone = $${idx}`);
          values.push(fields.timeZone ?? null);
          idx++;
        }
        if (fields.mapConfig !== undefined) {
          sets.push(`map_config = $${idx}`);
          values.push(fields.mapConfig == null ? null : JSON.stringify(fields.mapConfig));
          idx++;
        }
        if (fields.updatedBy !== undefined) {
          sets.push(`updated_by = $${idx}`);
          values.push(fields.updatedBy);
          idx++;
        }
        sets.push(`updated_at = $${idx}`);
        values.push(new Date().toISOString());
        idx++;
        values.push(festivalId);

        await client.query(`UPDATE festivals SET ${sets.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`, values);

        // Upsert stages instead of delete-and-reinsert: festival_sets_stage_fkey is ON DELETE
        // CASCADE, so deleting a stage row would delete (or, with picks, fail on) its sets.
        const stageIds: string[] = (fields.stages || []).map((stage: any) => stage.id);
        if (fields.stages !== undefined) {
          const stageRows = (fields.stages || []).map((stage: any, sortOrder: number) => [
            festivalId,
            stage.id,
            stage.name,
            stage.color,
            sortOrder,
            stage.latitude ?? null,
            stage.longitude ?? null,
          ]);
          await upsertStagesBatch(client, stageRows);
        }

        // Update days and sets if provided (batch insert with pick/rating preservation)
        if (fields.days !== undefined) {
          const children = collectFestivalChildren(festivalId, { days: fields.days });
          await replaceChildRows(client, festivalId, children);
        }

        // Drop stages missing from the payload only once no set uses them, so this never
        // cascades into festival_sets. A map save without days keeps a stage that still has sets.
        if (fields.stages !== undefined) {
          await client.query(
            `DELETE FROM festival_stages st
             WHERE st.festival_id = $1
               AND NOT (st.id = ANY($2::text[]))
               AND NOT EXISTS (SELECT 1 FROM festival_sets s WHERE s.festival_id = st.festival_id AND s.stage_id = st.id)`,
            [festivalId, stageIds],
          );
        }

        const result = await client.query(
          `
          SELECT
            id,
            name,
            location,
            time_zone AS "timeZone",
            latitude,
            longitude,
            map_config AS "mapConfig",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            published_at AS "publishedAt"
          FROM
            festivals
          WHERE
            id = $1
            AND deleted_at IS NULL
        `,
          [festivalId],
        );
        return result.rows[0] || null;
      });
    },
  };

  return festivals;
}
