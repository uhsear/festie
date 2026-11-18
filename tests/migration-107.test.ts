import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { ensureTestSchema } from './_test-schema';

// Migration 107 adds the artists table with its two partial unique indexes, artist_backfill_runs
// and festivals.edited_at. It runs twice without error, keeps data written between the runs, is
// ASCII only and holds no BEGIN or COMMIT (the runner wraps each file itself).
// Run it only on a private Postgres (port 5434 or higher), never 5432 or 5433.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '107_artists.sql'),
  'utf8',
);

describe('migration 107 artists', () => {
  test('the file is ASCII only and has no transaction control', () => {
    assert.equal(/[^\x00-\x7F]/.test(SQL), false);
    assert.equal(/^\s*(BEGIN|COMMIT)\b/im.test(SQL), false);
  });

  describe('on a database', { skip }, () => {
    let pool: Pool;
    const stamp = Date.now();
    const festivalId = `mig107-${stamp}`;
    const [live, second, third] = [`art-m107-a-${stamp}`, `art-m107-b-${stamp}`, `art-m107-c-${stamp}`] as [string, string, string];
    const spotifyId = `m107${stamp}`.padEnd(22, '0');

    const insertArtist = (id: string, label: string, spotify: string | null, mergedInto: string | null = null) =>
      pool.query(
        'INSERT INTO artists (id, name, name_key, label, spotify_id, merged_into) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, `HOL ${stamp}`, `hol ${stamp}`, label, spotify, mergedInto],
      );

    before(async () => {
      await ensureTestSchema(TEST_DATABASE_URL!);
      pool = new Pool({ connectionString: TEST_DATABASE_URL });
    });

    after(async () => {
      await pool.query('DELETE FROM artists WHERE id = ANY($1::text[]) AND merged_into IS NOT NULL', [[live, second, third]]);
      await pool.query('DELETE FROM artists WHERE id = ANY($1::text[])', [[live, second, third]]);
      await pool.query('DELETE FROM festivals WHERE id = $1', [festivalId]);
      await pool.end();
    });

    test('applies twice and leaves the tables, columns and indexes once', async () => {
      await pool.query(SQL);
      await pool.query(SQL);
      const { rows: columns } = await pool.query(
        `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'artists'`,
      );
      const nullable = Object.fromEntries(columns.map((c: any) => [c.column_name, c.is_nullable]));
      for (const name of ['id', 'name', 'name_key', 'label', 'links', 'genres', 'created_at', 'updated_at']) {
        assert.equal(nullable[name], 'NO', name);
      }
      for (const name of ['spotify_id', 'photo', 'merged_into', 'merge_refs', 'created_by', 'updated_by']) {
        assert.equal(nullable[name], 'YES', name);
      }
      const { rows: indexes } = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'artists' AND indexname LIKE 'idx_artists_%'`,
      );
      const defs = Object.fromEntries(indexes.map((i: any) => [i.indexname, i.indexdef]));
      assert.match(defs.idx_artists_live_key_label, /UNIQUE.*\(name_key, lower\(label\)\).*merged_into IS NULL/);
      assert.match(defs.idx_artists_live_spotify_id, /UNIQUE.*\(spotify_id\).*spotify_id IS NOT NULL.*merged_into IS NULL/);
      const { rows: runs } = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'artist_backfill_runs' ORDER BY ordinal_position`,
      );
      assert.deepEqual(runs.map((r: any) => r.column_name), ['run_id', 'festival_id', 'before', 'created_at']);
      const { rows: edited } = await pool.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'festivals' AND column_name = 'edited_at'`,
      );
      assert.equal(edited[0].is_nullable, 'YES');
    });

    test('a same-key artist needs a different note, and a tombstone frees its key and spotify id', async () => {
      await insertArtist(live, '', spotifyId);
      await assert.rejects(insertArtist(second, '', null), /idx_artists_live_key_label/);
      await assert.rejects(insertArtist(second, 'UK', spotifyId), /idx_artists_live_spotify_id/);
      await insertArtist(second, 'UK', null);
      await assert.rejects(insertArtist(third, 'uk', null), /idx_artists_live_key_label/);
      await insertArtist(third, 'uk', spotifyId, live);
      await assert.rejects(pool.query('DELETE FROM artists WHERE id = $1', [live]), { code: '23503' });
    });

    test('a re-run seeds a missing edited_at from updated_at and keeps a set one', async () => {
      await pool.query(
        `INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, 'M107', 'x', NOW(), '2026-01-02T03:04:05Z')`,
        [festivalId],
      );
      assert.equal((await pool.query('SELECT edited_at FROM festivals WHERE id = $1', [festivalId])).rows[0].edited_at, null);
      await pool.query(SQL);
      const { rows } = await pool.query('SELECT edited_at, updated_at FROM festivals WHERE id = $1', [festivalId]);
      assert.equal(rows[0].edited_at.toISOString(), rows[0].updated_at.toISOString());
      await pool.query(`UPDATE festivals SET edited_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [festivalId]);
      await pool.query(SQL);
      const kept = await pool.query('SELECT edited_at FROM festivals WHERE id = $1', [festivalId]);
      assert.equal(kept.rows[0].edited_at.toISOString(), '2026-01-01T00:00:00.000Z');
    });
  });
});
