import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WRAPPER = resolve('scripts/backup-festival-hourly.sh');

let root: string;
let scriptsDir: string;
let home: string;
let trace: string;

// Stub the two scripts the wrapper calls. Each appends its name and BACKUP_LOCK_WAIT to a trace file.
function stub(name: string, exitCode: number) {
  writeFileSync(join(scriptsDir, name), `#!/usr/bin/env bash\necho "${name} wait=\${BACKUP_LOCK_WAIT:-unset}" >> "${trace.replace(/\\/g, '/')}"\nexit ${exitCode}\n`);
}

function run(flag: boolean) {
  rmSync(trace, { force: true });
  const flagFile = join(home, '.festie-festival-mode');
  rmSync(flagFile, { force: true });
  if (flag) writeFileSync(flagFile, '');
  const r = spawnSync('bash', [join(scriptsDir, 'backup-festival-hourly.sh')], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
  const calls = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
  return { code: r.status, out: r.stdout + r.stderr, calls };
}

describe('backup-festival-hourly.sh', () => {
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'festival-hourly-'));
    scriptsDir = join(root, 'scripts');
    home = join(root, 'home');
    trace = join(root, 'trace.log');
    for (const dir of [scriptsDir, home]) mkdirSync(dir, { recursive: true });
    copyFileSync(WRAPPER, join(scriptsDir, 'backup-festival-hourly.sh'));
  });

  after(() => rmSync(root, { recursive: true, force: true }));

  it('exits 0 and runs nothing without the flag file', () => {
    stub('backup-pg.sh', 0);
    stub('backup-offsite-git.sh', 0);
    const r = run(false);
    assert.equal(r.code, 0);
    assert.deepEqual(r.calls, []);
  });

  it('runs the dump, then the off-site push, with BACKUP_LOCK_WAIT=0', () => {
    stub('backup-pg.sh', 0);
    stub('backup-offsite-git.sh', 0);
    const r = run(true);
    assert.equal(r.code, 0);
    assert.deepEqual(r.calls, ['backup-pg.sh wait=0', 'backup-offsite-git.sh wait=0']);
  });

  it('treats exit 75 from the dump as a skip: exit 0 and no push', () => {
    stub('backup-pg.sh', 75);
    stub('backup-offsite-git.sh', 0);
    const r = run(true);
    assert.equal(r.code, 0);
    assert.match(r.out, /SKIP: backup-pg\.sh/);
    assert.deepEqual(r.calls, ['backup-pg.sh wait=0']);
  });

  it('treats exit 75 from the push as a skip', () => {
    stub('backup-pg.sh', 0);
    stub('backup-offsite-git.sh', 75);
    const r = run(true);
    assert.equal(r.code, 0);
    assert.match(r.out, /SKIP: backup-offsite-git\.sh/);
  });

  it('propagates a real dump failure and does not push', () => {
    stub('backup-pg.sh', 1);
    stub('backup-offsite-git.sh', 0);
    const r = run(true);
    assert.equal(r.code, 1);
    assert.deepEqual(r.calls, ['backup-pg.sh wait=0']);
  });

  it('propagates a real push failure code', () => {
    stub('backup-pg.sh', 0);
    stub('backup-offsite-git.sh', 3);
    const r = run(true);
    assert.equal(r.code, 3);
    assert.match(r.out, /ERROR: backup-offsite-git\.sh exited 3/);
  });
});
