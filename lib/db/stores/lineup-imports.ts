// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Lineup import records: commit an import plan, list import history, undo the newest import.
 * Each import keeps the ids it created and the before/after values of the sets it changed,
 * because the festival editor save rewrites every festival_sets row.
 */

import crypto from 'crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool } from 'pg';
import { withTransactionRetry } from '../connection';
import { buildMultiInsert, insertSetsBatch } from './festivals';
import type { ArtistLookup, ArtistRef, LineupImportPlan, LineupImportWrites, SetValues } from '../../lineup-import-plan';
import { nextMoveMark, type SlotAt } from '../../set-moves';
import { resolveArtistRefs, resolveSetValues } from '../../artist-refs';
import { type ArtistViewer, viewerMask } from './artist-visibility';

import { lockFestival } from './festival-lock';
import { outsideLabelSql } from './organizations';

export { lockFestivalAny } from './festival-lock';

/** The second argument carries the locked artist rows, so the plan copies them instead of the earlier lookup. */
export type BuildPlan = (festival: any, lockedArtists?: Map<string, ArtistRef>) => { plan: LineupImportPlan; writes: LineupImportWrites };

export interface UndoResult {
  removed: number;
  restored: number;
  removedStages: number;
  removedDays: number;
  /** Announced lineup entries the import added, and entries it changed that were put back. */
  removedEntries: number;
  restoredEntries: number;
  /** Picks that interest conversion made on the removed sets and nobody changed. Their marks are open again. */
  autoPicksRemoved: number;
  /** For an entry, setId holds the entry id. */
  kept: { setId: string; artist: string; reason: 'picked' | 'edited' }[];
}

type DayMove = { from: number; to: number };

const sameText = (a: any, b: any) => (a ?? '') === (b ?? '');

type MarkContext = { published: boolean; now: Date };


const markContext = (festival: { published_at: Date | null }): MarkContext => ({
  published: festival.published_at != null,
  now: new Date(),
});

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
    return [s.id, festivalId, s.dayIndex, s.artist, s.stageId, s.startTime, s.endTime, sortOrder, s.linkUrl, JSON.stringify(s.artists), s.displayName ?? null];
  });
  await insertSetsBatch(client, setRows);
}

/** The set's "moved" mark after the write. Without a day move the day key is the position. */
async function nextImportMark(client: any, festivalId: string, setId: string, v: SetValues, ctx: MarkContext, move?: DayMove) {
  if (!ctx.published) return null;
  const { rows } = await client.query(
    'SELECT day_index, stage_id, start_time, end_time, moved_at, moved_from FROM festival_sets WHERE id = $1 AND festival_id = $2',
    [setId, festivalId],
  );
  const cur = rows[0];
  if (!cur) return null;
  const before: SlotAt = {
    dayKey: `#${cur.day_index}`,
    dayIndex: cur.day_index,
    stageId: cur.stage_id,
    start: cur.start_time,
    end: cur.end_time,
  };
  const toDay = move ? move.to : cur.day_index;
  const after: SlotAt = { dayKey: `#${toDay}`, dayIndex: toDay, stageId: v.stageId, start: v.startTime, end: v.endTime };
  const prior = cur.moved_at && cur.moved_from ? { movedAt: new Date(cur.moved_at), movedFrom: cur.moved_from } : null;
  return nextMoveMark(prior, before, after, ctx.now);
}

/**
 * Writes one set. A displayName of undefined leaves the stored name alone: undo restores values
 * that an older import saved before imports wrote display names. A day move puts the set last on its new day.
 */
