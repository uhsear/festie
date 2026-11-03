// Imports express, then prints which modules Sentry injected its tracing
// channels into. @sentry/node 11 can only inject into modules that load after
// Sentry.init, so "router" (express 5's router) is listed only when
// dist/instrument.js ran first, through `node --import`.
import express from 'express';

if (process.env.PROBE_LATE_INIT === '1') {
  await import('../../dist/instrument.js');
}
express();
console.log(JSON.stringify(globalThis.__SENTRY_ORCHESTRION__?.runtime ?? []));
