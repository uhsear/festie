import { describe, it, expect } from 'vitest';
import { colors } from '@festie/shared/tokens';
import { read } from '../__tests__/read-source';

describe('Now & Next widget source (DP-69)', () => {
  const src = read('widgets/NowNextActivity.ios.tsx');
  const hexes = [...src.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());

  it('mirrors only the live token, one copy per isolated widget function', () => {
    expect(new Set(hexes)).toEqual(new Set([colors.live.text.toLowerCase()]));
    expect(hexes).toHaveLength(2);
  });
  it('shows the live state with a shape and a word, not colour alone', () => {
    expect(src).toContain('circle.fill');
    expect(src).toContain('NOW');
  });
  it('uses native timers with tabular digits for the countdown', () => {
    expect(src).toContain('dateStyle="timer"');
    expect(src).toContain('monospacedDigit()');
  });
});
