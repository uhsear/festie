import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) && !/\.(test|stories)\./.test(name) ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const offenders = (pattern: RegExp) => files.filter((f) => pattern.test(f.text)).map((f) => f.path.slice(SRC.length));

describe('colour roles (DP-28)', () => {
  it('keeps off-token hex values out of the web source', () => {
    expect(offenders(/19e3d3|2f80ff|ffaa00|6a6a88|08080f|18182c|0d0d1a/i)).toEqual([]);
  });

  it('puts the on-accent ink on aqua and amber fills, never the page ground', () => {
    expect(offenders(/text-bg-primary/)).toEqual([]);
  });
});
