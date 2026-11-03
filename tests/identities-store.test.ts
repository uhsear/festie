import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';

import { createIdentitiesStore } from '../lib/db/stores/identities.js';

// Needs the Docker test DB (port 5433, a *_test database) with migrations applied.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const MIGRATION = path.join(import.meta.dirname, '..', 'migrations', '083_user_identities.sql');

describe('identities store (database)', { skip }, () => {
  let pool: Pool;
  let identities: ReturnType<typeof createIdentitiesStore>;

  const mkUser = (id: string, passwordHash: string | null) =>
    pool.query('INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, NOW())', [
      id,
      id,
      passwordHash,
    ]);

  const cleanup = async () => {
    await pool.query("DELETE FROM users WHERE id LIKE 'idt-test-%'");
    await pool.query("DELETE FROM auth_oauth_states WHERE key_hash LIKE 'idt-test-%'");
  };

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    identities = createIdentitiesStore(pool);
    // Running the migration here also proves it is idempotent: the harness already applied it once.
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    await pool.query(sql);
    await pool.query(sql);
    await cleanup();
    await mkUser('idt-test-a', 'hash');
    await mkUser('idt-test-b', null);
    await mkUser('idt-test-c', null);
  });

  after(async () => {
    await cleanup().catch(() => {});
    await pool.end();
  });

  test('create, find and list never expose the encrypted Apple token', async () => {
    const created = await identities.create({
      userId: 'idt-test-a',
      provider: 'apple',
      subject: 'idt-test-apple-1',
      email: 'x@privaterelay.appleid.com',
      emailVerified: true,
      isPrivateEmail: true,
      appleRefreshTokenEnc: 'v1.sealed',
    });
    assert.equal(created.userId, 'idt-test-a');
    assert.equal(created.isPrivateEmail, true);
    assert.ok(!('appleRefreshTokenEnc' in created));
    const found = await identities.findBySubject('apple', 'idt-test-apple-1');
    assert.equal(found?.id, created.id);
    assert.ok(!('appleRefreshTokenEnc' in (found as object)));
    const listed = await identities.listByUser('idt-test-a');
    assert.deepEqual(
      listed.map((i) => i.provider),
      ['apple'],
    );
    assert.deepEqual(await identities.appleTokensForUser('idt-test-a'), [
      { id: created.id, appleRefreshTokenEnc: 'v1.sealed' },
    ]);
  });

  test('a duplicate (provider, subject) raises 23505', async () => {
    await assert.rejects(
      identities.create({ userId: 'idt-test-b', provider: 'apple', subject: 'idt-test-apple-1' }),
      (err: any) => err.code === '23505',
    );
  });

  test('a duplicate (user_id, provider) raises 23505', async () => {
    await assert.rejects(
      identities.create({ userId: 'idt-test-a', provider: 'apple', subject: 'idt-test-apple-2' }),
      (err: any) => err.code === '23505',
    );
  });

  test('touch stamps last_used_at and only replaces the token when given', async () => {
    const row = await identities.findBySubject('apple', 'idt-test-apple-1');
    await identities.touch(row!.id);
    assert.ok((await identities.findBySubject('apple', 'idt-test-apple-1'))?.lastUsedAt);
    assert.equal((await identities.appleTokensForUser('idt-test-a'))[0]?.appleRefreshTokenEnc, 'v1.sealed');
    await identities.touch(row!.id, 'v1.newer');
    assert.equal((await identities.appleTokensForUser('idt-test-a'))[0]?.appleRefreshTokenEnc, 'v1.newer');
  });

  test('countSignInMethods returns 0, 1 and 2', async () => {
    await identities.create({ userId: 'idt-test-c', provider: 'google', subject: 'idt-test-google-c' });
    const count = async (userId: string) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const n = await identities.countSignInMethods(client, userId);
        await client.query('COMMIT');
        return n;
      } finally {
        client.release();
      }
    };
    assert.equal(await count('idt-test-b'), 0); // no password, no identity
    assert.equal(await count('idt-test-c'), 1); // one identity
    assert.equal(await count('idt-test-a'), 2); // password + Apple
    assert.equal(await count('idt-test-missing'), 0);
  });

  test('deleteForUser returns the row with its encrypted token, then null', async () => {
    const deleted = await identities.deleteForUser('idt-test-a', 'apple');
    assert.equal(deleted?.subject, 'idt-test-apple-1');
    assert.equal(deleted?.appleRefreshTokenEnc, 'v1.newer');
    assert.equal(await identities.deleteForUser('idt-test-a', 'apple'), null);
  });

  test('deleting the user cascades to its identities', async () => {
    await pool.query("DELETE FROM users WHERE id = 'idt-test-c'");
    assert.equal(await identities.findBySubject('google', 'idt-test-google-c'), null);
  });

  test('takeState returns the payload once, then null', async () => {
    await identities.putState('signup', 'idt-test-s1', { provider: 'google', subject: 's' }, 900);
    assert.deepEqual(await identities.takeState('signup', 'idt-test-s1'), { provider: 'google', subject: 's' });
    assert.equal(await identities.takeState('signup', 'idt-test-s1'), null);
  });

  test('a nonce with no payload is still taken exactly once', async () => {
    await identities.putState('nonce', 'idt-test-n1', null, 600);
    assert.notEqual(await identities.takeState('nonce', 'idt-test-n1'), null);
    assert.equal(await identities.takeState('nonce', 'idt-test-n1'), null);
  });

  test('takeState ignores the wrong kind and expired rows', async () => {
    await identities.putState('nonce', 'idt-test-n2', null, 600);
    assert.equal(await identities.takeState('signup', 'idt-test-n2'), null);
    await pool.query(
      "INSERT INTO auth_oauth_states (key_hash, kind, payload, expires_at) VALUES ('idt-test-old', 'signup', '{}', NOW() - INTERVAL '1 minute')",
    );
    assert.equal(await identities.takeState('signup', 'idt-test-old'), null);
  });

  test('markTokenUsed is true once, then false', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    assert.equal(await identities.markTokenUsed('idt-test-t1', exp), true);
    assert.equal(await identities.markTokenUsed('idt-test-t1', exp), false);
  });

  test('purgeExpiredStates removes only expired rows', async () => {
    assert.ok((await identities.purgeExpiredStates()) >= 1); // idt-test-old
    const { rows } = await pool.query("SELECT key_hash FROM auth_oauth_states WHERE key_hash = 'idt-test-t1'");
    assert.equal(rows.length, 1);
  });
});
