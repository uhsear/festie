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

export async function ensureTestSchema(databaseUrl: string): Promise<void> {
  if (!databaseName(databaseUrl).endsWith('_test')) {
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
