// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * A fictional demo festival for staging, used for store screenshots, previews and design checks.
 * Every festival, stage, artist and person in it is invented, so no capture of it shows a real
 * artist or festival name.
 *
 *   SEED_DATABASE_URL=postgresql://.../name_staging \
 *     node --import tsx/esm scripts/staging/seed-demo-festival.ts [--remove]
 *
 * It creates two festivals:
 *   demo-moonlit-orchard  Today's sets are placed around the moment you run the script, so one
 *                         capture shows ended, live, imminent and later sets, plus a clash. It also
 *                         gets three crew members with picks, one poll and one expense.
 *   demo-hush-harbor      Stages and sets with no times, for the unannounced-schedule state.
 * A rerun deletes the demo rows first and rebuilds them, so the times move to the new "now".
 * --remove deletes the demo rows and nothing else. Demo accounts have no password: sign in to a
 * staging web or app build by setting one on staging only, never through the production site.
 *
 * It fails closed: the URL comes only from SEED_DATABASE_URL (never DATABASE_URL), the database
 * name must end in _staging, and "festival_planner" is refused by name. The guard runs before any
 * connection opens.
 */

import { Client, Pool, type PoolClient } from 'pg';

const PRODUCTION_DATABASE = 'festival_planner'; // secret-scan: allow names the guarded production database on purpose
const TIME_ZONE = 'America/New_York';
const FESTIVALS = ['demo-moonlit-orchard', 'demo-hush-harbor'];
const MAIN = FESTIVALS[0]!;
const HUSH = FESTIVALS[1]!;
const USER_PREFIX = 'demo-user-';

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

export function assertStagingDatabase(databaseUrl: string): void {
  const name = databaseName(databaseUrl);
  if (name === PRODUCTION_DATABASE) {
    throw new Error(`Refusing to seed "${PRODUCTION_DATABASE}": that is the production database. Use a _staging database.`);
  }
  if (!/_staging$/.test(name)) {
    throw new Error(`Refusing to seed database "${name}": the name must end in _staging. Point SEED_DATABASE_URL at the staging database.`);
  }
}

const STAGES = [
  { id: 'lantern', name: 'Lantern Stage', color: '#e8294f' },
  { id: 'moth', name: 'Moth Garden', color: '#8f4ad8' },
  { id: 'tidepool', name: 'Tidepool', color: '#1f9d6b' },
  { id: 'copper', name: 'Copper Tent', color: '#e08a1e' },
];

// [stage, artist, start offset in minutes from now, end offset]. Today has three live sets, one
// soon, ended sets before them, and Moth Garden's Nova Lemonade overlapping
// Marsh Choir Collective and Orbit Kitchen so one pick pair clashes.
export const TODAY: [string, string, number, number][] = [
  ['lantern', 'Velvet Lanterns', -210, -150],
  ['lantern', 'Pocket Comet', -150, -90],
  ['lantern', 'Marsh Choir Collective', -30, 45],
  ['lantern', 'Orbit Kitchen', 60, 130],
  ['moth', 'Hollow Tangerine', -180, -110],
  ['moth', 'Sundial Static', -100, -40],
  ['moth', 'Nova Lemonade', 15, 80],
  ['moth', 'Quiet Anvil', 95, 160],
  ['tidepool', 'Glass Heron', -60, 20],
  ['tidepool', 'Mango Telescope', 30, 100],
  ['tidepool', 'Late Bus Home', 120, 190],
  ['copper', 'Fern and Foxglove', -90, -30],
  ['copper', 'Static Orchard', 0, 50],
  ['copper', 'Dust Ballet', 70, 120],
];

const TOMORROW: [string, string, string, string][] = [
  ['lantern', 'Brass Cathedral', '14:00', '15:00'],
  ['moth', 'Lilac Interstate', '16:30', '17:30'],
  ['tidepool', 'The Slow Lanterns', '19:00', '20:15'],
  ['copper', 'Pale Fox Parade', '21:30', '23:00'],
];

