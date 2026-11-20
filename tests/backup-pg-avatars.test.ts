import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { hasCommand, makeTempDir, runScript, stubEnv, writeStub } from './_backup-stubs';

const skip = hasCommand('flock') && hasCommand('tar') ? false : 'needs util-linux flock and tar (Linux)';

// A skipped suite is not counted in the summary, so report the skip as a skipped test too.
if (skip) it('scripts/backup-pg.sh avatar suite', { skip }, () => {});

describe('scripts/backup-pg.sh avatar archive', { skip }, () => {
  function setup() {
    const work = makeTempDir('festie-backup-avatars-test-');
    const backupDir = path.join(work, 'backups');
    const avatarDir = path.join(work, 'public', 'uploads', 'avatars');
    mkdirSync(avatarDir, { recursive: true });
    writeFileSync(path.join(avatarDir, 'alice.webp'), 'alice-pixels');
    writeFileSync(path.join(avatarDir, 'bob.webp'), 'bob-pixels');
    const bin = path.join(work, 'bin');
    writeStub(bin, 'pg_dump', 'while [ $# -gt 0 ]; do [ "$1" = "-f" ] && head -c 300 /dev/zero > "$2"; shift; done');
    writeStub(bin, 'pg_restore', 'exit 0');
    writeStub(bin, 'psql', 'echo "users|1|"');
    const env = stubEnv(bin, path.join(work, 'stub.log'), {
      BACKUP_DIR: backupDir,
      AVATAR_DIR: avatarDir,
      PGPASSWORD: 'x',
      HOME: work,
      DB_PORT: '1',
      DB_HOST: '127.0.0.1',
    });
    return { work, backupDir, avatarDir, env };
  }
  const archives = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^avatars_\d{8}\.tar\.gz$/.test(f)) : []);

  it('archives the avatar directory beside the dump and restores one avatar from it', () => {
    const { work, backupDir, env } = setup();
    const r = runScript('scripts/backup-pg.sh', [], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const [archive] = archives(backupDir);
    assert.ok(archive, 'no avatar archive was written');
    assert.equal(readdirSync(backupDir).filter((f) => f.endsWith('.tmp')).length, 0);

    const restored = path.join(work, 'restored');
    mkdirSync(restored);
    const tar = spawnSync('tar', ['-xzf', path.join(backupDir, archive), '-C', restored, 'avatars/alice.webp']);
    assert.equal(tar.status, 0, String(tar.stderr));
    assert.equal(readFileSync(path.join(restored, 'avatars', 'alice.webp'), 'utf8'), 'alice-pixels');
    assert.equal(existsSync(path.join(restored, 'avatars', 'bob.webp')), false);
  });

  it('replaces the archive on a second run the same day instead of adding one', () => {
    const { backupDir, avatarDir, env } = setup();
    assert.equal(runScript('scripts/backup-pg.sh', [], env).status, 0);
    writeFileSync(path.join(avatarDir, 'carol.webp'), 'carol-pixels');
    assert.equal(runScript('scripts/backup-pg.sh', [], env).status, 0);
    const found = archives(backupDir);
    assert.equal(found.length, 1);
    const list = spawnSync('tar', ['-tzf', path.join(backupDir, found[0]!)], { encoding: 'utf8' });
    assert.match(list.stdout, /avatars\/carol\.webp/);
  });

  it('skips the archive and still succeeds when there is no avatar directory', () => {
    const { backupDir, avatarDir, env } = setup();
    rmSync(avatarDir, { recursive: true });
    const r = runScript('scripts/backup-pg.sh', [], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /avatar archive skipped/);
    assert.equal(archives(backupDir).length, 0);
  });

  it('prunes avatar archives older than DAILY_KEEP days', () => {
    const { backupDir, env } = setup();
    mkdirSync(backupDir, { recursive: true });
    const old = path.join(backupDir, 'avatars_20200101.tar.gz');
    writeFileSync(old, 'x');
    const longAgo = new Date(Date.now() - 40 * 86400e3);
    utimesSync(old, longAgo, longAgo);
    assert.equal(runScript('scripts/backup-pg.sh', [], env).status, 0);
    assert.equal(existsSync(old), false);
    assert.equal(archives(backupDir).length, 1);
  });

  it('keeps the dump and exits 76 when the avatar archive cannot be written', () => {
    const { backupDir, env } = setup();
    const bin = path.dirname(env.STUB_LOG!) + '/bin';
    writeStub(bin, 'tar', 'exit 2');
    const r = runScript('scripts/backup-pg.sh', [], env);
    assert.equal(r.status, 76, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /avatar archive failed/);
    assert.equal(readdirSync(backupDir).filter((f) => f.endsWith('.dump')).length, 1);
    assert.equal(archives(backupDir).length, 0);
  });

  it('keeps the archive and exits 0 when tar reports a file changed while it read (exit 1)', () => {
    const { backupDir, env } = setup();
    const bin = path.dirname(env.STUB_LOG!) + '/bin';
    const realTar = spawnSync('bash', ['-c', 'command -v tar'], { encoding: 'utf8' }).stdout.trim();
    writeStub(bin, 'tar', `"${realTar}" "$@"; exit 1`);
    const r = runScript('scripts/backup-pg.sh', [], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /changed while archiving/);
    assert.equal(archives(backupDir).length, 1);
  });
});
