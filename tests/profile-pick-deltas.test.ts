import { afterEach, describe, test } from 'node:test';
import {
  assert,
  Pool,
  TRUSTED_MUTATION_HEADER,
  startServer,
  registerUser,
  joinFestivalProfile,
} from './_integration-helpers';

// BL-1.1 server half: pick writes can carry deltas, so a replayed offline write changes only
// the sets it names. Old app builds keep sending full maps and must behave as before.

let server: any;

afterEach(async () => {
  if (server) await server.close();
  server = undefined;
});

async function setup(name: string) {
  server = await startServer();
  const user = await registerUser(server, name);
  const profile = await joinFestivalProfile(server, user.token);
  const write = (method: 'put' | 'patch', body: any, headers: Record<string, string> = {}) => {
    let req = server.request[method](`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1');
    for (const [key, value] of Object.entries(headers)) req = req.set(key, value);
    return req.send(body);
  };
  const tablePicks = async () => {
    const pool = new Pool({ connectionString: server.databaseUrl });
    try {
      const rows = (await pool.query('SELECT set_id, priority FROM festival_profile_picks WHERE profile_id = $1', [profile.id])).rows;
      const json = (await pool.query('SELECT picks_json FROM festival_profiles WHERE id = $1', [profile.id])).rows[0].picks_json;
      return { table: Object.fromEntries(rows.map((r: any) => [r.set_id, r.priority])), json };
    } finally {
      await pool.end();
    }
  };
  return { user, profile, write, tablePicks };
}

describe('Picks deltas (BL-1.1 server half)', { concurrency: 1 }, () => {
  test('a delta sets and removes only the sets it names', async () => {
    const { write, tablePicks } = await setup('delta-basic');
    await write('put', { picks: { 'set-a': 'must', 'set-b': 'maybe', 'set-c': 'want-to-see' } }).expect(200);

    const res = await write('patch', { pickDeltas: { 'set-a': null, 'set-d': 'must', 'set-b': 'must' } }).expect(200);

    assert.deepEqual(res.body.data.picks, { 'set-b': 'must', 'set-c': 'want-to-see', 'set-d': 'must' });
    const { table, json } = await tablePicks();
    assert.deepEqual(table, { 'set-b': 'must', 'set-c': 'want-to-see', 'set-d': 'must' });
    assert.deepEqual(json, table, 'picks_json mirrors the normalized table');
  });

  test('replay: a delta sent twice, with or without the same Idempotency-Key, lands once', async () => {
    const { write, tablePicks } = await setup('delta-replay');
    const delta = { pickDeltas: { 'set-a': 'must' } };

    await write('put', delta, { 'Idempotency-Key': 'pick-1:abc' }).expect(200);
    const dup = await write('put', delta, { 'Idempotency-Key': 'pick-1:abc' }).expect(200);
    assert.equal(dup.headers['x-idempotency-replayed'], 'true');
    await write('put', delta, { 'Idempotency-Key': 'pick-1:other' }).expect(200);

    assert.deepEqual((await tablePicks()).table, { 'set-a': 'must' });
  });

  test('replay cannot clobber newer picks on other sets (the stale-device case)', async () => {
    const { write, tablePicks } = await setup('delta-stale');
    // A newer pick arrives from another device or from the server (converted pick).
    await write('put', { picks: { 'set-c': 'must' } }).expect(200);

    // The offline device now replays its queued pick for a different set.
    await write('put', { pickDeltas: { 'set-a': 'maybe' } }).expect(200);

    assert.deepEqual((await tablePicks()).table, { 'set-a': 'maybe', 'set-c': 'must' });
  });

  test('replay of a removal after the pick is already gone is a no-op', async () => {
    const { write, tablePicks } = await setup('delta-remove-twice');
    await write('put', { picks: { 'set-a': 'must', 'set-b': 'maybe' } }).expect(200);
    await write('put', { pickDeltas: { 'set-a': null } }).expect(200);
    await write('put', { pickDeltas: { 'set-a': null } }).expect(200);
    assert.deepEqual((await tablePicks()).table, { 'set-b': 'maybe' });
  });

  test('concurrent deltas to different sets both land', async () => {
    const { write, tablePicks } = await setup('delta-concurrent');
    const results = await Promise.all([
      write('put', { pickDeltas: { 'set-a': 'must' } }),
      write('put', { pickDeltas: { 'set-b': 'maybe' } }),
      write('put', { pickDeltas: { 'set-c': 'want-to-see' } }),
    ]);
    for (const res of results) assert.equal(res.status, 200);
    assert.deepEqual((await tablePicks()).table, { 'set-a': 'must', 'set-b': 'maybe', 'set-c': 'want-to-see' });
  });

  test('conflict: a stale If-Match on a delta write returns 409 with the current profile and applies nothing', async () => {
    const { write, tablePicks } = await setup('delta-conflict');
    const first = await write('put', { pickDeltas: { 'set-a': 'must' } }).expect(200);
    const staleEtag = first.headers['etag'];
    assert.ok(staleEtag);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await write('put', { pickDeltas: { 'set-b': 'maybe' } }).expect(200);

    const conflict = await write('put', { pickDeltas: { 'set-c': 'must' } }, { 'If-Match': staleEtag });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'VERSION_MISMATCH');
    assert.deepEqual(conflict.body.error.current.picks, { 'set-a': 'must', 'set-b': 'maybe' });
    assert.deepEqual((await tablePicks()).table, { 'set-a': 'must', 'set-b': 'maybe' });

    const fresh = await write('put', { pickDeltas: { 'set-c': 'must' } }, { 'If-Match': second.headers['etag'] });
    assert.equal(fresh.status, 200);
  });

  test('conflict: two writes that carry the same ETag at once, only one applies', async () => {
    const { write, tablePicks } = await setup('delta-conflict-race');
    const first = await write('put', { pickDeltas: { 'set-a': 'must' } }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const etag = first.headers['etag'];

    const results = await Promise.all([
      write('put', { pickDeltas: { 'set-b': 'maybe' } }, { 'If-Match': etag }),
      write('put', { pickDeltas: { 'set-c': 'must' } }, { 'If-Match': etag }),
    ]);

    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const { table } = await tablePicks();
    assert.equal(table['set-b'] !== undefined, results[0].status === 200);
    assert.equal(table['set-c'] !== undefined, results[1].status === 200);
  });

  test('a stale If-Match on a full picks map returns 409 and applies nothing', async () => {
    const { write, tablePicks } = await setup('delta-conflict-full');
    const first = await write('put', { picks: { 'set-a': 'must' } }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await write('put', { picks: { 'set-b': 'maybe' } }).expect(200);

    const conflict = await write('put', { picks: { 'set-c': 'must' } }, { 'If-Match': first.headers['etag'] });
    assert.equal(conflict.status, 409);
    assert.deepEqual((await tablePicks()).table, { 'set-b': 'maybe' });
  });

  test('an empty pickDeltas is rejected and changes nothing', async () => {
    const { write, tablePicks } = await setup('delta-empty');
    await write('put', { picks: { 'set-a': 'must' } }).expect(200);
    await write('put', { pickDeltas: {} }).expect(400);
    assert.deepEqual((await tablePicks()).table, { 'set-a': 'must' });
  });

  test('repeated deltas cannot grow the pick map past MAX_PICKS', async () => {
    server = await startServer({ MAX_PICKS: 2 });
    const user = await registerUser(server, 'delta-cap');
    const profile = await joinFestivalProfile(server, user.token);
    const write = (body: any) =>
      server.request
        .put(`/api/v1/profiles/${profile.id}`)
        .set('x-user-token', user.token)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send(body);
    await write({ pickDeltas: { 'set-a': 'must', 'set-b': 'maybe' } }).expect(200);
    const over = await write({ pickDeltas: { 'set-c': 'must' } });
    assert.equal(over.status, 400);
    await write({ pickDeltas: { 'set-a': null, 'set-c': 'must' } }).expect(200);
    const pool = new Pool({ connectionString: server.databaseUrl });
    try {
      const rows = (await pool.query('SELECT set_id FROM festival_profile_picks WHERE profile_id = $1 ORDER BY set_id', [profile.id])).rows;
      assert.deepEqual(rows.map((r: any) => r.set_id), ['set-b', 'set-c']);
    } finally {
      await pool.end();
    }
  });

  test('old client: a full picks map still replaces the whole map, on PUT and PATCH', async () => {
    const { write, tablePicks } = await setup('delta-old-client');
    await write('put', { picks: { 'set-a': 'must', 'set-b': 'maybe' } }).expect(200);
    await write('patch', { picks: { 'set-c': 'want-to-see' } }).expect(200);
    assert.deepEqual((await tablePicks()).table, { 'set-c': 'want-to-see' });
    await write('put', { picks: {} }).expect(200);
    assert.deepEqual((await tablePicks()).table, {});
  });

  test('a delta mixed with notes saves both', async () => {
    const { write } = await setup('delta-notes');
    const res = await write('put', { pickDeltas: { 'set-a': 'must' }, notes: { 'set-a': 'Front row' } }).expect(200);
    assert.deepEqual(res.body.data.picks, { 'set-a': 'must' });
    assert.equal(res.body.data.notes['set-a'], 'Front row');
  });

  test('rejects picks and pickDeltas together, a bad priority, and an unknown set without partial writes', async () => {
    const { write, tablePicks } = await setup('delta-invalid');
    await write('put', { picks: { 'set-b': 'maybe' } }).expect(200);

    await write('put', { picks: { 'set-a': 'must' }, pickDeltas: { 'set-c': 'must' } }).expect(400);
    await write('put', { pickDeltas: { 'set-a': 'urgent' } }).expect(400);
    await write('put', { pickDeltas: { 'set-a': 'must', 'no-such-set': 'must' } }).expect(400);

    assert.deepEqual((await tablePicks()).table, { 'set-b': 'maybe' });
  });

  test('removing a pick for a set that is not in the lineup is a harmless no-op', async () => {
    const { write, tablePicks } = await setup('delta-unknown-removal');
    await write('put', { picks: { 'set-a': 'must' } }).expect(200);
    await write('put', { pickDeltas: { 'gone-set': null } }).expect(200);
    assert.deepEqual((await tablePicks()).table, { 'set-a': 'must' });
  });

  test("a delta cannot touch another user's profile", async () => {
    const { profile } = await setup('delta-owner');
    const mallory = await registerUser(server, 'delta-mallory');
    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', mallory.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ pickDeltas: { 'set-a': 'must' } })
      .expect(403);
  });
});
