import { describe, expect, it } from 'vitest';
import { read } from './read-source';

describe('crew horizontal rows fit or hint that they scroll', () => {
  it('CrewTabBar shares the fit-or-fade pattern: tight tabs that grow, EndFade when they overflow', () => {
    const src = read('components/CrewTabBar.tsx');
    expect(src).toContain('useScrollMore()');
    expect(src).toContain('<EndFade visible={more}');
    expect(src).toMatch(/tab: \{\s*flexGrow: 1,/);
  });

  it('EndFade draws from tokens only and never intercepts touches', () => {
    const src = read('components/EndFade.tsx');
    expect(src).toContain('pointerEvents="none"');
    expect(src).toContain('t.colors.bg.primary');
  });
});
