import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';

// Migration 078 repairs crew ownership written before the transfer and
// account-deletion fixes: a stale crews.created_by after a transfer, and a crew
// whose only owner is a soft-deleted user. Running it again changes nothing.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '078_crew_owner_repair.sql'),
  'utf8',
);

describe('migration 078 crew owner repair', { skip }, () => {
  let pool: Pool;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query("INSERT INTO festivals (id, name) VALUES ('repair-test-f1', 'Repair Fest') ON CONFLICT DO NOTHING");
    for (const u of ['a', 'b', 'c', 'd', 'e']) {
      await pool.query(
        'INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING',
        [`repair-test-${u}`, `repair-test-${u}`, 'x'],
      );
    }
    await pool.query("UPDATE users SET deleted_at = NOW() WHERE id = 'repair-test-c'");

    const crew = (id: string, createdBy: string) =>
      pool.query(
        "INSERT INTO crews (id, festival_id, name, created_by, invite_code, max_members) VALUES ($1, 'repair-test-f1', $1, $2, $1, 10)",
        [id, createdBy],
      );
    const member = (crewId: string, userId: string, role: string, joinedAt: string) =>
      pool.query('INSERT INTO crew_members (crew_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)', [
        crewId,
        userId,
        role,
        joinedAt,
      ]);

    // Stale: B owns the crew by role, created_by still names A.
    await crew('repair-test-stale', 'repair-test-a');
    await member('repair-test-stale', 'repair-test-a', 'member', '2020-01-01');
    await member('repair-test-stale', 'repair-test-b', 'owner', '2020-01-02');

    // Ownerless: the owner C is soft-deleted; E joined before D.
    await crew('repair-test-ownerless', 'repair-test-c');
    await member('repair-test-ownerless', 'repair-test-c', 'owner', '2020-01-01');
    await member('repair-test-ownerless', 'repair-test-d', 'member', '2020-01-03');
    await member('repair-test-ownerless', 'repair-test-e', 'member', '2020-01-02');

    // Healthy crew, untouched.
    await crew('repair-test-ok', 'repair-test-a');
    await member('repair-test-ok', 'repair-test-a', 'owner', '2020-01-01');
  });

  after(async () => {
    await pool.query("DELETE FROM crews WHERE id LIKE 'repair-test-%'").catch(() => {});
    await pool.query("DELETE FROM festivals WHERE id LIKE 'repair-test-%'").catch(() => {});
    await pool.query("DELETE FROM users WHERE id LIKE 'repair-test-%'").catch(() => {});
    await pool.end();
  });

  const snapshot = async () => {
    const crews = await pool.query(
      "SELECT id, created_by, updated_at FROM crews WHERE id LIKE 'repair-test-%' ORDER BY id",
    );
    const roles = await pool.query(
      "SELECT crew_id, user_id, role FROM crew_members WHERE crew_id LIKE 'repair-test-%' ORDER BY crew_id, user_id",
    );
    return { crews: crews.rows, roles: roles.rows };
  };

  test('fixes both crews, then a second run changes nothing', async () => {
    await pool.query(SQL);
    const first = await snapshot();

    const createdBy = Object.fromEntries(first.crews.map((c: any) => [c.id, c.created_by]));
    assert.equal(createdBy['repair-test-stale'], 'repair-test-b');
    assert.equal(createdBy['repair-test-ownerless'], 'repair-test-e', 'the first-joined active member inherits');
    assert.equal(createdBy['repair-test-ok'], 'repair-test-a');

    const role = (crewId: string, userId: string) =>
      first.roles.find((r: any) => r.crew_id === crewId && r.user_id === userId)?.role;
    assert.equal(role('repair-test-ownerless', 'repair-test-e'), 'owner');
    assert.equal(role('repair-test-ownerless', 'repair-test-c'), 'member', 'the deleted owner is demoted');
    assert.equal(role('repair-test-ownerless', 'repair-test-d'), 'member');

    await pool.query(SQL);
    assert.deepEqual(await snapshot(), first);
  });
});
