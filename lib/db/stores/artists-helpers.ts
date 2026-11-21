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
import { isoOrNull } from '../connection';
import { createOpaqueId } from '../../helpers';
import { sanitizeString } from '../../helpers/sanitize';
import { artistNameKey } from '../../artist-key';
import { detectPlatform, normalizeArtistLink } from '../../artist-links';
import { todayInZone } from '../../lineup';
import { AUDIT_ACTIONS } from '../../audit-actions';
import { lockFestivalAny } from './festival-lock';

const MAX_ARTIST_NAME = 300;
export const MAX_ARTIST_LABEL = 40;
export const MAX_CANDIDATES = 10;

export type Links = Record<string, string>;

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
  verified: boolean;
  label_auto: boolean;
}

export const ARTIST_COLUMNS =
  'id, name, name_key, label, spotify_id, links, photo, genres, merged_into, updated_at, verified, label_auto';

/** A refusal the route turns into an HTTP answer. `details` is sent with it. */
export class ArtistError extends Error {
  constructor(
    public status: number,
    public code: 'INVALID_INPUT' | 'NOT_FOUND' | 'ARTIST_EXISTS' | 'ARTIST_CHANGED' | 'REAUTH_REQUIRED',
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ArtistError';
  }
}

/** The error a transaction throws to start over: withTransactionRetry retries 40001. */
export function retryTransaction(reason: string): Error {
  return Object.assign(new Error(reason), { code: '40001' });
}

export interface ArtistActor {
  userId: string | null;
  ip?: string | null;
  /** The caller writes its own audit row for the change (pickSpotify does, with the copies it rewrote). */
  skipAudit?: boolean;
  /** An organizer's rows read 'organizer' and carry the organization. The default is an admin. */
  actorType?: 'admin' | 'organizer';
  organizationId?: string | null;
  /** A fill of an artist that other tenants or the platform also use, for the review list. */
  flagged?: boolean;
}

/** The audit row of a global artist change, written in the change's own transaction so the two never disagree. */
export async function insertArtistAudit(
  client: any,
  artistId: string,
  actor: ArtistActor,
  details: Record<string, unknown>,
  action: string = AUDIT_ACTIONS.ARTIST_UPDATED,
) {
  await client.query(
    `
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
      status,
      created_at,
      organization_id
    )
  VALUES
    (
      $1,
      $7,
      $2,
      $3,
      'artist',
      $4,
      $5,
      $6,
      'success',
      NOW(),
      $8
    )
`,
    [
      createOpaqueId('aud'),
      actor.userId,
      action,
      artistId,
      JSON.stringify(details),
      actor.ip ?? null,
      actor.actorType ?? 'admin',
      actor.organizationId ?? null,
    ],
  );
}

export function publicArtist(row: ArtistRecord) {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    links: row.links ?? {},
    photo: row.photo,
    genres: row.genres ?? [],
    spotifyId: row.spotify_id,
    updatedAt: isoOrNull(row.updated_at) as string,
    verified: row.verified,
    labelAuto: row.label_auto,
  };
}

/** What a non-admin reads: a note the server chose reads as empty, so a hidden artist never shows through it. */
export function viewerArtist(row: ArtistRecord) {
  const { labelAuto: _auto, ...rest } = publicArtist(row);
  return { ...rest, label: row.label_auto ? '' : row.label };
}

/** The next free neutral note, "unnamed 1", for a name whose note a hidden artist holds. */
export function nextAutoLabel(takenLabels: string[]): string {
  const taken = new Set(takenLabels.map((label) => label.toLowerCase()));
  let n = 1;
  while (taken.has(`unnamed ${n}`)) n++;
  return `unnamed ${n}`;
}

/** The note: Unicode NFKC, trimmed, runs of spaces collapsed. Null when it is over the limit. */
export function cleanLabel(raw: unknown): string | null {
  const label = sanitizeString(typeof raw === 'string' ? raw.normalize('NFKC') : '', 200)
    .replace(/\s+/g, ' ')
    .trim();
  return label.length > MAX_ARTIST_LABEL ? null : label;
}

export const cleanArtistName = (raw: unknown) => sanitizeString(raw, MAX_ARTIST_NAME);

const shownName = (artist: { name: string; label: string }) =>
  artist.label ? `${artist.name} (${artist.label})` : artist.name;

/** The name with its note, for a message. */
export const artistTitle = shownName;

