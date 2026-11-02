// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * A 15-minute window of request and server-error counts, kept as one-minute
 * buckets on `state.metrics.recentBuckets`. It covers this server process only,
 * so a restart resets it. The admin dashboard health line reads it.
 */

const WINDOW_MINUTES = 15;

interface RecentBucket {
  minute: number;
  requests: number;
  serverErrors: number;
}

export interface RecentRequestTotals {
  minutes: typeof WINDOW_MINUTES;
  requests: number;
  serverErrors: number;
}

export function recordRecentRequest(metrics: any, statusCode: number, now: number = Date.now()): void {
  if (!metrics) return;
  const minute = Math.floor(now / 60_000);
  const buckets: RecentBucket[] = (metrics.recentBuckets ??= []);
  let bucket = buckets[buckets.length - 1];
  if (!bucket || bucket.minute !== minute) {
    bucket = { minute, requests: 0, serverErrors: 0 };
    buckets.push(bucket);
    if (buckets.length > WINDOW_MINUTES) buckets.splice(0, buckets.length - WINDOW_MINUTES);
  }
  bucket.requests += 1;
  if (statusCode >= 500) bucket.serverErrors += 1;
}

export function recentRequestTotals(metrics: any, now: number = Date.now()): RecentRequestTotals {
  const totals: RecentRequestTotals = { minutes: WINDOW_MINUTES, requests: 0, serverErrors: 0 };
  const buckets: RecentBucket[] | undefined = metrics?.recentBuckets;
  if (!Array.isArray(buckets)) return totals;
  const currentMinute = Math.floor(now / 60_000);
  for (const b of buckets) {
    if (b.minute > currentMinute - WINDOW_MINUTES && b.minute <= currentMinute) {
      totals.requests += b.requests;
      totals.serverErrors += b.serverErrors;
    }
  }
  return totals;
}
