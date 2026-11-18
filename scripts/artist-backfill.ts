// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Artist backfill. The default is a dry run that writes nothing.
 *
 *   ARTIST_BACKFILL_DATABASE_URL=postgresql://.../name_test \
 *     node --import tsx/esm scripts/artist-backfill.ts [--mode dry-run|run|verify] [--report out.json]
 *
 * It refuses any database whose name does not end in _test or _staging, and it has no default
 * database: the URL comes only from ARTIST_BACKFILL_DATABASE_URL. Migration 107 must be applied.
 * It cannot clear the app's festival cache, so an app that is running shows old data for up to a
 * minute. --report writes the JSON report and a CSV next to it (dry-run and run).
 */

import fs from 'node:fs';
import { Pool } from 'pg';
import {
  applyBackfillPlan,
  assertSafeBackfillDatabase,
  planBackfill,
  reportToCsv,
  verifyBackfill,
} from '../lib/artist-backfill';

const MODES = ['dry-run', 'run', 'verify'] as const;

function readArgs(argv: string[]): { mode: (typeof MODES)[number]; report: string | null } {
  let mode: (typeof MODES)[number] = 'dry-run';
  let report: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode') {
      const value = argv[++i];
      if (!MODES.includes(value as (typeof MODES)[number])) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
      mode = value as (typeof MODES)[number];
    } else if (argv[i] === '--report') {
      report = argv[++i] ?? null;
      if (!report) throw new Error('--report needs a file path');
    } else {
      throw new Error(`Unknown argument "${argv[i]}". Use --mode and --report.`);
    }
  }
  return { mode, report };
}

async function main() {
  const databaseUrl = process.env.ARTIST_BACKFILL_DATABASE_URL;
  if (!databaseUrl) throw new Error('Set ARTIST_BACKFILL_DATABASE_URL to a test or staging database.');
  assertSafeBackfillDatabase(databaseUrl);
  const { mode, report } = readArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    if (mode === 'verify') {
      const result = await verifyBackfill(pool);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    const plan = await planBackfill(pool);
    const output: Record<string, unknown> = { mode, report: plan.report };
    if (mode === 'run') output.result = await applyBackfillPlan(pool, plan);
    console.log(JSON.stringify(output, null, 2));
    if (report) {
      fs.writeFileSync(report, JSON.stringify(output, null, 2));
      fs.writeFileSync(report.replace(/\.json$/i, '') + '.csv', reportToCsv(plan.report));
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
