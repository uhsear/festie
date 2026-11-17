import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { advance, readyObservations, diskObservations, normalizeState } = require('../scripts/error-rate-alert.cjs');

const COOLDOWN = 30 * 60_000;
const MIN = 60_000;
const T0 = 1_700_000_000_000;

const ok = (status: string, redis?: string) => ({
  status: 200,
  body: { data: { status, checks: redis ? { database: 'ok', redis } : undefined } },
});

// Runs polls through advance() and returns the per-poll results.
function run(polls: Array<Record<string, { bad: boolean; msg: string }>>, startState: unknown = null, step = 5 * MIN) {
  let state = startState;
  return polls.map((observations, i) => {
    const result = advance(state, observations, T0 + i * step, COOLDOWN);
    state = result.state;
    return result;
  });
}

describe('error-rate-alert: readyObservations', () => {
  it('is quiet when ready and redis ok', () => {
    const o = readyObservations(ok('ready', 'ok'));
    assert.equal(o.ready.bad, false);
    assert.equal(o.redis.bad, false);
  });

  it('treats redis disabled as fine', () => {
    assert.equal(readyObservations(ok('ready', 'disabled')).redis.bad, false);
  });

  it('flags redis degraded even though /api/ready is 200', () => {
    const o = readyObservations(ok('ready', 'degraded'));
    assert.equal(o.redis.bad, true);
    assert.equal(o.ready.bad, false);
    assert.match(o.redis.msg, /degraded/);
  });

  it('flags a 503 not_ready response without a redis verdict', () => {
    const o = readyObservations({ status: 503, body: { data: { status: 'not_ready' } } });
    assert.equal(o.ready.bad, true);
    assert.equal(o.redis.bad, undefined);
  });

  it('flags an unreachable server as not ready', () => {
    const o = readyObservations({ status: 0, error: 'ECONNREFUSED' });
    assert.equal(o.ready.bad, true);
    assert.match(o.ready.msg, /ECONNREFUSED/);
    assert.equal(o.redis.bad, undefined);
  });

  it('flags a 200 with a non-JSON body as not ready', () => {
    assert.equal(readyObservations({ status: 200, body: '<html>' }).ready.bad, true);
  });
});

describe('error-rate-alert: diskObservations', () => {
  it('alerts below 10% free', () => {
    assert.equal(diskObservations({ freeRatio: 0.099, probeError: '' })['disk-space'].bad, true);
  });

  it('does not alert at exactly 10% free', () => {
    assert.equal(diskObservations({ freeRatio: 0.1, probeError: '' })['disk-space'].bad, false);
  });

  it('alerts on a failed probe write and names the error', () => {
    const o = diskObservations({ freeRatio: 0.5, probeError: 'ENOSPC: no space left on device' });
    assert.equal(o['disk-write'].bad, true);
    assert.match(o['disk-write'].msg, /ENOSPC/);
  });
});

describe('error-rate-alert: advance', () => {
  const bad = (msg: string) => ({ bad: true, msg });
  const good = { bad: false, msg: '' };

  it('pages ready only on the 2nd consecutive bad poll', () => {
    const [p1, p2] = run([{ ready: bad('r') }, { ready: bad('r') }]);
    assert.deepEqual(p1.alerts, []);
    assert.deepEqual(p2.alerts, ['r']);
  });

  it('resets the 2-poll count when a good poll intervenes', () => {
    const results = run([{ redis: bad('x') }, { redis: good }, { redis: bad('x') }]);
    assert.deepEqual(results.flatMap((r) => r.alerts), []);
  });

  it('pages a single-poll kind such as health immediately', () => {
    const [p1] = run([{ health: bad('h') }]);
    assert.deepEqual(p1.alerts, ['h']);
  });

  it('suppresses a repeat of the same kind inside the cooldown', () => {
    const [p1, p2, p3] = run([{ health: bad('h') }, { health: bad('h') }, { health: bad('h') }], null, 10 * MIN);
    assert.equal(p1.alerts.length, 1);
    assert.equal(p2.suppressed, 1);
    assert.equal(p3.suppressed, 1);
  });

  it('alerts again once the cooldown has passed', () => {
    const results = run([{ health: bad('h') }, { health: bad('h') }], null, 31 * MIN);
    assert.equal(results[1].alerts.length, 1);
  });

  it('keeps a separate cooldown per kind', () => {
    const [p1, p2] = run([{ health: bad('h') }, { health: bad('h'), 'disk-space': bad('d') }]);
    assert.deepEqual(p1.alerts, ['h']);
    assert.deepEqual(p2.alerts, ['d']);
    assert.equal(p2.suppressed, 1);
  });

  it('sends a recovery notice when an alerted kind clears, once', () => {
    const [, p2, p3] = run([{ health: bad('h') }, { health: good }, { health: good }]);
    assert.deepEqual(p2.recoveries, ['Recovered: health']);
    assert.deepEqual(p3.recoveries, []);
  });

  it('sends no recovery for a kind that never alerted', () => {
    const results = run([{ ready: bad('r') }, { ready: good }]);
    assert.deepEqual(results.flatMap((r) => r.recoveries), []);
  });

  it('sends no recovery for an alert that was only suppressed', () => {
    // Cooldown still runs from a sent alert 1 min ago, so this bad poll is suppressed.
    const prev = { lastAlertAt: { health: T0 - MIN }, active: {}, strikes: {} };
    const [p1, p2] = run([{ health: bad('h') }, { health: good }], prev);
    assert.equal(p1.suppressed, 1);
    assert.deepEqual(p2.recoveries, []);
  });

  it('pages the first failure after a recovery even inside the cooldown', () => {
    const results = run([{ health: bad('h') }, { health: good }, { health: bad('h') }]);
    assert.deepEqual(results[2].alerts, ['h']);
    assert.equal(results[2].suppressed, 0);
  });

  it('keeps a kind alerted and sends no recovery when a poll has no verdict', () => {
    const unknown = readyObservations({ status: 0, error: 'ECONNREFUSED' });
    const [, p2, p3, p4] = run([{ redis: bad('x') }, { redis: bad('x') }, { redis: unknown.redis }, { redis: good }], null, MIN);
    assert.deepEqual(p2.alerts, ['x']);
    assert.deepEqual(p3.recoveries, []);
    assert.deepEqual(p4.recoveries, ['Recovered: redis']);
  });

  it('migrates the old single-number lastAlertAt state', () => {
    const state = normalizeState({ lastAlertAt: T0, lastErrorCount: 3 });
    assert.deepEqual(state.lastAlertAt, {});
    assert.equal(state.lastErrorCount, 3);
    const [p1] = run([{ health: bad('h') }], { lastAlertAt: T0, lastErrorCount: 3 });
    assert.equal(p1.alerts.length, 1);
  });
});
