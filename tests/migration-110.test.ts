import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { ensureTestSchema, TEST_DATABASE_URL, skip } from './_test-schema';

// Migration 110 adds artists.verified, artists.label_auto and artist_suggestions with its indexes. It runs twice
// without error, keeps data written between the runs, is ASCII only and holds no BEGIN or COMMIT (the runner wraps
// each file itself). Run it only on a private Postgres, never 5432 or 5433.

const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '110_artist_rules.sql'),
  'utf8',
);

describe('migration 110 artist rules', () => {
  test('the file is ASCII only and has no transaction control', () => {
    assert.equal(/[^\x00-\x7F]/.test(SQL), false);
    assert.equal(/^\s*(BEGIN|COMMIT)\b/im.test(SQL), false);
  });

  describe('on a database', { skip }, () => {
    let pool: Pool;
    const stamp = Date.now();
    const artistId = `art-m110-${stamp}`;
    const suggestionId = `sug-m110-${stamp}`;

    before(async () => {
      await ensureTestSchema(TEST_DATABASE_URL!);
      pool = new Pool({ connectionString: TEST_DATABASE_URL });
    });

    after(async () => {
      await pool.query('DELETE FROM artist_suggestions WHERE id = $1', [suggestionId]);
      await pool.query('DELETE FROM artists WHERE id = $1', [artistId]);
      await pool.end();
    });

    test('applies twice, keeps the columns and indexes once and keeps data written between the runs', async () => {
      await pool.query(SQL);
      await pool.query(
        'INSERT INTO artists (id, name, name_key, verified) VALUES ($1, $2, $3, false)',
        [artistId, `M110 ${stamp}`, `m110 ${stamp}`],
      );
      await pool.query("INSERT INTO artist_suggestions (id, artist_id, changes) VALUES ($1, $2, '{}'::jsonb)", [suggestionId, artistId]);
      await pool.query(SQL);

      const { rows: columns } = await pool.query(
        `SELECT column_name, is_nullable, column_default FROM information_schema.columns
          WHERE table_name = 'artists' AND column_name IN ('verified', 'label_auto')`,
      );
      assert.deepEqual(columns.map((c: any) => c.column_name).sort(), ['label_auto', 'verified']);
      assert.ok(columns.every((c: any) => c.is_nullable === 'NO'));

      const { rows: indexes } = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'artist_suggestions' AND indexname LIKE 'idx_artist_suggestions_%'`,
      );
      assert.deepEqual(
        indexes.map((i: any) => i.indexname).sort(),
        ['idx_artist_suggestions_artist', 'idx_artist_suggestions_festival', 'idx_artist_suggestions_org', 'idx_artist_suggestions_status'],
      );

      const { rows: artist } = await pool.query('SELECT verified, label_auto FROM artists WHERE id = $1', [artistId]);
      assert.deepEqual(artist[0], { verified: false, label_auto: false });
      const { rows: suggestion } = await pool.query('SELECT status FROM artist_suggestions WHERE id = $1', [suggestionId]);
      assert.equal(suggestion[0].status, 'pending');
    });
  });
});
