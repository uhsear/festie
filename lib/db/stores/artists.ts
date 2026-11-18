// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The artists table: match, create, edit, usage lists, and syncArtistCopies, which rewrites the copy
 * of an artist that every set and announced-lineup entry holds. An edit changes past festivals too.
 *
 * Lock order for every writer: festivals in id order, then artists in id order. An
 * artist edit does not know which festivals it needs until it reads them, so it reads the ids, locks
 * those festivals, locks the artist, then reads the ids again. A new id means a save added the artist
 * to a festival in between: the transaction rolls back with a retryable error and starts again.
 */

import type { Pool } from 'pg';
import { withTransactionRetry } from '../connection';
import { createOpaqueId } from '../../helpers';
import { sanitizeString } from '../../helpers/sanitize';
import { artistNameKey } from '../../artist-key';
import { detectPlatform, normalizeArtistLink } from '../../artist-links';
import { todayInZone } from '../../lineup';
import { lockFestivalAny } from './lineup-imports';

export const MAX_ARTIST_NAME = 300;
export const MAX_ARTIST_LABEL = 40;
export const MAX_MATCH_ITEMS = 500;
const MAX_CANDIDATES = 10;

type Links = Record<string, string>;

export interface ArtistRecord {
  id: string;
  name: string;
  name_key: string;
  label: string;
  spotify_id: string | null;
  links: Links | null;
  photo: string | null;
  genres: string[] | null;
  merged_into: string | null;
  updated_at: Date;
}

const ARTIST_COLUMNS = 'id, name, name_key, label, spotify_id, links, photo, genres, merged_into, updated_at';

/** A refusal the route turns into an HTTP answer. `details` is sent with it. */
export class ArtistError extends Error {
  constructor(
    public status: number,
    public code: 'INVALID_INPUT' | 'NOT_FOUND' | 'ARTIST_EXISTS' | 'ARTIST_CHANGED',
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ArtistError';
  }
}

/** The error a transaction throws to start over: withTransactionRetry retries 40001. */
function retryTransaction(reason: string): Error {
  return Object.assign(new Error(reason), { code: '40001' });
}

const iso = (value: unknown) => (value ? new Date(value as any).toISOString() : null);

export function publicArtist(row: ArtistRecord) {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    links: row.links ?? {},
    photo: row.photo,
    genres: row.genres ?? [],
    spotifyId: row.spotify_id,
    updatedAt: iso(row.updated_at) as string,
  };
}

/** The note: Unicode NFKC, trimmed, runs of spaces collapsed. Null when it is over the limit. */
export function cleanLabel(raw: unknown): string | null {
  const label = sanitizeString(typeof raw === 'string' ? raw.normalize('NFKC') : '', 200).replace(/\s+/g, ' ').trim();
  return label.length > MAX_ARTIST_LABEL ? null : label;
}

export const cleanArtistName = (raw: unknown) => sanitizeString(raw, MAX_ARTIST_NAME);

const shownName = (artist: { name: string; label: string }) => (artist.label ? `${artist.name} (${artist.label})` : artist.name);

/** The name with its note, for a message. */
export const artistTitle = shownName;

/** Live artists whose key is in `keys`, newest id order, grouped by key. */
export async function liveArtistsByKey(db: { query: Pool['query'] }, keys: string[]): Promise<Map<string, ArtistRecord[]>> {
  const out = new Map<string, ArtistRecord[]>();
  if (keys.length === 0) return out;
  const { rows } = await db.query(
    `SELECT ${ARTIST_COLUMNS} FROM artists WHERE name_key = ANY($1::text[]) AND merged_into IS NULL ORDER BY lower(label), id`,
    [keys],
  );
  for (const row of rows as ArtistRecord[]) out.set(row.name_key, [...(out.get(row.name_key) ?? []), row]);
  return out;
}

export async function liveArtistsBySpotifyId(db: { query: Pool['query'] }, spotifyIds: string[]): Promise<Map<string, ArtistRecord>> {
  const out = new Map<string, ArtistRecord>();
  if (spotifyIds.length === 0) return out;
  const { rows } = await db.query(
    `SELECT ${ARTIST_COLUMNS} FROM artists WHERE spotify_id = ANY($1::text[]) AND merged_into IS NULL`,
    [spotifyIds],
  );
  for (const row of rows as ArtistRecord[]) out.set(row.spotify_id!, row);
  return out;
}

