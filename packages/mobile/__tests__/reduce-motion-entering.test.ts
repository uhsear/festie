import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { read } from './read-source';

const root = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) return sourceFiles(rel);
    return /\.tsx$/.test(name) ? [rel] : [];
  });
}

// Reanimated entering/exiting/layout props, as JSX props or in a spread object.
const MOTION_PROP = /\b(entering|exiting)\s*[=:]\s*(?!undefined)|\blayout\s*[=:]\s*\{?LinearTransition/;

describe('reduce motion and reanimated entering animations', () => {
  it('the hook treats an unknown setting as reduce motion (content visible)', () => {
    const src = read('hooks/useReduceMotion.ts');
    expect(src).toContain('useState(known ?? true)');
    expect(src).not.toContain('useState(false)');
  });

  const users = [...sourceFiles('app'), ...sourceFiles('components')].filter((rel) =>
    MOTION_PROP.test(readFileSync(join(root, rel), 'utf8')),
  );

  it('finds the screens that use entering animations', () => {
    expect(users).toContain('app/(auth)/register.tsx');
    expect(users).toContain('app/(auth)/login.tsx');
  });

  it.each(users)('%s branches on useReduceMotion before attaching motion props', (rel) => {
    const src = readFileSync(join(root, rel), 'utf8');
    expect(src).toContain("useReduceMotion } from '");
    expect(src, rel).toMatch(/reduceMotion\s*\?|if \(reduceMotion\)/);
  });

  it('Toaster attaches no entering/exiting animation under reduce motion', () => {
    const src = read('components/Toaster.tsx');
    expect(src).toContain('entering={reduceMotion ? undefined :');
    expect(src).toContain('exiting={reduceMotion ? undefined :');
  });
});
