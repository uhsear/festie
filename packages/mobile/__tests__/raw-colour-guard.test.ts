import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Ratchet: raw colour literals in mobile source may only shrink. Counts live in
// raw-colour-allowlist.json. A new literal or a higher count fails; a lower
// count fails too, so the allowlist is tightened in the same change.
const root = join(__dirname, '..');
const SCAN_DIRS = ['app', 'components', 'contexts', 'hooks', 'lib', 'store', 'widgets'];
// Token definitions, and fixed artwork that renders the same in both themes
// (the web T60 rule exempts ScheduleImagePoster for the same reason).
const EXEMPT = new Set(['hooks/useTokens.ts', 'components/ScheduleImagePoster.tsx']);
const SOURCE = /\.(tsx?|jsx?)$/;
const TEST_FILE = /\.test\.[tj]sx?$/;
const COLOUR =
  /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\(/g;

const walk = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (name === 'node_modules' || name.includes('.generated.')) return [];
    if (statSync(join(root, rel)).isDirectory()) return walk(rel);
    return SOURCE.test(name) && !TEST_FILE.test(name) ? [rel] : [];
  });

// shortcut: comment stripping is regex-based and ignores `//` inside strings that follow whitespace; upgrade to a tokenizer if that ever miscounts.
export const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

export const countColours = (src: string) => stripComments(src).match(COLOUR)?.length ?? 0;

const allowlist: Record<string, number> = JSON.parse(
  readFileSync(join(__dirname, 'raw-colour-allowlist.json'), 'utf8'),
);

describe('raw colour literal guard', () => {
  it('counts hex, rgb(), rgba() and hsl() literals outside comments', () => {
    expect(countColours("a: '#fff', b: '#12345678', c: 'rgba(0,0,0,.5)', d: hsl(1,2%,3%)")).toBe(4);
    expect(countColours("// #fff\n/* rgb(1,2,3) */ const x = 'https://a.b/#frag'; id: '#12'")).toBe(0);
  });

  it('allows no new or extra raw colours and no stale allowlist entries', () => {
    const actual: Record<string, number> = {};
    for (const file of SCAN_DIRS.flatMap(walk)) {
      if (EXEMPT.has(file)) continue;
      const n = countColours(readFileSync(join(root, file), 'utf8'));
      if (n > 0) actual[file] = n;
    }
    const grew: string[] = [];
    const shrank: string[] = [];
    for (const file of new Set([...Object.keys(actual), ...Object.keys(allowlist)])) {
      const have = actual[file] ?? 0;
      const allowed = allowlist[file] ?? 0;
      if (have > allowed) grew.push(`${file}: ${have} raw colours, allowed ${allowed}`);
      if (have < allowed) shrank.push(`${file}: ${have} raw colours, allowlist says ${allowed}`);
    }
    expect(
      grew,
      'Raw colour literal added. Use a token from @festie/shared/tokens (colors, colorsDaylight) via hooks/useTokens instead of a hex or rgb()/rgba()/hsl() value.',
    ).toEqual([]);
    expect(
      shrank,
      'Fewer raw colours than the allowlist. Lower the count (or delete the entry) in __tests__/raw-colour-allowlist.json to lock in the gain.',
    ).toEqual([]);
  });
});
