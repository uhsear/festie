import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Pool } from 'pg';
import { planBackfill, runBackfill, verifyBackfill } from '../lib/artist-backfill';
import { normalizeLineup } from '../lib/lineup';
import { createOpaqueId } from '../lib/helpers';
import { ensureTestSchema } from './_test-schema';

// Backfill on announced-lineup data (migration 104): festivals with a lineup and no sets, next to a
// festival with sets. The entries mirror the real shapes of the Forbidden Kingdom and Wasteland
// Orlando lineups. They are saved through normalizeLineup alone, with no artist ids. That reproduces
// lineups written before resolveArtistRefs existed: the legacy shape the backfill must handle.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SPOTIFY_ANGERFIST = '4YkHkQb7Y4kVdYQpXJzQ1n';
const spotifyUrl = (id: string) => `https://open.spotify.com/artist/${id}`;

const entry = (id: string, names: string[], extra: Record<string, unknown> = {}, links: Record<string, string>[] = []) => ({
  id,
  artists: names.map((name, i) => ({ name, links: links[i] ?? {} })),
  ...extra,
});

const FK_LINEUP = [
  entry('fk-2dy4', ['2DY4']),
  entry('fk-hundred-drums-zen', ['A Hundred Drums', 'Zen Selekta']),
  entry('fk-bynz-inqu', ['Bynz', 'Inqu']),
  entry('fk-dpmo', ['beastboi.', 'FuntCase', 'Versa'], { displayName: 'DPMO Presents: beastboi. B2B FuntCase B2B Versa' }),
  entry('fk-onaroi', ['Onara', 'roi*'], { displayName: 'Onaroi* Onara B2B roi*)' }),
  entry('fk-syn', ['S.Y.N (Svdden Death, yvm3, NIMDA)']),
  entry('fk-excision', ['excision']),
];

const WL_LINEUP = [
  entry('wl-999', ['999999999'], {}, [{ soundcloud: 'https://soundcloud.com/999999999music', instagram: 'https://www.instagram.com/999999999_live/' }]),
  entry('wl-angerfist', ['Angerfist'], {}, [{ website: 'http://angerfist.nl', spotify: spotifyUrl(SPOTIFY_ANGERFIST), instagram: 'https://www.instagram.com/angerfist_official/' }]),
  entry('wl-alignment', ['Alignment'], {}, [{ instagram: 'https://www.instagram.com/alignment__official/' }]),
  entry('wl-pair', ['Zen Selekta', 'Fieldz']),
];

