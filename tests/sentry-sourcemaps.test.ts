import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

// @ts-expect-error plain .mjs script with no type declarations
import { uploadSourceMaps } from '../scripts/ci/sentry-sourcemaps.mjs';

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sourcemaps-'));
  roots.push(root);
  for (const dir of ['dist', path.join('packages', 'web', 'dist', 'assets')]) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  writeFileSync(path.join(root, 'dist', 'server.js'), '');
  writeFileSync(path.join(root, 'dist', 'server.js.map'), '{}');
  writeFileSync(path.join(root, 'packages', 'web', 'dist', 'assets', 'index-a.js'), '');
  writeFileSync(path.join(root, 'packages', 'web', 'dist', 'assets', 'index-a.js.map'), '{}');
  return root;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const ENV = { SENTRY_AUTH_TOKEN: 'tok-secret', SENTRY_ORG: 'org', SENTRY_PROJECT: 'proj', SENTRY_RELEASE: 'abc123' };

describe('sentry-sourcemaps', () => {
  it('does nothing without SENTRY_AUTH_TOKEN', () => {
    const root = fixture();
    const calls: string[][] = [];
    const logs: string[] = [];
    const code = uploadSourceMaps({ env: {}, root, run: (a: string[]) => calls.push(a), log: (m: string) => logs.push(m) });
    assert.equal(code, 0);
    assert.equal(calls.length, 0);
    assert.match(logs.join(' '), /skipped/);
    assert.ok(existsSync(path.join(root, 'dist', 'server.js.map')));
  });

  it('injects then uploads each bundle, and removes only the web maps', () => {
    const root = fixture();
    const calls: string[][] = [];
    const logs: string[] = [];
    const code = uploadSourceMaps({ env: ENV, root, run: (a: string[]) => calls.push(a), log: (m: string) => logs.push(m) });
    assert.equal(code, 0);
    assert.deepEqual(
      calls.map((c) => c.slice(0, 2).join(' ')),
      ['sourcemaps inject', 'sourcemaps upload', 'sourcemaps inject', 'sourcemaps upload'],
    );
    assert.ok(calls[1]?.includes('abc123'));
    assert.ok(existsSync(path.join(root, 'dist', 'server.js.map')));
    const webAssets = readdirSync(path.join(root, 'packages', 'web', 'dist', 'assets'));
    assert.equal(webAssets.filter((f) => f.endsWith('.map')).length, 0);
    assert.ok(!logs.join('\n').includes('tok-secret'));
  });

  it('still removes the web maps when the upload fails', () => {
    const root = fixture();
    const code = uploadSourceMaps({
      env: ENV,
      root,
      log: () => {},
      run: () => {
        throw new Error('network down');
      },
    });
    assert.equal(code, 1);
    assert.ok(!existsSync(path.join(root, 'packages', 'web', 'dist', 'assets', 'index-a.js.map')));
  });

  it('fails when the org or project is missing, and still removes the web maps', () => {
    const root = fixture();
    const calls: string[][] = [];
    const code = uploadSourceMaps({ env: { SENTRY_AUTH_TOKEN: 'x' }, root, run: (a: string[]) => calls.push(a), log: () => {} });
    assert.equal(code, 1);
    assert.equal(calls.length, 0);
    assert.ok(!existsSync(path.join(root, 'packages', 'web', 'dist', 'assets', 'index-a.js.map')));
    assert.ok(existsSync(path.join(root, 'dist', 'server.js.map')));
  });

  it('removes the web maps when the git sha lookup throws', () => {
    const root = fixture();
    const env = { SENTRY_AUTH_TOKEN: 'x', SENTRY_ORG: 'org', SENTRY_PROJECT: 'proj' };
    assert.throws(() => uploadSourceMaps({ env, root, run: () => {}, log: () => {} }));
    assert.ok(!existsSync(path.join(root, 'packages', 'web', 'dist', 'assets', 'index-a.js.map')));
  });
});
