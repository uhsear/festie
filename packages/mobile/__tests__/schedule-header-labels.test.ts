import { describe, it, expect } from 'vitest';
import { read } from './read-source';


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
