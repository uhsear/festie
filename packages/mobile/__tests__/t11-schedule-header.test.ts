import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t11 schedule header labels', () => {
  it('schedule tab makes the title the festival switcher and drops unlabelled icons', () => {
    const src = read('app/(tabs)/index.tsx');
    expect(src).toContain('onTitlePress={() => setPickingFestival(true)}');
    expect(src).not.toContain('name="swap-horizontal"');
    expect(src).not.toContain('name="navigate-circle-outline"');
  });
  it('ScreenHeader supports a pressable title and keeps DisplayWords', () => {
    const src = read('components/ScreenHeader.tsx');
    expect(src).toContain('onTitlePress');
    expect(src).toContain('<DisplayWords');
  });
});
