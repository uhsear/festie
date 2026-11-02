// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { recentRequestTotals, recordRecentRequest } from '../lib/recent-requests.js';

const MINUTE = 60_000;
const T0 = 1_800_000_000_000;

describe('recent request window', () => {
  it('counts requests in one minute; a 500 is a server error and a 404 is not', () => {
    const metrics: any = {};
    recordRecentRequest(metrics, 200, T0);
    recordRecentRequest(metrics, 404, T0 + 1_000);
    recordRecentRequest(metrics, 500, T0 + 2_000);
    recordRecentRequest(metrics, 503, T0 + 3_000);
    assert.equal(metrics.recentBuckets.length, 1);
    assert.deepEqual(recentRequestTotals(metrics, T0 + 4_000), { minutes: 15, requests: 4, serverErrors: 2 });
  });

  it('drops a bucket older than 15 minutes', () => {
    const metrics: any = {};
    recordRecentRequest(metrics, 500, T0);
    recordRecentRequest(metrics, 200, T0 + 5 * MINUTE);
    assert.deepEqual(recentRequestTotals(metrics, T0 + 14 * MINUTE), { minutes: 15, requests: 2, serverErrors: 1 });
    assert.deepEqual(recentRequestTotals(metrics, T0 + 15 * MINUTE), { minutes: 15, requests: 1, serverErrors: 0 });
  });

  it('keeps at most 15 buckets', () => {
    const metrics: any = {};
    for (let i = 0; i < 20; i++) recordRecentRequest(metrics, 200, T0 + i * MINUTE);
    assert.equal(metrics.recentBuckets.length, 15);
    assert.equal(metrics.recentBuckets[0].minute, Math.floor(T0 / MINUTE) + 5);
  });

  it('gives zeros when metrics or the buckets are missing', () => {
    const zeros = { minutes: 15, requests: 0, serverErrors: 0 };
    assert.deepEqual(recentRequestTotals(undefined), zeros);
    assert.deepEqual(recentRequestTotals({}), zeros);
    assert.doesNotThrow(() => recordRecentRequest(undefined, 500));
  });
});
