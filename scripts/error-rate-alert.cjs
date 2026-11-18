#!/usr/bin/env node
'use strict';

/**
 * Error Rate Alert — Lightweight cron-based alerting for Festie
 *
 * Checks the health endpoint and PM2 error logs for elevated error rates.
 * Sends alerts via a webhook URL (Slack, Discord, ntfy, or any HTTP endpoint).
 *
 * Usage:
 *   Check every 5 minutes via cron:
 *   [star]/5 * * * * cd /path/to/festie && node scripts/error-rate-alert.js >> logs/alert.log 2>&1
 *
 * Environment:
 *   ALERT_WEBHOOK_URL   - POST webhook for alerts (required for actual notifications).
 *                         When unset, falls back to https://ntfy.sh/<topic> with the topic
 *                         read from ~/.config/festie-ntfy-topic; no file = log only.
 *   ALERT_THRESHOLD     - Error count threshold per window (default: 10)
 *   ALERT_COOLDOWN_MIN  - Minutes between repeat alerts of the same kind (default: 30).
 *                         A "recovered" notice is sent when a kind clears.
 *   ALERT_MEMORY_MB     - Per-instance memory (MB) that triggers an alert (default: 600)
 *   HEALTH_URL          - Health endpoint URL (default: http://127.0.0.1:4000/api/health)
 *   READY_URL           - Readiness endpoint URL (default: HEALTH_URL with /health -> /ready).
 *                         Not-ready and Redis-degraded alert after 2 consecutive polls.
 *   BACKUP_DIR          - Directory probed for writability (default: ~/backups/festie)
 *
 * Disk: alerts below 10% free on / or when a probe file cannot be written to BACKUP_DIR.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

// ── Config ──
// Read inside main() so that requiring this file (tests) has no side effects.
function loadConfig() {
  // Load .env. cron runs this as `cd <app> && node scripts/error-rate-alert.cjs`
  // with a bare environment, so without this every setting below silently fell
  // back to its default — including ALERT_WEBHOOK_URL, which is configured in
  // .env but was invisible here. Measured 2026-08-19: 1128 of 104507 log lines
  // were "No ALERT_WEBHOOK_URL configured", i.e. 1128 real alerts were computed
  // and then thrown away. Loading it here (rather than fixing the crontab) keeps
  // the fix in version control. Never overrides a var already set in the
  // environment, so an explicit override still wins.
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  } catch {
    // dotenv missing (or no .env present) — fall through to process.env only.
  }
  const healthUrl = process.env.HEALTH_URL || 'http://127.0.0.1:4000/api/health';
  return {
    healthUrl,
    readyUrl: process.env.READY_URL || healthUrl.replace(/\/health\/?$/, '/ready'),
    memoryMb: parseInt(process.env.ALERT_MEMORY_MB, 10) || 600,
    webhookUrl: process.env.ALERT_WEBHOOK_URL || ntfyUrlFromTopicFile(),
    threshold: parseInt(process.env.ALERT_THRESHOLD, 10) || 10,
    cooldownMin: parseInt(process.env.ALERT_COOLDOWN_MIN, 10) || 30,
    backupDir: process.env.BACKUP_DIR || path.join(os.homedir(), 'backups', 'festie'),
  };
}

// Same server and JSON body the other host scripts post to ntfy with.
function ntfyUrlFromTopicFile() {
  try {
    const topic = fs.readFileSync(path.join(os.homedir(), '.config', 'festie-ntfy-topic'), 'utf8').trim();
    return topic ? `https://ntfy.sh/${encodeURIComponent(topic)}` : '';
  } catch {
    return '';
  }
}

const LOG_DIR = path.join(__dirname, '..', 'logs');
const STATE_FILE = path.join(LOG_DIR, '.alert-state.json');
const DISK_MIN_FREE = 0.1;
// Alert kinds that must fail this many polls in a row before they page.
const CONFIRM_POLLS = { ready: 2, redis: 2 };

// ── State (persisted between runs) ──
// lastAlertAt is per alert kind. Older state files stored one number; it is dropped.
function normalizeState(raw) {
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return {
    lastAlertAt: obj(raw?.lastAlertAt),
    active: obj(raw?.active),
    strikes: obj(raw?.strikes),
    lastErrorCount: Number(raw?.lastErrorCount) || 0,
  };
}

function loadState() {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
  } catch {
    return normalizeState(null);
  }
}

function saveState(state) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── HTTP probe ──
function fetchJson(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', (err) => resolve({ status: 0, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
  });
}

async function checkHealth(url) {
  const res = await fetchJson(url);
  return { ...res, ok: res.status === 200 && res.body?.data?.status === 'ok' };
}

// ── Pure checks (exported for tests) ──
// Each returns { bad, msg } per alert kind. bad is undefined when there is no verdict.
function readyObservations(res) {
  const ready = res.status === 200 && res.body?.data?.status === 'ready';
  const redis = res.body?.data?.checks?.redis;
  const redisBad = typeof redis === 'string' ? redis !== 'ok' && redis !== 'disabled' : undefined;
  return {
    ready: { bad: !ready, msg: `/api/ready is not ready (status: ${res.status}, error: ${res.error || res.body?.data?.status || 'unready response'})` },
    redis: { bad: redisBad, msg: `Redis is ${redis} (/api/ready checks.redis)` },
  };
}

function diskObservations({ freeRatio, probeError }) {
  return {
    'disk-space': { bad: freeRatio < DISK_MIN_FREE, msg: `Disk / has ${(freeRatio * 100).toFixed(1)}% free (alert below ${DISK_MIN_FREE * 100}%)` },
    'disk-write': { bad: Boolean(probeError), msg: `Cannot write to the backup directory: ${probeError}` },
  };
}

/**
 * Applies one poll to the persisted state.
 * observations: { kind: { bad, msg } }. Kinds in CONFIRM_POLLS need that many bad polls in a row.
 * A kind whose bad is undefined has no verdict this poll: its strikes and active flag stay as they were.
 * Returns { state, alerts, recoveries, suppressed }.
 * A kind alerts at most once per cooldownMs while it stays active. A "recovered" notice follows only an alert
 * that was sent, and it clears the cooldown so the first failure after a recovery always pages.
 */
