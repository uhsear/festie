import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dumpStamp, hasCommand, makeTempDir, runScript, stubEnv, writeStub } from './_backup-stubs';

const skip = hasCommand('flock') ? false : 'needs util-linux flock (Linux)';
const SCRIPT = 'scripts/backup-offsite-git.sh';

describe('scripts/backup-offsite-git.sh', { skip }, () => {
  let work: string;
  let backupDir: string;
  let dumpsDir: string;
  let env: NodeJS.ProcessEnv;

  const log = () => readFileSync(path.join(backupDir, 'offsite-git.log'), 'utf8');
  const pushed = () => readdirSync(dumpsDir).sort();
  const run = (extra: Record<string, string> = {}) => runScript(SCRIPT, [], { ...env, ...extra });

  function writeDump(hoursAgo: number, opts: { weekly?: boolean; counts?: boolean } = {}): string {
    const name = `fp_${dumpStamp(hoursAgo)}${opts.weekly ? '_weekly' : ''}.dump`;
    writeFileSync(path.join(backupDir, name), 'x'.repeat(300));
    if (opts.counts !== false && !opts.weekly) writeFileSync(path.join(backupDir, `${name}.counts`), 'users|1|\n');
    return name;
  }

  beforeEach(() => {
    work = makeTempDir('festie-offsite-test-');
    backupDir = path.join(work, 'backups');
    dumpsDir = path.join(work, 'clone', 'dumps');
    mkdirSync(backupDir, { recursive: true });
    mkdirSync(path.join(work, 'clone', '.git'), { recursive: true }); // skips the first-run clone
    mkdirSync(dumpsDir, { recursive: true });
    const bin = path.join(work, 'bin');
    // diff exits 1 so the script sees changes; rm exits 1 so its plain rm -f fallback runs.
    writeStub(bin, 'git', 'case "$*" in "diff --cached --quiet"|"diff --quiet"|"rm "*) exit 1;; esac; exit 0');
    writeStub(bin, 'gpg', 'while [ $# -gt 0 ]; do [ "$1" = "--output" ] && echo encrypted > "$2"; shift; done');
    writeStub(bin, 'pg_restore', 'echo "pg_restore: stub failure" >&2; exit "${PG_RESTORE_RC:-0}"');
    env = stubEnv(bin, path.join(work, 'stub.log'), {
      BACKUP_DIR: backupDir,
      BACKUP_GIT_CLONE: path.join(work, 'clone'),
      BACKUP_GPG_PASSPHRASE: 'pw',
      FESTIVAL_MODE_FLAG: path.join(work, 'no-festival-mode'),
      HOME: work,
    });
    delete env.BACKUP_LOCK_WAIT;
    delete env.PG_RESTORE_RC;
  });

  it('pushes the newest dump with its sidecar', () => {
    const name = writeDump(1);
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr + log());
    assert.deepEqual(pushed(), [`${name}.counts`, `${name}.gpg`]);
    assert.match(readFileSync(path.join(work, 'stub.log'), 'utf8'), /^git push /m);
  });

  it('fails on a dump older than 26 h', () => {
    writeDump(27);
    assert.equal(run().status, 1);
    assert.match(log(), /older than 26 h/);
    assert.deepEqual(pushed(), []);
  });

  it('accepts a 25 h dump normally but fails a 3 h dump in festival mode', () => {
    writeDump(25);
    assert.equal(run().status, 0, log());

    writeFileSync(path.join(work, 'festival-mode'), '');
    const stale = writeDump(3);
    const r = run({ FESTIVAL_MODE_FLAG: path.join(work, 'festival-mode') });
    assert.equal(r.status, 1);
    assert.match(log(), new RegExp(`${stale} is older than 2 h`));
  });

  it('renames a corrupt dump to .bad and exits 1', () => {
    const name = writeDump(1);
    const r = run({ PG_RESTORE_RC: '1' });
    assert.equal(r.status, 1);
    assert.ok(existsSync(path.join(backupDir, `${name}.bad`)));
    assert.ok(!existsSync(path.join(backupDir, name)));
    assert.match(log(), /renamed to .*\.bad/);
    assert.match(log(), /stub failure/);
    assert.deepEqual(pushed(), []);
  });

  it('leaves the dump in place when pg_restore cannot run (exit 127)', () => {
    const name = writeDump(1);
    const r = run({ PG_RESTORE_RC: '127' });
    assert.equal(r.status, 1);
    assert.ok(existsSync(path.join(backupDir, name)));
    assert.ok(!existsSync(path.join(backupDir, `${name}.bad`)));
    assert.match(log(), /could not run/);
  });

  it('exits 75 without waiting when BACKUP_LOCK_WAIT=0 and the lock is held', async () => {
    writeDump(1);
    const holder = spawn('bash', ['-c', 'exec 9>"$1"; flock 9; sleep 4', '_', path.join(backupDir, '.backup.lock')], { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const r = run({ BACKUP_LOCK_WAIT: '0' });
      assert.equal(r.status, 75, r.stdout + r.stderr);
      assert.match(log(), /lock held, skipped/);
      assert.deepEqual(pushed(), []);
    } finally {
      holder.kill();
    }
  });

  it('never selects a _weekly copy, even when it is newer', () => {
    const daily = writeDump(5);
    writeDump(2, { weekly: true });
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr + log());
    assert.deepEqual(pushed(), [`${daily}.counts`, `${daily}.gpg`]);
  });

  it('prunes a sidecar together with its dump and keeps the pair of a kept dump', () => {
    const stems = new Map<number, string>(); // stamps taken once: dumpStamp moves with the clock
    for (let day = 2; day <= 121; day++) {
      const stem = `fp_${dumpStamp(day * 24)}.dump`;
      stems.set(day, stem);
      writeFileSync(path.join(dumpsDir, `${stem}.gpg`), 'old');
      writeFileSync(path.join(dumpsDir, `${stem}.counts`), 'users|1|\n');
    }
    const name = writeDump(1);
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr + log());
    const files = new Set(pushed());
    assert.ok(files.has(`${name}.gpg`) && files.has(`${name}.counts`), 'the new pair is pushed');
    const kept = (day: number) => files.has(`${stems.get(day)}.gpg`);
    assert.ok(kept(5), 'a 5-day-old dump stays');
    assert.ok(!kept(100), 'a 100-day-old dump is pruned');
    for (const [day, stem] of stems) {
      assert.equal(files.has(`${stem}.gpg`), files.has(`${stem}.counts`), `day ${day}: dump and sidecar must agree`);
    }
  });

  it('pushes, then exits 1, when the retention step fails', () => {
    const name = writeDump(1);
    writeStub(path.join(work, 'bin'), 'node', 'exit 1');
    const r = run();
    assert.equal(r.status, 1);
    assert.match(log(), /retention prune failed/);
    assert.ok(pushed().includes(`${name}.gpg`), 'the new dump is still pushed');
    assert.match(readFileSync(path.join(work, 'stub.log'), 'utf8'), /^git push /m);
  });
});
