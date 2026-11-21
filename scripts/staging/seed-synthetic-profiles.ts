// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Synthetic users and profiles for load rehearsals on staging. No production user data is
 * copied: every row is invented and its id starts with "synth-".
 *
 *   SEED_DATABASE_URL=postgresql://.../name_staging \
 *     node --import tsx/esm scripts/staging/seed-synthetic-profiles.ts \
 *       --festival <festival id> [--count 2000] [--picks 8] [--remove]
 *
 * It adds one account and one festival profile per synthetic user, each with up to --picks picks
 * on the festival's sets. A second run adds nothing that exists already, including picks for a
 * profile that belongs to another festival: run --remove before seeding a different festival. --remove deletes every
 * synthetic row and nothing else.
 *
 * It fails closed: the URL comes only from SEED_DATABASE_URL (never DATABASE_URL), the database
 * name must end in _staging or _test, and "festival_planner" is refused by name. The guard runs // secret-scan: allow names the guarded production database on purpose
 * before any connection opens. The festival must exist already (load it with the normal tools).
 */

import { Client, Pool } from 'pg';

const PRIORITIES = ['must', 'want-to-see', 'maybe'];
const PRODUCTION_DATABASE = 'festival_planner'; // secret-scan: allow names the guarded production database on purpose
const ID_PREFIX = 'synth-';
const BATCH = 500;

/** The database name the way pg reads it, so the guard and the connection cannot disagree. */
function databaseName(databaseUrl: string): string {
  try {
    const { protocol } = new URL(databaseUrl);
    if (protocol !== 'postgres:' && protocol !== 'postgresql:') return '';
    return new Client({ connectionString: databaseUrl }).database ?? '';
  } catch {
    return '';
  }
}

function assertSafeSeedDatabase(databaseUrl: string): void {
  const name = databaseName(databaseUrl);
  if (name === PRODUCTION_DATABASE) {
    throw new Error(`Refusing to seed "${PRODUCTION_DATABASE}": that is the production database. Use a _staging or _test database.`);
  }
  if (!/_(?:staging|test)$/.test(name)) {
    throw new Error(
      `Refusing to seed database "${name}": the name must end in _staging or _test. Point SEED_DATABASE_URL at a private staging or test database.`,
    );
  }
}

interface Args {
  festival: string;
  count: number;
  picks: number;
  remove: boolean;
}

function positiveInt(flag: string, value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} needs a positive whole number`);
  return n;
}

function readArgs(argv: string[]): Args {
  const args: Args = { festival: '', count: 2000, picks: 8, remove: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--festival') args.festival = argv[++i] ?? '';
    else if (argv[i] === '--count') args.count = positiveInt('--count', argv[++i]);
    else if (argv[i] === '--picks') args.picks = positiveInt('--picks', argv[++i]);
    else if (argv[i] === '--remove') args.remove = true;
    else throw new Error(`Unknown argument "${argv[i]}". Use --festival, --count, --picks and --remove.`);
  }
  if (!args.remove && !args.festival) throw new Error('--festival <festival id> is required');
  return args;
}

// Small seeded generator so a rerun picks the same sets for the same user.
function random(start: number): () => number {
  let a = start;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function picksFor(index: number, setIds: string[], count: number): Record<string, string> {
  const next = random(index);
  const pool = [...setIds];
  const picks: Record<string, string> = {};
  for (let n = 0; n < count && pool.length > 0; n++) {
    const [setId] = pool.splice(Math.floor(next() * pool.length), 1);
    picks[setId!] = PRIORITIES[Math.floor(next() * PRIORITIES.length)]!;
  }
  return picks;
}

const pad = (n: number) => String(n).padStart(6, '0');

async function removeAll(pool: Pool): Promise<number> {
  await pool.query('DELETE FROM festival_profiles WHERE user_id LIKE $1', [`${ID_PREFIX}%`]);
  const { rowCount } = await pool.query('DELETE FROM users WHERE id LIKE $1', [`${ID_PREFIX}%`]);
  return rowCount ?? 0;
}

async function seedBatch(client: any, festival: string, indexes: number[], setIds: string[], pickCount: number) {
  const numbers = indexes.map(pad);
  const picks = indexes.map((i) => picksFor(i, setIds, pickCount));
  const users = await client.query(
    `INSERT INTO users (id, username, display_name, created_at)
     SELECT 'synth-user-' || n, 'synth_' || n, 'Synthetic ' || n, now() FROM unnest($1::text[]) AS u(n)
     ON CONFLICT DO NOTHING`,
    [numbers],
  );
  const profiles = await client.query(
    `INSERT INTO festival_profiles (id, festival_id, user_id, name, picks_json, created_at, updated_at)
     SELECT 'synth-profile-' || n, $2, 'synth-user-' || n, 'Synthetic ' || n, p::jsonb, now(), now()
     FROM unnest($1::text[], $3::text[]) AS u(n, p)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [numbers, festival, picks.map((p) => JSON.stringify(p))],
  );
  // Picks only for profiles this run created, so a rerun never adds picks to another festival's profile
  // or picks that are missing from picks_json.
  const created = new Set(profiles.rows.map((r: { id: string }) => r.id));
  const rows = picks
    .flatMap((p, k) => Object.entries(p).map(([setId, priority]) => [`synth-profile-${numbers[k]}`, setId, priority]))
    .filter(([profileId]) => created.has(profileId));
  const inserted = await client.query(
    `INSERT INTO festival_profile_picks (profile_id, set_id, priority)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
     ON CONFLICT DO NOTHING`,
    [0, 1, 2].map((col) => rows.map((r) => r[col])),
  );
  return { users: users.rowCount ?? 0, profiles: created.size, picks: inserted.rowCount ?? 0 };
}

async function seed(pool: Pool, { festival, count, picks }: Args) {
  const { rows } = await pool.query('SELECT id FROM festival_sets WHERE festival_id = $1 ORDER BY id', [festival]);
  if (rows.length === 0) throw new Error(`Festival "${festival}" has no sets in this database. Load it first.`);
  const setIds = rows.map((r: { id: string }) => r.id);
  const total = { users: 0, profiles: 0, picks: 0 };
  for (let start = 1; start <= count; start += BATCH) {
    const indexes = Array.from({ length: Math.min(BATCH, count - start + 1) }, (_, k) => start + k);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const added = await seedBatch(client, festival, indexes, setIds, picks);
      await client.query('COMMIT');
      total.users += added.users;
      total.profiles += added.profiles;
      total.picks += added.picks;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return total;
}

async function main() {
  const databaseUrl = process.env.SEED_DATABASE_URL;
  if (!databaseUrl) throw new Error('Set SEED_DATABASE_URL to a staging or test database.');
  assertSafeSeedDatabase(databaseUrl);
  const args = readArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = args.remove ? { removedUsers: await removeAll(pool) } : await seed(pool, args);
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
