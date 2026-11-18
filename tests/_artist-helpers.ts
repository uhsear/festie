// Shared fixtures for the artist integration tests (artists-routes, artists-sync, artist-refs,
// artists-concurrency). Not a test file: the test glob is tests/*.test.ts.
import { Pool } from 'pg';
import { startServer, loginAdmin, TEST_DATABASE_URL, TRUSTED_MUTATION_HEADER } from './_integration-helpers';

export const skip = !process.env.TEST_DATABASE_URL || !process.env.TEST_DATABASE_URL.includes('_test');

export async function withPool<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

export interface SeedSet {
  id: string;
  artist: string;
  artists: any[];
  displayName?: string | null;
  linkUrl?: string | null;
  start?: string;
}

export interface SeedFestival {
  id: string;
  name?: string;
  separator?: string;
  published?: boolean;
  deleted?: boolean;
  timeZone?: string;
  date?: string;
  lineup?: any[];
  sets: SeedSet[];
}

/** Inserts one festival with one stage, one day and the given sets. All ids are test-owned. */
export async function seedFestival(pool: Pool, festival: SeedFestival) {
  await pool.query(
    `INSERT INTO festivals (id, name, location, created_at, updated_at, edited_at, b2b_separator, time_zone, published_at, deleted_at, lineup)
     VALUES ($1, $2, 'Here', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', $3, $4, $5, $6, $7::jsonb)`,
    [
      festival.id,
      festival.name ?? festival.id,
      festival.separator ?? 'b2b',
      festival.timeZone ?? 'America/New_York',
      festival.published ? '2026-01-02T00:00:00Z' : null,
      festival.deleted ? '2026-02-01T00:00:00Z' : null,
      JSON.stringify(festival.lineup ?? []),
    ],
  );
  await pool.query(`INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, 'Main', '#ff3366', 0)`, [
    festival.id,
    `${festival.id}-main`,
  ]);
  await pool.query(`INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, 0, 'Friday', $2)`, [
    festival.id,
    festival.date ?? '2099-08-21',
  ]);
  for (const [index, set] of festival.sets.entries()) {
    await pool.query(
      `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, artists, link_url, display_name)
       VALUES ($1, $2, 0, $3, $4, $5, '23:00', $6, $7::jsonb, $8, $9)`,
      [
        set.id,
        festival.id,
        set.artist,
        `${festival.id}-main`,
        set.start ?? '20:00',
        index,
        JSON.stringify(set.artists),
        set.linkUrl ?? null,
        set.displayName ?? null,
      ],
    );
  }
}

export interface ArtistServer {
  server: any;
  token: string;
  get(path: string): any;
  post(path: string, body?: unknown): any;
  patch(path: string, body?: unknown): any;
  put(path: string, body?: unknown): any;
  close(): Promise<void>;
}

/** A started app, an admin token and request helpers that carry the token and the trusted-mutation header. */
export async function startArtistServer(): Promise<ArtistServer> {
  const server = await startServer();
  const token = await loginAdmin(server);
  const authed = (builder: any) => builder.set('x-user-token', token).set(TRUSTED_MUTATION_HEADER, '1');
  return {
    server,
    token,
    get: (path) => authed(server.request.get(path)),
    post: (path, body) => authed(server.request.post(path)).send(body ?? {}),
    patch: (path, body) => authed(server.request.patch(path)).send(body ?? {}),
    put: (path, body) => authed(server.request.put(path)).send(body ?? {}),
    close: () => server.close(),
  };
}

/** Creates an artist through the route and returns the artist object. */
export async function createArtist(app: ArtistServer, body: { name: string; label?: string; link?: string }) {
  const res = await app.post('/api/v1/admin/artists', body).expect(201);
  return res.body.data.artist;
}

/** The `artists` array of a set, read straight from the table. */
export async function setRow(pool: Pool, setId: string) {
  const { rows } = await pool.query('SELECT artist, artists, link_url, display_name FROM festival_sets WHERE id = $1', [setId]);
  return rows[0];
}

export async function festivalRow(pool: Pool, id: string) {
  const { rows } = await pool.query('SELECT updated_at, edited_at, lineup FROM festivals WHERE id = $1', [id]);
  return rows[0];
}

/** A PUT body that saves the sets of one day as the form would send them. */
export function formBody(festival: { id: string; name?: string; stageId?: string }, sets: any[], extra: Record<string, unknown> = {}) {
  return {
    name: festival.name ?? festival.id,
    stages: [{ id: festival.stageId ?? `${festival.id}-main`, name: 'Main', color: '#ff3366' }],
    days: [{ label: 'Friday', date: '2099-08-21', sets }],
    ...extra,
  };
}

let bumps = 0;
/**
 * The festival cache holds festivals for 60 seconds, and the tests seed rows with SQL. An artist
 * rename that rewrites a copy drops the cache (afterSync), so this renames a throwaway artist.
 */
export async function dropFestivalCache(app: ArtistServer) {
  bumps += 1;
  const artist = await createArtist(app, { name: `Cache Bump ${bumps}` });
  await withPool((pool) =>
    seedFestival(pool, { id: `fest-cache-bump-${bumps}`, sets: [{ id: `bump-${bumps}`, artist: artist.name, artists: [{ id: artist.id, name: artist.name, links: {} }] }] }),
  );
  await app.patch(`/api/v1/admin/artists/${artist.id}`, { expectedUpdatedAt: artist.updatedAt, changes: { name: `Cache Bumped ${bumps}` } }).expect(200);
}
