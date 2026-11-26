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

// A reanimated animation builder, as opposed to a variable holding one.
const BUILDER = /\b(?:Fade|Slide|Zoom|Bounce|Flip|Stretch|Rotate|Roll|Pinwheel|Lightspeed)\w*\.|LinearTransition\./;
// Structural gates that cover the next few lines: an early return or a ternary-selected props object.
const BLOCK_GATE = /if \(reduceMotion\)|=\s*reduceMotion\s*$/;
const GATE_WINDOW = 6;

/** Lines that attach a reanimated builder without a reduce-motion gate. */
function ungatedMotionLines(src: string): string[] {
  const lines = src.split('\n');
  return lines.filter((line, i) => {
    if (!MOTION_PROP.test(line) || !BUILDER.test(line)) return false;
    if (/reduceMotion\s*\?\s*undefined\s*:/.test(line)) return false;
    return !lines.slice(Math.max(0, i - GATE_WINDOW), i).some((prev) => BLOCK_GATE.test(prev));
  });
}

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
    expect(users).toContain('components/BrandWordmark.tsx');
    expect(users).not.toContain('app/(auth)/login.tsx');
  });

  it.each(users)('%s branches on useReduceMotion before attaching motion props', (rel) => {
    const src = readFileSync(join(root, rel), 'utf8');
    expect(src).toContain("useReduceMotion } from '");
    expect(ungatedMotionLines(src), rel).toEqual([]);
  });

  it('flags an entering prop that is not gated', () => {
    expect(ungatedMotionLines('<A entering={FadeIn.duration(1)} />')).toHaveLength(1);
    expect(ungatedMotionLines('<A entering={reduceMotion ? undefined : FadeIn.duration(1)} />')).toEqual([]);
    expect(ungatedMotionLines('if (reduceMotion) return x;\nreturn <A entering={FadeIn.duration(1)} />;')).toEqual([]);
  });

  it('Toaster attaches no entering/exiting animation under reduce motion', () => {
    const src = read('components/Toaster.tsx');
    expect(src).toContain('entering={reduceMotion ? undefined :');
    expect(src).toContain('exiting={reduceMotion ? undefined :');
  });
});