function advance(prevState, observations, now, cooldownMs) {
  const state = normalizeState(prevState);
  const alerts = [];
  const recoveries = [];
  let suppressed = 0;

  for (const [kind, { bad, msg }] of Object.entries(observations)) {
    if (bad === undefined) continue;
    state.strikes[kind] = bad ? (state.strikes[kind] || 0) + 1 : 0;
    if (bad && state.strikes[kind] >= (CONFIRM_POLLS[kind] || 1)) {
      if (now - (state.lastAlertAt[kind] || 0) > cooldownMs) {
        alerts.push(msg);
        state.lastAlertAt[kind] = now;
        state.active[kind] = true;
      } else {
        suppressed++;
      }
    } else if (!bad && state.active[kind]) {
      recoveries.push(`Recovered: ${kind}`);
      delete state.active[kind];
      delete state.lastAlertAt[kind];
    }
  }
  return { state, alerts, recoveries, suppressed };
}

// ── Error Log Analysis ──
function countRecentErrors(windowMinutes = 5) {
  const errorLogPath = path.join(LOG_DIR, 'pm2-error.log');
  if (!fs.existsSync(errorLogPath)) return 0;

  const cutoff = Date.now() - windowMinutes * 60_000;
  const content = fs.readFileSync(errorLogPath, 'utf8');
  const lines = content.split('\n').filter(Boolean);

  let errorCount = 0;
  for (const line of lines) {
    // PM2 error logs have timestamps like "2026-03-18T16:47:56:"
    const tsMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    if (tsMatch) {
      const ts = new Date(tsMatch[1]).getTime();
      if (ts > cutoff) errorCount++;
    }
  }
  return errorCount;
}

