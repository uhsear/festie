import { describe, expect, it } from 'vitest';
import { compareToBaseline, mergeResults, serializeBaseline } from './a11y-baseline-lib.mjs';

describe('mergeResults', () => {
  it('merges per-story files and drops stories without violations', () => {
    expect(
      mergeResults([
        { id: 'a--one', counts: { 'color-contrast': 2 } },
        { id: 'a--two', counts: {} },
        { id: 'b--one', counts: { region: 0, 'link-name': 1 } },
      ]),
    ).toEqual({ 'a--one': { 'color-contrast': 2 }, 'b--one': { 'link-name': 1 } });
  });
});

describe('compareToBaseline', () => {
  const baseline = { version: 1, stories: { 'a--one': { 'color-contrast': 2 } } };

  it('passes at or below the baseline and reports improvements', () => {
    expect(compareToBaseline({ 'a--one': { 'color-contrast': 2 } }, baseline)).toEqual({
      regressions: [],
      improvements: [],
    });
    expect(compareToBaseline({}, baseline).improvements).toEqual([
      { story: 'a--one', rule: 'color-contrast', baseline: 2, current: 0 },
    ]);
  });

  it('fails when a count exceeds the baseline', () => {
    expect(compareToBaseline({ 'a--one': { 'color-contrast': 3 } }, baseline).regressions).toEqual([
      { story: 'a--one', rule: 'color-contrast', baseline: 2, current: 3 },
    ]);
  });

  it('allows zero for new stories and new rules', () => {
    const { regressions } = compareToBaseline(
      { 'new--story': { 'link-name': 1 }, 'a--one': { 'link-name': 1 } },
      baseline,
    );
    expect(regressions.map((r) => `${r.story}:${r.rule}`).sort()).toEqual([
      'a--one:link-name',
      'new--story:link-name',
    ]);
  });

  it('treats a missing baseline as all zeros', () => {
    expect(compareToBaseline({ s: { r: 1 } }, undefined).regressions).toHaveLength(1);
  });
});

describe('serializeBaseline', () => {
  it('sorts keys deterministically and ends with a newline', () => {
    const out = serializeBaseline({ b: { z: 1, a: 2 }, a: { r: 1 } });
    expect(Object.keys(JSON.parse(out).stories)).toEqual(['a', 'b']);
    expect(Object.keys(JSON.parse(out).stories.b)).toEqual(['a', 'z']);
    expect(out.endsWith('\n')).toBe(true);
  });
});