/**
 * Each id's live artist. An id that is a tombstone follows merged_into to the survivor. An unknown id
 * maps to nothing. A chain is at most a few rows long (a merge re-points older tombstones).
 */
export async function resolveArtistIds(db: { query: Pool['query'] }, ids: string[]): Promise<Map<string, ArtistRecord>> {
  const out = new Map<string, ArtistRecord>();
  if (ids.length === 0) return out;
  const { rows } = await db.query(
    `
  WITH RECURSIVE
    chain AS (
      SELECT id AS asked, id, merged_into, 0 AS depth FROM artists WHERE id = ANY($1::text[])
      UNION ALL
      SELECT c.asked, a.id, a.merged_into, c.depth + 1 FROM chain c JOIN artists a ON a.id = c.merged_into WHERE c.depth < 10
    )
  SELECT c.asked, ${ARTIST_COLUMNS.split(', ').map((col) => `a.${col}`).join(', ')}
  FROM chain c JOIN artists a ON a.id = c.id
  WHERE c.merged_into IS NULL
`,
    [ids],
  );
  for (const row of rows) out.set(row.asked, row as ArtistRecord);
  return out;
}

/**
 * Locks live artist rows FOR SHARE, in id order, and returns their current versions. A festival save
 * calls it after it holds the festival lock, so an artist edit (which takes FOR UPDATE) waits for the
 * save to commit, then finds the festival in its second read and starts over. READ COMMITTED re-reads
 * a row that changed while the lock waited, so the save copies the newest name and links.
 */
export async function lockArtistRows(client: any, ids: string[]): Promise<Map<string, ArtistRecord>> {
  const out = new Map<string, ArtistRecord>();
  if (ids.length === 0) return out;
  const { rows } = await client.query(
    `SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = ANY($1::text[]) AND merged_into IS NULL ORDER BY id FOR SHARE`,
    [[...ids].sort()],
  );
  for (const row of rows as ArtistRecord[]) out.set(row.id, row);
  return out;
}

const ELEMENT_IDS_OF_SETS = `
  SELECT s.festival_id, a->>'id' AS artist_id
  FROM festival_sets s, jsonb_array_elements(CASE WHEN jsonb_typeof(s.artists) = 'array' THEN s.artists ELSE '[]'::jsonb END) a
  WHERE a->>'id' = ANY($1::text[])`;

const ELEMENT_IDS_OF_LINEUPS = `
  SELECT f.id AS festival_id, a->>'id' AS artist_id
  FROM festivals f,
    jsonb_array_elements(CASE WHEN jsonb_typeof(f.lineup) = 'array' THEN f.lineup ELSE '[]'::jsonb END) e,
    jsonb_array_elements(CASE WHEN jsonb_typeof(e->'artists') = 'array' THEN e->'artists' ELSE '[]'::jsonb END) a
  WHERE a->>'id' = ANY($1::text[])`;

export interface ArtistUse {
  artistId: string;
  festivalId: string;
  name: string;
  published: boolean;
  deleted: boolean;
  firstDate: string | null;
  lastDate: string | null;
  timeZone: string | null;
}

/** Every festival that lists each artist on a set or in its announced lineup, archived ones included. */
export async function artistUses(db: { query: Pool['query'] }, artistIds: string[]): Promise<Map<string, ArtistUse[]>> {
  const out = new Map<string, ArtistUse[]>();
  if (artistIds.length === 0) return out;
  const { rows } = await db.query(
    `
  SELECT
    u.artist_id AS "artistId",
    f.id AS "festivalId",
    f.name,
    f.published_at IS NOT NULL AS published,
    f.deleted_at IS NOT NULL AS deleted,
    (SELECT MIN(d.date) FROM festival_days d WHERE d.festival_id = f.id AND d.date <> '') AS "firstDate",
    (SELECT MAX(d.date) FROM festival_days d WHERE d.festival_id = f.id AND d.date <> '') AS "lastDate",
    f.time_zone AS "timeZone"
  FROM (${ELEMENT_IDS_OF_SETS} UNION ${ELEMENT_IDS_OF_LINEUPS}) u
  JOIN festivals f ON f.id = u.festival_id
  ORDER BY "firstDate" DESC NULLS LAST, f.id
`,
    [artistIds],
  );
  for (const row of rows as ArtistUse[]) out.set(row.artistId, [...(out.get(row.artistId) ?? []), row]);
  return out;
}

