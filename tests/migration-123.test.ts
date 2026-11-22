import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { ensureTestSchema, TEST_DATABASE_URL, skip } from './_test-schema';

// Migration 123 adds refresh_tokens.family_id (existing tokens become their own family) and login_failure_ips.
// It runs twice without error, is ASCII only and holds no BEGIN or COMMIT (the runner wraps each file itself).

const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '123_refresh_token_family_login_ip_failures.sql'),
  'utf8',
);

describe('migration 123 refresh-token family and per-IP login failures', () => {
  test('the file is ASCII only and has no transaction control', () => {
    assert.equal(/[^\x00-\x7F]/.test(SQL), false);
    assert.equal(/^\s*(BEGIN|COMMIT)\b/im.test(SQL), false);
  });

  describe('on a database', { skip }, () => {
    let pool: Pool;
    const userId = `m123-${Date.now()}`;

    before(async () => {
      await ensureTestSchema(TEST_DATABASE_URL!);
      pool = new Pool({ connectionString: TEST_DATABASE_URL });
      await pool.query(`INSERT INTO users (id, username, password_hash, created_at) VALUES ($1::text, $1::text, 'x', NOW())`, [userId]);
    });

    after(async () => {
      await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM login_failure_ips WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.end();
    });

    test('applies twice and backfills a token without a family as its own family', async () => {
      await pool.query(
        `INSERT INTO refresh_tokens (token, user_id, expires_at, family_id) VALUES ('m123-old', $1, NOW() + interval '1 day', NULL)`,
        [userId],
      );
      await pool.query(SQL);
      await pool.query(SQL);
      const { rows } = await pool.query(`SELECT family_id FROM refresh_tokens WHERE token = 'm123-old'`);
      assert.equal(rows[0].family_id, 'm123-old');
    });

    test('login_failure_ips keeps one row per (user, ip)', async () => {
      await pool.query(`INSERT INTO login_failure_ips (user_id, ip_hash, consecutive_failures) VALUES ($1, 'h1', 1)`, [userId]);
      await assert.rejects(
        pool.query(`INSERT INTO login_failure_ips (user_id, ip_hash, consecutive_failures) VALUES ($1, 'h1', 1)`, [userId]),
        /login_failure_ips_pkey/,
      );
    });
  });
});
