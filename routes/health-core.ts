// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
//
// Core health & liveness routes:
//   GET  /health               — simple uptime JSON (5s cache)
//   POST /metrics/client       — Web-Vitals / render-perf beacon (public, rate-limited)
//   GET  /ready                — readiness probe (db + redis checks)
//   GET  /info                 — app/version/feature-flag info for mobile clients
//
// The heavier admin HTML/status endpoints and the Prometheus `/metrics`
// exposition live in `admin-status.js` and `admin-metrics.js` respectively
// (split 2026-04-14 to keep this module focused and <200 lines).
//
// The shared client-metrics counters are created here and exposed on the
// returned object so `admin-metrics.js` can include them in the Prometheus
// exposition without reaching through module state.

import { Router, json } from 'express';
import { clientPerfBeaconSchema, validate } from '../lib/schemas.js';

// A CSP report's URLs can carry query strings (invite or friend-link tokens).
// Log only the directive fields, with each URL cut back to origin and path.
const CSP_REPORT_FIELDS = [
  'violated-directive', 'effective-directive', 'blocked-uri', 'document-uri', 'source-file',
  'disposition', 'status-code', 'line-number', 'column-number',
];

function stripUrlQuery(value: any) {
  if (typeof value !== 'string') return value;
  return value.replace(/[?#].*$/, '');
}

export function redactCspReport(body: any) {
  const report = body && typeof body === 'object' ? body['csp-report'] ?? body : {};
  const out: Record<string, any> = {};
  for (const field of CSP_REPORT_FIELDS) {
    if (report[field] !== undefined) out[field] = stripUrlQuery(report[field]);
  }
  return out;
}

export default function createHealthRoutes(deps: any) {
  const {
    log,
    stores, pool,
    sendSuccess, sendError, ErrorCodes, rateLimit,
  } = deps;

  const router = Router();
  const config = deps.config;

  let isReady = false;

  // Client performance metrics collection (beaconed from frontend)
  // shortcut: client metric aggregates and error fingerprints are per process, so each instance reports only its own beacons; export them through Prometheus if the app scales out.
  const clientMetrics = { samples: 0, lcpSum: 0, fidSum: 0, clsSum: 0, renderMsSum: 0, renderCount: 0 };
  const clientMetricsBuckets = { lcp_under_2500: 0, lcp_over_2500: 0, fid_under_100: 0, fid_over_100: 0, render_under_500: 0, render_over_500: 0 };

  router.get('/health', rateLimit(120, 'health'), (req: any, res: any) => {
    res.setHeader('Cache-Control', 'public, max-age=5');
    return sendSuccess(res, { status: 'ok', uptime: Math.round(process.uptime()) });
  });

  router.post('/metrics/client', rateLimit(10, 'client-metrics'), json({ limit: '1kb' }), validate(clientPerfBeaconSchema), (req: any, res: any) => {
    const { lcp, fid, cls, avgRenderMs, renders } = req.validatedBody;
    clientMetrics.samples++;
    clientMetrics.lcpSum += Math.min(lcp, 30000);
    clientMetrics.fidSum += Math.min(fid, 5000);
    clientMetrics.clsSum += Math.min(cls || 0, 10);
    clientMetrics.renderMsSum += Math.min(avgRenderMs || 0, 5000);
    clientMetrics.renderCount += Math.min(renders || 0, 10000);
    // Bucket for SLO tracking
    if (lcp < 2500) clientMetricsBuckets.lcp_under_2500++; else clientMetricsBuckets.lcp_over_2500++;
    if (fid < 100) clientMetricsBuckets.fid_under_100++; else clientMetricsBuckets.fid_over_100++;
    if ((avgRenderMs || 0) < 500) clientMetricsBuckets.render_under_500++; else clientMetricsBuckets.render_over_500++;
    return sendSuccess(res, { received: true });
  });

  router.post('/csp-report', rateLimit(30, 'csp-report'), json({ type: ['application/csp-report', 'application/json'], limit: '2kb' }), (req: any, res: any) => {
    log.warn('csp-violation', { report: redactCspReport(req.body) });
    res.status(204).end();
  });

  router.get('/ready', rateLimit(60, 'ready'), async (req: any, res: any) => {
    if (!isReady) {
      // data.status stays 'not_ready': health probes read it, so error is added beside it.
      const message = 'Server is still initializing';
      return sendError(res, 503, message, ErrorCodes.SERVICE_UNAVAILABLE, null, { status: 'not_ready', message });
    }

    // Perform dependency checks on ready probe
    const checks: Record<string, string> = {
      database: 'ok',
      redis: 'ok',
    };

    // Check database connectivity
    try {
      if (stores && stores.pool && typeof stores.pool.query === 'function') {
        await stores.pool.query('SELECT 1');
      } else {
        checks.database = 'degraded';
      }
    } catch {
      checks.database = 'failed';
    }

    // Check Redis connectivity if enabled
    if (config.REDIS_ENABLED && deps.redis) {
      try {
        const status = deps.redis.status || 'unknown';
        checks.redis = status === 'ready' ? 'ok' : 'degraded';
      } catch {
        checks.redis = 'degraded';
      }
    } else {
      checks.redis = 'disabled';
    }

    const hasFailures = Object.values(checks).some(v => v === 'failed');
    if (hasFailures) {
      const message = 'Dependency check failed';
      return sendError(res, 503, message, ErrorCodes.SERVICE_UNAVAILABLE, null, { status: 'not_ready', message, checks });
    }

    res.setHeader('Cache-Control', 'public, max-age=5');
    return sendSuccess(res, { status: 'ready', uptime: Math.round(process.uptime()), checks });
  });

  // App info endpoint for mobile clients — version check, feature flags, minimum app version
  router.get('/info', rateLimit(60, 'info'), (req: any, res: any) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return sendSuccess(res, {
      apiVersion: config.API_VERSION,
      features: {
        push: Boolean(config.FIREBASE_CREDENTIALS_PATH),
        liveStatus: false, // P3.14: removed from UI, column retained for data preservation
        export: true,
        calendarExport: true,
        avatars: true,
      },
      limits: {
        maxPicks: config.MAX_PICKS,
        maxNotes: config.MAX_NOTES,
        maxNoteLength: config.MAX_NOTE_LENGTH,
        maxStatusText: config.MAX_STATUS_TEXT,
      },
      mobile: {
        minAppVersion: '1.0.0',
        authMethods: ['bearer', 'cookie'],
        socketAuth: ['bearer', 'query-token', 'cookie'],
      },
    });
  });

  // Silence lint for intentionally-unused destructures kept for API-compat parity
  // with the original createHealthRoutes signature.
  void pool;

  return {
    router,
    setReady: (ready: boolean) => { isReady = ready; },
    // Exposed so admin-metrics.js can include client Web-Vitals in Prometheus
    // output. Returned by reference — the same object is mutated in-place by
    // the POST /metrics/client handler above.
    clientMetrics,
    clientMetricsBuckets,
  };
}
