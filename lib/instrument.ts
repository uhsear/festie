// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Sentry preload. Built to dist/instrument.js and loaded with
 * `node --import ./dist/instrument.js dist/server.js`, so Sentry initializes
 * before express is imported and its OpenTelemetry hooks can patch it.
 * It must not import express or lib/app-context.
 */
import 'dotenv/config';
import { loadConfig } from './config';
import { initSentry } from './sentry';

initSentry({ release: loadConfig().APP_VERSION || 'dev' });
