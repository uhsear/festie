import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('T10 day-of large text', () => {
  it('compass empty state sits inside a ScrollView', () => {
    const src = read('app/compass.tsx');
    const scrolls = [...src.matchAll(/<ScrollView/g)];
    expect(scrolls).toHaveLength(2);
    expect(src.indexOf('<EmptyState')).toBeGreaterThan(scrolls[1]!.index!);
  });

  it('festival-mode name wraps and caps instead of shrinking', () => {
    const src = read('app/festival-mode.tsx');
    expect(src).not.toContain('minimumFontScale={0.7}');
    expect(src).toContain("typeScaleCap('title')");
    expect(src).toContain('useLargeText()');
  });
});
