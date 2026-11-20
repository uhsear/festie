import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { createStores } from '../lib/db/index.js';
import { DELETED_USER_ID } from '../lib/db/stores/users.js';
import { validateUsername } from '../lib/helpers/validation.js';
import { DEFAULT_PASSWORD, registerUser, startServer } from './_integration-helpers';

// The migration 116 placeholder owns the expenses of hard-deleted users. It has a far-future
// deleted_at, so without explicit guards the deleted-account lookups would match it.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const PLACEHOLDER_NAME = '[deleted user]';

async function seedPlaceholder(pool: Pool, { email, withHash }: { email?: string; withHash?: boolean } = {}) {
  await pool.query(
    `INSERT INTO users (id, username, display_name, email, password_hash, created_at, deleted_at)
     VALUES ($1, $2, 'Deleted user', $3, $4, NOW(), NOW() - INTERVAL '1 day')
     ON CONFLICT (id) DO UPDATE SET email = $3, password_hash = $4, deleted_at = NOW() - INTERVAL '1 day'`,
    [DELETED_USER_ID, PLACEHOLDER_NAME, email ?? null, withHash ? 'x:y' : null],
  );
}

describe('deleted-user placeholder is never a sign-in identity', { skip, concurrency: 1 }, () => {
  let pool: Pool;
  let stores: any;

  before(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    stores = createStores(pool);
  });
  after(() => pool.end());
  // Put the migration 116 row back as the migration seeds it; later suites in the same DB rely on it.
  afterEach(() =>
    pool.query(
      `INSERT INTO users (id, username, display_name, created_at, deleted_at)
       VALUES ($1, $2, 'Deleted user', NOW(), '9999-12-31T00:00:00Z')
       ON CONFLICT (id) DO UPDATE SET email = NULL, password_hash = NULL, deleted_at = '9999-12-31T00:00:00Z'`,
      [DELETED_USER_ID, PLACEHOLDER_NAME],
    ),
  );

  test('store lookups by username and email never return it', async () => {
    await seedPlaceholder(pool, { email: 'ghost@example.com' });
    assert.equal(await stores.users.findDeletedByUsername(PLACEHOLDER_NAME), null);
    assert.equal(await stores.users.findDeletedByEmail('ghost@example.com'), null);
    assert.equal(await stores.users.getByUsername(PLACEHOLDER_NAME), null);
    assert.equal(await stores.users.getByEmail('ghost@example.com'), null);
  });

  test('reactivate leaves the placeholder deleted', async () => {
    await seedPlaceholder(pool);
    await stores.users.reactivate(DELETED_USER_ID);
    const { rows } = await pool.query('SELECT deleted_at FROM users WHERE id = $1', [DELETED_USER_ID]);
    assert.ok(rows[0].deleted_at);
  });

  test('password login by username and by email refuses it, even with a hash', async () => {
    const server = await startServer();
    try {
      await seedPlaceholder(new Pool({ connectionString: TEST_DATABASE_URL }), { email: 'ghost@example.com', withHash: true });
      for (const ident of [PLACEHOLDER_NAME, 'ghost@example.com']) {
        const res = await server.request.post('/api/v1/auth/login').send({ username: ident, password: DEFAULT_PASSWORD });
        assert.equal(res.status, 401, ident);
      }
    } finally {
      await server.close();
    }
  });

  test('a user with a NULL password hash cannot log in, not even with the dummy hash password', async () => {
    const server = await startServer();
    try {
      await registerUser(server, 'nohash');
      const p = new Pool({ connectionString: TEST_DATABASE_URL });
      await p.query("UPDATE users SET password_hash = NULL WHERE username = 'nohash'");
      await p.end();
      for (const password of [DEFAULT_PASSWORD, 'festie-dummy-password']) {
        await server.request.post('/api/v1/auth/login').send({ username: 'nohash', password }).expect(401);
      }
    } finally {
      await server.close();
    }
  });

  test('registration rules reject the reserved username', () => {
    assert.equal(validateUsername(PLACEHOLDER_NAME), false);
    assert.equal(validateUsername(DELETED_USER_ID), true); // allowed as a name; ids are opaque 'user_*', so no collision
  });
});
