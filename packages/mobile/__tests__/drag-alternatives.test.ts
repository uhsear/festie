// WCAG 2.5.7: every drag gesture keeps a single-pointer alternative.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = join(__dirname, '..');

// Files allowed to use Gesture.Pan(. Add a file here only with its button alternative.
const PAN_ALLOWED: string[] = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('mobile drag alternatives', () => {
  it('set sheet keeps a Close button', () => {
    const src = readFileSync(join(root, 'app/set/[setId].tsx'), 'utf8');
    expect(src).toContain('<CloseButton onPress={dismiss}');
  });

  it('no unlisted Gesture.Pan( usage', () => {
    const found = [...sourceFiles(join(root, 'app')), ...sourceFiles(join(root, 'components'))]
      .filter((f) => readFileSync(f, 'utf8').includes('Gesture.Pan('))
      .map((f) => relative(root, f).split(sep).join('/'));
    expect(found.sort()).toEqual([...PAN_ALLOWED].sort());
  });
});
