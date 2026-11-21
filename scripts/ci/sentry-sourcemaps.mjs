#!/usr/bin/env node
// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
//
// Uploads source maps for the backend bundle (dist/) and the web build (packages/web/dist/) to
// Sentry, then deletes the web .map files so they are never served from the public site.
//
// Runs ONLY when SENTRY_AUTH_TOKEN is set; otherwise it prints a note and exits 0 and nothing
// changes. packages/web/vite.config.ts emits hidden source maps under the same condition, so a
// build without the token has no maps to leak.
//
// Env: SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT (backend project; also web by default),
//      SENTRY_WEB_PROJECT (optional web project), SENTRY_RELEASE (default: git HEAD sha),
//      SENTRY_URL (optional, self-hosted).
// Usage: node scripts/ci/sentry-sourcemaps.mjs [--root <repo>]   (run after the builds)
//
// Each bundle gets Sentry debug ids (`sourcemaps inject`) before upload, so stack traces resolve
// by debug id and the web release name does not need to equal the backend one.
// Call it BEFORE restarting PM2: inject rewrites dist/*.js, and the running process must load
// the injected files.

import { execFileSync } from 'node:child_process';
import { readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pinned: npx would otherwise fetch whatever is latest on every deploy.
export const SENTRY_CLI = '@sentry/cli@2.58.6';

function runCli(args, env) {
  execFileSync('npx', ['--yes', SENTRY_CLI, ...args], {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
}

function findMaps(dir) {
  try {
    return readdirSync(dir, { recursive: true })
      .filter((f) => String(f).endsWith('.map'))
      .map((f) => path.join(dir, String(f)));
  } catch {
    return [];
  }
}

function gitSha(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
}

/** Returns a process exit code: 0 = done or skipped, 1 = a step failed. */
export function uploadSourceMaps({ env = process.env, root = '.', run = runCli, log = console.log } = {}) {
  if (!env.SENTRY_AUTH_TOKEN) {
    log('[sourcemaps] SENTRY_AUTH_TOKEN not set: skipped (no source maps uploaded or published)');
    return 0;
  }
  const missing = ['SENTRY_ORG', 'SENTRY_PROJECT'].filter((k) => !env[k]);
  if (missing.length) {
    log(`[sourcemaps] ${missing.join(' and ')} must be set with SENTRY_AUTH_TOKEN`);
    return 1;
  }
  const release = env.SENTRY_RELEASE || gitSha(root);
  const targets = [
    { name: 'backend', dir: path.join(root, 'dist'), project: env.SENTRY_PROJECT, removeMaps: false },
    {
      name: 'web',
      dir: path.join(root, 'packages', 'web', 'dist'),
      project: env.SENTRY_WEB_PROJECT || env.SENTRY_PROJECT,
      removeMaps: true,
    },
  ];
  let failed = 0;
  for (const { name, dir, project, removeMaps } of targets) {
    try {
      if (!findMaps(dir).length) {
        log(`[sourcemaps] ${name}: no .map files under ${path.relative(root, dir) || dir}; build first`);
        failed++;
        continue;
      }
      run(['sourcemaps', 'inject', dir], env);
      run(['sourcemaps', 'upload', '--release', release, '--org', env.SENTRY_ORG, '--project', project, dir], env);
      log(`[sourcemaps] ${name}: uploaded for release ${release}`);
    } catch (err) {
      log(`[sourcemaps] ${name}: upload failed (${err.message.split('\n')[0]})`);
      failed++;
    } finally {
      // Delete even after a failed upload: a map left in the web dist is public.
      if (removeMaps) for (const f of findMaps(dir)) unlinkSync(f);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  process.exitCode = uploadSourceMaps({ root: i > 0 ? process.argv[i + 1] : '.' });
}
