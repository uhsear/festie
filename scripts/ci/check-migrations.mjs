#!/usr/bin/env node
// Index churn gate. Replays migrations/*.sql in order and fails when an index is
// created again in a later file after an earlier file dropped it (a create-drop
// cycle), unless the index is in KNOWN_CHURN below.
//
// Applied migrations are immutable, so KNOWN_CHURN records the history that
// already exists (migrations 029-044) and only new cycles fail. A drop and
// re-create inside one file is a rebuild, not churn.
//
// ponytail: regex scan, not a SQL parser. Indexes created inside DO blocks or
// dynamic SQL are invisible to it. Upgrade if a migration ever hides one there.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KNOWN_CHURN = new Set([
  'idx_audit_log_created_desc', // dropped 032, restored 033
  'idx_crew_activity_user_id', // dropped 035, restored 039
  'idx_notification_counts_user_id', // dropped 029, restored 040
  'idx_set_ratings_user', // dropped 029, restored 044
  'idx_audit_log_target_id', // dropped 016, restored 120 (audit.listForUser had no index to serve target_id = $1)
]);

const CREATE = /\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi;
const DROP = /\bdrop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?(?:public\.)?(\w+)/gi;

export function findCycles(files) {
  const droppedIn = new Map();
  const cycles = [];
  for (const { name, sql } of files) {
    const text = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, idx] of text.matchAll(CREATE)) {
      const from = droppedIn.get(idx.toLowerCase());
      if (from && from !== name) cycles.push({ index: idx.toLowerCase(), dropped: from, recreated: name });
    }
    for (const [, idx] of text.matchAll(DROP)) droppedIn.set(idx.toLowerCase(), name);
  }
  return cycles;
}

function selftest() {
  const files = [
    { name: '001.sql', sql: 'CREATE INDEX idx_a ON t(a);' },
    { name: '002.sql', sql: 'DROP INDEX IF EXISTS idx_a;' },
    { name: '003.sql', sql: 'CREATE INDEX IF NOT EXISTS idx_a ON t(a);' },
    { name: '004.sql', sql: 'DROP INDEX idx_b; CREATE INDEX idx_b ON t(b);' },
    { name: '005.sql', sql: '-- DROP INDEX idx_c;\nCREATE INDEX idx_c ON t(c);' },
  ];
  const got = findCycles(files);
  if (got.length !== 1 || got[0].index !== 'idx_a') throw new Error(`selftest failed: ${JSON.stringify(got)}`);
}

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'migrations');
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  selftest();
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
  const all = findCycles(files);
  const fresh = all.filter((c) => !KNOWN_CHURN.has(c.index));
  console.log(`index churn: ${all.length} create-drop cycles, ${all.length - fresh.length} known, ${fresh.length} new`);
  for (const c of fresh) {
    console.error(`${c.index}: dropped in ${c.dropped}, created again in ${c.recreated}. Keep the index instead of recreating it, or add it to KNOWN_CHURN with a reason.`);
  }
  process.exit(fresh.length ? 1 : 0);
}
