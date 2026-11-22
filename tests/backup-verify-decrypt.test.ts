/**
 * scripts/backup-verify.sh and scripts/backup-verify-restore.sh read on-host dumps, which are GPG-encrypted
 * (fp_*.dump.gpg). Both decrypt to a temporary file, check it and delete it. Real gpg; database tools are stubs.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { hasCommand, makeTempDir, repoRoot, stubEnv, writeStub } from './_backup-stubs';

const skip = hasCommand('gpg') && hasCommand('find') ? false : 'needs gpg and GNU find (Linux)';

// A skipped suite is not counted in the summary, so report the skip as a skipped test too.
if (skip) it('scripts/backup-verify*.sh suite', { skip }, () => {});

describe('backup verify scripts on encrypted dumps', { skip }, () => {
  let repo: string;
  let backupDir: string;
  let tmp: string;
  let env: NodeJS.ProcessEnv;
  let dump: string;
  const PASS = 'verify-passphrase';

  const run = (script: string, extra: Record<string, string | undefined> = {}) =>
    spawnSync('bash', [path.join(repo, 'scripts', script)], { env: { ...env, ...extra }, encoding: 'utf8' });

  beforeEach(() => {
    const work = makeTempDir('festie-backup-verify-test-');
    repo = path.join(work, 'repo');
    backupDir = path.join(work, 'backups');
    tmp = path.join(work, 'tmp');
    mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    mkdirSync(backupDir, { recursive: true });
    mkdirSync(tmp, { recursive: true });
    for (const f of ['backup-verify.sh', 'backup-verify-restore.sh']) cpSync(path.join(repoRoot, 'scripts', f), path.join(repo, 'scripts', f));
    cpSync(path.join(repoRoot, 'scripts', 'lib'), path.join(repo, 'scripts', 'lib'), { recursive: true });
    const bin = path.join(work, 'bin');
    // pg_restore --list must be handed plaintext: it fails on the encrypted file.
    writeStub(bin, 'pg_restore', 'for a in "$@"; do [ -f "$a" ] && head -c 5 "$a" | grep -q PGDMP || continue; exit 0; done; case "$*" in *--list*) exit 1;; *) exit 0;; esac');
    writeStub(bin, 'createdb', 'exit 0');
    writeStub(bin, 'dropdb', 'exit 0');
    writeStub(bin, 'psql', 'echo 5');
    env = stubEnv(bin, path.join(work, 'stub.log'), {
      BACKUP_DIR: backupDir,
      PGPASSWORD: 'x',
      HOME: work,
      TMPDIR: tmp,
      EXPECTED_TABLES: '5',
      BACKUP_GPG_PASSPHRASE: PASS,
    });
    const plain = path.join(work, 'plain.dump');
    // Random bytes: gpg compresses, and the scripts reject a dump under 100 bytes.
    writeFileSync(plain, Buffer.concat([Buffer.from('PGDMP'), randomBytes(600)]));
    dump = path.join(backupDir, 'fp_20260101_000000.dump.gpg');
    const enc = spawnSync('gpg', ['--batch', '--quiet', '--pinentry-mode', 'loopback', '--symmetric', '--cipher-algo', 'AES256', '--passphrase-fd', '0', '--output', dump, plain], {
      input: PASS,
      env: { ...process.env, HOME: work },
    });
    assert.equal(enc.status, 0, String(enc.stderr));
  });

  it('backup-verify.sh decrypts the newest dump, passes it, and leaves no plaintext behind', () => {
    const r = run('backup-verify.sh');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS: pg_restore --list OK/);
    assert.deepEqual(readdirSync(backupDir).filter((f) => f.startsWith('.verify')), []);
  });

  it('backup-verify.sh fails with a wrong passphrase', () => {
    const r = run('backup-verify.sh', { BACKUP_GPG_PASSPHRASE: 'wrong' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /could not decrypt/);
    assert.deepEqual(readdirSync(backupDir).filter((f) => f.startsWith('.verify')), []);
  });

  it('backup-verify-restore.sh restores the decrypted dump and deletes the plaintext at exit', () => {
    const r = run('backup-verify-restore.sh');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /verification PASSED/);
    assert.deepEqual(readdirSync(tmp), [], 'no plaintext temp file is left');
  });

  it('backup-verify-restore.sh accepts a given .gpg file and refuses to run without the passphrase', () => {
    assert.equal(run('backup-verify-restore.sh', { BACKUP_GPG_PASSPHRASE: '' }).status, 1);
    const r = run('backup-verify-restore.sh', {});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const given = spawnSync('bash', [path.join(repo, 'scripts', 'backup-verify-restore.sh'), dump], { env, encoding: 'utf8' });
    assert.equal(given.status, 0, given.stdout + given.stderr);
    assert.deepEqual(readdirSync(tmp), []);
  });
});
