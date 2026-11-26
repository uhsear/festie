import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TARGETS, check, loadAllowlist } from './design-ratchet.mjs';

function fakeRepo(name, files) {
  const repo = mkdtempSync(join(tmpdir(), 'ratchet-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(repo, TARGETS[name].dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return repo;
}

const CASES = {
  web: [
    ['hex', 'src/a.tsx', 'const c = "#ff00aa";'],
    ['rgb', 'src/a.tsx', 'const c = "rgba(1,2,3,.5)";'],
    ['text-px', 'src/a.tsx', 'const c = "text-[11px]";'],
    ['duration', 'src/a.tsx', 'const c = "duration-300";'],
    ['ease', 'src/a.tsx', 'const c = "ease-[ease]";'],
    ['hex', 'src/a.css', '.a { color: #fff; }'],
  ],
  mobile: [
    ['hex', 'components/A.tsx', 'const c = "#ff00aa";'],
    ['fontSize', 'components/A.tsx', 'const s = { fontSize: 14 };'],
    ['fontFamily', 'components/A.tsx', 'const s = { fontFamily: "X" };'],
    ['ionicons-size', 'components/A.tsx', 'const e = <Ionicons name="x" size={20} />;'],
    ['duration-ms', 'components/A.tsx', 'withTiming(1, { duration: 200 });'],
    ['animated-true', 'components/A.tsx', 'ref.scrollTo({ y: 0, animated: true });'],
  ],
};

for (const [name, cases] of Object.entries(CASES)) {
  for (const [rule, file, body] of cases) {
    test(`${name}: a new ${rule} offender in ${file} fails`, () => {
      const repo = fakeRepo(name, { [file]: body });
      try {
        const problems = check(name, repo, { entries: [] });
        assert.ok(problems.some((p) => p.startsWith(`${file}|${rule}:`)), problems.join('\n'));
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });
  }

  test(`${name}: a count above the allowlist max fails, a count at the max passes`, () => {
    const [rule, file, body] = cases[0];
    const repo = fakeRepo(name, { [file]: `${body}\n${body}` });
    try {
      const entry = (max) => ({ entries: [{ file, rule, max, reason: 'test' }] });
      assert.equal(check(name, repo, entry(2)).length, 0);
      assert.equal(check(name, repo, entry(1)).length, 1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test(`${name}: an entry without a reason fails`, () => {
    const repo = fakeRepo(name, { [cases[0][1]]: 'export {};' });
    try {
      for (const reason of [undefined, '', '  ']) {
        const problems = check(name, repo, { entries: [{ file: 'x.ts', rule: Object.keys(TARGETS[name].rules)[0], max: 1, reason }] });
        assert.ok(problems.some((p) => p.includes('no reason')));
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test(`${name}: the committed allowlist holds and every entry has a reason`, () => {
    assert.deepEqual(check(name), []);
    for (const e of loadAllowlist(name).entries) assert.ok(e.reason?.trim(), `${e.file}|${e.rule}`);
  });
}

test('mobile: token source and posters are exempt from raw values', () => {
  const repo = fakeRepo('mobile', {
    'hooks/useTokens.ts': 'const c = "#ff00aa"; const s = { fontSize: 1 };',
    'components/wrap/WrapCardPoster.tsx': 'const s = { fontFamily: "X" };',
  });
  try {
    assert.deepEqual(check('mobile', repo, { entries: [] }), []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('HTML entities and test files are not offenders', () => {
  const repo = fakeRepo('web', { 'src/a.tsx': 'const c = "&#8212;";', 'src/a.test.tsx': 'const c = "#ff00aa";' });
  try {
    assert.deepEqual(check('web', repo, { entries: [] }), []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
