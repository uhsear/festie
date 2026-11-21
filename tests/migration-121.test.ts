import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { ensureTestSchema, TEST_DATABASE_URL, skip } from './_test-schema';

// Migration 121 adds artist_match_reviews. It runs twice without error, keeps data written between the runs,
// refuses a duplicate item_key and an unknown kind, is ASCII only and holds no BEGIN or COMMIT (the runner wraps
// each file itself). Run it only on a private Postgres, never 5432 or 5433.

const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '121_artist_match_reviews.sql'),
  'utf8',
);

describe('migration 121 artist match reviews', () => {
  test('the file is ASCII only and has no transaction control', () => {
    assert.equal(/[^\x00-\x7F]/.test(SQL), false);
    assert.equal(/^\s*(BEGIN|COMMIT)\b/im.test(SQL), false);
  });

  describe('on a database', { skip }, () => {
    let pool: Pool;
    const key = `m121-${Date.now()}`;

    before(async () => {
      await ensureTestSchema(TEST_DATABASE_URL!);
      pool = new Pool({ connectionString: TEST_DATABASE_URL });
    });

    after(async () => {
      await pool.query('DELETE FROM artist_match_reviews WHERE item_key = $1', [key]);
      await pool.end();
    });

    test('applies twice, keeps rows written between the runs and guards kind and item_key', async () => {
      await pool.query(SQL);
      await pool.query(`INSERT INTO artist_match_reviews (id, item_key, kind, artist_name) VALUES ($1, $2, 'link', 'M121')`, [key, key]);
      await pool.query(SQL);

      const { rows } = await pool.query('SELECT status, artist_ids, candidates, seq FROM artist_match_reviews WHERE item_key = $1', [key]);
      assert.equal(rows[0].status, 'pending');
      assert.deepEqual(rows[0].artist_ids, []);
      assert.ok(rows[0].seq);
      await assert.rejects(
        pool.query(`INSERT INTO artist_match_reviews (id, item_key, kind, artist_name) VALUES ($1, $2, 'link', 'dup')`, [`${key}-b`, key]),
        /artist_match_reviews_item_key_key/,
      );
      await assert.rejects(
        pool.query(`INSERT INTO artist_match_reviews (id, item_key, kind, artist_name) VALUES ($1, $2, 'delete', 'bad')`, [`${key}-c`, `${key}-c`]),
        /artist_match_reviews_kind_check/,
      );
      const { rows: indexes } = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'artist_match_reviews' AND indexname = 'idx_artist_match_reviews_status'`);
      assert.equal(indexes.length, 1);
    });
  });
});
