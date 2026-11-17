import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DB_STUBS, dumpStamp, hasCommand, makeTempDir, runScript, stubEnv, writeStub,
} from './_backup-stubs';

const skip = hasCommand('bash') ? false : 'needs bash';

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
      'case "$q" in *information_schema*) echo 3; exit 0;; esac',
      't=$(echo "$q" | sed -n "s/.*FROM \\([a-z_]*\\);.*/\\1/p")',
      'grep "^$t=" "$RESTORED_FILE" | cut -d= -f2',
    ].join('\n'));

    writeFileSync(path.join(work, 'prod.env'), 'DATABASE_URL=postgres://festival:prodpw@127.0.0.1:5432/festival_planner\nBACKUP_GPG_PASSPHRASE=secret\n');
    writeFileSync(path.join(work, 'drill-db.env'), 'DB_USER=festie\nPGPASSWORD=drillpw\nDB_NAME=festie_test\n');
    chmodSync(path.join(work, 'drill-db.env'), 0o600);

    env = stubEnv(bin, log, {
      DRILL_DB_ENV: path.join(work, 'drill-db.env'),
      FESTIE_ENV_FILE: path.join(work, 'prod.env'),
      FAKE_REPO: repo,
      RESTORED_FILE: path.join(work, 'restored'),
      HOME: work,
    });
    delete env.DB_PORT;
    delete env.RESTORE_DB;
    delete env.SENTRY_DSN;
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
