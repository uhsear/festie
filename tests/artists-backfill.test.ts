import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Pool } from 'pg';
import {
  applyBackfillPlan,
  assertSafeBackfillDatabase,
  planBackfill,
  reportToCsv,
  runBackfill,
  verifyBackfill,
} from '../lib/artist-backfill';
import { lockFestivalAny } from '../lib/db/stores/lineup-imports';
import { ensureTestSchema, TEST_DATABASE_URL, skip } from './_test-schema';

// The backfill gives every artist element an artists row and an id. These tests run it on a private
// Postgres (port 5434 or higher), never 5432 or 5433. They empty the festival tables first.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const SPOTIFY_A = 'AAAAAAAAAAAAAAAAAAAAAA';
const SPOTIFY_B = 'BBBBBBBBBBBBBBBBBBBBBB';
const spotifyUrl = (id: string) => `https://open.spotify.com/artist/${id}`;

describe('backfill database guard', () => {
  test('accepts a _test or _staging name and refuses anything else', () => {
    assertSafeBackfillDatabase('postgresql://u:p@localhost:5653/festie_ar2_test');
    assertSafeBackfillDatabase('postgresql://u:p@localhost:5432/app_db_staging');
    const disagree = ['socket://x/foo_test?db=festival_planner', 'mysql://u:p@localhost/foo_test'];
    for (const url of ['postgresql://u:p@localhost:5432/festival_planner', 'postgresql://u:p@localhost/testing', 'postgresql://u:p@localhost/', 'not a url', ...disagree]) {
      assert.throws(() => assertSafeBackfillDatabase(url), /must end in _test or _staging/);
    }
  });

  test('the script exits 1 on a production name, without connecting', () => {
    const run = spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/artist-backfill.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, ARTIST_BACKFILL_DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/festival_planner' },
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Refusing to run the artist backfill on database "festival_planner"/);
  });

  test('the script needs an explicit database URL', () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ARTIST_BACKFILL_DATABASE_URL;
    const run = spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/artist-backfill.ts'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Set ARTIST_BACKFILL_DATABASE_URL/);
  });
});