async function writeSetValues(client: any, festivalId: string, setId: string, v: SetValues, ctx: MarkContext, move?: DayMove) {
  const mark = await nextImportMark(client, festivalId, setId, v, ctx, move);
  await client.query(
    `
  UPDATE festival_sets
  SET
    stage_id = $1,
    start_time = $2,
    end_time = $3,
    artist = $4,
    artists = $5,
    link_url = $6,
    moved_at = $9,
    moved_from = $10,
    display_name = CASE
      WHEN $11::boolean THEN $12
      ELSE display_name
    END
  WHERE
    id = $7
    AND festival_id = $8
`,
    [
      v.stageId,
      v.startTime,
      v.endTime,
      v.artist,
      JSON.stringify(v.artists),
      v.linkUrl,
      setId,
      festivalId,
      mark ? mark.movedAt.toISOString() : null,
      mark ? JSON.stringify(mark.movedFrom) : null,
      v.displayName !== undefined,
      v.displayName ?? null,
    ],
  );
  if (!move) return;
  await client.query(
    `
  UPDATE festival_sets
  SET
    day_index = $3,
    sort_order = (
      SELECT
        COALESCE(MAX(sort_order), -1) + 1
      FROM
        festival_sets
      WHERE
        festival_id = $1
        AND day_index = $3
    )
  WHERE
    id = $2
    AND festival_id = $1
`,
    [festivalId, setId, move.to],
  );
}

/** Adds and replaces announced lineup entries on the locked festival row. */
async function writeAnnounced(client: any, festivalId: string, announced: LineupImportWrites['announced']) {
  if (announced.inserts.length === 0 && announced.updates.length === 0) return;
  const { rows } = await client.query('SELECT lineup FROM festivals WHERE id = $1', [festivalId]);
  const stored: any[] = Array.isArray(rows[0]?.lineup) ? rows[0].lineup : [];
  const replaced = new Map(announced.updates.map((u) => [u.id, u.after]));
  const next = [...stored.map((e) => replaced.get(e.id) ?? e), ...announced.inserts.map((i) => i.entry)];
  await client.query('UPDATE festivals SET lineup = $2::jsonb WHERE id = $1', [festivalId, JSON.stringify(next)]);
}

/**
 * The locked live rows of the artists the plan attaches, or null when one was merged or is gone.
 * Rows lock in id order, as every other writer does, so two writers on the same artists cannot deadlock.
 * The share lock keeps them live and unchanged until commit.
 */
async function lockLiveArtists(client: any, ids: string[]): Promise<Map<string, ArtistRef> | null> {
  const locked = new Map<string, ArtistRef>();
  if (ids.length === 0) return locked;
  const { rows } = await client.query(
    `
  SELECT
    id,
    name,
    label,
    links,
    photo,
    genres,
    merged_into
  FROM
    artists
  WHERE
    id = ANY ($1::text[])
    AND merged_into IS NULL
  ORDER BY
    id
  FOR SHARE
`,
    [ids],
  );
  if (rows.length !== ids.length) return null;
  for (const r of rows) locked.set(r.id, artistRefOf(r));
  return locked;
}

