import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/ci/scan-staged-secrets.mjs');
// Every fixture is assembled at runtime so no secret-shaped string is committed.
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const rand = (chars: string, n: number) => Array.from({ length: n }, (_, i) => chars[(i * 7) % chars.length]).join('');
const fixtures: Record<string, string> = {
  'AWS access key': ['AK', 'IA', rand('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 16)].join(''),
  'GitHub token': ['gh', 'p_', rand(ALNUM, 36)].join(''),
  'Slack token': ['xo', 'xb-', rand('0123456789', 12)].join(''),
  'Stripe key': ['sk', '_live_', rand(ALNUM, 24)].join(''),
  'Sentry auth token': ['sntr', 'ys_', rand(ALNUM, 40)].join(''),
  'Expo or Sentry token assignment': ['EXPO_', 'TOKEN=', rand(ALNUM, 30)].join(''),
  JWT: ['ey', 'J', rand(ALNUM, 12), '.ey', 'J', rand(ALNUM, 12), '.', rand(ALNUM, 12)].join(''),
  'database URI with a password': ['post', 'gres://app:', rand(ALNUM, 12), '@db.example.com/app'].join(''),
  'private key header': ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' '),
  'private IPv4 address': ['192', '168', '1', '9'].join('.'),
};

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function stage(file: string, content: string): void {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), content);
  git('add', '-f', file);
}

function run() {
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: repo, encoding: 'utf8' });
  return { code: result.status, out: result.stdout + result.stderr };
}

before(() => {
  repo = mkdtempSync(join(tmpdir(), 'scan-staged-'));
  git('init', '-q');
  git('config', 'user.email', 'ci@example.com');
  git('config', 'user.name', 'ci');
  git('config', 'commit.gpgsign', 'false');
  stage('README.md', 'hello\n');
  git('commit', '-q', '-m', 'Initial');
});

after(() => rmSync(repo, { recursive: true, force: true }));

test('flags every secret shape and never prints the value', () => {
  for (const [kind, value] of Object.entries(fixtures)) {
    stage('src/leak.txt', `const x = '${value}';\n`);
    const { code, out } = run();
    assert.equal(code, 1, kind);
    assert.match(out, /src\/leak\.txt:1: /, kind);
    assert.ok(out.includes(kind), `${kind} not named in: ${out}`);
    assert.ok(!out.includes(value), `${kind} value was echoed`);
  }
});

test('clean staged diff exits 0', () => {
  stage('src/leak.txt', 'const answer = 42; // port 4001, version 10.1\n');
  assert.equal(run().code, 0);
});

test('placeholder database passwords and the allow marker pass', () => {
  const template = ['post', 'gres://user:${DB_PASSWORD}@host/app'].join('');
  stage('src/a.txt', `${template}\n${fixtures['AWS access key']} // secret-scan: allow AWS docs example\n`);
  assert.equal(run().code, 0);
});

test('flags secret file names even when the content is harmless', () => {
  const names = ['.env', 'config/.env.production', 'keys/app.pem', 'ios/AuthKey.p8', 'a/release.keystore', 'a/b.jks', 'a/credentials-prod.json', 'tests/e2e/.auth/user.json'];
  for (const name of names) {
    stage(name, 'x\n');
    const { code, out } = run();
    assert.equal(code, 1, name);
    assert.ok(out.includes(`${name}: `), name);
    git('rm', '-q', '--cached', '-f', name);
  }
});

test('the example environment file is allowed', () => {
  git('rm', '-q', '--cached', '-f', 'src/a.txt');
  stage('.env.example', 'PORT=4000\n');
  assert.equal(run().code, 0);
});

test('only added lines are scanned: a removed secret does not block the fix', () => {
  stage('old.txt', `key ${fixtures['AWS access key']} // secret-scan: allow fixture\n`);
  git('commit', '-q', '-m', 'Add old');
  stage('old.txt', 'key redacted\n');
  assert.equal(run().code, 0);
});

test('git errors exit 2', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 2);
});
