import { describe, it, expect } from 'vitest';
import { defaultStageColor, resolveStageColor, STAGE_COLOR_FALLBACK } from './stageColor';

describe('resolveStageColor', () => {
  it('returns a real color unchanged', () => {
    expect(resolveStageColor('#ff3366', '#fallback')).toBe('#ff3366');
    expect(resolveStageColor('hsl(200 60% 50%)', '#fallback')).toBe('hsl(200 60% 50%)');
  });

  it('maps the neutral sentinel to the platform fallback', () => {
    expect(resolveStageColor(STAGE_COLOR_FALLBACK, 'var(--text-muted)')).toBe('var(--text-muted)');
    expect(resolveStageColor(STAGE_COLOR_FALLBACK, '#9999bb')).toBe('#9999bb');
  });

  it('maps nullish/empty to the fallback', () => {
    expect(resolveStageColor(undefined, '#fb')).toBe('#fb');
    expect(resolveStageColor(null, '#fb')).toBe('#fb');
    expect(resolveStageColor('', '#fb')).toBe('#fb');
  });

  it('the sentinel is not a CSS var (shared stays RN-safe)', () => {
    expect(STAGE_COLOR_FALLBACK.startsWith('var(')).toBe(false);
    expect(STAGE_COLOR_FALLBACK.startsWith('#')).toBe(false);
  });
});

describe('defaultStageColor', () => {
  it('gives each new stage the next palette colour, cycling, and never the danger colour', () => {
    const first = Array.from({ length: 8 }, (_, i) => defaultStageColor(i));
    expect(new Set(first.slice(0, 4)).size).toBe(4);
    expect(first.slice(4)).toEqual(first.slice(0, 4));
    expect(first).not.toContain('#ff3366');
  });
});
