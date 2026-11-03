import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';

// Migration 099 (T58) adds two crew history indexes: every poll of a crew by
// age, and the inactive meeting points of a crew by expiry. It runs twice
// without error and leaves each index once, valid.
// Run it only on a private Postgres (port 5434 or higher), never 5432 or 5433.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '099_crew_history_indexes.sql'),
  'utf8',
);

describe('migration 099 crew history indexes', { skip }, () => {
  let pool: Pool;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  after(async () => {
    await pool.end();
  });

  test('applies twice and leaves each index once and valid', async () => {
    await pool.query(SQL);
    await pool.query(SQL);

    const { rows } = await pool.query(
      `SELECT c.relname AS name, t.relname AS "table", i.indisvalid AS valid,
              pg_get_indexdef(i.indexrelid) AS def
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_class t ON t.oid = i.indrelid
       WHERE c.relname IN ('idx_crew_polls_crew', 'idx_cmp_crew_inactive')
       ORDER BY c.relname`,
    );
    assert.equal(rows.length, 2);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    assert.equal(byName.idx_crew_polls_crew.table, 'crew_polls');
    assert.equal(byName.idx_crew_polls_crew.valid, true);
    assert.match(byName.idx_crew_polls_crew.def, /\(crew_id, created_at DESC\)/);
    assert.equal(byName.idx_cmp_crew_inactive.table, 'crew_meeting_points');
    assert.equal(byName.idx_cmp_crew_inactive.valid, true);
    assert.match(byName.idx_cmp_crew_inactive.def, /\(crew_id, expires_at DESC\) WHERE \(active = false\)/);
  });
});
