import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { ensureTestSchema, TEST_DATABASE_URL } from './_test-schema';

// SAFETY: only TEST_DATABASE_URL, never DATABASE_URL (ensureTestSchema also requires a _test name).
const sql = readFileSync(path.resolve(import.meta.dirname, '..', 'scripts', 'sql', 'backup-counts.sql'), 'utf8');

const TABLES = [
  'users',
  'festivals',
  'festival_sets',
  'crews',
  'crew_members',
  'festival_profiles',
  'festival_profile_picks',
  'festival_profile_notes',
  'crew_expenses',
  'festival_announcements',
];

const skip = !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set';

// A skipped suite is not counted in the summary, so report the skip as a skipped test too.
if (skip) it('scripts/sql/backup-counts.sql suite', { skip }, () => {});

describe('scripts/sql/backup-counts.sql', { skip }, () => {
  let pool: Pool;

  before(async () => {
    await ensureTestSchema(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  after(async () => {
    await pool?.end();
  });

  it('runs against the migrated schema and returns one row per table', async () => {
    const { rows } = await pool.query(sql);
    assert.deepEqual(rows.map((r) => r.table_name), TABLES);
    for (const row of rows) {
      assert.match(String(row.row_count), /^\d+$/, `${row.table_name} count`);
    }
  });

  it('reports count-only tables with no newest-write time', async () => {
    const { rows } = await pool.query(sql);
    for (const name of ['festival_sets', 'festival_profile_picks', 'festival_profile_notes']) {
      assert.equal(rows.find((r) => r.table_name === name).newest_write, null, name);
    }
  });
});
