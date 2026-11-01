import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

// The toast host is components/Toaster.tsx. A second host would render every toast twice.
describe('t3 toast host source guards', () => {
  it('root layout mounts the Toaster once, after loading', () => {
    const src = read('app/_layout.tsx');
    expect(src.match(/<Toaster\s*\/>/g)).toHaveLength(1);
    expect(src).toContain('{!loading && <Toaster />}');
  });

  it('Toaster reads the shared toasts and dismisses them', () => {
    const src = read('components/Toaster.tsx');
    expect(src).toContain('s.toasts');
    expect(src).toContain('dismissToast');
  });

  it('Toaster uses amber for errors, dismisses on tap and offsets with useListBottomInset', () => {
    const src = read('components/Toaster.tsx');
    expect(src).toContain('error: t.colors.accent.amber');
    expect(src).not.toContain('coralStrong');
    expect(src).toContain('onPress={() => dismissToast(toast.id)}');
    expect(src).toContain('useListBottomInset(');
  });
});