/** The fields a merge can overwrite, for the audit row. */
export const auditFields = (row: ArtistRecord) => ({
  name: row.name,
  label: row.label,
  spotifyId: row.spotify_id,
  links: row.links ?? {},
  photo: row.photo ?? null,
  genres: row.genres ?? [],
});

/** Live artists whose key is in `keys`, newest id order, grouped by key. */
export async function liveArtistsByKey(
  db: { query: Pool['query'] },
  keys: string[],
): Promise<Map<string, ArtistRecord[]>> {
  const out = new Map<string, ArtistRecord[]>();
  if (keys.length === 0) return out;
  const { rows } = await db.query(
    `SELECT ${ARTIST_COLUMNS} FROM artists WHERE name_key = ANY($1::text[]) AND merged_into IS NULL ORDER BY lower(label), id`,
    [keys],
  );
  for (const row of rows as ArtistRecord[]) out.set(row.name_key, [...(out.get(row.name_key) ?? []), row]);
  return out;
}

export async function liveArtistsBySpotifyId(
  db: { query: Pool['query'] },
  spotifyIds: string[],
): Promise<Map<string, ArtistRecord>> {
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
export async function resolveArtistIds(
  db: { query: Pool['query'] },
  ids: string[],
): Promise<Map<string, ArtistRecord>> {
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
  SELECT c.asked, ${ARTIST_COLUMNS.split(', ')
    .map((col) => `a.${col}`)
    .join(', ')}
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

// Containment probes let the jsonb_path_ops GIN indexes of migration 118 narrow the rows before
// the per-element id match below, which still decides the result.
const ID_REF_PROBES = `ARRAY(SELECT jsonb_build_array(jsonb_build_object('id', i)) FROM unnest($1::text[]) i)`;
const LINEUP_REF_PROBES = `ARRAY(SELECT jsonb_build_array(jsonb_build_object('artists', jsonb_build_array(jsonb_build_object('id', i)))) FROM unnest($1::text[]) i)`;

const ELEMENT_IDS_OF_SETS = `
  SELECT s.festival_id, a->>'id' AS artist_id
  FROM festival_sets s, jsonb_array_elements(CASE WHEN jsonb_typeof(s.artists) = 'array' THEN s.artists ELSE '[]'::jsonb END) a
  WHERE s.artists @> ANY(${ID_REF_PROBES}) AND a->>'id' = ANY($1::text[])`;

const ELEMENT_IDS_OF_LINEUPS = `
  SELECT f.id AS festival_id, a->>'id' AS artist_id
  FROM festivals f,
    jsonb_array_elements(CASE WHEN jsonb_typeof(f.lineup) = 'array' THEN f.lineup ELSE '[]'::jsonb END) e,
    jsonb_array_elements(CASE WHEN jsonb_typeof(e->'artists') = 'array' THEN e->'artists' ELSE '[]'::jsonb END) a
  WHERE f.lineup @> ANY(${LINEUP_REF_PROBES}) AND a->>'id' = ANY($1::text[])`;

export interface ArtistUse {
  artistId: string;
  festivalId: string;
  name: string;
  published: boolean;
  deleted: boolean;
  firstDate: string | null;
  lastDate: string | null;
  timeZone: string | null;
  /** The owner organization. Null: an admin-only festival. */
  organizationId: string | null;
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
    f.time_zone AS "timeZone",
    f.organization_id AS "organizationId"
  FROM (${ELEMENT_IDS_OF_SETS} UNION ${ELEMENT_IDS_OF_LINEUPS}) u
  JOIN festivals f ON f.id = u.festival_id
  ORDER BY "firstDate" DESC NULLS LAST, f.id
`,
    [artistIds],
  );
  for (const row of rows as ArtistUse[]) out.set(row.artistId, [...(out.get(row.artistId) ?? []), row]);
  return out;
}

/** Ids of the festivals that list any of the artists, archived ones included, in id order. Takes no locks. */
async function festivalIdsUsingAny(client: any, artistIds: string[]): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT DISTINCT festival_id FROM (${ELEMENT_IDS_OF_SETS} UNION ${ELEMENT_IDS_OF_LINEUPS}) u ORDER BY festival_id`,
    [artistIds],
  );
  return rows.map((row: any) => row.festival_id);
}

/**
 * Locks every festival that lists any of the artists, in id order. `assertUnchanged` reads the ids
 * again, after the caller locked the artist rows, and retries the transaction when a save added a festival.
 */
export async function lockFestivalsUsing(client: any, artistIds: string[]) {
  const festivalIds = await festivalIdsUsingAny(client, artistIds);
  for (const festivalId of festivalIds) await lockFestivalAny(client, festivalId);
  const assertUnchanged = async () => {
    const again = await festivalIdsUsingAny(client, artistIds);
    if (again.some((festivalId) => !festivalIds.includes(festivalId))) {
      throw retryTransaction(
        artistIds.length > 1 ? 'a festival began to list an artist' : 'a festival began to list the artist',
      );
    }
  };
  return { festivalIds, assertUnchanged };
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

/** Writes festivals.lineup for several festivals in one round trip. */
async function writeLineups(client: any, writes: Array<{ id: string; lineup: string }>) {
  if (writes.length === 0) return;
  await client.query(
    `
  UPDATE festivals f
  SET
    lineup = v.lineup::jsonb
  FROM
    unnest($1::text[], $2::text[]) AS v (id, lineup)
  WHERE
    f.id = v.id
`,
    [writes.map((w) => w.id), writes.map((w) => w.lineup)],
  );
}

/**
 * Rewrites the copy of one artist in every set and lineup entry of the festivals in `festivalIds`
 * (all locked by the caller). The flat `artist` follows only where it equals the old joined names:
 * display_name is the durable per-set override. link_url follows the first artist's Spotify link.
 * updated_at moves so the list version and the caches change; edited_at does not.
 */
export async function rewriteCopies(
  client: any,
  festivalIds: string[],
  artist: ArtistRecord,
): Promise<SyncedFestival[]> {
  if (festivalIds.length === 0) return [];
  const { rows: festivals } = await client.query(
    `
  SELECT
    id,
    COALESCE(b2b_separator, 'b2b') AS separator,
    lineup,
    published_at,
    time_zone,
    (
      SELECT
        MAX(d.date)
      FROM
        festival_days d
      WHERE
        d.festival_id = festivals.id
        AND d.date <> ''
    ) AS last_date
  FROM
    festivals
  WHERE
    id = ANY ($1::text[])
`,
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
  const writes: Array<{ id: string; artists: string; artist: string; linkUrl: string | null }> = [];
  for (const set of sets) {
    const separator = separatorOf.get(set.festival_id) ?? 'b2b';
    const next = set.artists.map((e: any) => (e?.id === artist.id ? copyOf(e, artist) : e));
    const flat = set.artist === joined(set.artists, separator) ? joined(next, separator) : set.artist;
    const linkUrl = next[0]?.links?.spotify ?? null;
    if (
      JSON.stringify(next) === JSON.stringify(set.artists) &&
      flat === set.artist &&
      linkUrl === (set.link_url ?? null)
    )
      continue;
    writes.push({ id: set.id, artists: JSON.stringify(next), artist: flat, linkUrl });
    changedSets.set(set.festival_id, [...(changedSets.get(set.festival_id) ?? []), set.id]);
  }
  if (writes.length > 0) {
    await client.query(
      `
  UPDATE festival_sets s
  SET
    artists = v.artists::jsonb,
    artist = v.artist,
    link_url = v.link_url
  FROM
    unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS v (id, artists, artist, link_url)
  WHERE
    s.id = v.id
`,
      [
        writes.map((w) => w.id),
        writes.map((w) => w.artists),
        writes.map((w) => w.artist),
        writes.map((w) => w.linkUrl),
      ],
    );
  }
  const lineupWrites: Array<{ id: string; lineup: string }> = [];
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
    if (changed) lineupWrites.push({ id: festival.id, lineup: JSON.stringify(lineup) });
  }
  await writeLineups(client, lineupWrites);
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
export function isCurrentOrUpcoming(
  festival: { timeZone: string | null; lastDate: string | null },
  now: Date = new Date(),
): boolean {
  if (!festival.lastDate) return true;
  const yesterday = new Date(Date.parse(`${todayInZone(festival.timeZone, now)}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
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
export function applyChanges(current: ArtistRecord, changes: ArtistChanges) {
  let name = current.name;
  let label = current.label;
  const links: Links = { ...(current.links ?? {}) };
  if (changes.name !== undefined) {
    name = cleanArtistName(changes.name);
    if (!name) throw new ArtistError(400, 'INVALID_INPUT', 'The name cannot be empty.');
  }
  if (changes.label !== undefined) {
    const cleaned = cleanLabel(changes.label);
    if (cleaned === null)
      throw new ArtistError(400, 'INVALID_INPUT', `The note can be at most ${MAX_ARTIST_LABEL} characters.`);
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
  const spotifyId = links.spotify
    ? ((normalizeArtistLink('spotify', links.spotify) as { spotifyId?: string }).spotifyId ?? null)
    : null;
  return { name, label, links, spotifyId, key: artistNameKey(name) };
}

/** Throws the 409 ARTIST_CHANGED, with the current version, when the editor's token is not the row's updated_at. */
export async function tokenIsFresh(client: any, row: ArtistRecord, expectedUpdatedAt: string): Promise<boolean> {
  const { rows } = await client.query(
    "SELECT date_trunc('milliseconds', $1::timestamptz) = date_trunc('milliseconds', $2::timestamptz) AS same",
    [expectedUpdatedAt, row.updated_at],
  );
  return rows[0].same;
}

export async function assertFreshToken(client: any, row: ArtistRecord, expectedUpdatedAt: string) {
  if (!(await tokenIsFresh(client, row, expectedUpdatedAt))) {
    throw new ArtistError(
      409,
      'ARTIST_CHANGED',
      `Someone changed ${row.name} while you were editing. Here is the new version. Apply your change again.`,
      {
        artist: publicArtist(row),
      },
    );
  }
}

/** Another live artist that would clash with the next key and note, or Spotify id. Throws the 409. */
export async function assertNoClash(
  client: any,
  id: string | string[],
  next: { key: string; label: string; spotifyId: string | null },
  opts: { merging?: boolean } = {},
) {
  const ignored = Array.isArray(id) ? id : [id];
  const { rows: sameKey } = await client.query(
    `SELECT ${ARTIST_COLUMNS} FROM artists WHERE name_key = $1 AND lower(label) = lower($2) AND merged_into IS NULL AND id <> ALL($3::text[])`,
    [next.key, next.label, ignored],
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
    `SELECT ${ARTIST_COLUMNS} FROM artists WHERE spotify_id = $1 AND merged_into IS NULL AND id <> ALL($2::text[])`,
    [next.spotifyId, ignored],
  );
  if (sameSpotify[0]) {
    throw new ArtistError(
      409,
      'ARTIST_EXISTS',
      opts.merging
        ? `The merged artist would take a Spotify link that '${shownName(sameSpotify[0])}' already holds. Keep the other Spotify link, or merge into that artist.`
        : `This Spotify artist is already linked to '${shownName(sameSpotify[0])}'. Use that artist, or ask an admin to merge them.`,
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

type MergeSide = 'survivor' | 'loser';

/** Per field, which artist's value the merged artist keeps. A field that is not listed keeps the survivor's. */
export interface MergePick {
  name?: MergeSide;
  label?: MergeSide;
  photo?: MergeSide;
  genres?: MergeSide;
  /** By platform key. A platform the picked side lacks takes the other side's link. */
  links?: Record<string, MergeSide>;
}

/**
 * The merged artist's fields. The picked side wins; an empty photo, genre list or link takes the other
 * side's value. The note is never filled: it tells same-name artists apart, so a copied note could clash.
 */
export function mergedFields(survivor: ArtistRecord, loser: ArtistRecord, pick: MergePick) {
  const side = (which: MergeSide | undefined) =>
    which === 'loser' ? { first: loser, second: survivor } : { first: survivor, second: loser };
  const name = side(pick.name).first.name;
  const label = side(pick.label).first.label;
  const photoSides = side(pick.photo);
  const photo = photoSides.first.photo ?? photoSides.second.photo ?? null;
  const genreSides = side(pick.genres);
  const genres = genreSides.first.genres?.length ? genreSides.first.genres : (genreSides.second.genres ?? []);
  const links: Links = {};
  for (const platform of new Set([...Object.keys(survivor.links ?? {}), ...Object.keys(loser.links ?? {})])) {
    const linkSides = side(pick.links?.[platform]);
    const link = linkSides.first.links?.[platform] ?? linkSides.second.links?.[platform];
    if (link) links[platform] = link;
  }
  const spotify = links.spotify ? normalizeArtistLink('spotify', links.spotify) : null;
  return {
    name,
    label,
    photo,
    genres,
    links,
    spotifyId: spotify?.ok ? (spotify.spotifyId ?? null) : null,
    key: artistNameKey(name),
  };
}

interface MergeRefs {
  sets: Array<{ festivalId: string; setId: string; index: number }>;
  lineup: Array<{ festivalId: string; entry: number; index: number }>;
}

const idsOf = (elements: any) => (Array.isArray(elements) ? elements.map((e: any) => e?.id) : []);

/**
 * Where the loser sits, and the refusal when one set or lineup entry lists both artists. The festivals
 * are locked by the caller, so the answer stays true until the commit.
 */
export async function findMergeRefs(client: any, festivalIds: string[], survivorId: string, loserId: string) {
  const refs: MergeRefs = { sets: [], lineup: [] };
  const sets: Array<{ id: string; festival_id: string; artist: string; artists: any[] }> = [];
  const lineups: Array<{ festivalId: string; lineup: any[] }> = [];
  if (festivalIds.length > 0) {
    const { rows } = await client.query(
      `SELECT id, festival_id, artist, artists FROM festival_sets
        WHERE festival_id = ANY($1::text[]) AND jsonb_typeof(artists) = 'array'
          AND (artists @> $2::jsonb OR artists @> $3::jsonb)
        ORDER BY festival_id, id`,
      [festivalIds, JSON.stringify([{ id: survivorId }]), JSON.stringify([{ id: loserId }])],
    );
    sets.push(...rows);
    const { rows: festivals } = await client.query(
      `SELECT id, lineup FROM festivals WHERE id = ANY($1::text[]) AND jsonb_typeof(lineup) = 'array' ORDER BY id`,
      [festivalIds],
    );
    for (const festival of festivals) lineups.push({ festivalId: festival.id, lineup: festival.lineup });
  }
  const together = (title: string) =>
    new ArtistError(409, 'INVALID_INPUT', `Both artists play together in '${title}'. They cannot be the same artist.`);
  for (const set of sets) {
    const ids = idsOf(set.artists);
    if (ids.includes(survivorId) && ids.includes(loserId)) throw together(set.artist);
    ids.forEach((id, index) => id === loserId && refs.sets.push({ festivalId: set.festival_id, setId: set.id, index }));
  }
  for (const { festivalId, lineup } of lineups) {
    lineup.forEach((entry: any, entryIndex: number) => {
      const ids = idsOf(entry?.artists);
      if (ids.includes(survivorId) && ids.includes(loserId)) {
        throw together((entry.artists as any[]).map((e) => e?.name).join(' b2b '));
      }
      ids.forEach((id, index) => id === loserId && refs.lineup.push({ festivalId, entry: entryIndex, index }));
    });
  }
  return { refs, sets, lineups };
}

/** Points every loser element at the survivor. Names, links and the flat set fields follow in rewriteCopies. */
export async function moveRefs(
  client: any,
  found: Awaited<ReturnType<typeof findMergeRefs>>,
  survivorId: string,
  loserId: string,
) {
  const repoint = (elements: any[]) => elements.map((e: any) => (e?.id === loserId ? { ...e, id: survivorId } : e));
  const moved = found.sets.filter((set) => idsOf(set.artists).includes(loserId));
  if (moved.length > 0) {
    await client.query(
      `
  UPDATE festival_sets s
  SET
    artists = v.artists::jsonb
  FROM
    unnest($1::text[], $2::text[]) AS v (id, artists)
  WHERE
    s.id = v.id
`,
      [moved.map((set) => set.id), moved.map((set) => JSON.stringify(repoint(set.artists)))],
    );
  }
  const lineupWrites: Array<{ id: string; lineup: string }> = [];
  for (const { festivalId, lineup } of found.lineups) {
    if (!lineup.some((entry: any) => idsOf(entry?.artists).includes(loserId))) continue;
    const next = lineup.map((entry: any) =>
      Array.isArray(entry?.artists) ? { ...entry, artists: repoint(entry.artists) } : entry,
    );
    lineupWrites.push({ id: festivalId, lineup: JSON.stringify(next) });
  }
  await writeLineups(client, lineupWrites);
}

export interface MatchItem {
  name: string;
  spotify?: string | null;
}

export type MatchOutcome = 'linked' | 'pick' | 'new';