describe('artist backfill on lineup entries', { skip }, () => {
  let pool: Pool;
  const save = (festivalId: string, lineup: any[]) =>
    pool.query('UPDATE festivals SET lineup = $2::jsonb WHERE id = $1', [
      festivalId,
      JSON.stringify(normalizeLineup(lineup, [], { createId: createOpaqueId, today: '2026-11-18' })),
    ]);
  const lineupOf = async (festivalId: string) => (await pool.query('SELECT lineup FROM festivals WHERE id = $1', [festivalId])).rows[0].lineup as any[];
  const entryOf = async (festivalId: string, id: string) => (await lineupOf(festivalId)).find((e) => e.id === id);
  const artistRows = async () => (await pool.query('SELECT * FROM artists ORDER BY name_key, label')).rows;

  async function festival(id: string, date: string) {
    await pool.query(`INSERT INTO festivals (id, name, location, created_at, updated_at, lineup) VALUES ($1, $1, 'x', now(), now(), '[]'::jsonb)`, [id]);
    await pool.query(`INSERT INTO festival_stages (festival_id, id, name) VALUES ($1, 'main', 'Main')`, [id]);
    await pool.query(`INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, 0, 'Day', $2)`, [id, date]);
  }
  const set = (id: string, festivalId: string, artist: string, artists: unknown, order: number) =>
    pool.query(
      `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, sort_order, artists) VALUES ($1, $2, 0, $3, 'main', $4, $5::jsonb)`,
      [id, festivalId, artist, order, JSON.stringify(artists)],
    );

  before(async () => {
    await ensureTestSchema(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE artist_backfill_runs, artists, festival_sets, festival_days, festival_stages, festivals CASCADE');
    await festival('fest-a', '2026-06-05');
    await festival('fest-fk', '2027-03-05');
    await festival('fest-wl', '2027-04-05');
    await set('a-excision', 'fest-a', 'Excision', [{ name: 'Excision', links: {} }], 0);
    await set('a-onara', 'fest-a', 'Onara B2B roi*', [{ name: 'Onara', links: {} }, { name: 'roi*', links: {} }], 1);
    await save('fest-fk', FK_LINEUP);
    await save('fest-wl', WL_LINEUP);
  });

  after(async () => {
    await pool.query('TRUNCATE TABLE artist_backfill_runs, artists, festival_sets, festival_days, festival_stages, festivals CASCADE');
    await pool.end();
  });

  test('dry run counts the lineup entries and writes nothing', async () => {
    const before = await pool.query('SELECT id, lineup FROM festivals ORDER BY id');
    const setsBefore = await pool.query('SELECT id, artists, artist, link_url FROM festival_sets ORDER BY id');
    const { report } = await planBackfill(pool);
    assert.equal(report.counts.festivals, 3);
    assert.equal(report.counts.sets, 2);
    assert.equal(report.counts.lineupEntries, FK_LINEUP.length + WL_LINEUP.length);
    assert.deepEqual(await artistRows(), []);
    assert.deepEqual((await pool.query('SELECT id, lineup FROM festivals ORDER BY id')).rows, before.rows);
    assert.deepEqual((await pool.query('SELECT id, artists, artist, link_url FROM festival_sets ORDER BY id')).rows, setsBefore.rows);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM artist_backfill_runs')).rows[0].n, 0);
  });

  test('run puts artist ids on lineup entries as well as sets, and joins shared names', async () => {
    const lineupBefore = { 'fest-fk': await lineupOf('fest-fk'), 'fest-wl': await lineupOf('fest-wl') };
    const { apply } = await runBackfill(pool, { runId: 'lineup-1' });
    assert.deepEqual(apply.festivalsWritten.sort(), ['fest-a', 'fest-fk', 'fest-wl']);
    assert.deepEqual(apply.conflicts, []);

    for (const [id, lineup] of Object.entries(lineupBefore)) {
      const run = (await pool.query(`SELECT before FROM artist_backfill_runs WHERE run_id = 'lineup-1' AND festival_id = $1`, [id])).rows[0];
      assert.deepEqual(run.before.lineup, lineup, `${id} run record keeps the lineup as it was`);
      assert.deepEqual(run.before.sets, {}, `${id} has no sets to record`);
    }
    const byKey = async (key: string) => (await artistRows()).filter((a) => a.name_key === key);

    for (const e of [...(await lineupOf('fest-fk')), ...(await lineupOf('fest-wl'))]) {
      for (const a of e.artists) assert.equal(typeof a.id, 'string', `${e.id}/${a.name} has an id`);
    }

    const excision = await byKey('excision');
    assert.equal(excision.length, 1, 'one Excision artist');
    const setRow = (await pool.query(`SELECT artists FROM festival_sets WHERE id = 'a-excision'`)).rows[0];
    assert.equal(setRow.artists[0].id, excision[0].id);
    assert.equal((await entryOf('fest-fk', 'fk-excision')).artists[0].id, excision[0].id, 'lineup entry joins the set artist');

    const onara = await byKey('onara');
    const roi = await byKey('roi');
    assert.equal(onara.length, 1);
    assert.equal(roi.length, 1);
    const onaroi = await entryOf('fest-fk', 'fk-onaroi');
    assert.deepEqual(onaroi.artists.map((a: any) => a.id), [onara[0].id, roi[0].id]);
    const aSet = (await pool.query(`SELECT artists FROM festival_sets WHERE id = 'a-onara'`)).rows[0];
    assert.deepEqual(aSet.artists.map((a: any) => a.id), onaroi.artists.map((a: any) => a.id));

    const zen = await byKey('zen selekta');
    assert.equal(zen.length, 1, 'a name in two lineups is one artist');
    assert.equal((await entryOf('fest-fk', 'fk-hundred-drums-zen')).artists[1].id, zen[0].id);
    assert.equal((await entryOf('fest-wl', 'wl-pair')).artists[0].id, zen[0].id);
  });

  test('B2B entries keep both artists and displayName survives', async () => {
    await runBackfill(pool);
    const pair = await entryOf('fest-fk', 'fk-bynz-inqu');
    assert.deepEqual(pair.artists.map((a: any) => a.name), ['Bynz', 'Inqu']);
    const dpmo = await entryOf('fest-fk', 'fk-dpmo');
    assert.deepEqual(dpmo.artists.map((a: any) => a.name), ['beastboi.', 'FuntCase', 'Versa']);
    assert.equal(dpmo.displayName, 'DPMO Presents: beastboi. B2B FuntCase B2B Versa');
    assert.equal((await entryOf('fest-fk', 'fk-onaroi')).displayName, 'Onaroi* Onara B2B roi*)');
    const syn = await entryOf('fest-fk', 'fk-syn');
    assert.equal(syn.artists.length, 1);
    assert.equal(syn.artists[0].name, 'S.Y.N (Svdden Death, yvm3, NIMDA)');
    assert.equal((await entryOf('fest-fk', 'fk-2dy4')).status, 'announced', 'the rest of the entry is kept');
  });

  test('links on lineup entries move to the artist row', async () => {
    await runBackfill(pool);
    const rows = await artistRows();
    const anger = rows.find((a) => a.name_key === 'angerfist');
    assert.equal(anger.spotify_id, SPOTIFY_ANGERFIST);
    assert.equal(anger.links.instagram, 'https://www.instagram.com/angerfist_official');
    assert.ok(anger.links.website, 'website link kept');
    const n999 = rows.find((a) => a.name_key === '999999999');
    assert.equal(n999.links.soundcloud, 'https://soundcloud.com/999999999music');
    assert.equal(n999.links.instagram, 'https://www.instagram.com/999999999_live');
    assert.equal((await entryOf('fest-wl', 'wl-angerfist')).artists[0].id, anger.id);
  });

  test('verify passes and a second dry run reports zero changes', async () => {
    await runBackfill(pool);
    const verify = await verifyBackfill(pool);
    assert.equal(verify.ok, true, JSON.stringify(verify.checks));
    const again = await planBackfill(pool);
    assert.equal(again.report.counts.artistsToCreate, 0);
    assert.equal(again.report.counts.ownersToWrite, 0);
    assert.deepEqual((await runBackfill(pool)).apply.festivalsWritten, []);
  });
});
