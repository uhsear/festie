/**
 * The one schema path for DB-backed tests: the same migration runner that
 * production boots with (lib/planner-db-pg.ts), so a migration that fails to
 * apply fails the suite instead of being swallowed. No top-level exit, so any
 * test file may import it.
 */
import { Pool } from 'pg';
import { runPostgresMigrations } from '../lib/planner-db-pg';

const readyUrls = new Set<string>();

function databaseName(databaseUrl: string): string {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

/** The one test-database name rule: the database name must end in "_test". */
export function isTestDatabaseUrl(databaseUrl: string): boolean {
  return databaseName(databaseUrl).endsWith('_test');
}

// SAFETY: only TEST_DATABASE_URL, never DATABASE_URL, so a test run cannot touch production data.
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
/** For suites that cannot skip: exit with a clear message unless TEST_DATABASE_URL names a "_test" database. */
export function requireTestDatabaseUrl(): string {
  if (!TEST_DATABASE_URL) {
    console.error('ERROR: TEST_DATABASE_URL env var required. Set it in .env. (Never falls back to DATABASE_URL to protect production data.)');
    process.exit(1);
  }
  if (!isTestDatabaseUrl(TEST_DATABASE_URL)) {
    console.error('SAFETY: TEST_DATABASE_URL must end in "_test" in the database name to prevent accidental production wipe.');
    process.exit(1);
  }
  return TEST_DATABASE_URL;
}

/** DB-backed suites skip when no safe test database is configured. */
export const skip = !TEST_DATABASE_URL || !isTestDatabaseUrl(TEST_DATABASE_URL);

export async function ensureTestSchema(databaseUrl: string): Promise<void> {
  if (!isTestDatabaseUrl(databaseUrl)) {
    throw new Error(
      `SAFETY: refusing to migrate database "${databaseName(databaseUrl)}": the database name must end in "_test". ` +
        'Point TEST_DATABASE_URL at a private test database, for example postgresql://festie:festie@localhost:5434/festie_test.',
    );
  }
  if (readyUrls.has(databaseUrl)) return;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS citext');
    await runPostgresMigrations(pool, {
      log: (level: string, msg: string, meta?: unknown) => {
        if (level === 'error') console.error(`[test-schema] ${msg}`, meta);
      },
    });
    readyUrls.add(databaseUrl);
  } finally {
    await pool.end();
  }
}
