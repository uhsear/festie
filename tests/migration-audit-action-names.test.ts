import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';

// Migration 082 renames old audit action values to the dotted names in
// lib/audit-actions.ts. Running it again changes nothing.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '082_audit_action_names.sql'),
  'utf8',
);

const ROWS: Array<[string, string]> = [
  ['rename-test-role', 'role_grant'],
  ['rename-test-create', 'festival:create'],
  ['rename-test-generic', 'create:crews'],
  ['rename-test-dotted', 'festival.created'],
];

describe('migration 082 audit action names', { skip }, () => {
  let pool: Pool;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    for (const [id, action] of ROWS) {
      await pool.query(
        "INSERT INTO audit_log (id, actor_type, action, target_type) VALUES ($1, 'admin', $2, 'test') ON CONFLICT (id) DO UPDATE SET action = $2",
        [id, action],
      );
    }
  });

  after(async () => {
    await pool.query("DELETE FROM audit_log WHERE id LIKE 'rename-test-%'").catch(() => {});
    await pool.end();
  });

  const actions = async () => {
    const { rows } = await pool.query("SELECT id, action FROM audit_log WHERE id LIKE 'rename-test-%'");
    return Object.fromEntries(rows.map((r: any) => [r.id, r.action]));
  };

  test('renames old values, then a second run changes nothing', async () => {
    await pool.query(SQL);
    const first = await actions();
    assert.deepEqual(first, {
      'rename-test-role': 'user.role.granted',
      'rename-test-create': 'festival.created',
      'rename-test-generic': 'crews.created',
      'rename-test-dotted': 'festival.created',
    });

    await pool.query(SQL);
    assert.deepEqual(await actions(), first);
  });
});
