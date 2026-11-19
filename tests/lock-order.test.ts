import 'dotenv/config';
/**
 * Global lock order, recorded from the SQL a festival save sends: the festival row lock comes first,
 * then artist locks in id order. A writer that locks artists first can deadlock against a festival
 * save, and withTransactionRetry hides it. Needs TEST_DATABASE_URL.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { createArtist, dropFestivalCache, formBody, seedFestival, skip, startArtistServer, withPool, type ArtistServer } from './_artist-helpers';

let app: ArtistServer;
before(async () => {
  if (!skip) app = await startArtistServer();
});
after(async () => {
  if (app) await app.close();
});

type Recorded = { text: string; values: unknown[] | undefined };

/** Records every statement any pg client sends while fn runs. */
async function recordSql(fn: () => Promise<void>): Promise<Recorded[]> {
  const proto = pg.Client.prototype as any;
  const original = proto.query;
  const log: Recorded[] = [];
  proto.query = function (config: any, values?: any, ...rest: any[]) {
    if (typeof config === 'string') log.push({ text: config, values: Array.isArray(values) ? values : undefined });
    else if (config && typeof config.text === 'string') log.push({ text: config.text, values: config.values });
    return original.call(this, config, values, ...rest);
  };
  try {
    await fn();
  } finally {
    proto.query = original;
  }
  return log;
}

const FESTIVAL_LOCK = /^\s*UPDATE festivals SET\b/;
const ARTIST_LOCK = /FROM artists\b[\s\S]*\bFOR (UPDATE|SHARE)\b|INSERT INTO artists\b/;

describe('a festival save locks festivals before artists', { skip, concurrency: 1 }, () => {
  test('the festival row lock precedes every artist lock, and artist rows lock in id order', async () => {
    const [first, second] = [await createArtist(app, { name: 'Order Alpha' }), await createArtist(app, { name: 'Order Beta' })];
    await withPool((p) => seedFestival(p, { id: 'fest-lock-order', sets: [] }));
    await dropFestivalCache(app);
    // Reverse id order in the request, so only the code can put the rows in order.
    const [high, low] = [first, second].sort((a, b) => (a.id < b.id ? 1 : -1));
    const sets = [high, low].map((artist, i) => ({
      id: `lock-order-${i}`,
      artist: artist.name,
      artists: [{ id: artist.id, name: artist.name, links: {} }],
      stageId: 'fest-lock-order-main',
      startTime: `${20 + i}:00`,
      endTime: `${20 + i}:45`,
    }));

    const log = await recordSql(async () => {
      const res = await app.put('/api/v1/admin/festivals/fest-lock-order', formBody({ id: 'fest-lock-order' }, sets));
      assert.equal(res.status, 200, JSON.stringify(res.body));
    });

    const festivalAt = log.findIndex((q) => FESTIVAL_LOCK.test(q.text));
    const artistAt = log.findIndex((q) => ARTIST_LOCK.test(q.text));
    assert.notEqual(festivalAt, -1, 'the save locks the festival row');
    assert.notEqual(artistAt, -1, 'the save locks the artist rows');
    assert.ok(festivalAt < artistAt, `festival lock at ${festivalAt} must come before artist lock at ${artistAt}`);

    const rowLock = log.find((q) => /FROM artists\b[\s\S]*\bFOR SHARE\b/.test(q.text));
    assert.ok(rowLock, 'the save share-locks the linked artists');
    const ids = rowLock.values?.[0] as string[];
    assert.deepEqual(ids, [...ids].sort(), 'artist ids reach the lock query sorted');
    assert.match(rowLock.text, /ORDER BY id\b/);
  });
});
