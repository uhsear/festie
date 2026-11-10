#!/usr/bin/env node

/**
 * Metrics rollup cron — runs hourly to persist in-memory metrics to PostgreSQL.
 * Cron: 0 * * * * cd /path/to/festie && node scripts/metrics-rollup.js
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const { Pool } = pg;

// Load .env the way the app does (cron doesn't inherit env). Never overrides a
// var already set, so an explicit DATABASE_URL still wins. The root package is
// "type": "module", so this file is ESM and has no require/__dirname.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'), quiet: true });
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/festival_planner';

async function rollup() {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    // Fetch current metrics from the health endpoint
    // Use internal metrics endpoint (localhost-only, no auth required)
    const data = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:4000/api/internal/metrics-json', (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
    });

    const now = new Date();
    const bucketStart = new Date(now);
    bucketStart.setMinutes(0, 0, 0);
    const bucketEnd = new Date(bucketStart.getTime() + 3600000);

    const metrics = data.data || data;
    const statusCodes = metrics.statusCodes || {};

    await pool.query(`
      INSERT INTO metrics_rollups (bucket_start, bucket_end, total_requests, total_errors, avg_duration_ms, status_2xx, status_4xx, status_5xx, peak_connections, active_users)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT DO NOTHING
    `, [
      bucketStart.toISOString(),
      bucketEnd.toISOString(),
      metrics.totalRequests || 0,
      metrics.totalErrors || 0,
      metrics.requestCount > 0 ? (metrics.totalDuration / metrics.requestCount) : 0,
      statusCodes['2xx'] || 0,
      statusCodes['4xx'] || 0,
      statusCodes['5xx'] || 0,
      metrics.peakConnections || 0,
      metrics.socketConnections || 0,
    ]);

    console.log(`[metrics-rollup] Persisted rollup for ${bucketStart.toISOString()}`);
  } catch (err) {
    console.error(`[metrics-rollup] Error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

rollup();