/** Ids of the festivals that list one artist, archived ones included, in id order. Takes no locks. */
async function festivalIdsUsing(client: any, artistId: string): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT DISTINCT festival_id FROM (${ELEMENT_IDS_OF_SETS} UNION ${ELEMENT_IDS_OF_LINEUPS}) u ORDER BY festival_id`,
    [[artistId]],
  );
  return rows.map((row: any) => row.festival_id);
}

/** The element with the artist row's name, links, photo and genres. Other keys stay. */
function copyOf(element: any, artist: Pick<ArtistRecord, 'name' | 'links' | 'photo' | 'genres'>) {
  const { photo: _photo, genres: _genres, ...rest } = element;
  return {
    ...rest,
    name: artist.name,
    links: { ...(artist.links ?? {}) },
    ...(artist.photo ? { photo: artist.photo } : {}),
    ...(artist.genres?.length ? { genres: artist.genres } : {}),
  };
}

export interface SyncedFestival {
  id: string;
  published: boolean;
  timeZone: string | null;
  lastDate: string | null;
  /** Sets whose copy changed, for the Spotify preview cache. */
  setIds: string[];
}

/**
 * Rewrites the copy of one artist in every set and lineup entry of the festivals in `festivalIds`
 * (all locked by the caller). The flat `artist` follows only where it equals the old joined names:
 * display_name is the durable per-set override. link_url follows the first artist's Spotify link.
 * updated_at moves so the list version and the caches change; edited_at does not.
 */
async function rewriteCopies(client: any, festivalIds: string[], artist: ArtistRecord): Promise<SyncedFestival[]> {
  if (festivalIds.length === 0) return [];
  const { rows: festivals } = await client.query(
    `SELECT id, COALESCE(b2b_separator, 'b2b') AS separator, lineup, published_at, time_zone,
            (SELECT MAX(d.date) FROM festival_days d WHERE d.festival_id = festivals.id AND d.date <> '') AS last_date
       FROM festivals WHERE id = ANY($1::text[])`,
    [festivalIds],
  );
  const { rows: sets } = await client.query(
    `SELECT id, festival_id, artist, artists, link_url FROM festival_sets
      WHERE festival_id = ANY($1::text[]) AND jsonb_typeof(artists) = 'array' AND artists @> $2::jsonb`,
    [festivalIds, JSON.stringify([{ id: artist.id }])],
  );
  const separatorOf = new Map<string, string>(festivals.map((f: any) => [f.id, f.separator || 'b2b']));
  const joined = (elements: any[], separator: string) => elements.map((e) => e?.name).join(` ${separator} `);
  const changedSets = new Map<string, string[]>();
  for (const set of sets) {
    const separator = separatorOf.get(set.festival_id) ?? 'b2b';
    const next = set.artists.map((e: any) => (e?.id === artist.id ? copyOf(e, artist) : e));
    const flat = set.artist === joined(set.artists, separator) ? joined(next, separator) : set.artist;
    const linkUrl = next[0]?.links?.spotify ?? null;
    if (JSON.stringify(next) === JSON.stringify(set.artists) && flat === set.artist && linkUrl === (set.link_url ?? null)) continue;
    await client.query('UPDATE festival_sets SET artists = $2::jsonb, artist = $3, link_url = $4 WHERE id = $1', [
      set.id,
      JSON.stringify(next),
      flat,
      linkUrl,
    ]);
    changedSets.set(set.festival_id, [...(changedSets.get(set.festival_id) ?? []), set.id]);
  }
  for (const festival of festivals) {
    if (!Array.isArray(festival.lineup)) continue;
    let changed = false;
    const lineup = festival.lineup.map((entry: any) => ({
      ...entry,
      artists: (entry?.artists ?? []).map((e: any) => {
        if (e?.id !== artist.id) return e;
        changed = true;
        return copyOf(e, artist);
      }),
    }));
    if (changed) await client.query('UPDATE festivals SET lineup = $2::jsonb WHERE id = $1', [festival.id, JSON.stringify(lineup)]);
  }
  await client.query('UPDATE festivals SET updated_at = now() WHERE id = ANY($1::text[])', [festivalIds]);
  return festivals.map((f: any) => ({
    id: f.id,
    published: f.published_at != null,
    timeZone: f.time_zone ?? null,
    lastDate: f.last_date ?? null,
    setIds: changedSets.get(f.id) ?? [],
  }));
}

/** True when the festival's last day, in its own time zone, is today or later (one day of grace). */
export function isCurrentOrUpcoming(festival: { timeZone: string | null; lastDate: string | null }, now: Date = new Date()): boolean {
  if (!festival.lastDate) return true;
  const yesterday = new Date(Date.parse(`${todayInZone(festival.timeZone, now)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return festival.lastDate >= yesterday;
}

