import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hasCommand, makeTempDir, runScript, startScript, stubEnv, writeStub } from './_backup-stubs';

const skip = hasCommand('flock') ? false : 'needs util-linux flock (Linux)';

describe('scripts/backup-pg.sh', { skip }, () => {
  let backupDir: string;
  let env: NodeJS.ProcessEnv;

  // The Sunday run also writes a _weekly copy; it is not a separate dump here.
  const files = (suffix: string) => readdirSync(backupDir).filter((f) => f.endsWith(suffix) && !f.includes('_weekly'));

  function setup(stubs: { dumpSleep?: number; listRc?: number; countsRc?: number } = {}) {
    const work = makeTempDir('festie-backup-pg-test-');
    backupDir = path.join(work, 'backups');
    const bin = path.join(work, 'bin');
    writeStub(bin, 'pg_dump', `sleep ${stubs.dumpSleep ?? 0}; while [ $# -gt 0 ]; do [ "$1" = "-f" ] && head -c 300 /dev/zero > "$2"; shift; done`);
    writeStub(bin, 'pg_restore', `echo "pg_restore: stub failure" >&2; exit ${stubs.listRc ?? 0}`);
    writeStub(bin, 'psql', `echo "users|1|"; exit ${stubs.countsRc ?? 0}`);
    env = stubEnv(bin, path.join(work, 'stub.log'), { BACKUP_DIR: backupDir, PGPASSWORD: 'x', HOME: work,
      // Port 1 can never reach a real database, even if a stub is missing from PATH.
      DB_PORT: '1', DB_HOST: '127.0.0.1' });
    delete env.BACKUP_LOCK_WAIT;
  }

  beforeEach(() => setup());

  it('serializes two parallel runs into two distinct dumps', async () => {
    setup({ dumpSleep: 2 });
    const startedAt = Date.now();
    const a = startScript('scripts/backup-pg.sh', [], env);
    await new Promise((r) => setTimeout(r, 500));
    const b = startScript('scripts/backup-pg.sh', [], env);
    const bExit = await b.done.then((code) => ({ code, at: Date.now() }));
    assert.equal(await a.done, 0);
    assert.equal(bExit.code, 0);
    // Each dump takes 2 s. B only starts dumping once A releases the lock.
    assert.ok(bExit.at - startedAt >= 3500, `B ended ${bExit.at - startedAt} ms after A started: not serialized`);
    assert.equal(files('.dump').length, 2);
  });

  it('takes a new timestamp when the dump name is already taken', () => {
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = (d: Date) => `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    mkdirSync(backupDir, { recursive: true });
    const taken = [0, 1, 2].map((s) => `fp_${stamp(new Date(Date.now() + s * 1000))}.dump`);
    for (const name of taken) writeFileSync(path.join(backupDir, name), 'x'.repeat(300));
    const startedAt = Date.now();
    const r = runScript('scripts/backup-pg.sh', [], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(Date.now() - startedAt >= 1000, 'the rename loop should have waited at least 1 s');
    const created = files('.dump').filter((f) => !taken.includes(f));
    assert.equal(created.length, 1);
    for (const name of taken) assert.equal(readFileSync(path.join(backupDir, name), 'utf8'), 'x'.repeat(300), `${name} was overwritten`);
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

  it('keeps the dump and exits 1 when pg_restore cannot run (exit 127)', () => {
    setup({ listRc: 127 });
    const r = runScript('scripts/backup-pg.sh', [], env);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /could not run/);
    assert.match(r.stderr, /pg_restore: stub failure/);
    assert.equal(files('.dump').length, 1);
    assert.equal(files('.dump.bad').length, 0);
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
