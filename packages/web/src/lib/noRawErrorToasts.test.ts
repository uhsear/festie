import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard for design-system-10: user-facing errors go through toastError, never a raw e.message.
const SRC_ROOT = resolve(__dirname, '..');
const TOAST_CONTEXT = join('lib', 'toastContext.tsx');
const RAW_PATTERNS = [
  /toast\([^)]*\b(e|err|error)\.message/,
  /toast\(\s*(e|err|error) instanceof Error \? (e|err|error)\.message/,
];

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return collectSourceFiles(full);
    if (!/\.tsx?$/.test(name) || /\.(test|stories)\./.test(name)) return [];
    if (relative(SRC_ROOT, full) === TOAST_CONTEXT) return [];
    return [full];
  });
}

describe('no raw error toasts', () => {
  it('does not pass e.message straight to toast()', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (RAW_PATTERNS.some((re) => re.test(line))) {
            offenders.push(`${relative(SRC_ROOT, file).split(sep).join('/')}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders, 'Use toastError(err, fallback) instead of a raw error message').toEqual([]);
  });
});