export interface ArtistChanges {
  name?: string;
  label?: string;
  /** One raw link. The server detects the platform from the host and cleans it. */
  addLink?: string;
  /** Platform keys to remove. */
  removeLinks?: string[];
  /** Sets or, with null, clears the Spotify link. Used by the single-link set route that old apps call. */
  spotifyLink?: string | null;
}

/** The next name, note and links for a PATCH, or an ArtistError that says what to fix. */
function applyChanges(current: ArtistRecord, changes: ArtistChanges) {
  let name = current.name;
  let label = current.label;
  const links: Links = { ...(current.links ?? {}) };
  if (changes.name !== undefined) {
    name = cleanArtistName(changes.name);
    if (!name) throw new ArtistError(400, 'INVALID_INPUT', 'The name cannot be empty.');
  }
  if (changes.label !== undefined) {
    const cleaned = cleanLabel(changes.label);
    if (cleaned === null) throw new ArtistError(400, 'INVALID_INPUT', `The note can be at most ${MAX_ARTIST_LABEL} characters.`);
    label = cleaned;
  }
  for (const platform of changes.removeLinks ?? []) delete links[platform];
  if (changes.spotifyLink !== undefined) {
    delete links.spotify;
    if (changes.spotifyLink) {
      const result = normalizeArtistLink('spotify', changes.spotifyLink);
      if (!result.ok) throw new ArtistError(400, 'INVALID_INPUT', result.message);
      links.spotify = result.url;
    }
  }
  if (changes.addLink !== undefined) {
    const platform = detectPlatform(changes.addLink) ?? 'website';
    const result = normalizeArtistLink(platform, changes.addLink);
    if (!result.ok) throw new ArtistError(400, 'INVALID_INPUT', result.message);
    links[platform] = result.url;
  }
  const spotifyId = links.spotify ? (normalizeArtistLink('spotify', links.spotify) as { spotifyId?: string }).spotifyId ?? null : null;
  return { name, label, links, spotifyId, key: artistNameKey(name) };
}

/** Another live artist that would clash with the next key and note, or Spotify id. Throws the 409. */
async function assertNoClash(client: any, id: string, next: { key: string; label: string; spotifyId: string | null }) {
  const { rows: sameKey } = await client.query(
    `SELECT ${ARTIST_COLUMNS} FROM artists WHERE name_key = $1 AND lower(label) = lower($2) AND merged_into IS NULL AND id <> $3`,
    [next.key, next.label, id],
  );
  if (sameKey[0]) {
    throw new ArtistError(
      409,
      'ARTIST_EXISTS',
      `${shownName(sameKey[0])} already exists. Pick that artist, or use a different note.`,
      { existingId: sameKey[0].id },
    );
  }
  if (!next.spotifyId) return;
  const { rows: sameSpotify } = await client.query(
    `SELECT ${ARTIST_COLUMNS} FROM artists WHERE spotify_id = $1 AND merged_into IS NULL AND id <> $2`,
    [next.spotifyId, id],
  );
  if (sameSpotify[0]) {
    throw new ArtistError(
      409,
      'ARTIST_EXISTS',
      `This Spotify artist is already linked to '${shownName(sameSpotify[0])}'. Use that artist, or ask an admin to merge them.`,
      { existingId: sameSpotify[0].id },
    );
  }
}