describe('artist backfill', { skip }, () => {
  let pool: Pool;

  const festival = (id: string, opts: { date: string; sep?: string; deleted?: boolean; lineup?: any[] }) =>
    pool.query(
      `INSERT INTO festivals (id, name, location, created_at, updated_at, b2b_separator, deleted_at, lineup)
       VALUES ($1, $1, 'x', now(), now(), $2, $3, $4::jsonb)`,
      [id, opts.sep ?? 'b2b', opts.deleted ? new Date() : null, JSON.stringify(opts.lineup ?? [])],
    ).then(async () => {
      await pool.query(`INSERT INTO festival_stages (festival_id, id, name) VALUES ($1, 'main', 'Main')`, [id]);
      await pool.query(`INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, 0, 'Day', $2)`, [id, opts.date]);
    });

  let order = 0;
  const set = (id: string, festivalId: string, artist: string, artists: unknown, extra: { linkUrl?: string | null; displayName?: string } = {}) =>
    pool.query(
      `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, sort_order, link_url, artists, display_name)
       VALUES ($1, $2, 0, $3, 'main', $4, $5, $6::jsonb, $7)`,
      [id, festivalId, artist, order++, extra.linkUrl ?? null, JSON.stringify(artists), extra.displayName ?? null],
    );

  const artistsOf = async (setId: string) => (await pool.query('SELECT artists, artist, link_url FROM festival_sets WHERE id = $1', [setId])).rows[0];
  const artistRows = async () => (await pool.query('SELECT * FROM artists ORDER BY name_key, label')).rows;

  async function fixture() {
    await pool.query('TRUNCATE TABLE artist_backfill_runs, artists, festival_sets, festival_days, festival_stages, festivals CASCADE');
    order = 0;
    await festival('fest-2026', { date: '2026-06-05' });
    await festival('fest-2025', {
      date: '2025-06-05',
      lineup: [{ id: 'lu-1', artists: [{ name: 'Fred again..', links: {} }, { name: 'Newcomer', links: {} }], displayName: null, tier: 'headliner' }],
    });
    await festival('fest-gone', { date: '2024-06-05', deleted: true });
    // "Fred again.." variants: one artist, most frequent spelling "Fred again.." wins.
    await set('s-fred-1', 'fest-2026', 'Fred again..', [{ name: 'Fred again..', links: { instagram: 'http://instagram.com/fredagain/' } }]);
    await set('s-fred-2', 'fest-2025', 'Fred Again', [{ name: 'Fred Again', links: {} }]);
    await set('s-fred-3', 'fest-2025', 'FRED AGAIN!', [{ name: 'FRED AGAIN!', links: {} }]);
    await set('s-fred-4', 'fest-gone', 'Fred again..', [{ name: 'Fred again..', links: {} }]);
    // Two HOL with different Spotify ids, then HOL with no Spotify id.
    await set('s-hol-a', 'fest-2026', 'HOL!', [{ name: 'HOL!', links: { spotify: spotifyUrl(SPOTIFY_A) } }]);
    await set('s-hol-b', 'fest-2025', 'HOL', [{ name: 'HOL', links: { spotify: spotifyUrl(SPOTIFY_B) } }]);
    await set('s-hol-c', 'fest-2025', 'HOL', [{ name: 'HOL', links: {} }]);
    // Conflicting Instagram links under one key.
    await set('s-zed-1', 'fest-2026', 'Zeds Dead', [{ name: 'Zeds Dead', links: { instagram: 'https://www.instagram.com/zedsdead' } }]);
    await set('s-zed-2', 'fest-2025', 'Zeds Dead', [{ name: 'Zeds Dead', links: { instagram: 'https://www.instagram.com/zeds_dead_fake' } }]);
    // A SoundCloud URL under spotify, and a Spotify track link that fails the rules.
    await set('s-soundcloud', 'fest-2026', 'Seeing Dubble', [{ name: 'Seeing Dubble', links: { spotify: 'https://soundcloud.com/seeingdubble' } }], { linkUrl: 'https://soundcloud.com/seeingdubble' });
    await set('s-track', 'fest-2026', 'Track Link', [{ name: 'Track Link', links: { spotify: `https://open.spotify.com/track/${SPOTIFY_A}` } }]);
    // An "A b2b B" element with a link, and a set billed under a display name.
    await set('s-b2b', 'fest-2026', 'Alpha b2b Beta', [{ name: 'Alpha b2b Beta', links: { instagram: 'https://www.instagram.com/alphabeta' } }]);
    await set('s-display', 'fest-2026', 'Skull Machine', [{ name: 'Gamma', links: {} }, { name: 'Delta', links: {} }], { displayName: 'Skull Machine' });
    // A legacy set with only a flat artist and link_url, and a non-array artists value.
    await set('s-legacy', 'fest-2026', 'Legacy Act', [], { linkUrl: spotifyUrl(SPOTIFY_B.replace(/B/g, 'C')) });
    await set('s-weird', 'fest-2026', 'Weird Act', { not: 'an array' });
    // A photo on a non-Spotify element only, a photo on a host that is not allowed.
    await set('s-photo', 'fest-2026', 'Photo Only', [{ name: 'Photo Only', links: {}, photo: 'https://i.scdn.co/image/abc', genres: ['bass'] }]);
    await set('s-badphoto', 'fest-2026', 'Bad Photo', [{ name: 'Bad Photo', links: {}, photo: 'https://example.com/x.jpg' }]);
  }

  before(async () => {
    await ensureTestSchema(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  beforeEach(fixture);

  after(async () => {
    await pool.query('TRUNCATE TABLE artist_backfill_runs, artists, festival_sets, festival_days, festival_stages, festivals CASCADE');
    await pool.end();
  });

  test('the dry run reports every list and writes nothing', async () => {
    const before = await pool.query('SELECT id, artists, artist, link_url FROM festival_sets ORDER BY id');
    const { report } = await planBackfill(pool);
    assert.equal(report.counts.festivals, 3);
    assert.equal(report.counts.sets, 17);
    assert.equal(report.counts.lineupEntries, 1);
    assert.equal(report.counts.legacyFlatOnlySets, 2);
    assert.deepEqual((await artistRows()), []);
    assert.deepEqual((await pool.query('SELECT id, artists, artist, link_url FROM festival_sets ORDER BY id')).rows, before.rows);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM artist_backfill_runs')).rows[0].n, 0);

    assert.deepEqual(report.needsPick.map((p) => p.ownerId), ['s-hol-c']);
    assert.deepEqual(report.joinedBySpotify, []);
    assert.deepEqual(report.joinedByName.map((j) => j.ownerId).sort(), ['s-fred-1', 's-fred-2', 's-fred-3', 's-fred-4', 'lu-1'].sort());
    assert.deepEqual(report.separateArtists.map((s) => [s.key, s.notes]).sort(), [['hol', ['unnamed 1', 'unnamed 2']], ['zeds dead', ['unnamed 1', 'unnamed 2']]]);
    assert.deepEqual(report.linkRefiles.map((r) => [r.ownerId, r.from, r.to]), [['s-soundcloud', 'spotify', 'soundcloud']]);
    assert.deepEqual(report.linkFailures.map((f) => f.ownerId), ['s-track']);
    assert.deepEqual(report.b2bSplits.map((s) => s.parts), [['Alpha', 'Beta']]);
    assert.deepEqual(report.splitLinksToPlace.map((s) => s.ownerId), ['s-b2b']);
    assert.deepEqual(report.photosNotCopied.map((p) => p.ownerId), ['s-badphoto']);
    assert.ok(report.renames.some((r) => r.setId === 's-fred-2' && r.before === 'Fred Again' && r.after === 'Fred again..'));
    assert.ok(!report.renames.some((r) => r.setId === 's-display'), 'a display name is never a rename');
    const csv = reportToCsv(report);
    assert.ok(csv.startsWith('list,entry\n'));
    assert.ok(csv.includes('"needsPick","{""festivalId"":""fest-2025"",""kind"":""set"",""ownerId"":""s-hol-c""'));
  });

  test('run writes the artists, ids and canonical copies, and records the before-values', async () => {
    const { apply } = await runBackfill(pool, { runId: 'run-1' });
    assert.deepEqual(apply.festivalsWritten.sort(), ['fest-2025', 'fest-2026', 'fest-gone']);
    assert.deepEqual(apply.festivalsSkipped, []);
    assert.deepEqual(apply.conflicts, []);

    const fred = (await artistRows()).filter((a) => a.name_key === 'fred again');
    assert.equal(fred.length, 1);
    assert.equal(fred[0].name, 'Fred again..');
    assert.equal(fred[0].label, '');
    assert.deepEqual(fred[0].links, { instagram: 'https://www.instagram.com/fredagain' });
    for (const id of ['s-fred-1', 's-fred-2', 's-fred-3', 's-fred-4']) {
      const row = await artistsOf(id);
      assert.deepEqual(row.artists.map((a: any) => [a.id, a.name]), [[fred[0].id, 'Fred again..']]);
      assert.equal(row.artist, 'Fred again..');
    }

    const hols = (await artistRows()).filter((a) => a.name_key === 'hol');
    assert.deepEqual(hols.map((a) => [a.label, a.spotify_id]).sort(), [['unnamed 1', SPOTIFY_B], ['unnamed 2', SPOTIFY_A]].sort());
    assert.equal(JSON.stringify(await artistRows()).includes('fest-'), false, 'no note carries a festival name');
    assert.equal(JSON.stringify((await artistRows()).map((a) => a.label)).includes('2026'), false);
    assert.equal((await artistsOf('s-hol-c')).artists[0].id, undefined, 'a name with several candidates stays without an id');

    const zeds = (await artistRows()).filter((a) => a.name_key === 'zeds dead');
    assert.deepEqual(zeds.map((a) => a.label), ['unnamed 1', 'unnamed 2']);

    assert.deepEqual((await artistsOf('s-soundcloud')).artists[0].links, { soundcloud: 'https://soundcloud.com/seeingdubble' });
    assert.equal((await artistsOf('s-soundcloud')).link_url, null, 'link_url follows artists[0].links.spotify, as a save does');
    assert.deepEqual((await artistsOf('s-track')).artists[0].links, { spotify: `https://open.spotify.com/track/${SPOTIFY_A}` });
    assert.equal((await artistsOf('s-track')).artists[0].id !== undefined, true);

    const b2b = await artistsOf('s-b2b');
    assert.deepEqual(b2b.artists.map((a: any) => [a.name, a.links]), [['Alpha', {}], ['Beta', {}]]);
    assert.equal(b2b.artist, 'Alpha b2b Beta');

    const display = await artistsOf('s-display');
    assert.equal(display.artist, 'Skull Machine', 'a flat name that differs from the joined names is kept');

    const legacy = await artistsOf('s-legacy');
    assert.equal(legacy.artists.length, 1);
    assert.equal(legacy.artists[0].name, 'Legacy Act');
    assert.equal(legacy.link_url, spotifyUrl('C'.repeat(22)));
    assert.equal((await artistsOf('s-weird')).artists.length, 1);

    const photo = (await artistRows()).find((a) => a.name_key === 'photo only');
    assert.equal(photo.photo, 'https://i.scdn.co/image/abc');
    assert.deepEqual(photo.genres, ['bass']);
    assert.equal((await artistRows()).find((a) => a.name_key === 'bad photo').photo, null);

    const lineup = (await pool.query(`SELECT lineup FROM festivals WHERE id = 'fest-2025'`)).rows[0].lineup;
    assert.equal(lineup[0].id, 'lu-1');
    assert.equal(lineup[0].tier, 'headliner', 'the whole entry is kept');
    assert.equal(lineup[0].artists[0].id, fred[0].id);
    assert.equal(typeof lineup[0].artists[1].id, 'string');

    const runs = (await pool.query(`SELECT festival_id, before FROM artist_backfill_runs WHERE run_id = 'run-1' ORDER BY festival_id`)).rows;
    assert.deepEqual(runs.map((r) => r.festival_id), ['fest-2025', 'fest-2026', 'fest-gone']);
    const before2026 = runs.find((r) => r.festival_id === 'fest-2026').before;
    assert.deepEqual(before2026.sets['s-fred-1'].artists, [{ name: 'Fred again..', links: { instagram: 'http://instagram.com/fredagain/' } }]);
    assert.equal(before2026.counts.sets, 11);
    assert.equal(runs.find((r) => r.festival_id === 'fest-2025').before.lineup[0].id, 'lu-1');
  });

  test('a soft-deleted festival is rewritten', async () => {
    await runBackfill(pool);
    const row = await artistsOf('s-fred-4');
    assert.equal(typeof row.artists[0].id, 'string');
    assert.equal((await pool.query(`SELECT deleted_at IS NOT NULL AS gone FROM festivals WHERE id = 'fest-gone'`)).rows[0].gone, true);
  });

  test('verify passes after a run, and a second dry run reports zero changes', async () => {
    await runBackfill(pool);
    const verify = await verifyBackfill(pool);
    assert.deepEqual(verify.checks.map((c) => [c.name, c.ok, c.details]), [['counts', true, []], ['ids', true, []], ['second dry run', true, []]]);
    assert.equal(verify.ok, true);
    const again = await planBackfill(pool);
    assert.equal(again.report.counts.artistsToCreate, 0);
    assert.equal(again.report.counts.ownersToWrite, 0);
    assert.equal(again.report.needsPick.length, 1);
    const second = await runBackfill(pool);
    assert.deepEqual(second.apply.festivalsWritten, []);
  });

  test('verify fails on a missing id and skips a festival that changed after its run', async () => {
    await runBackfill(pool);
    await pool.query(`UPDATE festival_sets SET artists = '[{"name":"Fred again..","links":{}}]'::jsonb WHERE id = 's-fred-1'`);
    const broken = await verifyBackfill(pool);
    assert.equal(broken.ok, false);
    assert.match(broken.checks.find((c) => c.name === 'ids')!.details.join('\n'), /s-fred-1.*no live artist id/);
    await pool.query(`UPDATE festivals SET updated_at = now() + interval '1 minute' WHERE id = 'fest-2026'`);
    const skipped = await verifyBackfill(pool);
    assert.deepEqual(skipped.skipped, ['fest-2026']);
    assert.equal(skipped.checks.find((c) => c.name === 'ids')!.ok, true);
  });

  test('a run stopped after one festival resumes and creates no duplicate', async () => {
    const plan = await planBackfill(pool);
    const first = plan.festivals[0]!.id;
    const partial = await applyBackfillPlan(pool, { ...plan, changedOwners: plan.changedOwners.filter((o) => o.festival.id === first) });
    assert.deepEqual(partial.festivalsWritten, [first]);
    const rest = await runBackfill(pool);
    assert.equal(rest.apply.festivalsWritten.includes(first), false);
    assert.equal(rest.apply.festivalsWritten.length, 2);
    const dup = await pool.query('SELECT name_key, lower(label) FROM artists WHERE merged_into IS NULL GROUP BY 1, 2 HAVING count(*) > 1');
    assert.equal(dup.rows.length, 0);
    assert.equal((await verifyBackfill(pool)).ok, true);
  });

  test('a festival saved between the read and the lock is skipped and its edit survives', async () => {
    const plan = await planBackfill(pool);
    await pool.query(`UPDATE festival_sets SET artist = 'Edited Name', artists = '[{"name":"Edited Name","links":{}}]'::jsonb WHERE id = 's-fred-2'`);
    await pool.query(`UPDATE festivals SET updated_at = now() WHERE id = 'fest-2025'`);
    const apply = await applyBackfillPlan(pool, plan);
    assert.deepEqual(apply.festivalsSkipped, [{ festivalId: 'fest-2025', reason: 'changed during the run; run again' }]);
    assert.deepEqual(apply.festivalsWritten.sort(), ['fest-2026', 'fest-gone']);
    assert.deepEqual((await artistsOf('s-fred-2')).artists, [{ name: 'Edited Name', links: {} }]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM artist_backfill_runs WHERE festival_id = 'fest-2025'`)).rows[0].n, 0);
    const rerun = await runBackfill(pool);
    assert.deepEqual(rerun.apply.festivalsWritten, ['fest-2025']);
  });

  test('a set changed without a updated_at bump is skipped and its edit survives', async () => {
    const plan = await planBackfill(pool);
    await pool.query(`UPDATE festival_sets SET artist = 'Edited Name', artists = '[{"name":"Edited Name","links":{}}]'::jsonb WHERE id = 's-fred-2'`);
    const apply = await applyBackfillPlan(pool, plan);
    assert.deepEqual(apply.festivalsSkipped, [{ festivalId: 'fest-2025', reason: 'changed during the run; run again' }]);
    assert.deepEqual((await artistsOf('s-fred-2')).artists, [{ name: 'Edited Name', links: {} }]);
  });

  test('a B2B split that would pass the artist cap is left whole and reported', async () => {
    await set('s-b2b-five', 'fest-2026', 'A b2b B b2b C b2b D b2b E', [{ name: 'A b2b B b2b C b2b D b2b E', links: {} }]);
    await set('s-b2b-multi', 'fest-2026', 'P b2b Q, R b2b S, T b2b U', [
      { name: 'P b2b Q', links: {} },
      { name: 'R b2b S', links: {} },
      { name: 'T b2b U', links: {} },
    ]);
    const { plan } = await runBackfill(pool);
    assert.deepEqual(plan.report.b2bNotSplit.map((s) => [s.ownerId, s.name]), [['s-b2b-five', 'A b2b B b2b C b2b D b2b E'], ['s-b2b-multi', 'R b2b S'], ['s-b2b-multi', 'T b2b U']]);
    assert.deepEqual((await artistsOf('s-b2b-five')).artists.map((a: any) => a.name), ['A b2b B b2b C b2b D b2b E']);
    assert.deepEqual((await artistsOf('s-b2b-multi')).artists.map((a: any) => a.name), ['P', 'Q', 'R b2b S', 'T b2b U']);
    assert.equal((await verifyBackfill(pool)).ok, true);
  });

  test('links under an unknown key or a non-http scheme are dropped and reported', async () => {
    await set('s-links', 'fest-2026', 'Links Act', [{ name: 'Links Act', links: { fanclub: 'https://example.com/fan', website: 'javascript:alert(1)', instagram: 'https://www.instagram.com/linksact' } }]);
    const { plan } = await runBackfill(pool);
    assert.deepEqual((await artistsOf('s-links')).artists[0].links, { instagram: 'https://www.instagram.com/linksact' });
    assert.deepEqual(plan.report.linksNotCopied.filter((l) => l.ownerId === 's-links').map((l) => l.links), [{ website: 'javascript:alert(1)', fanclub: 'https://example.com/fan' }]);
  });

  test('an element whose id names a tombstone is rewritten with the survivor id', async () => {
    await pool.query(
      `INSERT INTO artists (id, name, name_key, label) VALUES ('art-live', 'Tomb Act', 'tomb act', ''), ('art-old', 'Tomb Act', 'tomb act', 'old')`,
    );
    await pool.query(`UPDATE artists SET merged_into = 'art-live' WHERE id = 'art-old'`);
    await set('s-tomb', 'fest-2026', 'Tomb Act', [{ id: 'art-old', name: 'Tomb Act', links: {} }]);
    await runBackfill(pool);
    assert.equal((await artistsOf('s-tomb')).artists[0].id, 'art-live');
    assert.equal((await planBackfill(pool)).report.counts.ownersToWrite, 0);
    assert.equal((await verifyBackfill(pool)).ok, true);
  });

  test('two runs at once create no duplicate artist and no error', async () => {
    const [a, b] = await Promise.all([runBackfill(pool), runBackfill(pool)]);
    const written = [...a.apply.festivalsWritten, ...b.apply.festivalsWritten].sort();
    assert.deepEqual(written, ['fest-2025', 'fest-2026', 'fest-gone'], 'each festival is written once');
    const dup = await pool.query('SELECT name_key, lower(label) FROM artists WHERE merged_into IS NULL GROUP BY 1, 2 HAVING count(*) > 1');
    assert.equal(dup.rows.length, 0);
    const dupSpotify = await pool.query('SELECT spotify_id FROM artists WHERE spotify_id IS NOT NULL AND merged_into IS NULL GROUP BY 1 HAVING count(*) > 1');
    assert.equal(dupSpotify.rows.length, 0);
    assert.equal((await verifyBackfill(pool)).ok, true);
  });

  test('run reseeds edited_at that old writers left behind', async () => {
    await pool.query(`UPDATE festivals SET updated_at = '2026-03-01T00:00:00Z', edited_at = '2026-01-01T00:00:00Z' WHERE id = 'fest-gone'`);
    await pool.query(`UPDATE festivals SET edited_at = NULL WHERE id = 'fest-2026'`);
    await pool.query(`UPDATE festival_sets SET artists = '[{"name":"Done","links":{}}]'::jsonb WHERE festival_id = 'fest-gone'`);
    const plan = await planBackfill(pool);
    await applyBackfillPlan(pool, { ...plan, changedOwners: [] });
    const { rows } = await pool.query(`SELECT id, edited_at = updated_at AS same FROM festivals ORDER BY id`);
    assert.deepEqual(rows.map((r) => r.same), [true, true, true]);
  });

  test('a written festival moves updated_at and edited_at together', async () => {
    const before = (await pool.query(`SELECT updated_at FROM festivals WHERE id = 'fest-2026'`)).rows[0].updated_at as Date;
    await runBackfill(pool);
    const { rows } = await pool.query(`SELECT updated_at, edited_at FROM festivals WHERE id = 'fest-2026'`);
    assert.ok(rows[0].updated_at > before);
    assert.equal(rows[0].edited_at.getTime(), rows[0].updated_at.getTime());
  });

  test('an artist that already exists is reused, not duplicated', async () => {
    await pool.query(
      `INSERT INTO artists (id, name, name_key, label, spotify_id, links) VALUES ('art-existing', 'Fred again..', 'fred again', '', NULL, '{"instagram":"https://www.instagram.com/fredagain"}'::jsonb)`,
    );
    const { apply } = await runBackfill(pool);
    assert.deepEqual(apply.conflicts, []);
    assert.equal((await artistRows()).filter((a) => a.name_key === 'fred again').length, 1);
    assert.equal((await artistsOf('s-fred-2')).artists[0].id, 'art-existing');
  });

  const displayOf = async (setId: string) => (await pool.query('SELECT display_name FROM festival_sets WHERE id = $1', [setId])).rows[0].display_name;
  const assertSettled = async () => {
    const verify = await verifyBackfill(pool);
    assert.equal(verify.ok, true, JSON.stringify(verify.checks));
    const again = await planBackfill(pool);
    assert.equal(again.report.counts.artistsToCreate, 0);
    assert.equal(again.report.counts.ownersToWrite, 0);
    assert.deepEqual(again.report.renames, []);
  };

  test('a set tag is stripped: one artist, and the tagged set keeps its poster text', async () => {
    await set('s-tag', 'fest-2026', 'Quill Harbor (Sunset Set)', [{ name: 'Quill Harbor (Sunset Set)', links: {} }]);
    await set('s-untagged', 'fest-2025', 'Quill Harbor', [{ name: 'Quill Harbor', links: {} }]);
    const { plan } = await runBackfill(pool, { runId: 'run-tag' });
    const quill = (await artistRows()).filter((a) => a.name_key === 'quill harbor' || a.name_key.startsWith('quill harbor'));
    assert.deepEqual(quill.map((a) => a.name), ['Quill Harbor']);
    const tagged = await artistsOf('s-tag');
    assert.deepEqual(tagged.artists.map((a: any) => [a.id, a.name]), [[quill[0].id, 'Quill Harbor']]);
    assert.equal(await displayOf('s-tag'), 'Quill Harbor (Sunset Set)');
    assert.equal(await displayOf('s-untagged'), null);
    assert.ok(!plan.report.renames.some((r) => r.setId === 's-tag'), 'the poster text is unchanged, so no rename');
    const before = (await pool.query(`SELECT before FROM artist_backfill_runs WHERE run_id = 'run-tag' AND festival_id = 'fest-2026'`)).rows[0].before;
    assert.equal(before.sets['s-tag'].display_name, null, 'the before-values hold display_name');
    assert.ok('display_name' in before.sets['s-tag']);
    await assertSettled();
  });

  test('a Spotify join of two different names keeps the printed name; a case-only difference still renames', async () => {
    const spotify = spotifyUrl('D'.repeat(22));
    await set('s-glow-1', 'fest-2026', 'Tessen Glow', [{ name: 'Tessen Glow', links: { spotify } }]);
    await set('s-glow-2', 'fest-2025', 'Tessen Glow', [{ name: 'Tessen Glow', links: { spotify } }]);
    await set('s-glo', 'fest-2025', 'Tessen Glo', [{ name: 'Tessen Glo', links: { spotify } }]);
    await set('s-pell-1', 'fest-2026', 'Pell Ardent', [{ name: 'Pell Ardent', links: {} }]);
    await set('s-pell-2', 'fest-2025', 'Pell Ardent', [{ name: 'Pell Ardent', links: {} }]);
    await set('s-pell-3', 'fest-2025', 'PELL ARDENT', [{ name: 'PELL ARDENT', links: {} }]);
    const { plan } = await runBackfill(pool);
    assert.ok(plan.report.joinedBySpotify.some((j) => j.artist === 'Tessen Glow' && j.names.includes('Tessen Glo')));
    assert.equal((await artistsOf('s-glo')).artists[0].name, 'Tessen Glow');
    assert.equal(await displayOf('s-glo'), 'Tessen Glo');
    assert.ok(!plan.report.renames.some((r) => r.setId === 's-glo'));
    assert.equal(await displayOf('s-glow-2'), null);
    assert.ok(plan.report.renames.some((r) => r.setId === 's-pell-3' && r.before === 'PELL ARDENT' && r.after === 'Pell Ardent'));
    assert.equal(await displayOf('s-pell-3'), null, 'a case-only difference sets no display name');
    await assertSettled();
  });

  test('an existing artist with no Spotify id takes the Spotify link of a set in another festival; every copy follows', async () => {
    const spotify = spotifyUrl('E'.repeat(22));
    await pool.query(
      `INSERT INTO artists (id, name, name_key, label, spotify_id, links) VALUES ('art-wren', 'Wren Okafor', 'wren okafor', '', NULL, '{"instagram":"https://www.instagram.com/wrenokafor"}'::jsonb)`,
    );
    await set('s-wren-id', 'fest-2026', 'Wren Okafor', [{ id: 'art-wren', name: 'Wren Okafor', links: { instagram: 'https://www.instagram.com/wrenokafor' } }]);
    await set('s-wren-spotify', 'fest-2025', 'Wren Okafor', [
      { name: 'Wren Okafor', links: { spotify, instagram: 'https://www.instagram.com/other_wren', soundcloud: 'https://soundcloud.com/wrenokafor' } },
    ]);
    const plan = await planBackfill(pool);
    // The other Instagram link conflicts with the row, so the cluster stays separate.
    assert.deepEqual(plan.report.rowFills, []);
    await pool.query(`UPDATE festival_sets SET artists = jsonb_set(artists, '{0,links}', $1::jsonb) WHERE id = 's-wren-spotify'`, [
      JSON.stringify({ spotify, soundcloud: 'https://soundcloud.com/wrenokafor' }),
    ]);
    const { plan: run, apply } = await runBackfill(pool, { runId: 'run-wren' });
    assert.deepEqual(apply.conflicts, []);
    const fill = { artistId: 'art-wren', artist: 'Wren Okafor', spotifyId: 'E'.repeat(22), links: { spotify, soundcloud: 'https://soundcloud.com/wrenokafor' } };
    assert.deepEqual(run.report.rowFills, [fill]);
    assert.ok(!run.report.separateArtists.some((s) => s.key === 'wren okafor'));
    assert.ok(!run.report.linksNotCopied.some((l) => l.ownerId === 's-wren-spotify'));
    const wren = (await artistRows()).filter((a) => a.name_key === 'wren okafor');
    assert.equal(wren.length, 1);
    assert.equal(wren[0].spotify_id, 'E'.repeat(22));
    assert.deepEqual(wren[0].links, { instagram: 'https://www.instagram.com/wrenokafor', ...fill.links });
    assert.deepEqual((await artistsOf('s-wren-spotify')).artists, [{ id: 'art-wren', name: 'Wren Okafor', links: wren[0].links }]);
    // s-wren-id sits in fest-2026 and already held the row's id: its copy and link_url follow the filled row.
    const referencing = await artistsOf('s-wren-id');
    assert.deepEqual(referencing.artists, [{ id: 'art-wren', name: 'Wren Okafor', links: wren[0].links }]);
    assert.equal(referencing.link_url, spotify);
    assert.ok(run.report.copyRefreshes.some((c) => c.ownerId === 's-wren-id' && c.artistId === 'art-wren'));
    const before2026 = (await pool.query(`SELECT before FROM artist_backfill_runs WHERE run_id = 'run-wren' AND festival_id = 'fest-2026'`)).rows[0].before;
    assert.deepEqual(before2026.sets['s-wren-id'].artists, [{ id: 'art-wren', name: 'Wren Okafor', links: { instagram: 'https://www.instagram.com/wrenokafor' } }]);
    const before = (await pool.query(`SELECT before FROM artist_backfill_runs WHERE run_id = 'run-wren' AND festival_id = 'fest-2025'`)).rows[0].before;
    assert.deepEqual(before.rowFills, [{ artistId: 'art-wren', spotifyId: fill.spotifyId, links: fill.links }]);
    await assertSettled();
  });

  const wrenFixture = async () => {
    await pool.query(`INSERT INTO artists (id, name, name_key, label, spotify_id, links) VALUES ('art-wren', 'Wren Okafor', 'wren okafor', '', NULL, '{}'::jsonb)`);
    await set('s-wren-id', 'fest-2026', 'Wren Okafor', [{ id: 'art-wren', name: 'Wren Okafor', links: {} }]);
    await set('s-wren-spotify', 'fest-2025', 'Wren Okafor', [{ name: 'Wren Okafor', links: { spotify: spotifyUrl('E'.repeat(22)) } }]);
    const plan = await planBackfill(pool);
    assert.equal(plan.report.rowFills.length, 1);
    return plan;
  };
  const skippedIds = (apply: { festivalsSkipped: Array<{ festivalId: string; reason: string }> }) =>
    apply.festivalsSkipped.filter((s) => s.reason === 'changed during the run; run again').map((s) => s.festivalId).sort();

  test('a save that takes the Spotify id before the fill skips the festivals and the run goes on', async () => {
    const plan = await wrenFixture();
    await pool.query(`INSERT INTO artists (id, name, name_key, label, spotify_id) VALUES ('art-taken', 'Someone Else', 'someone else', '', $1)`, ['E'.repeat(22)]);
    const apply = await applyBackfillPlan(pool, plan);
    assert.deepEqual(skippedIds(apply), ['fest-2025', 'fest-2026']);
    assert.deepEqual(apply.festivalsWritten, ['fest-gone']);
    assert.equal((await pool.query(`SELECT spotify_id FROM artists WHERE id = 'art-wren'`)).rows[0].spotify_id, null);
    assert.deepEqual((await artistsOf('s-wren-id')).artists, [{ id: 'art-wren', name: 'Wren Okafor', links: {} }]);
  });

  test('a row edited after the plan is not filled: the festivals that need it are skipped', async () => {
    const plan = await wrenFixture();
    await pool.query(`UPDATE artists SET updated_at = now() + interval '1 second' WHERE id = 'art-wren'`);
    assert.deepEqual(skippedIds(await applyBackfillPlan(pool, plan)), ['fest-2025', 'fest-2026']);
    const replan = await planBackfill(pool);
    await pool.query(`UPDATE artists SET name = 'Wren Okafor-Lee' WHERE id = 'art-wren'`);
    assert.deepEqual(skippedIds(await applyBackfillPlan(pool, replan)), ['fest-2025', 'fest-2026']);
    assert.equal((await pool.query(`SELECT spotify_id FROM artists WHERE id = 'art-wren'`)).rows[0].spotify_id, null);
  });

  test('a copy that drifted from its row is refreshed without a display name, and a merged id sets none either', async () => {
    await pool.query(
      `INSERT INTO artists (id, name, name_key, label, links) VALUES ('art-drift', 'Drift Act', 'drift act', '', '{"soundcloud":"https://soundcloud.com/driftact"}'::jsonb),
       ('art-prime', 'Tomb Prime', 'tomb prime', '', '{}'::jsonb), ('art-gone', 'Tomb Lesser', 'tomb lesser', 'old', '{}'::jsonb)`,
    );
    await pool.query(`UPDATE artists SET merged_into = 'art-prime' WHERE id = 'art-gone'`);
    await set('s-drift', 'fest-2026', 'Drift Akt', [{ id: 'art-drift', name: 'Drift Akt', links: {} }]);
    await set('s-merged', 'fest-2026', 'Tomb Lesser', [{ id: 'art-gone', name: 'Tomb Lesser', links: {} }]);
    const { plan } = await runBackfill(pool);
    assert.deepEqual(plan.report.copyRefreshes.filter((c) => c.ownerId === 's-drift').map((c) => c.artistId), ['art-drift']);
    const drift = await artistsOf('s-drift');
    assert.deepEqual(drift.artists, [{ id: 'art-drift', name: 'Drift Act', links: { soundcloud: 'https://soundcloud.com/driftact' } }]);
    assert.equal(drift.artist, 'Drift Act');
    assert.equal(await displayOf('s-drift'), null, 'an artist edit is not a rename on the poster');
    assert.equal((await artistsOf('s-merged')).artists[0].id, 'art-prime');
    assert.equal(await displayOf('s-merged'), null, 'a merge is not a rename on the poster');
    await assertSettled();
  });

  test('lockFestivalAny locks a soft-deleted festival and returns null for a missing one', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const gone = await lockFestivalAny(client, 'fest-gone');
      assert.equal(gone?.id, 'fest-gone');
      assert.ok(gone?.deleted_at);
      assert.equal(await lockFestivalAny(client, 'no-such-festival'), null);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  test('the script runs a dry run against a test database and writes nothing', async () => {
    const run = spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/artist-backfill.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, ARTIST_BACKFILL_DATABASE_URL: TEST_DATABASE_URL },
    });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));
    assert.equal(out.mode, 'dry-run');
    assert.equal(out.report.counts.artistsToCreate > 0, true);
    assert.deepEqual(await artistRows(), []);
  });
});
