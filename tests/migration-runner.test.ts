import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Pool } from 'pg';
import {
  __resetMigrationCacheForTests,
  discoverMigrationsOnDisk,
  runPostgresMigrations,
  stripOuterTxBoundaries,
} from '../lib/planner-db-pg';

// Characterizes the migration runner: ordering, ledger, idempotence, the
// advisory lock and failure rollback. The database tests create and drop a
// scratch database, so they never touch the schema other tests use.
// Run them only on a private Postgres (port 5434 or higher), never 5432 or 5433.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SCRATCH_DB = 'festie_migration_runner_scratch';

describe('discoverMigrationsOnDisk', () => {
  test('returns migrations sorted by version with unique versions', () => {
    const found = discoverMigrationsOnDisk();
    assert.ok(found.length > 0);
    const versions = found.map((m: any) => m.version);
    assert.deepEqual(
      versions,
      [...versions].sort((a, b) => a - b),
    );
    assert.equal(new Set(versions).size, versions.length);
  });
});

describe('stripOuterTxBoundaries', () => {
  test('removes an outer BEGIN/COMMIT pair', () => {
    const out = stripOuterTxBoundaries('BEGIN;\nCREATE TABLE a (id int);\nCOMMIT;\n');
    assert.ok(!/BEGIN/i.test(out));
    assert.ok(!/COMMIT/i.test(out));
    assert.match(out, /CREATE TABLE a/);
  });

  test('leaves BEGIN inside a PL/pgSQL body alone', () => {
    const sql = 'DO $$ BEGIN PERFORM 1; END $$;';
    assert.equal(stripOuterTxBoundaries(sql), sql);
  });
});

describe('runPostgresMigrations failure handling (fake client)', () => {
  beforeEach(() => __resetMigrationCacheForTests());

  test('rolls back, wraps the error with version and file, and releases the lock', async () => {
    const statements: string[] = [];
    let released = false;
    const client = {
      query: async (sql: string) => {
        statements.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
        const bookkeeping = /schema_migrations|statement_timeout|^\s*(BEGIN|COMMIT|ROLLBACK)|pg_advisory/;
        if (!bookkeeping.test(sql)) throw new Error('boom');
        return { rows: [], rowCount: 0 };
      },
      release: () => {
        released = true;
      },
    };
    await assert.rejects(runPostgresMigrations({ connect: async () => client }), (err: any) => {
      assert.equal(typeof err.migrationVersion, 'number');
      assert.match(err.migrationFile, /^\d{3,4}[a-z]?_.*\.sql$/i);
      assert.match(err.message, /failed: boom/);
      return true;
    });
    assert.ok(statements.includes('ROLLBACK'));
    assert.ok(statements.some((s) => s.startsWith('SELECT pg_advisory_unlock')));
    assert.ok(released);
  });
});

describe('runPostgresMigrations against Postgres', { skip }, () => {
  let admin: Pool;
  let pool: Pool;

  before(async () => {
    admin = new Pool({ connectionString: TEST_DATABASE_URL });
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
    const url = new URL(TEST_DATABASE_URL!);
    url.pathname = `/${SCRATCH_DB}`;
    pool = new Pool({ connectionString: url.toString() });
  });

  after(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin?.end();
  });

  test('applies every migration on an empty database and ledgers each one', async () => {
    __resetMigrationCacheForTests();
    const onDisk = discoverMigrationsOnDisk();
    const result = await runPostgresMigrations(pool);
    assert.deepEqual(
      result.applied,
      onDisk.map((m: any) => m.version),
    );
    assert.deepEqual(result.gap, []);
    assert.equal(result.current, Math.max(...onDisk.map((m: any) => m.version)));
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
    assert.equal(rows[0].n, onDisk.length);
  });

  test('a second run applies nothing and changes no ledger row', async () => {
    const before = await pool.query('SELECT version, applied_at FROM schema_migrations ORDER BY version');
    __resetMigrationCacheForTests();
    const result = await runPostgresMigrations(pool);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.gap, []);
    const after = await pool.query('SELECT version, applied_at FROM schema_migrations ORDER BY version');
    assert.deepEqual(after.rows, before.rows);
  });

  test('the process-wide flag short-circuits later calls', async () => {
    const result = await runPostgresMigrations(pool);
    assert.deepEqual(result, { applied: [], current: 0, gap: [] });
  });

  test('releases the advisory lock after a run', async () => {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
    );
    assert.equal(rows[0].n, 0);
  });
});