/** Maps a unique-index race (23505) on an artist index to the same 409 the checks give. */
export function artistConflict(error: any): ArtistError | null {
  if (error?.code !== '23505') return null;
  const spotify = String(error.constraint ?? '').includes('spotify');
  return new ArtistError(
    409,
    'ARTIST_EXISTS',
    spotify
      ? 'This Spotify artist is already linked to another artist. Use that artist, or ask an admin to merge them.'
      : 'An artist with that name and note already exists. Pick that artist, or use a different note.',
  );
}

export interface MatchItem {
  name: string;
  spotify?: string | null;
}

export type MatchOutcome = 'linked' | 'pick' | 'new';

export function createArtistsStore(pool: Pool) {
  const candidatesOf = (rows: ArtistRecord[], uses: Map<string, ArtistUse[]>) => {
    return rows.slice(0, MAX_CANDIDATES).map((row) => {
      const live = (uses.get(row.id) ?? []).filter((u) => !u.deleted);
      return {
        id: row.id,
        name: row.name,
        label: row.label,
        photo: row.photo,
        platforms: Object.keys(row.links ?? {}),
        lastFestival: live[0] ? { id: live[0].festivalId, name: live[0].name } : null,
      };
    });
  };

  return {
    /**
     * For each name, the live artists it could be. A Spotify artist link whose id belongs to a live
     * artist, or exactly one live artist with the same key, is "linked". Two or more is "pick".
     */
    async match(items: MatchItem[]) {
      const prepared = items.map((item) => {
        const name = cleanArtistName(item.name);
        const result = item.spotify ? normalizeArtistLink('spotify', item.spotify) : null;
        return { name, key: name ? artistNameKey(name) : '', spotifyId: result?.ok ? (result.spotifyId ?? null) : null };
      });
      const [byKey, bySpotify] = await Promise.all([
        liveArtistsByKey(pool, [...new Set(prepared.map((p) => p.key).filter(Boolean))]),
        liveArtistsBySpotifyId(pool, [...new Set(prepared.map((p) => p.spotifyId).filter((id): id is string => !!id))]),
      ]);
      const rowsOf = (p: (typeof prepared)[number]) => {
        const spotifyHit = p.spotifyId ? bySpotify.get(p.spotifyId) : undefined;
        return spotifyHit ? [spotifyHit] : (byKey.get(p.key) ?? []);
      };
      // One scan of the sets and lineups for the whole paste, not one per name.
      const candidateIds = new Set(prepared.flatMap((p) => rowsOf(p).slice(0, MAX_CANDIDATES).map((row) => row.id)));
      const uses = await artistUses(pool, [...candidateIds]);
      return prepared.map((p) => {
        const rows = rowsOf(p);
        const outcome: MatchOutcome = rows.length === 1 ? 'linked' : rows.length > 1 ? 'pick' : 'new';
        return { name: p.name, outcome, candidates: candidatesOf(rows, uses) };
      });
    },

    async getById(id: string, db: { query: Pool['query'] } = pool): Promise<ArtistRecord | null> {
      const { rows } = await db.query(`SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = $1`, [id]);
      return (rows[0] as ArtistRecord | undefined) ?? null;
    },

    /**
     * A new artist. When a live artist has the same key, the editor must add a note to tell them apart.
     * A clash on key and note, or on the Spotify id, is a 409 that names the other artist.
     */
    async create(input: { name: string; label?: string; link?: string; userId: string | null }) {
      const name = cleanArtistName(input.name);
      if (!name) throw new ArtistError(400, 'INVALID_INPUT', 'The name cannot be empty.');
      const label = cleanLabel(input.label ?? '');
      if (label === null) throw new ArtistError(400, 'INVALID_INPUT', `The note can be at most ${MAX_ARTIST_LABEL} characters.`);
      const links: Links = {};
      let spotifyId: string | null = null;
      if (input.link) {
        const platform = detectPlatform(input.link) ?? 'website';
        const result = normalizeArtistLink(platform, input.link);
        if (!result.ok) throw new ArtistError(400, 'INVALID_INPUT', result.message);
        links[platform] = result.url;
        spotifyId = result.spotifyId ?? null;
      }
      const key = artistNameKey(name);
      const id = createOpaqueId('art');
      try {
        return await withTransactionRetry(pool, async (client) => {
          const { rows: same } = await client.query(
            `SELECT ${ARTIST_COLUMNS} FROM artists WHERE name_key = $1 AND merged_into IS NULL`,
            [key],
          );
          if (same.length > 0 && !label) {
            throw new ArtistError(
              400,
              'INVALID_INPUT',
              `There is already an artist named ${same[0].name}. Add a note to tell them apart, for example UK or Berlin.`,
              { existingIds: same.map((row: any) => row.id) },
            );
          }
          await assertNoClash(client, id, { key, label, spotifyId });
          const { rows } = await client.query(
            `INSERT INTO artists (id, name, name_key, label, spotify_id, links, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7) RETURNING ${ARTIST_COLUMNS}`,
            [id, name, key, label, spotifyId, JSON.stringify(links), input.userId],
          );
          return rows[0] as ArtistRecord;
        });
      } catch (error: any) {
        throw artistConflict(error) ?? error;
      }
    },

    /**
     * Edits one artist and rewrites its copy in every festival, past and archived ones included.
     * `expectedUpdatedAt` is the artist's updatedAt the editor loaded. Returns the artist and the
     * festivals whose copy was rewritten, so the route can refresh caches and notify clients.
     */
    async update(
      id: string,
      input: { expectedUpdatedAt: string; changes: ArtistChanges; userId: string | null },
    ): Promise<{ artist: ArtistRecord; synced: SyncedFestival[]; before: ArtistRecord }> {
      try {
        return await withTransactionRetry(pool, async (client) => {
          const festivalIds = await festivalIdsUsing(client, id);
          for (const festivalId of festivalIds) await lockFestivalAny(client, festivalId);
          const { rows } = await client.query(`SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = $1 FOR UPDATE`, [id]);
          const before = rows[0] as ArtistRecord | undefined;
          if (!before) throw new ArtistError(404, 'NOT_FOUND', 'Artist not found.');
          if (before.merged_into) {
            const survivor = (await client.query('SELECT name, label FROM artists WHERE id = $1', [before.merged_into])).rows[0];
            throw new ArtistError(409, 'ARTIST_CHANGED', `This artist was already merged into ${survivor ? shownName(survivor) : 'another artist'}.`);
          }
          const { rows: tokenRows } = await client.query(
            "SELECT date_trunc('milliseconds', $1::timestamptz) = date_trunc('milliseconds', $2::timestamptz) AS same",
            [input.expectedUpdatedAt, before.updated_at],
          );
          if (!tokenRows[0].same) {
            throw new ArtistError(409, 'ARTIST_CHANGED', `Someone changed ${before.name} while you were editing. Here is the new version. Apply your change again.`, {
              artist: publicArtist(before),
            });
          }
          const next = applyChanges(before, input.changes);
          await assertNoClash(client, id, next);
          const { rows: updated } = await client.query(
            `UPDATE artists SET name = $2, name_key = $3, label = $4, spotify_id = $5, links = $6::jsonb,
                    updated_by = $7, updated_at = now()
              WHERE id = $1 RETURNING ${ARTIST_COLUMNS}`,
            [id, next.name, next.key, next.label, next.spotifyId, JSON.stringify(next.links), input.userId],
          );
          const artist = updated[0] as ArtistRecord;
          // A save may have put the artist on a festival after the first read, before it could lock the artist.
          const again = await festivalIdsUsing(client, id);
          if (again.some((festivalId) => !festivalIds.includes(festivalId))) throw retryTransaction('a festival began to list the artist');
          const copyChanged = before.name !== artist.name || JSON.stringify(before.links ?? {}) !== JSON.stringify(artist.links ?? {});
          const synced = copyChanged ? await rewriteCopies(client, festivalIds, artist) : [];
          return { artist, synced, before };
        });
      } catch (error: any) {
        throw artistConflict(error) ?? error;
      }
    },

    /**
     * The festivals that list an artist, archived ones marked, newest first, with the counts an editor
     * weighs before a change: festivals by time (archived ones apart) and the copies a change rewrites.
     */
    async impact(id: string, now: Date = new Date()) {
      const uses = (await artistUses(pool, [id])).get(id) ?? [];
      const counts = { past: 0, current: 0, upcoming: 0, archived: 0, sets: 0, lineupEntries: 0 };
      for (const u of uses) {
        if (u.deleted) counts.archived++;
        else if (!isCurrentOrUpcoming(u, now)) counts.past++;
        else if (!u.firstDate || u.firstDate > todayInZone(u.timeZone, now)) counts.upcoming++;
        else counts.current++;
      }
      const { rows } = await pool.query(
        `SELECT
           (SELECT count(*) FROM festival_sets WHERE jsonb_typeof(artists) = 'array' AND artists @> $1::jsonb)::int AS sets,
           (SELECT count(*) FROM festivals f,
              jsonb_array_elements(CASE WHEN jsonb_typeof(f.lineup) = 'array' THEN f.lineup ELSE '[]'::jsonb END) e
              WHERE jsonb_typeof(e->'artists') = 'array' AND e->'artists' @> $1::jsonb)::int AS "lineupEntries"`,
        [JSON.stringify([{ id }])],
      );
      counts.sets = rows[0].sets;
      counts.lineupEntries = rows[0].lineupEntries;
      return {
        festivals: uses.map((u) => ({ id: u.festivalId, name: u.name, published: u.published, archived: u.deleted, firstDate: u.firstDate })),
        counts,
      };
    },

    /**
     * Artists on one festival (its sets and announced names), or every artist with `scope: 'all'`.
     * Rows with no links come first. `alsoOn` counts the other festivals, archived ones left out.
     */
    async list(opts: { festivalId?: string; query?: string; limit: number }) {
      let rows: ArtistRecord[];
      if (opts.festivalId) {
        ({ rows } = await pool.query(
          `
  SELECT ${ARTIST_COLUMNS} FROM artists WHERE merged_into IS NULL AND id IN (
    SELECT u.artist_id FROM (
      SELECT a->>'id' AS artist_id FROM festival_sets s,
        jsonb_array_elements(CASE WHEN jsonb_typeof(s.artists) = 'array' THEN s.artists ELSE '[]'::jsonb END) a
        WHERE s.festival_id = $1
      UNION
      SELECT a->>'id' FROM festivals f,
        jsonb_array_elements(CASE WHEN jsonb_typeof(f.lineup) = 'array' THEN f.lineup ELSE '[]'::jsonb END) e,
        jsonb_array_elements(CASE WHEN jsonb_typeof(e->'artists') = 'array' THEN e->'artists' ELSE '[]'::jsonb END) a
        WHERE f.id = $1
    ) u WHERE u.artist_id IS NOT NULL)
  ORDER BY name_key, lower(label), id LIMIT $2`,
          [opts.festivalId, opts.limit],
        ));
      } else {
        const key = opts.query ? artistNameKey(opts.query) : '';
        ({ rows } = await pool.query(
          `SELECT ${ARTIST_COLUMNS} FROM artists WHERE merged_into IS NULL AND ($1 = '' OR name_key LIKE $2)
            ORDER BY name_key, lower(label), id LIMIT $3`,
          [key, `%${key.replace(/[\\%_]/g, '\\$&')}%`, opts.limit],
        ));
      }
      const uses = await artistUses(pool, rows.map((r) => r.id));
      const sameKey = new Map<string, number>();
      for (const row of rows) sameKey.set(row.name_key, (sameKey.get(row.name_key) ?? 0) + 1);
      const keysAcross = await liveArtistsByKey(pool, [...sameKey.keys()]);
      const items = rows.map((row) => {
        const others = (uses.get(row.id) ?? []).filter((u) => u.festivalId !== opts.festivalId && !u.deleted);
        return {
          ...publicArtist(row),
          alsoOn: others.length,
          sameName: (keysAcross.get(row.name_key)?.length ?? 1) > 1,
          linkCount: Object.keys(row.links ?? {}).length,
        };
      });
      // Rows with no links first: the editor's work list.
      return items.sort((a, b) => Number(a.linkCount > 0) - Number(b.linkCount > 0));
    },

    /**
     * How many distinct names on a festival have no artist id and fit two or more live artists. The
     * save keeps such a name without an id, so the publish checklist asks the editor to pick one.
     */
    async countAmbiguousNames(festival: any): Promise<number> {
      const elements = [
        ...(festival?.days ?? []).flatMap((day: any) => (day?.sets ?? []).flatMap((set: any) => set?.artists ?? [])),
        ...(festival?.lineup ?? []).flatMap((entry: any) => entry?.artists ?? []),
      ];
      const keys = [
        ...new Set(elements.filter((e: any) => !e?.id && typeof e?.name === 'string' && e.name.trim()).map((e: any) => artistNameKey(e.name))),
      ];
      const byKey = await liveArtistsByKey(pool, keys);
      return keys.filter((key) => (byKey.get(key)?.length ?? 0) > 1).length;
    },

    /** Ids of the artists in `ids` that sit on a festival other than `festivalId`, archived ones included. */
    async sharedElsewhere(festivalId: string, ids: string[], db: { query: Pool['query'] } = pool): Promise<Set<string>> {
      const uses = await artistUses(db, ids);
      return new Set(ids.filter((id) => (uses.get(id) ?? []).some((u) => u.festivalId !== festivalId)));
    },

    /**
     * Fills empty fields of artists, inside the caller's transaction. Used by "Find missing links" for
     * artists that sit on one festival only, so the caller rewrites that festival's other copies (see rewriteCopies). A Spotify id that another
     * artist holds is left out and reported. Never overwrites a link.
     */
    async fillEmpty(
      client: any,
      id: string,
      fill: { spotifyUrl?: string; photo?: string; genres?: string[] },
    ): Promise<{ artist: ArtistRecord; skippedSpotify: boolean; changed: boolean } | null> {
      const { rows } = await client.query(`SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = $1 AND merged_into IS NULL FOR UPDATE`, [id]);
      const row = rows[0] as ArtistRecord | undefined;
      if (!row) return null;
      const links: Links = { ...(row.links ?? {}) };
      let spotifyId = row.spotify_id;
      let skippedSpotify = false;
      if (fill.spotifyUrl && !links.spotify) {
        const result = normalizeArtistLink('spotify', fill.spotifyUrl);
        if (result.ok) {
          const taken = await client.query('SELECT 1 FROM artists WHERE spotify_id = $1 AND merged_into IS NULL AND id <> $2', [
            result.spotifyId,
            id,
          ]);
          if (taken.rowCount) skippedSpotify = true;
          else {
            links.spotify = result.url;
            spotifyId = result.spotifyId ?? null;
          }
        }
      }
      const photo = row.photo ?? (fill.photo?.startsWith('https://') ? fill.photo.slice(0, 500) : null);
      const genres = row.genres?.length ? row.genres : (fill.genres ?? []).slice(0, 10);
      // A call that fills nothing leaves updated_at alone: it is the edit token of the Artists screen.
      if (
        spotifyId === row.spotify_id &&
        photo === row.photo &&
        JSON.stringify(links) === JSON.stringify(row.links ?? {}) &&
        JSON.stringify(genres) === JSON.stringify(row.genres ?? [])
      ) {
        return { artist: row, skippedSpotify, changed: false };
      }
      const { rows: updated } = await client.query(
        `UPDATE artists SET links = $2::jsonb, spotify_id = $3, photo = $4, genres = $5::jsonb, updated_at = now()
          WHERE id = $1 RETURNING ${ARTIST_COLUMNS}`,
        [id, JSON.stringify(links), spotifyId, photo, JSON.stringify(genres)],
      );
      return { artist: updated[0] as ArtistRecord, skippedSpotify, changed: true };
    },
  };
}

export type ArtistsStore = ReturnType<typeof createArtistsStore>;
export { rewriteCopies, festivalIdsUsing };
