import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ci', 'check-docs.mjs');

const tmpDirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-docs-'));
  tmpDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

function run(root: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: e.stdout + e.stderr };
  }
}

const CONTRACT = '### `presence:update`\nPresence.\n';
const EMITTER = "export const go = (io) => io.to('r').emit('presence:update', {});\n";

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('check-docs', () => {
  test('clean tree passes', () => {
    const root = fixture({
      'ARCHITECTURE.md': 'See `lib/emitter.ts:1` and [the contract](docs/SOCKET_CONTRACT.md).\n',
      'docs/SOCKET_CONTRACT.md': CONTRACT,
      'docs/adrs/001-x.md': 'Uses `lib/` and `dist/server.js` (build output).\n',
      'lib/emitter.ts': EMITTER,
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('missing cited path fails with doc, line and path', () => {
    const root = fixture({
      'ARCHITECTURE.md': 'ok\n`lib/gone.ts` was removed.\n',
      'docs/SOCKET_CONTRACT.md': CONTRACT,
      'lib/emitter.ts': EMITTER,
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /ARCHITECTURE\.md:2 cites `lib\/gone\.ts`/);
  });

  test('missing path in an ADR and a broken markdown link both fail', () => {
    const root = fixture({
      'docs/SOCKET_CONTRACT.md': CONTRACT,
      'docs/adrs/002-y.md': 'See [spec](./missing.md) and `routes/nope.ts`.\n',
      'lib/emitter.ts': EMITTER,
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /cites `\.\/missing\.md`/);
    assert.match(out, /cites `routes\/nope\.ts`/);
  });

  test('urls, globs, placeholders, api routes, fenced code and prose are not citations', () => {
    const root = fixture({
      'ARCHITECTURE.md': [
        'Visit `https://festie.us/a/b.html`, `routes/*.ts`, `crew:<id>/x.json`, `/api/v1/crews/x`,',
        '`application/json`, `@festie/shared/` and `festie.us/x.html`.',
        '```',
        'cat lib/not-real.ts',
        '```',
        '',
      ].join('\n'),
      'docs/SOCKET_CONTRACT.md': CONTRACT,
      'lib/emitter.ts': EMITTER,
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('undocumented emitted event fails with its source location', () => {
    const root = fixture({
      'docs/SOCKET_CONTRACT.md': CONTRACT,
      'lib/emitter.ts': EMITTER,
      'routes/crews.ts': "io.to(`crew:${id}`).emit('crew:renamed', {});\nsocket.emit(\"crew:other\", 1);\n",
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /routes\/crews\.ts:1 emits `crew:renamed`/);
    assert.match(out, /routes\/crews\.ts:2 emits `crew:other`/);
  });

  test('emits in tests and comments are ignored', () => {
    const root = fixture({
      'docs/SOCKET_CONTRACT.md': CONTRACT,
      'lib/emitter.ts': `${EMITTER}// socket.emit('commented:out', 1)\n`,
      'lib/emitter.test.ts': "io.emit('test:only', 1);\n",
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('absent docs are skipped, not failed', () => {
    const root = fixture({ 'lib/emitter.ts': EMITTER });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /skipped docs\/SOCKET_CONTRACT\.md/);
  });
});
