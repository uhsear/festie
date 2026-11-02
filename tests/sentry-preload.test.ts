import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Dummy values: port 9 is discard, and nothing here opens a DB connection. loadConfig
// refuses its implicit localhost:5432 fallback in a test process, so pass one explicitly.
const DSN = 'http://public@127.0.0.1:9/1';
const DATABASE_URL = 'postgresql://festie@127.0.0.1:5999/festie_test';

function probe(nodeArgs: string[], extraEnv: Record<string, string> = {}): string[] {
  const out = execFileSync(process.execPath, [...nodeArgs, 'tests/fixtures/sentry-probe.mjs'], {
    cwd: root,
    env: { ...process.env, SENTRY_DSN: DSN, DATABASE_URL, ...extraEnv },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop()!);
}

describe('Sentry preload (dist/instrument.js)', () => {
  before(() => {
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
  });

  it('instruments express when loaded with --import before express', () => {
    assert.ok(probe(['--import', './dist/instrument.js']).includes('router'));
  });

  it('does not instrument express when Sentry initializes after express loaded', () => {
    assert.ok(!probe([], { PROBE_LATE_INIT: '1' }).includes('router'));
  });
});

describe('initSentry across two bundled copies', () => {
  it('calls Sentry.init once and the second copy adopts the client', async () => {
    process.env.DATABASE_URL ??= DATABASE_URL;
    const SentryNode = createRequire(import.meta.url)('@sentry/node');
    const realInit = SentryNode.init;
    let calls = 0;
    SentryNode.init = (...args: any[]) => { calls++; return realInit(...args); };
    try {
      const loadCopy = (name: string) => import(`../lib/sentry.js?copy=${name}`);
      const first = await loadCopy('instrument');
      const second = await loadCopy('server');
      first.initSentry({ dsn: DSN });
      const adopted = second.initSentry({ dsn: DSN });
      assert.equal(calls, 1);
      assert.equal(adopted, SentryNode);
      assert.equal(second.sentry.available, true);
    } finally {
      SentryNode.init = realInit;
    }
  });
});