function artistRefOf(r: any): ArtistRef {
  return {
    id: r.id,
    name: r.name,
    label: r.label,
    links: r.links ?? {},
    photo: r.photo ?? null,
    genres: Array.isArray(r.genres) ? r.genres : [],
    mergedInto: r.merged_into ?? null,
  };
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

/**
 * Takes back the picks that conversion made on these sets: the profile's converted mark lists the set as one it added,
 * the pick is still want-to-see, and the profile has no note, reminder or rating on it. The mark loses
 * the set id and goes back to `open` when none are left. Any other pick stays and keeps its set.
 * Returns the profiles it changed, so the caller can tell their open devices.
 */
async function removeConversionPicks(client: any, festivalId: string, setIds: string[], result: UndoResult) {
  const { rows } = await client.query(
    `
  SELECT
    fp.id,
    fp.interests_json AS marks,
    ARRAY(
      SELECT
        p.set_id
      FROM
        festival_profile_picks p
      WHERE
        p.profile_id = fp.id
        AND p.set_id = ANY ($2::text[])
        AND p.priority = 'want-to-see'
        AND NOT EXISTS (SELECT 1 FROM festival_profile_notes n WHERE n.profile_id = fp.id AND n.set_id = p.set_id)
        AND NOT (COALESCE(fp.reminders_json, '{}'::jsonb) ? p.set_id)
        AND NOT EXISTS (SELECT 1 FROM set_ratings sr WHERE sr.user_id = fp.user_id AND sr.set_id = p.set_id)
    ) AS candidates
  FROM
    festival_profiles fp
  WHERE
    fp.festival_id = $1
    AND fp.deleted_at IS NULL
    AND fp.interests_json <> '{}'::jsonb
  ORDER BY
    fp.id
  FOR UPDATE OF
    fp
`,
    [festivalId, setIds],
  );
  const changedProfileIds: string[] = [];
  for (const row of rows) {
    const marks: Record<string, any> = { ...row.marks };
    const removed = new Set<string>();
    for (const [entryId, mark] of Object.entries(marks)) {
      if (mark?.state !== 'converted') continue;
      const taken = (mark.added ?? []).filter((setId: string) => row.candidates.includes(setId));
      if (taken.length === 0) continue;
      taken.forEach((setId: string) => removed.add(setId));
      const left = (mark.sets ?? []).filter((setId: string) => !taken.includes(setId));
      const addedLeft = (mark.added ?? []).filter((setId: string) => !taken.includes(setId));
      marks[entryId] = left.length > 0 ? { ...mark, sets: left, added: addedLeft } : { state: 'open' };
    }
    if (removed.size === 0) continue;
    const ids = [...removed];
    await client.query('DELETE FROM festival_profile_picks WHERE profile_id = $1 AND set_id = ANY($2::text[])', [row.id, ids]);
    await client.query(
      `
  UPDATE festival_profiles
  SET
    interests_json = $2::jsonb,
    picks_json = COALESCE(picks_json, '{}'::jsonb) - $3::text[],
    updated_at = NOW()
  WHERE
    id = $1
`,
      [row.id, JSON.stringify(marks), ids],
    );
    result.autoPicksRemoved += ids.length;
    changedProfileIds.push(row.id);
  }
  return changedProfileIds;
}

/** Deletes the created sets nobody picked, noted, rated or set a reminder on. */
async function removeCreatedSets(client: any, festivalId: string, setIds: string[], result: UndoResult) {
  if (setIds.length === 0) return [];
  const changedProfileIds = await removeConversionPicks(client, festivalId, setIds, result);
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
  if (removable.length === 0) return changedProfileIds;
  // eslint-disable-next-line require-atomic-updates -- result is owned by this undo call, not shared
  result.removed = removable.length;
  await client.query('DELETE FROM festival_sets WHERE festival_id = $1 AND id = ANY($2::text[])', [festivalId, removable]);
  return changedProfileIds;
}

/** True when the day the set moved from still exists, so the set can go back. */
async function dayExists(client: any, festivalId: string, dayIndex: number): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM festival_days WHERE festival_id = $1 AND day_index = $2', [
    festivalId,
    dayIndex,
  ]);
  return rows.length > 0;
}