const HUSH_SETS: [string, string][] = [
  ['quay', 'Salt Meadow'],
  ['quay', 'Drift Almanac'],
  ['pier', 'Wren Theory'],
  ['pier', 'Cobalt Bakery'],
];

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** The festival-local calendar date and minute of the day, rounded down to 5 minutes. */
export function localNow(now: Date, timeZone = TIME_ZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: minute - (minute % 5) };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's sets as [stage, artist, start, end] in HH:MM. Throws when the window would cross midnight. */
export function todaySchedule(minuteOfDay: number): [string, string, string, string][] {
  const lo = Math.min(...TODAY.map((s) => s[2]));
  const hi = Math.max(...TODAY.map((s) => s[3]));
  if (minuteOfDay + lo < 0 || minuteOfDay + hi > 24 * 60 - 1) {
    throw new Error(
      `The demo day spans ${-lo} minutes before to ${hi} minutes after now, which crosses midnight in ${TIME_ZONE}. Run the script between 03:30 and 20:50 festival-local time.`,
    );
  }
  return TODAY.map(([stage, artist, from, to]) => [stage, artist, hhmm(minuteOfDay + from), hhmm(minuteOfDay + to)]);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Rows a demo user can create after someone signs in as them. Their user foreign keys are RESTRICT,
// so the users delete fails while any remain. Mirrors the tables lib/db/stores/users.ts clears.
const DEMO_USER_ROWS: [table: string, column: string][] = [
  ['crew_poll_votes', 'user_id'], ['crew_polls', 'created_by'], ['crew_meeting_points', 'created_by'], ['crew_expenses', 'paid_by'],
  ['crew_activity', 'user_id'], ['crew_members', 'user_id'], ['set_ratings', 'user_id'], ['calendar_tokens', 'user_id'],
  ['device_tokens', 'user_id'], ['notification_preferences', 'user_id'], ['notification_log', 'user_id'], ['notification_counts', 'user_id'],
  ['notification_topic_subs', 'user_id'], ['refresh_tokens', 'user_id'], ['user_sessions', 'user_id'], ['login_failures', 'user_id'],
  ['password_reset_tokens', 'user_id'], ['email_verification_tokens', 'user_id'], ['user_roles', 'user_id'],
  ['festival_profiles', 'user_id'], ['crews', 'created_by'],
];

async function deleteDemoRows(db: Pick<PoolClient, 'query'>): Promise<void> {
  const crews = `SELECT id FROM crews WHERE festival_id = ANY($1)`;
  const del = (sql: string) => db.query(sql, [FESTIVALS]);
  await del(`DELETE FROM crew_poll_votes WHERE poll_id IN (SELECT id FROM crew_polls WHERE crew_id IN (${crews}))`);
  for (const table of ['crew_polls', 'crew_expenses', 'crew_members']) await del(`DELETE FROM ${table} WHERE crew_id IN (${crews})`);
  await del('DELETE FROM crews WHERE festival_id = ANY($1)');
  await del('DELETE FROM festival_profiles WHERE festival_id = ANY($1)'); // cascades picks and notes
  for (const table of ['festival_sets', 'festival_days', 'festival_stages']) await del(`DELETE FROM ${table} WHERE festival_id = ANY($1)`);
  await del('DELETE FROM festivals WHERE id = ANY($1)');
  for (const [table, column] of DEMO_USER_ROWS) await db.query(`DELETE FROM ${table} WHERE ${column} LIKE $1`, [`${USER_PREFIX}%`]);
  await db.query('DELETE FROM users WHERE id LIKE $1', [`${USER_PREFIX}%`]);
}

/** Deletes every demo row in one transaction, so a failure leaves the demo as it was. */
export async function removeDemo(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await deleteDemoRows(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function insertFestival(
  client: any,
  id: string,
  name: string,
  stages: { id: string; name: string; color: string }[],
  days: { label: string; date: string }[],
) {
  await client.query(
    `
  INSERT INTO
    festivals (
      id,
      name,
      location,
      created_at,
      updated_at,
      edited_at,
      b2b_separator,
      time_zone,
      published_at,
      lineup
    )
  VALUES
    (
      $1,
      $2,
      'Fictional Fields',
      now(),
      now(),
      now(),
      'b2b',
      $3,
      now(),
      '[]'::jsonb
    )
`,
    [id, name, TIME_ZONE],
  );
  for (const [i, s] of stages.entries()) {
    await client.query('INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, $3, $4, $5)', [id, `${id}-${s.id}`, s.name, s.color, i]);
  }
  for (const [i, d] of days.entries()) {
    await client.query('INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, $2, $3, $4)', [id, i, d.label, d.date]);
  }
}

async function insertSet(client: any, festival: string, day: number, order: number, stage: string, artist: string, start: string | null, end: string | null): Promise<string> {
  const id = `${festival}-${slug(artist)}`;
  await client.query(
    `
  INSERT INTO
    festival_sets (
      id,
      festival_id,
      day_index,
      artist,
      stage_id,
      start_time,
      end_time,
      sort_order,
      artists
    )
  VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, '[]'::jsonb)
`,
    [id, festival, day, artist, `${festival}-${stage}`, start, end, order],
  );
  return id;
}

async function seedCrew(client: any, setIds: Record<string, string>) {
  const people = [
    { key: 'ava', name: 'Ava', picks: { 'Marsh Choir Collective': 'must', 'Nova Lemonade': 'must', 'Glass Heron': 'want-to-see', 'Orbit Kitchen': 'maybe', 'Brass Cathedral': 'want-to-see' } },
    { key: 'ben', name: 'Ben', picks: { 'Nova Lemonade': 'want-to-see', 'Mango Telescope': 'must', 'Static Orchard': 'maybe', 'Lilac Interstate': 'want-to-see' } },
    { key: 'cleo', name: 'Cleo', picks: { 'Marsh Choir Collective': 'want-to-see', 'Dust Ballet': 'must', 'Orbit Kitchen': 'want-to-see' } },
  ];
  for (const p of people) {
    const user = `${USER_PREFIX}${p.key}`;
    await client.query(`INSERT INTO users (id, username, display_name, created_at) VALUES ($1, $2, $3, now())`, [user, `demo_${p.key}`, p.name]);
    const picks = Object.fromEntries(Object.entries(p.picks).map(([artist, priority]) => [setIds[artist]!, priority]));
    await client.query(
      `INSERT INTO festival_profiles (id, festival_id, user_id, name, picks_json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, now(), now())`,
      [`demo-profile-${p.key}`, MAIN, user, p.name, JSON.stringify(picks)],
    );
    for (const [setId, priority] of Object.entries(picks)) {
      await client.query('INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ($1, $2, $3)', [`demo-profile-${p.key}`, setId, priority]);
    }
  }
  const crew = 'demo-crew-orchard';
  await client.query(
    `INSERT INTO crews (id, festival_id, name, created_by, invite_code, max_members, created_at, updated_at) VALUES ($1, $2, 'Orchard Crew', $3, 'DEMOORCH', 30, now(), now())`,
    [crew, MAIN, `${USER_PREFIX}ava`],
  );
  for (const [i, p] of people.entries()) {
    await client.query('INSERT INTO crew_members (crew_id, user_id, role) VALUES ($1, $2, $3)', [crew, `${USER_PREFIX}${p.key}`, i === 0 ? 'owner' : 'member']);
  }
  await client.query(
    `INSERT INTO crew_polls (id, crew_id, created_by, question, options, multi_answer) VALUES ('demo-poll-meet', $1, $2, 'Where do we meet after the headliner?', $3::jsonb, FALSE)`,
    [crew, `${USER_PREFIX}ava`, JSON.stringify(['Lantern Stage', 'Moth Garden'])],
  );
  for (const [key, option] of [['ava', 0], ['ben', 1], ['cleo', 0]] as const) {
    await client.query('INSERT INTO crew_poll_votes (poll_id, user_id, option_index) VALUES ($1, $2, $3)', ['demo-poll-meet', `${USER_PREFIX}${key}`, option]);
  }
  await client.query(
    `INSERT INTO crew_expenses (id, crew_id, paid_by, created_by, description, amount, split_with) VALUES ('demo-expense-ice', $1, $2, $2, 'Ice for the cooler', 24.00, $3::jsonb)`,
    [crew, `${USER_PREFIX}ava`, JSON.stringify(people.map((p) => `${USER_PREFIX}${p.key}`))],
  );
}

export async function seedDemo(pool: Pool, now = new Date()) {
  const { date, minute } = localNow(now);
  const today = todaySchedule(minute);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await deleteDemoRows(client);
    await insertFestival(client, MAIN, 'Moonlit Orchard Fest', STAGES, [
      { label: 'Today', date },
      { label: 'Tomorrow', date: addDays(date, 1) },
    ]);
    const setIds: Record<string, string> = {};
    for (const [i, [stage, artist, start, end]] of today.entries()) setIds[artist] = await insertSet(client, MAIN, 0, i, stage, artist, start, end);
    for (const [i, [stage, artist, start, end]] of TOMORROW.entries()) setIds[artist] = await insertSet(client, MAIN, 1, i, stage, artist, start, end);
    await seedCrew(client, setIds);

    await insertFestival(client, HUSH, 'Hush Harbor Weekend', [{ id: 'quay', name: 'The Quay', color: '#1f9d6b' }, { id: 'pier', name: 'Pier Nine', color: '#8f4ad8' }], [
      { label: 'Saturday', date: addDays(date, 30) },
    ]);
    for (const [i, [stage, artist]] of HUSH_SETS.entries()) await insertSet(client, HUSH, 0, i, stage, artist, null, null);
    await client.query('COMMIT');
    return { festivals: FESTIVALS, date, sets: today.length + TOMORROW.length + HUSH_SETS.length, crewMembers: 3 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--remove');
  if (unknown.length > 0) throw new Error(`Unknown argument "${unknown[0]}". The only flag is --remove.`);
  const databaseUrl = process.env.SEED_DATABASE_URL;
  if (!databaseUrl) throw new Error('Set SEED_DATABASE_URL to the staging database.');
  assertStagingDatabase(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    if (args.includes('--remove')) {
      await removeDemo(pool);
      process.stdout.write(JSON.stringify({ removed: FESTIVALS }) + '\n');
    } else {
      process.stdout.write(JSON.stringify(await seedDemo(pool)) + '\n');
    }
  } finally {
    await pool.end();
  }
}

// Run only as a script, so a test can import the pure helpers without opening a connection.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
