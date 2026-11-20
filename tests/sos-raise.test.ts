import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { coarse, createSosRaiser } from '../lib/sos-raise';
import { ioEmitter } from './_io-emitter';

function setup(over: any = {}) {
  const events: any[] = [];
  const hsets: any[] = [];
  const logs: any = { error: [], warn: [], info: [] };
  const redis = {
    del: async () => {},
    hset: async (...a: any[]) => void hsets.push(a),
    pexpire: async () => {},
  };
  const sends: any[] = [];
  const deps: any = {
    stores: {
      activity: { log: async (row: any) => (events.push(['log', row]), 'act1') },
      crews: { getMembers: async () => [{ userId: 'raiser' }, { userId: 'm1' }, { userId: null }, { userId: 'm2' }] },
    },
    redis,
    emitter: { ...ioEmitter({ to: (room: string) => ({ emit: (name: string, p: any) => events.push(['emit', room, name, p]) }) }), crewActivityLogged: (p: any) => events.push(['feed', p]) },
    notificationService: { send: async (p: any) => void sends.push(p) },
    log: {
      error: (...a: any[]) => logs.error.push(a),
      warn: (...a: any[]) => logs.warn.push(a),
      info: (...a: any[]) => logs.info.push(a),
    },
    config: { PUBLIC_ORIGIN: 'https://example.test' },
    ...over,
  };
  return { raiser: createSosRaiser(deps), events, hsets, logs, sends };
}
const flush = () => new Promise((r) => setImmediate(r));
const input = { crewId: 'c1', userId: 'raiser', username: 'Rae' };

describe('coarse', () => {
  it('rounds to 4 decimals', () => {
    assert.equal(coarse(12.345678), 12.3457);
  });
});

describe('createSosRaiser.raise', () => {
  it('logs activity, marks active, broadcasts, emits feed and returns ids', async () => {
    const { raiser, events, hsets } = setup();
    const out = await raiser.raise({ ...input, message: 'help', position: { lat: 1.5, lng: 2.5, capturedAt: 't' } });
    assert.equal(out.activityId, 'act1');
    assert.deepEqual(events[0], ['log', { crewId: 'c1', userId: 'raiser', type: 'sos_raised', detail: 'help @1.5,2.5' }]);
    const emit = events.find((e) => e[0] === 'emit');
    assert.equal(emit[1], 'crew:c1');
    assert.equal(emit[2], 'sos:raised');
    assert.equal(emit[3].activityId, 'act1');
    assert.equal(emit[3].raisedAt, out.raisedAt);
    assert.equal(hsets.length, 1);
    assert.equal(hsets[0][1], 'raiser');
    assert.ok(events.some((e) => e[0] === 'feed' && e[1].item.id === 'act1'));
    assert.ok(events.findIndex((e) => e[0] === 'emit') < events.findIndex((e) => e[0] === 'feed'));
  });

  it('caps the message at 280 chars and uses a null detail when empty', async () => {
    const a = setup();
    await a.raiser.raise({ ...input, message: 'x'.repeat(400) });
    assert.equal(a.events[0][1].detail.length, 280);
    const b = setup();
    await b.raiser.raise(input);
    assert.equal(b.events[0][1].detail, null);
  });

  it('still broadcasts and pushes when the activity log fails, skipping the feed', async () => {
    const { raiser, events, logs, sends } = setup({
      stores: {
        activity: {
          log: async () => {
            throw new Error('db down');
          },
        },
        crews: { getMembers: async () => [{ userId: 'm1' }] },
      },
    });
    const out = await raiser.raise(input);
    await flush();
    assert.equal(out.activityId, null);
    assert.equal(logs.error.length, 1);
    const emit = events.find((e) => e[0] === 'emit');
    assert.equal(emit[3].activityId, '');
    assert.equal(events.some((e) => e[0] === 'feed'), false);
    assert.equal(sends.length, 1);
  });

  it('survives a throwing feed emitter', async () => {
    const { raiser } = setup({
      emitter: {
        ...ioEmitter({ to: () => ({ emit: () => {} }) }),
        crewActivityLogged: () => {
          throw new Error('x');
        },
      },
    });
    const out = await raiser.raise(input);
    assert.equal(out.activityId, 'act1');
  });

  it('works without io and without a notification service', async () => {
    const { raiser } = setup({ io: null, notificationService: null });
    const out = await raiser.raise(input);
    assert.equal(out.activityId, 'act1');
  });

  it('pushes to every member except the raiser, with directions text and coordinates', async () => {
    const { raiser, sends } = setup();
    await raiser.raise({ ...input, position: { lat: 1, lng: 2, capturedAt: 't' } });
    await flush();
    assert.deepEqual(sends.map((s) => s.userId), ['m1', 'm2']);
    assert.equal(sends[0].type, 'crew_sos');
    assert.equal(sends[0].title, 'Rae raised an SOS');
    assert.equal(sends[0].body, 'Tap to get directions to their last location.');
    assert.equal(sends[0].threadId, 'sos-c1');
    assert.deepEqual(sends[0].data, {
      crewId: 'c1',
      userId: 'raiser',
      deepLink: 'https://example.test/crew?sos=raiser',
      lat: '1',
      lng: '2',
    });
  });

  it('uses the message as push body, or a generic line without position', async () => {
    const a = setup();
    await a.raiser.raise({ ...input, message: 'stuck' });
    await flush();
    assert.equal(a.sends[0].body, 'stuck');
    assert.equal('lat' in a.sends[0].data, false);
    const b = setup();
    await b.raiser.raise(input);
    await flush();
    assert.equal(b.sends[0].body, 'Tap to see their SOS.');
  });

  it('logs a warning, not a failure, when the push fan-out rejects', async () => {
    const { raiser, logs } = setup({
      stores: {
        activity: { log: async () => 'act1' },
        crews: {
          getMembers: async () => {
            throw new Error('boom');
          },
        },
      },
    });
    await raiser.raise(input);
    await flush();
    assert.equal(logs.warn.length, 1);
  });
});
