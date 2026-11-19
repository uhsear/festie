import 'dotenv/config';
/**
 * Migration 113 and POST /api/v1/admin/policy-notice on the test database. Only dry-run and the
 * refused send run here: the test database has no mail key, so nothing is ever mailed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { skip, startArtistServer, withPool, type ArtistServer } from './_artist-helpers';
import { registerUser } from './_integration-helpers';

const NOTICE = 'it-policy-2026';
let app: ArtistServer;
const ids: Record<string, string> = {};

const wipe = () => withPool((pool) => pool.query(`DELETE FROM policy_notice_sends WHERE notice_id = $1`, [NOTICE]));

before(async () => {
  if (skip) return;
  app = await startArtistServer();
  await wipe();
  for (const name of ['pn-verified', 'pn-sent', 'pn-unverified', 'pn-deleted']) {
    ids[name] = (await registerUser(app.server, name)).user.id;
  }
  await withPool(async (pool) => {
    await pool.query(`UPDATE users SET email_verified_at = now() WHERE id = ANY($1)`, [[ids['pn-verified'], ids['pn-sent'], ids['pn-deleted']]]);
    await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [ids['pn-deleted']]);
    await pool.query(`INSERT INTO policy_notice_sends (notice_id, user_id) VALUES ($1, $2)`, [NOTICE, ids['pn-sent']]);
  });
});
after(async () => {
  if (!app) return;
  await wipe();
  await app.close();
});

describe('policy_notice_sends migration', { skip }, () => {
  test('re-applying the file is a no-op and the table has the ledger shape', async () => {
    const sql = fs.readFileSync(new URL('../migrations/113_policy_notice_sends.sql', import.meta.url), 'utf8');
    await withPool(async (pool) => {
      await pool.query(sql);
      const { rows } = await pool.query(
        `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'policy_notice_sends' ORDER BY column_name`,
      );
      assert.deepEqual(rows.map((r) => r.column_name), ['notice_id', 'sent_at', 'user_id']);
      assert.ok(rows.every((r) => r.is_nullable === 'NO'));
    });
  });

  test('hard-deleting a user removes the ledger row instead of blocking the delete', async () => {
    await withPool(async (pool) => {
      await pool.query(`INSERT INTO users (id, username, password_hash, created_at) VALUES ('pn-purged', 'pn-purged', 'x', now())`);
      await pool.query(`INSERT INTO policy_notice_sends (notice_id, user_id) VALUES ($1, 'pn-purged')`, [NOTICE]);
      await pool.query(`DELETE FROM users WHERE id = 'pn-purged'`);
      const { rows } = await pool.query(`SELECT 1 FROM policy_notice_sends WHERE user_id = 'pn-purged'`);
      assert.equal(rows.length, 0);
    });
  });

  test('the primary key refuses a second row for the same notice and user, and the user must exist', async () => {
    await withPool(async (pool) => {
      await assert.rejects(pool.query(`INSERT INTO policy_notice_sends (notice_id, user_id) VALUES ($1, $2)`, [NOTICE, ids['pn-sent']]), { code: '23505' });
      await assert.rejects(pool.query(`INSERT INTO policy_notice_sends (notice_id, user_id) VALUES ($1, 'no-such-user')`, [NOTICE]), { code: '23503' });
    });
  });
});

describe('POST /admin/policy-notice', { skip }, () => {
  const body = { noticeId: NOTICE, subject: 'Policy update', text: 'We changed the policy.' };

  test('dry-run counts verified, live, unsent users and returns no addresses', async () => {
    const res = await app.post('/api/v1/admin/policy-notice', { ...body, mode: 'dry-run' }).expect(200);
    const expected = await withPool(async (pool) =>
      (await pool.query(`SELECT count(*)::int AS n FROM users u WHERE deleted_at IS NULL AND email IS NOT NULL AND email_verified_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM policy_notice_sends s WHERE s.notice_id = $1 AND s.user_id = u.id)`, [NOTICE])).rows[0].n,
    );
    assert.equal(res.body.data.recipients, expected);
    assert.ok(res.body.data.recipients >= 1, 'pn-verified is a recipient');
    assert.equal(res.body.data.skipped, 1);
    assert.doesNotMatch(JSON.stringify(res.body), /@/);
  });

  test('send is refused without a recent re-auth', async () => {
    const res = await app.post('/api/v1/admin/policy-notice', { ...body, mode: 'send' }).expect(403);
    assert.equal(res.body.error.code, 'REAUTH_REQUIRED');
  });
});
