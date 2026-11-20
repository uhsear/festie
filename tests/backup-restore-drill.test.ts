import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DB_STUBS, dumpStamp, hasCommand, makeTempDir, runScript, stubEnv, writeStub,
} from './_backup-stubs';

// The drill requires mode 600 on its credentials file, which Windows cannot represent.
const skip = hasCommand('bash') && process.platform !== 'win32' ? false : 'needs bash on Linux';

const SERVICE_KEYS = ['FIREBASE_CREDENTIALS_PATH', 'RESEND_API_KEY', 'VAPID_PRIVATE_KEY', 'FCM_RETRY_WEBHOOK_URL', 'SENTRY_DSN'];
const DRILL_CREDS = 'DB_USER=festie\nPGPASSWORD=drillpw\nDB_NAME=festie_test\n';
const PROD_URL = 'DATABASE_URL=postgres://festival:prodpw@127.0.0.1:5432/festival_planner\n';

// Sidecar rows: name|count|newest write. Restored counts come from RESTORED below.
const SIDECAR = 'users|100|2026-11-17 01:00:00+00\nfestivals|10|2026-11-17 01:00:00+00\nfestival_sets|500|\n';

describe('scripts/backup-restore-drill.sh', { skip }, () => {
  let work: string;
  let log: string;
  let env: NodeJS.ProcessEnv;

  function dbCommands(): string[] {
    const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n') : [];
    return lines.filter((l) => DB_STUBS.some((s) => l.startsWith(`${s} `)));
  }

  function setup(opts: { sidecar?: string | null; hoursOld?: number; restored?: Record<string, number> } = {}) {
    const bin = path.join(work, 'bin');
    const stamp = dumpStamp(opts.hoursOld ?? 1);
    const repo = path.join(work, 'fake-repo');
    rmSync(repo, { recursive: true, force: true });
    mkdirSync(path.join(repo, 'dumps'), { recursive: true });
    writeFileSync(path.join(repo, 'dumps', `fp_${stamp}.dump.gpg`), 'encrypted');
    if (opts.sidecar !== null) writeFileSync(path.join(repo, 'dumps', `fp_${stamp}.dump.counts`), opts.sidecar ?? SIDECAR);

    const restored = { users: 100, festivals: 10, festival_sets: 500, ...opts.restored };
    writeFileSync(path.join(work, 'restored'), Object.entries(restored).map(([k, v]) => `${k}=${v}`).join('\n'));

    writeStub(bin, 'git', 'cp -r "$FAKE_REPO" "${@: -1}"');
    writeStub(bin, 'gpg', 'while [ $# -gt 0 ]; do [ "$1" = "--output" ] && head -c 300 /dev/zero > "$2"; shift; done');
    writeStub(bin, 'createdb', 'true');
    writeStub(bin, 'dropdb', 'true');
    writeStub(bin, 'pg_restore', '[ "$1" = "--list" ] && printf "1; 1259 1 TABLE public users festie\\n2; 1259 2 TABLE public festivals festie\\n3; 1259 3 TABLE public festival_sets festie\\n4; 0 0 TABLE DATA public users festie\\n"; true');
    writeStub(bin, 'psql', [
      'q="$*"',
      'case "$q" in *information_schema*) echo 3; exit 0;; *pg_database*) echo "$EXISTING_DB"; exit 0;; esac',
      't=$(echo "$q" | sed -n "s/.*FROM \\([a-z_]*\\);.*/\\1/p")',
      'grep "^$t=" "$RESTORED_FILE" | cut -d= -f2',
    ].join('\n'));

    writeFileSync(path.join(work, 'prod.env'), 'DATABASE_URL=postgres://festival:prodpw@127.0.0.1:5432/festival_planner\nBACKUP_GPG_PASSPHRASE=secret\n');
    writeFileSync(path.join(work, 'drill-db.env'), 'DB_USER=festie\nPGPASSWORD=drillpw\nDB_NAME=festie_test\n');
    chmodSync(path.join(work, 'drill-db.env'), 0o600);

    // A stand-in for dist/server.js: answers every request with the status in ./ready-status and
    // records what it was started with. The boot step starts it under env -i, so only the file
    // and PORT cross over.
    const appDir = path.join(work, 'app');
    mkdirSync(path.join(appDir, 'dist'), { recursive: true });
    writeFileSync(path.join(appDir, 'ready-status'), '200');
    writeFileSync(path.join(appDir, 'dist', 'server.js'), [
      "const fs = require('fs');",
      "fs.writeFileSync('seen.json', JSON.stringify(process.env));",
      "require('http').createServer((req, res) => {",
      "  res.statusCode = Number(fs.readFileSync('ready-status', 'utf8'));",
      "  res.end('{}');",
      "}).listen(Number(process.env.PORT), '127.0.0.1');",
    ].join('\n'));

    env = stubEnv(bin, log, {
      DRILL_APP_DIR: appDir,
      DRILL_BOOT_PORT: '4199',
      DRILL_BOOT_TIMEOUT: '10',
      DRILL_DB_ENV: path.join(work, 'drill-db.env'),
      FESTIE_ENV_FILE: path.join(work, 'prod.env'),
      FAKE_REPO: repo,
      RESTORED_FILE: path.join(work, 'restored'),
      HOME: work,
    });
    delete env.DB_PORT;
    delete env.RESTORE_DB;
    for (const key of SERVICE_KEYS) delete env[key];
    delete env.EXISTING_DB;
  }

  const run = (extra: Record<string, string> = {}) => runScript('scripts/backup-restore-drill.sh', [], { ...env, ...extra });

  beforeEach(() => {
    work = makeTempDir('festie-drill-test-');
    log = path.join(work, 'stub.log');
    setup();
  });

  it('passes when the restored counts match the sidecar, and drops the restore DB', () => {
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Restore drill PASSED/);
    assert.match(r.stdout, /host=127\.0\.0\.1 port=5433 admin_db=festie_test restore_db=festie_drill_\d+/);
    assert.ok(dbCommands().some((c) => c.startsWith('createdb ')));
    assert.ok(dbCommands().some((c) => c.startsWith('dropdb ')));
  });

  it('boots the app on the restored database with a scrubbed environment', () => {
    const r = run({ LEAKED_SECRET: 'x' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Boot drill PASSED: \/api\/ready 200/);
    const seen = JSON.parse(readFileSync(path.join(work, 'app', 'seen.json'), 'utf8'));
    assert.match(seen.DATABASE_URL, /^postgresql:\/\/festie:drillpw@127\.0\.0\.1:5433\/festie_drill_\d+$/);
    assert.equal(seen.PORT, '4199');
    assert.equal(seen.NODE_ENV, 'production');
    assert.equal(seen.REDIS_ENABLED, 'false');
    assert.equal(seen.LEAKED_SECRET, undefined);
    for (const key of SERVICE_KEYS) assert.equal(seen[key], undefined, key);
  });

  it('fails the drill, and still drops the restore DB, when /api/ready never returns 200', () => {
    writeFileSync(path.join(work, 'app', 'ready-status'), '503');
    const r = run({ DRILL_BOOT_TIMEOUT: '3' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Boot drill FAILED: \/api\/ready returned '503'/);
    assert.doesNotMatch(r.stdout, /Restore drill PASSED/);
    assert.ok(dbCommands().some((c) => c.startsWith('dropdb ')));
  });

  it('fails the drill when the app is not built', () => {
    rmSync(path.join(work, 'app', 'dist'), { recursive: true });
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /dist\/server\.js not found/);
    assert.doesNotMatch(r.stdout, /Restore drill PASSED/);
  });

  it('sends every database call to port 5433 with the drill password', () => {
    assert.equal(run().status, 0);
    const calls = dbCommands().filter((c) => !c.startsWith('pg_restore --list'));
    assert.ok(calls.length >= 5, `expected several DB calls, saw ${calls.length}`);
    for (const call of calls) assert.match(call, / -p 5433 /, call);
    const passwords = readFileSync(`${log}.pw`, 'utf8').split('\n').filter(Boolean);
    for (const line of passwords) assert.match(line, /^\S+ drillpw$/, line);
  });

  it('refuses when the credentials file sets DB_PORT=5432', () => {
    writeFileSync(path.join(work, 'drill-db.env'), `${DRILL_CREDS}DB_PORT=5432\n`);
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not 5433/);
    assert.deepEqual(dbCommands(), []);
  });

  it('refuses when the credentials file is not mode 600', () => {
    chmodSync(path.join(work, 'drill-db.env'), 0o644);
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /mode 600/);
    assert.deepEqual(dbCommands(), []);
  });

  it('refuses when the credentials file sets a production service key', () => {
    writeFileSync(path.join(work, 'drill-db.env'), `${DRILL_CREDS}RESEND_API_KEY=re_x\n`);
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /RESEND_API_KEY/);
    assert.deepEqual(dbCommands(), []);
  });

  it('refuses when the production .env has no DATABASE_URL or passphrase', () => {
    writeFileSync(path.join(work, 'prod.env'), 'BACKUP_GPG_PASSPHRASE=secret\n');
    let r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /DATABASE_URL not set/);
    writeFileSync(path.join(work, 'prod.env'), PROD_URL);
    r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /BACKUP_GPG_PASSPHRASE not set/);
    assert.deepEqual(dbCommands(), []);
  });

  it('refuses a restore DB that already exists and never drops it', () => {
    const r = run({ EXISTING_DB: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /already exists/);
    assert.deepEqual(dbCommands().filter((c) => /^(createdb|dropdb) /.test(c)), []);
  });

  it('fails when the sidecar has no users or festivals row', () => {
    setup({ sidecar: 'users|100|\nfestival_sets|500|\n' });
    let r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no festivals row/);
    setup({ sidecar: 'festivals|10|\nfestival_sets|500|\n' });
    r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no users row/);
    assert.deepEqual(dbCommands(), []);
  });

  it('refuses DB_PORT=5432 before any database command', () => {
    const r = run({ DB_PORT: '5432' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /5432/);
    assert.deepEqual(dbCommands(), []);
  });

  it('refuses a restore DB name ending in _test before any database command', () => {
    const r = run({ RESTORE_DB: 'festie_drill_1_test' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /_test/);
    assert.deepEqual(dbCommands(), []);
  });

  it('refuses a restore DB name outside the drill prefix', () => {
    const r = run({ RESTORE_DB: 'festival_planner' });
    assert.equal(r.status, 1);
    assert.deepEqual(dbCommands(), []);
  });

  it('refuses when the container password equals the production password', () => {
    writeFileSync(path.join(work, 'drill-db.env'), 'DB_USER=festie\nPGPASSWORD=prodpw\nDB_NAME=festie_test\n');
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /equals the production database password/);
    assert.deepEqual(dbCommands(), []);
  });

  it('refuses when a production service credential is set', () => {
    const r = run({ SENTRY_DSN: 'https://example.invalid/1' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SENTRY_DSN/);
    assert.deepEqual(dbCommands(), []);
  });

  it('does not use the caller DATABASE_URL or PGPASSWORD', () => {
    const r = run({ PGPASSWORD: 'prodpw', DATABASE_URL: 'postgres://festival:prodpw@127.0.0.1:5432/festival_planner' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it('fails when the sidecar is missing', () => {
    setup({ sidecar: null });
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Sidecar .* is missing/);
    assert.deepEqual(dbCommands(), []);
  });

  it('fails when the newest off-site dump is older than 26 h', () => {
    setup({ hoursOld: 30 });
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /older than 26 h/);
  });

  it('fails when a table differs by more than 5 rows and 20%', () => {
    setup({ restored: { festival_sets: 300 } });
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /festival_sets: restored=300 sidecar=500/);
  });

  it('tolerates drift of 5 rows or fewer', () => {
    setup({ restored: { users: 103 } });
    assert.equal(run().status, 0);
  });

  it('fails when users is empty after the restore', () => {
    setup({ sidecar: 'users|0|\nfestivals|10|\nfestival_sets|500|\n', restored: { users: 0 } });
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /users is empty/);
  });
});
