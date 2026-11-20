import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { ensureTestSchema, TEST_DATABASE_URL, skip } from './_test-schema';

// Migrations 108 and 109 add the organizer tables, festivals.organization_id and created_by, and
// audit_log.organization_id, then their indexes. Both run twice without error, are ASCII only and hold no
// BEGIN or COMMIT (the runner wraps each file itself). Run on a private Postgres, never 5432 or 5433.

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const SQL_108 = fs.readFileSync(path.join(dir, '108_organizations.sql'), 'utf8');
const SQL_109 = fs.readFileSync(path.join(dir, '109_organizations_indexes.sql'), 'utf8');

// CREATE INDEX CONCURRENTLY cannot share a query string with another statement, so 109 runs one statement at a time.
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

describe('migrations 108 and 109 organizations', () => {
  test('the files are ASCII only and have no transaction control', () => {
    for (const sql of [SQL_108, SQL_109]) {
      assert.equal(/[^\x00-\x7F]/.test(sql), false);
      assert.equal(/^\s*(BEGIN|COMMIT)\b/im.test(sql), false);
    }
  });

  describe('on a database', { skip }, () => {
    let pool: Pool;
    const stamp = Date.now();
    const orgId = `m108-org-${stamp}`;
    const userId = `m108-user-${stamp}`;
    const festivalId = `m108-fest-${stamp}`;

    before(async () => {
      await ensureTestSchema(TEST_DATABASE_URL!);
      pool = new Pool({ connectionString: TEST_DATABASE_URL });
    });

    after(async () => {
      await pool.query('DELETE FROM festivals WHERE id = $1', [festivalId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
      await pool.end();
    });

    test('108 applies twice and leaves the tables and columns once', async () => {
      await pool.query(SQL_108);
      await pool.query(SQL_108);
      const { rows } = await pool.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE (table_name IN ('organizations', 'organization_members', 'organization_pending_members'))
             OR (table_name = 'festivals' AND column_name IN ('organization_id', 'created_by'))
             OR (table_name = 'audit_log' AND column_name = 'organization_id')`,
      );
      const columns = (table: string) => rows.filter((r: any) => r.table_name === table).map((r: any) => r.column_name).sort();
      assert.deepEqual(columns('organizations'), ['created_at', 'created_by', 'id', 'kind', 'name', 'status', 'updated_at', 'verified_at', 'website']);
      assert.deepEqual(columns('organization_members'), ['added_by', 'created_at', 'organization_id', 'role', 'user_id']);
      assert.deepEqual(columns('organization_pending_members'), ['added_by', 'created_at', 'email', 'organization_id', 'role']);
      assert.deepEqual(columns('festivals'), ['created_by', 'organization_id']);
      assert.deepEqual(columns('audit_log'), ['organization_id']);
    });

    test('109 applies twice and leaves the four indexes', async () => {
      for (let run = 0; run < 2; run++) for (const statement of statements(SQL_109)) await pool.query(statement);
      const { rows } = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_org_members_user', 'idx_org_pending_email', 'idx_festivals_org', 'idx_audit_log_org') ORDER BY indexname`,
      );
      assert.deepEqual(rows.map((r: any) => r.indexname), ['idx_audit_log_org', 'idx_festivals_org', 'idx_org_members_user', 'idx_org_pending_email']);
    });

    test('the checks reject a short name, a bad kind or status, a non-https website and a mixed-case pending email', async () => {
      const insert = (name: string, kind: string, status: string, website: string | null) =>
        pool.query('INSERT INTO organizations (id, name, kind, status, website) VALUES ($1, $2, $3, $4, $5)', [orgId, name, kind, status, website]);
      await assert.rejects(insert('x', 'venue', 'pending', null), { code: '23514' });
      await assert.rejects(insert('Venue', 'club', 'pending', null), { code: '23514' });
      await assert.rejects(insert('Venue', 'venue', 'deleted', null), { code: '23514' });
      await assert.rejects(insert('Venue', 'venue', 'pending', 'http://venue.example'), { code: '23514' });
      await insert('Venue', 'venue', 'pending', 'https://venue.example');
      await assert.rejects(
        pool.query("INSERT INTO organization_pending_members (organization_id, email, role) VALUES ($1, 'Mixed@Example.com', 'owner')", [orgId]),
        { code: '23514' },
      );
      await assert.rejects(
        pool.query("INSERT INTO organization_pending_members (organization_id, email, role) VALUES ($1, 'a@example.com', 'boss')", [orgId]),
        { code: '23514' },
      );
    });

    test('a purged user takes its memberships with it, and a removed organization hands its festivals back to the platform', async () => {
      await pool.query("INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES ($1, $2, 'x', NOW(), NOW())", [userId, `m108${stamp}`]);
      await pool.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [orgId, userId]);
      await pool.query(
        "INSERT INTO festivals (id, name, location, created_at, updated_at, organization_id) VALUES ($1, 'M108', 'x', NOW(), NOW(), $2)",
        [festivalId, orgId],
      );
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      assert.equal((await pool.query('SELECT 1 FROM organization_members WHERE organization_id = $1', [orgId])).rowCount, 0);
      await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
      const { rows } = await pool.query('SELECT organization_id FROM festivals WHERE id = $1', [festivalId]);
      assert.equal(rows[0].organization_id, null);
    });
  });
});