// ── PM2 Process Check ──
function checkPM2Processes(memoryMb) {
  const { execSync } = require('child_process');
  try {
    const output = execSync('pm2 jlist 2>/dev/null', { timeout: 5000 }).toString();
    const procs = JSON.parse(output);
    const fpProcs = procs.filter((p) => p.name === 'festie');
    const stopped = fpProcs.filter((p) => p.pm2_env.status !== 'online');
    const highMem = fpProcs.filter((p) => (p.monit?.memory || 0) > memoryMb * 1024 * 1024);
    return {
      total: fpProcs.length,
      online: fpProcs.length - stopped.length,
      stopped: stopped.length,
      highMemory: highMem.length,
      avgMemoryMB: Math.round(fpProcs.reduce((sum, p) => sum + (p.monit?.memory || 0), 0) / fpProcs.length / 1024 / 1024),
    };
  } catch {
    return null;
  }
}

// ── Disk Check ──
function checkDisk(backupDir) {
  const stat = fs.statfsSync('/');
  const probe = path.join(backupDir, `.alert-probe-${process.pid}`);
  let probeError = '';
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (err) {
    probeError = err.message;
  }
  return { freeRatio: stat.bavail / stat.blocks, probeError };
}

// ── Alert Sender ──
function sendAlert(message, webhookUrl, title = '🚨 Festie Alert') {
  const timestamp = new Date().toISOString();
  console.log(`[ALERT ${timestamp}] ${message}`);

  if (!webhookUrl) {
    console.log('[ALERT] No ALERT_WEBHOOK_URL or ~/.config/festie-ntfy-topic configured — logging only');
    return Promise.resolve();
  }

  const payload = JSON.stringify({ text: `${title}\n${message}` });
  const url = new URL(webhookUrl);
  const mod = url.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const req = mod.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 5000 }, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', (err) => { console.error('[ALERT] webhook failed:', err.message); resolve(); });
    req.write(payload);
    req.end();
  });
}

// ── Main ──
async function main() {
  const cfg = loadConfig();
  const state = loadState();
  const observations = {};

  // 1. Health check
  const health = await checkHealth(cfg.healthUrl);
  observations.health = {
    bad: !health.ok,
    msg: `Health check FAILED (status: ${health.status}, error: ${health.error || 'unhealthy response'})`,
  };

  // 2. Readiness and Redis (page after 2 consecutive polls)
  Object.assign(observations, readyObservations(await fetchJson(cfg.readyUrl)));

  // 3. Error log count
  const errorCount = countRecentErrors(5);
  observations.errors = {
    bad: errorCount >= cfg.threshold,
    msg: `${errorCount} errors in PM2 error log (last 5 minutes, threshold: ${cfg.threshold})`,
  };

  // 4. PM2 process health
  const pm2 = checkPM2Processes(cfg.memoryMb);
  // pm2 null means `pm2 jlist` failed: no verdict, so the kinds are left out.
  if (pm2) {
    observations['pm2-stopped'] = { bad: pm2.stopped > 0, msg: `${pm2.stopped}/${pm2.total} PM2 instances are NOT online` };
    observations['pm2-memory'] = {
      bad: pm2.highMemory > 0,
      msg: `${pm2.highMemory}/${pm2.total} instances over ${cfg.memoryMb}MB (avg: ${pm2.avgMemoryMB}MB)`,
    };
  }

  // 5. Disk space and backup directory writability
  Object.assign(observations, diskObservations(checkDisk(cfg.backupDir)));

  // 6. Decide what to send
  const { state: next, alerts, recoveries, suppressed } = advance(state, observations, Date.now(), cfg.cooldownMin * 60_000);
  if (alerts.length > 0) await sendAlert(alerts.join('\n'), cfg.webhookUrl);
  if (recoveries.length > 0) await sendAlert(recoveries.join('\n'), cfg.webhookUrl, '✅ Festie Recovered');
  if (suppressed > 0) console.log(`[SUPPRESSED] ${suppressed} alert(s) within cooldown window`);
  if (Object.values(observations).every((o) => !o.bad)) {
    const pm2Line = pm2 ? `${pm2.online}/${pm2.total} online, Mem: ${pm2.avgMemoryMB}MB avg` : 'unknown';
    console.log(`[OK ${new Date().toISOString()}] Health: ok, Errors: ${errorCount}, PM2: ${pm2Line}`);
  }

  next.lastErrorCount = errorCount;
  saveState(next);
}

module.exports = { advance, readyObservations, diskObservations, normalizeState };

if (require.main === module) {
  main().catch((err) => {
    console.error('[FATAL]', err.message);
    process.exit(1);
  });
}
