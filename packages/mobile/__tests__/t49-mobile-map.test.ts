// Source-level guards for the T49 mobile map (no RN renderer in mobile vitest).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const map = read('components/OfflineMap.tsx');
const card = read('components/MapPlaceCard.tsx');

/** Every string and template literal, after comments are dropped (a URL's `//` is kept). */
function stringLiterals(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
}

describe('T49 mobile map', () => {
  it('uses the shared Nearest flow, place card and honest location', () => {
    expect(map).toContain('nearestStep(');
    expect(map).toContain('MapPlaceCard');
    expect(map).toContain("'place-select'");
    expect(map).toContain('retryLocation');
  });

  it('draws a downloaded basemap in the current theme', () => {
    expect(map).toContain('pmtilesVectorStyle(localBasemapUri, basemapAttribution, theme)');
  });

  it('never says "pursue" in copy or accessible names', () => {
    const pursue = /[Pp]ursu(e|ing) /;
    expect(stringLiterals(map).filter((s) => pursue.test(s))).toEqual([]);
    const labels = [...map.matchAll(/accessibilityLabel=(\{[^}]*\}|"[^"]*")/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(0);
    // The word, not identifiers such as `pursuit`, `pursueIsSos` or 'pursue-select'.
    expect(labels.filter((s) => /[Pp]ursu(e|ing)\b(?!-)/.test(s!))).toEqual([]);
  });

  it('place card shares the place and caps its text size', () => {
    expect(card).toContain('placeShareText(');
    expect(card).toContain('maxFontSizeMultiplier');
  });
});
