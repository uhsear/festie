import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { startReengagementQueueSampler } from '../lib/metrics.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeMetrics() {
  const set: number[] = [];
  return { available: true, reengagementQueueDepthGauge: { set: (v: number) => set.push(v) }, set };
}

describe('startReengagementQueueSampler', () => {
  it('sets the gauge to waiting plus delayed', async () => {
    const metrics = fakeMetrics();
    const queue = { getWaitingCount: async () => 2, getDelayedCount: async () => 3 };
    const stop = await startReengagementQueueSampler(metrics, queue, 1000);
    stop();
    assert.deepEqual(metrics.set, [5]);
  });

  it('skips cleanly when there is no queue or no metrics', async () => {
    const metrics = fakeMetrics();
    (await startReengagementQueueSampler(metrics, null))();
    (await startReengagementQueueSampler(null, { getWaitingCount: async () => 1, getDelayedCount: async () => 1 }))();
    (await startReengagementQueueSampler({ available: false }, { getWaitingCount: async () => 1 }))();
    assert.deepEqual(metrics.set, []);
  });

  it('stops sampling once the queue is closing instead of warning on every tick', async () => {
    const metrics = fakeMetrics();
    let calls = 0;
    const queue: { closing?: Promise<void>; getWaitingCount(): Promise<number>; getDelayedCount(): Promise<number> } = {
      closing: undefined,
      getWaitingCount: async () => {
        calls += 1;
        if (queue.closing) throw new Error('Connection is closed.');
        return 1;
      },
      getDelayedCount: async () => 0,
    };
    const stop = await startReengagementQueueSampler(metrics, queue, 5);
    await wait(30);
    queue.closing = Promise.resolve();
    await wait(30);
    const callsAfterClose = calls;
    await wait(50);
    stop();
    assert.equal(calls, callsAfterClose, 'no sample runs after the queue starts closing');
  });
});
