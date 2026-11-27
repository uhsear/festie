import { describe, expect, it } from 'vitest';
import { read } from './read-source';

describe('crew horizontal rows fit or hint that they scroll', () => {
  it('CrewTabBar shares the fit-or-fade pattern: tight tabs that grow, EndFade when they overflow', () => {
    const src = read('components/CrewTabBar.tsx');
    expect(src).toContain('useScrollMore()');
    expect(src).toContain('<EndFade visible={more}');
    expect(src).toMatch(/tab: \{\s*flexGrow: 1,/);
  });

  it('CrewFacesRow gaps leave four 80dp faces inside a 361dp row and fade when more exist', () => {
    const src = read('components/crew/CrewFacesRow.tsx');
    expect(src).toContain('row: { gap: t.spacing[2] }');
    expect(src).toContain('width: 80');
    expect(src).toContain('<EndFade visible={more}');
  });

  it('EndFade draws from tokens only and never intercepts touches', () => {
    const src = read('components/EndFade.tsx');
    expect(src).toContain('pointerEvents="none"');
    expect(src).toContain('t.colors.bg.primary');
  });
});
