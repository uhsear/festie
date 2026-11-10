import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/ci/check-public-text.mjs');
const ip = (...parts: string[]) => parts.join('.');
const keyHeader = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const homePath = ['', 'home', 'deploy', 'app', ''].join('/');

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

/** Commits `content` to `file` with `message`; returns the new head sha. */
function commit(file: string, content: string, message = 'Add file'): string {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), content);
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}

function run(head: string, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, '--base', head + '~1', '--head', head], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PUBLIC_TEXT_PRIVATE_TERMS: '', ...env },
  });
  return { code: result.status, out: result.stdout + result.stderr };
}

before(() => {
  repo = mkdtempSync(join(tmpdir(), 'public-text-'));
  git('init', '-q');
  git('config', 'user.email', 'ci@example.com');
  git('config', 'user.name', 'ci');
  git('config', 'commit.gpgsign', 'false');
  commit('README.md', 'hello\n', 'Initial');
});

after(() => rmSync(repo, { recursive: true, force: true }));

test('clean range exits 0', () => {
  const head = commit('ok.txt', 'public text, version 10.1 and 8.8.8.8\n');
  assert.equal(run(head).code, 0);
});

test('flags each private IPv4 range and names file, line and kind only', () => {
  const addrs = [ip('10', '0', '0', '5'), ip('172', '16', '3', '4'), ip('172', '31', '255', '1'), ip('192', '168', '1', '5')];
  const head = commit('net.txt', `ok\n${addrs.map(a => `host ${a}`).join('\n')}\n`);
  const { code, out } = run(head);
  assert.equal(code, 1);
  assert.match(out, /file=net\.txt,line=2,/);
  assert.match(out, /file=net\.txt,line=5,/);
  assert.match(out, /private IPv4 address/);
  for (const a of addrs) assert.ok(!out.includes(a), 'output must not echo the match');
});

test('does not flag public, out-of-range or version-like addresses', () => {
  const lines = [ip('172', '32', '0', '1'), ip('172', '15', '0', '1'), ip('11', '0', '0', '1'), ip('192', '169', '1', '1'), ip('110', '1', '2', '3'), ip('10', '1', '2', '3', '4'), `http://${ip('10', '0', '2', '2')}:4001`];
  assert.equal(run(commit('pub.txt', lines.join('\n') + '\n')).code, 0);
});

test('flags private key header and home-directory path', () => {
  const head = commit('keys.txt', `${keyHeader}\npath ${homePath}data\n`);
  const { code, out } = run(head);
  assert.equal(code, 1);
  assert.match(out, /private key header/);
  assert.match(out, /home-directory server path/);
  assert.ok(!out.includes('deploy'));
});

test('allow marker skips the line', () => {
  const head = commit('allowed.txt', `host ${ip('192', '168', '0', '9')} # public-text: allow\n`);
  assert.equal(run(head).code, 0);
});

test('only added lines are scanned, not removed ones', () => {
  const bad = commit('old.txt', `host ${ip('10', '9', '9', '9')}\n`);
  const fixed = commit('old.txt', 'host redacted\n', 'Remove host');
  const result = spawnSync(process.execPath, [SCRIPT, '--base', bad, '--head', fixed], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0);
});

test('lines the base branch changed after the fork are not blamed on the head', () => {
  const trunk = git('rev-parse', '--abbrev-ref', 'HEAD');
  commit('shared.txt', `host ${ip('10', '7', '7', '7')}\n`, 'Old leak on base');
  git('checkout', '-q', '-b', 'topic');
  const head = commit('topic.txt', 'fine\n', 'Topic work');
  git('checkout', '-q', trunk);
  const baseTip = commit('shared.txt', 'host redacted\n', 'Base removes the leak');
  const result = spawnSync(process.execPath, [SCRIPT, '--base', baseTip, '--head', head], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('flags a leak in a commit message', () => {
  const head = commit('msg.txt', 'fine\n', `Deploy to ${ip('192', '168', '4', '4')}`);
  const { code, out } = run(head);
  assert.equal(code, 1);
  assert.match(out, new RegExp(`commit ${head.slice(0, 7)} message`));
  assert.ok(!out.includes(ip('192', '168', '4', '4')));
});

test('PUBLIC_TEXT_PRIVATE_TERMS flags terms case-insensitively; unset skips', () => {
  const head = commit('terms.txt', 'the Secret-Box host\n');
  assert.equal(run(head).code, 0);
  const { code, out } = run(head, { PUBLIC_TEXT_PRIVATE_TERMS: 'other\n\nsecret-box\n' });
  assert.equal(code, 1);
  assert.match(out, /private term/);
  assert.ok(!/secret-box/i.test(out.replace('private term', '')));
});

test('usage and git errors exit 2', () => {
  assert.equal(spawnSync(process.execPath, [SCRIPT], { cwd: repo }).status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--base', '--head', 'x'], { cwd: repo }).status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--base', 'nope', '--head', 'HEAD'], { cwd: repo }).status, 2);
});
