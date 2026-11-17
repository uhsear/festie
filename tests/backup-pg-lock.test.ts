import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { hasCommand, makeTempDir, runScript, startScript, stubEnv, writeStub } from './_backup-stubs';

const skip = hasCommand('flock') ? false : 'needs util-linux flock (Linux)';

describe('scripts/backup-pg.sh', { skip }, () => {
  let backupDir: string;
  let env: NodeJS.ProcessEnv;

  const files = (suffix: string) => readdirSync(backupDir).filter((f) => f.endsWith(suffix));

  function setup(stubs: { dumpSleep?: number; listRc?: number; countsRc?: number } = {}) {
    const work = makeTempDir('festie-backup-pg-test-');
    backupDir = path.join(work, 'backups');
    const bin = path.join(work, 'bin');
    writeStub(bin, 'pg_dump', `sleep ${stubs.dumpSleep ?? 0}; while [ $# -gt 0 ]; do [ "$1" = "-f" ] && head -c 300 /dev/zero > "$2"; shift; done`);
    writeStub(bin, 'pg_restore', `exit ${stubs.listRc ?? 0}`);
    writeStub(bin, 'psql', `echo "users|1|"; exit ${stubs.countsRc ?? 0}`);
    env = stubEnv(bin, path.join(work, 'stub.log'), { BACKUP_DIR: backupDir, PGPASSWORD: 'x', HOME: work });
    delete env.BACKUP_LOCK_WAIT;
  }

  beforeEach(() => setup());

  it('serializes two parallel runs into two distinct dumps', async () => {
    setup({ dumpSleep: 2 });
    const a = startScript('scripts/backup-pg.sh', [], env);
    await new Promise((r) => setTimeout(r, 500));
    const b = startScript('scripts/backup-pg.sh', [], env);
    assert.deepEqual(await Promise.all([a.done, b.done]), [0, 0]);
    assert.equal(files('.dump').length, 2);
  });

  it('exits 75 without waiting when BACKUP_LOCK_WAIT=0 and the lock is held', async () => {
    setup({ dumpSleep: 3 });
    const a = startScript('scripts/backup-pg.sh', [], env);
    await new Promise((r) => setTimeout(r, 500));
    const b = runScript('scripts/backup-pg.sh', [], { ...env, BACKUP_LOCK_WAIT: '0' });
    assert.equal(b.status, 75, b.stdout + b.stderr);
    assert.match(b.stdout, /lock held, skipped/);
    assert.equal(await a.done, 0);
    assert.equal(files('.dump').length, 1);
  });

  it('renames a dump that fails pg_restore --list to .bad and exits 1', () => {
    setup({ listRc: 1 });
    const r = runScript('scripts/backup-pg.sh', [], env);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(files('.dump').length, 0);
    assert.equal(files('.dump.bad').length, 1);
  });

  it('writes the .counts sidecar next to the dump', () => {
    const r = runScript('scripts/backup-pg.sh', [], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(files('.dump.counts').length, 1);
    assert.equal(files('.counts.tmp').length, 0);
  });

  it('still succeeds without a sidecar when the count query fails', () => {
    setup({ countsRc: 1 });
    const r = runScript('scripts/backup-pg.sh', [], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /WARNING: row-count query failed/);
    assert.equal(files('.dump').length, 1);
    assert.equal(files('.counts').length, 0);
    assert.equal(files('.counts.tmp').length, 0);
    assert.ok(existsSync(path.join(backupDir, '.backup.lock')));
  });
});
