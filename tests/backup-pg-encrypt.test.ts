/**
 * scripts/backup-pg.sh encryption and retention: every on-host dump is GPG-encrypted with
 * BACKUP_GPG_PASSPHRASE (the passphrase the off-site script uses), no plaintext dump is left on disk,
 * and nothing stays longer than 13 weeks (the retention the Privacy Policy states). Uses the real gpg;
 * pg_dump, pg_restore and psql are stubs, so no database is touched.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { hasCommand, makeTempDir, repoRoot, stubEnv, writeStub } from './_backup-stubs';

const skip = hasCommand('flock') && hasCommand('gpg') ? false : 'needs util-linux flock (Linux) and gpg';

// A skipped suite is not counted in the summary, so report the skip as a skipped test too.
if (skip) it('scripts/backup-pg.sh encryption suite', { skip }, () => {});

describe('scripts/backup-pg.sh encryption and retention', { skip }, () => {
  let repo: string;
  let backupDir: string;
  let bin: string;
  let env: NodeJS.ProcessEnv;
  const PASS = 'correct horse "battery" staple';

  // A copy of the scripts in a temp repo root, so the script reads this test's .env and never a real one.
  const run = () => spawnSync('bash', [path.join(repo, 'scripts', 'backup-pg.sh')], { env, encoding: 'utf8' });
  const names = (suffix: string) => readdirSync(backupDir).filter((f) => f.endsWith(suffix)).sort();
  // The passphrase goes in on stdin (fd 0); the encrypted file is an argument.
  const decrypt = (file: string, pass = PASS) =>
    spawnSync('gpg', ['--batch', '--quiet', '--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--decrypt', path.join(backupDir, file)], {
      input: pass,
      encoding: 'utf8',
      env: { ...process.env, HOME: repo },
    });
  const ageDays = (file: string, days: number) => {
    const when = new Date(Date.now() - days * 86400e3);
    utimesSync(path.join(backupDir, file), when, when);
  };
  const seed = (name: string, days: number, body = 'old') => {
    writeFileSync(path.join(backupDir, name), body);
    ageDays(name, days);
  };

  beforeEach(() => {
    const work = makeTempDir('festie-backup-encrypt-test-');
    repo = path.join(work, 'repo');
    backupDir = path.join(work, 'backups');
    bin = path.join(work, 'bin');
    mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    cpSync(path.join(repoRoot, 'scripts', 'backup-pg.sh'), path.join(repo, 'scripts', 'backup-pg.sh'));
    cpSync(path.join(repoRoot, 'scripts', 'lib'), path.join(repo, 'scripts', 'lib'), { recursive: true });
    cpSync(path.join(repoRoot, 'scripts', 'sql'), path.join(repo, 'scripts', 'sql'), { recursive: true });
    mkdirSync(backupDir, { recursive: true });
    writeStub(bin, 'pg_dump', 'while [ $# -gt 0 ]; do [ "$1" = "-f" ] && printf "PGDMP-stub-%0300d" 0 > "$2"; shift; done');
    writeStub(bin, 'pg_restore', 'exit 0');
    writeStub(bin, 'psql', 'echo "users|1|"');
    env = stubEnv(bin, path.join(work, 'stub.log'), {
      BACKUP_DIR: backupDir,
      PGPASSWORD: 'x',
      HOME: work,
      DB_PORT: '1',
      DB_HOST: '127.0.0.1',
      AVATAR_DIR: path.join(work, 'no-avatars'),
      BACKUP_GPG_PASSPHRASE: PASS,
    });
    delete env.BACKUP_LOCK_WAIT;
  });

  it('writes only an encrypted dump: no plaintext is left, and the passphrase decrypts it', () => {
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(names('.dump'), [], 'no plaintext dump');
    const [dump] = names('.dump.gpg');
    assert.ok(dump, 'an encrypted dump exists');
    assert.equal(readFileSync(path.join(backupDir, dump!)).subarray(0, 5).toString('latin1').includes('PGDMP'), false, 'the file is not the plaintext');
    assert.equal(names('.dump.counts').length, 1, 'the sidecar keeps its name');
    const plain = decrypt(dump!);
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /^PGDMP-stub-/);
    assert.notEqual(decrypt(dump!, 'wrong passphrase').status, 0);
    assert.doesNotMatch(r.stdout + r.stderr, /correct horse/, 'the passphrase is never logged');
  });

  it('refuses to run without BACKUP_GPG_PASSPHRASE and makes no dump', () => {
    delete env.BACKUP_GPG_PASSPHRASE;
    const r = run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /BACKUP_GPG_PASSPHRASE is not set/);
    assert.deepEqual(readdirSync(backupDir).filter((f) => f.startsWith('fp_')), []);
  });

  it('reads the passphrase from the repo .env, quoted the way a sourced file reads it', () => {
    delete env.BACKUP_GPG_PASSPHRASE;
    writeFileSync(path.join(repo, '.env'), "OTHER=1\nBACKUP_GPG_PASSPHRASE='from env file'\n");
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const [dump] = names('.dump.gpg');
    assert.equal(decrypt(dump!, 'from env file').status, 0);
  });

  it('encrypts plaintext dumps that an older version left behind, weekly copies included, and deletes the plaintext', () => {
    seed('fp_20260101_000000.dump', 10, 'PGDMP-legacy-daily');
    seed('fp_20260101_000000.dump.counts', 10, 'users|1|\n');
    seed('fp_20251201_000000_weekly.dump', 40, 'PGDMP-legacy-weekly');
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(names('.dump'), []);
    assert.ok(existsSync(path.join(backupDir, 'fp_20260101_000000.dump.gpg')));
    assert.ok(existsSync(path.join(backupDir, 'fp_20251201_000000_weekly.dump.gpg')));
    assert.match(decrypt('fp_20260101_000000.dump.gpg').stdout, /^PGDMP-legacy-daily$/);
    assert.match(decrypt('fp_20251201_000000_weekly.dump.gpg').stdout, /^PGDMP-legacy-weekly$/);
  });

  it('exits 1 and keeps the plaintext when gpg fails, so a backup is never lost', () => {
    writeStub(bin, 'gpg', 'echo "gpg: stub failure" >&2; exit 2');
    const r = run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /encryption failed/);
    // On a Sunday the script also writes a _weekly copy, so count only the daily dump.
    assert.equal(names('.dump').filter((f) => !f.includes('_weekly')).length, 1, 'the plaintext dump is kept');
    assert.deepEqual(names('.gpg'), []);
    assert.deepEqual(names('.tmp'), []);
  });

  it('removes anything older than 13 weeks, whatever the counts say, and keeps what is younger', () => {
    seed('fp_20240101_000000.dump.gpg', 92);
    seed('fp_20240101_000000.dump.counts', 92);
    seed('fp_20240108_000000_weekly.dump.gpg', 92);
    seed('fp_20240115_000000_weekly.dump.gpg', 90);
    seed('fp_20240122_000000.dump.counts', 90);
    seed('avatars_20240101.tar.gz', 92);
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const left = readdirSync(backupDir);
    for (const gone of ['fp_20240101_000000.dump.gpg', 'fp_20240101_000000.dump.counts', 'fp_20240108_000000_weekly.dump.gpg', 'avatars_20240101.tar.gz']) {
      assert.ok(!left.includes(gone), `${gone} is older than 13 weeks and must be removed`);
    }
    assert.ok(left.includes('fp_20240115_000000_weekly.dump.gpg'), 'a 90-day-old weekly stays');
    assert.match(r.stdout, /Age ceiling: removed \d+ files older than 91d/);
  });

  it('keeps 30 daily and 12 weekly dumps, as before', () => {
    for (let i = 0; i < 14; i++) seed(`fp_2026${String(i + 10).padStart(2, '0')}01_000000_weekly.dump.gpg`, 5 + i * 5);
    seed('fp_20260101_000001.dump.gpg', 31);
    seed('fp_20260102_000001.dump.gpg', 29);
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(names('_weekly.dump.gpg').length, 12);
    const daily = names('.dump.gpg').filter((f) => !f.includes('_weekly'));
    assert.ok(!daily.includes('fp_20260101_000001.dump.gpg'), 'a 31-day-old daily dump is pruned');
    assert.ok(daily.includes('fp_20260102_000001.dump.gpg'), 'a 29-day-old daily dump stays');
  });
});