/** Puts back each changed set that nobody edited after the import. */
async function restoreUpdatedSets(
  client: any,
  festivalId: string,
  updated: any[],
  result: UndoResult,
  ctx: MarkContext,
) {
  const restoredIds: string[] = [];
  const { rows: currentRows } = await client.query(
    'SELECT id, stage_id, start_time, end_time, artist, artists, link_url, display_name, day_index FROM festival_sets WHERE id = ANY($1::text[]) AND festival_id = $2',
    [updated.map((u) => u.id), festivalId],
  );
  const currentById = new Map<string, any>(currentRows.map((row: any) => [row.id, row]));
  for (const u of updated) {
    const cur = currentById.get(u.id);
    const move: DayMove | undefined = u.dayMove;
    // An artist edit rewrites the flat name and link of every set that lists the artist. Those sets
    // still list the same artist ids, so the rewrite is not a hand edit of the set.
    const idsOf = (list: any) => (Array.isArray(list) ? list.map((a: any) => a?.id ?? '') : []);
    const sameArtistIds = idsOf(cur?.artists).length > 0 && idsOf(cur?.artists).join() === idsOf(u.after.artists).join() && !idsOf(cur?.artists).includes('');
    // Records from before display names carry no displayName, so that column is not compared for them.
    const untouched =
      cur &&
      sameText(cur.stage_id, u.after.stageId) &&
      sameText(cur.start_time, u.after.startTime) &&
      sameText(cur.end_time, u.after.endTime) &&
      ((sameText(cur.artist, u.after.artist) && sameText(cur.link_url, u.after.linkUrl)) || sameArtistIds) &&
      (u.after.displayName === undefined || sameText(cur.display_name, u.after.displayName)) &&
      (!move || cur.day_index === move.to);
    if (!untouched || (move && !(await dayExists(client, festivalId, move.from)))) {
      result.kept.push({ setId: u.id, artist: cur?.artist ?? u.after.artist, reason: 'edited' });
      continue;
    }
    await writeSetValues(client, festivalId, u.id, u.before, ctx, move ? { from: move.to, to: move.from } : undefined);
    result.restored++;
    restoredIds.push(u.id);
  }
  await canonicalizeRestoredSets(client, festivalId, restoredIds);
}

/**
 * The restored sets hold the artist copies from before the import. An artist edit may have changed
 * the artist since, so tie each restored set to its artists row again: canonical name and links.
 */
async function canonicalizeRestoredSets(client: any, festivalId: string, setIds: string[]) {
  if (setIds.length === 0) return;
  const { rows: festival } = await client.query("SELECT COALESCE(b2b_separator, 'b2b') AS separator FROM festivals WHERE id = $1", [
    festivalId,
  ]);
  const { rows } = await client.query(
    `SELECT id, artist, artists, link_url, display_name FROM festival_sets
      WHERE festival_id = $1 AND id = ANY($2::text[]) AND jsonb_typeof(artists) = 'array' AND jsonb_array_length(artists) > 0`,
    [festivalId, setIds],
  );
  const targets = rows.map((row: any) => ({
    id: row.id,
    values: { artists: row.artists, artist: row.artist, linkUrl: row.link_url ?? null, displayName: row.display_name ?? null },
  }));
  await resolveSetValues(client, { festivalId, separator: festival[0]?.separator ?? 'b2b', userId: null }, targets);
  if (targets.length === 0) return;
  await client.query(
    `
  UPDATE festival_sets s
  SET
    artists = v.artists::jsonb,
    artist = v.artist,
    link_url = v.link_url,
    display_name = v.display_name
  FROM
    unnest(
      $1::text[],
      $2::text[],
      $3::text[],
      $4::text[],
      $5::text[]
    ) AS v (id, artists, artist, link_url, display_name)
  WHERE
    s.id = v.id
`,
    [
      targets.map((t: any) => t.id),
      targets.map((t: any) => JSON.stringify(t.values.artists)),
      targets.map((t: any) => t.values.artist),
      targets.map((t: any) => t.values.linkUrl),
      targets.map((t: any) => t.values.displayName ?? null),
    ],
  );
}

/**
 * An artist edit rewrites the name and links inside every entry that lists the artist. Entries that still
 * list the same artist ids are the same entry, so the artist elements compare by id.
 */
const entryShape = (entry: any) => ({ ...entry, artists: (entry?.artists ?? []).map((a: any) => (a?.id ? { id: a.id } : a)) });

