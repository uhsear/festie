// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { Pool } from 'pg';
import { createLogger } from '../logger.js';

// Simple LRU cache for parsed JSON objects to reduce allocation
const parseJsonCache = new Map<string, any>();
const MAX_PARSE_CACHE_SIZE = 1000;

const txLog = createLogger('db:connection');

/**
 * Execute a function within a transaction
 * @param pool - PostgreSQL connection pool
 * @param fn - Async function that receives a client
 * @returns Result of fn
 */
export async function withTransaction(pool: Pool, fn: (client: any) => Promise<any>): Promise<any> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err: any) {
    // ROLLBACK failing (e.g. connection already dropped) must never mask the
    // real error that triggered the rollback — log it separately and rethrow err.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr: any) {
      txLog.error('withTransaction:rollback-failed', { rollbackError: rollbackErr?.message, originalError: err?.message });
    }
    throw err;
  } finally {
    client.release();
  }
}

// 40P01 deadlock detected, 40001 serialization failure: the database aborted this transaction only.
const RETRYABLE_TX_CODES = new Set(['40P01', '40001']);

/**
 * withTransaction, retried when Postgres aborts it for a deadlock (40P01) or a serialization
 * failure (40001). fn must touch only the database, so a second run is safe. The last failure,
 * and any other error, is rethrown unchanged: a route maps it to 503 "Festie is busy. Try again."
 * Global lock order for every writer: festivals in id order, then artists in id order.
 */
export async function withTransactionRetry(pool: Pool, fn: (client: any) => Promise<any>, attempts = 3): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTransaction(pool, fn);
    } catch (err: any) {
      if (attempt >= attempts || !RETRYABLE_TX_CODES.has(err?.code)) throw err;
      txLog.warn('withTransactionRetry:retry', { code: err.code, attempt });
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.floor(Math.random() * 30)));
    }
  }
}

export const isoOrNull = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

export function parseJsonObject(value: any, fallback: any = {}): any {
  if (!value) return fallback;

  // PostgreSQL JSONB returns JavaScript objects directly — no parsing needed
  if (typeof value === 'object') return value;

  // Check cache first (for string values)
  if (parseJsonCache.has(value)) {
    return parseJsonCache.get(value);
  }

  try {
    const parsed = JSON.parse(value);
    const result = parsed && typeof parsed === 'object' ? parsed : fallback;

    // Cache the parsed result
    parseJsonCache.set(value, result);
    if (parseJsonCache.size > MAX_PARSE_CACHE_SIZE) {
      // Remove oldest entry (LRU eviction)
      const oldestKey = parseJsonCache.keys().next().value;
      if (oldestKey !== undefined) parseJsonCache.delete(oldestKey);
    }

    return result;
  } catch {
    return fallback;
  }
}

export function serializeJson(value: any, fallback: any = {}): string {
  return JSON.stringify(value ?? fallback);
}

/**
 * Open PostgreSQL database connection pool
 * @param opts - Options {databaseUrl, log}
 * @returns {pool} PostgreSQL connection pool
 * @throws If pool cannot be created
 */
export function openPlannerDatabase({ databaseUrl, log = null, poolSize = 15, poolMin = 2 }: { databaseUrl: string; log?: any; poolSize?: number; poolMin?: number }): { pool: Pool } {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: poolSize,
    min: poolMin,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000,
    statement_timeout: 30000,
  });

  // Optional error logging
  if (log?.error) {
    pool.on('error', (err: Error) => {
      log.error('Unexpected error on idle client', err);
    });
  }

  return { pool };
}
