// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Single source for "which process am I". PM2 sets NODE_APP_INSTANCE to
 * '0'..'N-1' in cluster mode. The rule reads only the environment, never
 * Redis or the database, so a Redis outage or REDIS_ENABLED off still leaves
 * exactly one leader per single-process deploy instead of nobody running jobs.
 */

/** Instance 0, or any process PM2 did not number (single fork, manual run). */
export function isLeader(env: NodeJS.ProcessEnv = process.env): boolean {
  const instance = env.NODE_APP_INSTANCE;
  return instance === undefined || instance === '0';
}

/** Numeric worker id: NODE_APP_INSTANCE, else PM_ID, else 0. */
export function getWorkerId(env: NodeJS.ProcessEnv = process.env): number {
  if (env.NODE_APP_INSTANCE !== undefined) return Number(env.NODE_APP_INSTANCE);
  if (env.PM_ID !== undefined) return Number(env.PM_ID);
  return 0;
}