/** Removes the entries the import added and puts back the ones it changed, unless someone edited them since. */
async function restoreAnnouncedEntries(client: any, festivalId: string, items: any[], result: UndoResult) {
  if (items.length === 0) return;
  const { rows } = await client.query('SELECT lineup FROM festivals WHERE id = $1', [festivalId]);
  const lineup: any[] = Array.isArray(rows[0]?.lineup) ? [...rows[0].lineup] : [];
  let changed = false;
  const restored: any[] = [];
  for (const item of items) {
    const at = lineup.findIndex((e) => e?.id === item.id);
    if (at < 0 || !isDeepStrictEqual(entryShape(lineup[at]), entryShape(item.after))) {
      const artist = (item.after?.artists ?? []).map((a: any) => a?.name).join(' b2b ');
      result.kept.push({ setId: item.id, artist, reason: 'edited' });
      continue;
    }
    changed = true;
    if (item.before === null) {
      lineup.splice(at, 1);
      result.removedEntries++;
    } else {
      lineup[at] = structuredClone(item.before);
      restored.push(lineup[at]);
      result.restoredEntries++;
    }
  }
  if (!changed) return;
  if (restored.length > 0) {
    // The restored entries hold artist copies from before the import. Tie them to their artists rows again.
    const refs = await resolveArtistRefs(client, { festivalId, lineup: restored, separator: 'b2b', userId: null });
    refs.lineup!.forEach((entry: any, i: number) => {
      restored[i].artists = entry.artists;
      if (entry.displayName) restored[i].displayName = entry.displayName;
    });
  }
  await client.query('UPDATE festivals SET lineup = $2::jsonb WHERE id = $1', [festivalId, JSON.stringify(lineup)]);
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
    async commit(festivalId: string, buildPlan: BuildPlan, meta: { createdBy: string | null; viewer?: ArtistViewer }) {
      return withTransactionRetry(pool, async (client) => {
        const locked = await lockFestival(client, festivalId);
        if (!locked) return { notFound: true as const };
        const ctx = markContext(locked);
        const festival = await festivals.getById(festivalId, client);
        const first = buildPlan(festival);
        if (first.plan.counts.error > 0 || first.plan.problems.length > 0) return { committed: false as const, plan: first.plan };
        // Festival lock first, then artists: the one lock order of every writer.
        const lockedArtists = await lockLiveArtists(client, first.writes.artistIds);
        if (!lockedArtists) {
          first.plan.problems.push('An artist changed while you were importing. Check the rows again.');
          return { committed: false as const, plan: first.plan };
        }
        // Re-plan from the locked rows, so an artist edited since the lookup gives its current name and links.
        const { plan, writes } = first.writes.artistIds.length > 0 ? buildPlan(festival, lockedArtists) : first;
        if (plan.counts.error > 0 || plan.problems.length > 0) return { committed: false as const, plan };

        // Every artist element gets the artists row's name and links, and the flat name and link follow.
        const refs = await resolveSetValues(
          client,
          { festivalId, separator: festival.b2bSeparator || 'b2b', userId: meta.createdBy, fillEmptyLinks: true, viewer: meta.viewer },
          [
            ...writes.inserts.map((s) => ({ id: s.id, values: s })),
            ...writes.updates.map((u) => ({ id: u.setId, values: u.after })),
          ],
        );
        // Announced entries get the same treatment, so their artist elements carry ids and canonical links too.
        const entries = [...writes.announced.inserts.map((i) => i.entry), ...writes.announced.updates.map((u) => u.after)];
        if (entries.length > 0) {
          const resolved = await resolveArtistRefs(client, {
            festivalId,
            lineup: entries,
            separator: festival.b2bSeparator || 'b2b',
            userId: meta.createdBy,
            fillEmptyLinks: true,
            viewer: meta.viewer,
          });
          resolved.lineup!.forEach((entry: any, i: number) => {
            entries[i]!.artists = entry.artists;
            if (entry.displayName) entries[i]!.displayName = entry.displayName;
          });
          refs.ignoredLinkEdits += resolved.ignoredLinkEdits;
          for (const fill of resolved.linkFills) {
            if (!refs.linkFills.some((f) => f.artistId === fill.artistId && f.platform === fill.platform)) refs.linkFills.push(fill);
          }
        }

        await insertNewStages(client, festivalId, writes.newStages);
        await insertNewDays(client, festivalId, writes.newDays);
        await insertNewSets(client, festivalId, writes.inserts);
        for (const u of writes.updates) await writeSetValues(client, festivalId, u.setId, u.after, ctx, u.dayMove);
        await writeAnnounced(client, festivalId, writes.announced);
        await client.query('UPDATE festivals SET updated_at = NOW(), edited_at = NOW() WHERE id = $1', [festivalId]);

        const importId = `import-${crypto.randomBytes(8).toString('hex')}`;
        const counts = {
          created: writes.inserts.length,
          updated: writes.updates.length,
          newStages: writes.newStages.length,
          newDays: writes.newDays.length,
          announced: writes.announced.inserts.length,
          announcedUpdated: writes.announced.updates.length,
        };
        // An import that changed nothing has nothing to undo. Store it as already undone
        // so it never becomes the "newest open" import that blocks undoing the real ones.
        const changedNothing = Object.values(counts).every((n) => n === 0);
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
      updated_sets,
      undone_at
    )
  VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`,
          [
            importId,
            festivalId,
            meta.createdBy,
            JSON.stringify(counts),
            writes.inserts.map((s) => s.id),
            writes.newStages.map((s) => s.id),
            writes.newDays.map((d) => d.dayIndex),
            // Announced entries share the column: an item with kind "entry" has before null for an added entry.
            JSON.stringify([
              ...writes.updates.map((u) => ({ id: u.setId, before: u.before, after: u.after, ...(u.dayMove ? { dayMove: u.dayMove } : {}) })),
              ...writes.announced.inserts.map((i) => ({ kind: 'entry', id: i.entry.id, before: null, after: i.entry })),
              ...writes.announced.updates.map((u) => ({ kind: 'entry', id: u.id, before: u.before, after: u.after })),
            ]),
            changedNothing ? new Date().toISOString() : null,
          ],
        );
        return { committed: true as const, plan, writes, importId, refs };
      });
    },

    /**
     * The live artists whose key is in keys, and every artist whose id is in ids (merged ones too, so a
     * stale id gets a clear message). Read before the plan runs; commit checks the ids again under lock.
     */
    async lookupArtists(keys: string[], ids: string[], viewer?: ArtistViewer): Promise<ArtistLookup> {
      const lookup: ArtistLookup = { byKey: new Map(), byId: new Map() };
      if (keys.length === 0 && ids.length === 0) return lookup;
      const { rows } = await pool.query(
        `
  SELECT
    id,
    name,
    name_key,
    label,
    links,
    photo,
    genres,
    merged_into
  FROM
    artists
  WHERE
    (
      merged_into IS NULL
      AND name_key = ANY ($1::text[])
    )
    OR id = ANY ($2::text[])
  ORDER BY
    lower(label),
    id
`,
        [keys, ids],
      );
      // An organizer sees only visible artists, and may link by name only the ones it owns or that are verified.
      const mask = viewer ? await viewerMask(pool, viewer, rows.map((r: { id: string }) => r.id)) : null;
      for (const r of rows) {
        if (mask && !mask.has(r.id)) continue;
        const ref = artistRefOf(r);
        if (mask && !mask.get(r.id)!.linkable) ref.pickOnly = true;
        lookup.byId.set(ref.id, ref);
        if (!ref.mergedInto) lookup.byKey.set(r.name_key, [...(lookup.byKey.get(r.name_key) ?? []), ref]);
      }
      return lookup;
    },

    /**
     * The newest 20 imports, or null when the festival does not exist. With `viewerOrganizationId` the creator
     * reads as "<display name> at <organization>" for a member of that organization, as "Festie support" for
     * a platform admin and as "A former teammate" for anyone else. An organizer never sees an attendee username.
     */
    async list(festivalId: string, viewerOrganizationId: string | null = null) {
      const fest = await pool.query('SELECT name FROM festivals WHERE id = $1 AND deleted_at IS NULL', [festivalId]);
      if (fest.rows.length === 0) return null;
      const { rows } = await pool.query(
        `
  SELECT
    li.id,
    li.created_at,
    li.counts,
    li.undone_at,
    CASE
      WHEN u.id IS NULL OR $2::text IS NULL THEN u.username
      WHEN EXISTS (
        SELECT 1 FROM organization_members m WHERE m.organization_id = $2 AND m.user_id = u.id
      ) THEN COALESCE(NULLIF(btrim(u.display_name), ''), 'A teammate') || ' at ' || (SELECT o.name FROM organizations o WHERE o.id = $2)
      ELSE ${outsideLabelSql('u.id')}
    END AS username,
    (
      SELECT
        COALESCE(array_agg(DISTINCT d.date ORDER BY d.date), '{}')
      FROM
        festival_sets s
        JOIN festival_days d ON d.festival_id = s.festival_id
        AND d.day_index = s.day_index
      WHERE
        s.festival_id = li.festival_id
        AND d.date <> ''
        AND (
          s.id = ANY (li.created_set_ids)
          OR s.id IN (
            SELECT
              u2 ->> 'id'
            FROM
              jsonb_array_elements(li.updated_sets) u2
          )
        )
    ) AS touched_dates
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
        [festivalId, viewerOrganizationId],
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
            announced: r.counts?.announced ?? 0,
            announcedUpdated: r.counts?.announcedUpdated ?? 0,
          },
          undoneAt: r.undone_at ? new Date(r.undone_at).toISOString() : null,
          canUndo: r.id === newestOpen,
          // The festival dates this import wrote to, so the undo dialog can warn that a sent alert stays sent.
          touchedDates: (r.touched_dates ?? []) as string[],
        })),
      };
    },

    /** Undoes the newest import that is not undone yet. */
    async undo(festivalId: string, importId: string) {
      return withTransactionRetry(pool, async (client) => {
        const locked = await lockFestival(client, festivalId);
        if (!locked) return { notFound: true as const };
        const { rows } = await client.query(
          'SELECT * FROM lineup_imports WHERE id = $1 AND festival_id = $2 FOR UPDATE',
          [importId, festivalId],
        );
        const record = rows[0];
        if (!record) return { notFound: true as const };
        if (record.undone_at || (await newestOpenImportId(client, festivalId)) !== importId) {
          return { refused: true as const };
        }
        // The undo would restore artist copies from before the backfill gave every element an id.
        const { rowCount: backfilled } = await client.query(
          'SELECT 1 FROM artist_backfill_runs WHERE festival_id = $1 AND created_at > $2 LIMIT 1',
          [festivalId, record.created_at],
        );
        if (backfilled) return { olderThanUpgrade: true as const };

        const result: UndoResult = {
          removed: 0,
          restored: 0,
          removedStages: 0,
          removedDays: 0,
          removedEntries: 0,
          restoredEntries: 0,
          autoPicksRemoved: 0,
          kept: [],
        };
        const items: any[] = record.updated_sets || [];
        const changedProfileIds = await removeCreatedSets(client, festivalId, record.created_set_ids, result);
        await restoreUpdatedSets(client, festivalId, items.filter((i) => i.kind !== 'entry'), result, markContext(locked));
        await restoreAnnouncedEntries(client, festivalId, items.filter((i) => i.kind === 'entry'), result);
        await removeCreatedStagesAndDays(client, festivalId, record, result);
        await client.query('UPDATE lineup_imports SET undone_at = NOW(), undo_summary = $2 WHERE id = $1', [
          importId,
          JSON.stringify(result),
        ]);
        await client.query('UPDATE festivals SET updated_at = NOW(), edited_at = NOW() WHERE id = $1', [festivalId]);
        return { result, changedProfileIds };
      });
    },
  };
}
