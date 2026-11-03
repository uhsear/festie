import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const walk = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : /\.tsx?$/.test(n) ? [rel] : [];
  });

describe('T60 consistency', () => {
  it('friend-picks says Sign in and Create account', () => {
    const src = read('app/friend-picks.tsx');
    expect(src).not.toContain('"Log in"');
    expect(src).not.toContain('"Sign up"');
  });
  it('crew-plan uses the shared Wrap label', () => {
    expect(read('app/crew-plan.tsx')).toContain('COPY.wrap.open');
  });
  it('grid starts a festival load when a deep link lands before the catalogue', () => {
    expect(read('app/grid.tsx')).toMatch(/!currentFestival && festivals\.length === 0 && !isLoading && !error\)\s*\{\s*loadFestivals\(\)/);
  });
  it('only AppSwitch imports Switch from react-native', () => {
    const offenders = [...walk('app'), ...walk('components')].filter((f) => {
      if (f === 'components/AppSwitch.tsx') return false;
      return /import\s*\{[^}]*\bSwitch\b[^}]*\}\s*from\s*'react-native'/.test(read(f));
    });
    expect(offenders).toEqual([]);
  });
});
