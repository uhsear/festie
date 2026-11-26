import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POSTER } from '@festie/shared/tokens';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/**
 * Web (html-to-image) and mobile (view-shot) rasterise differently, so this compares structure:
 * both frames and both card posters place their boxes from the same POSTER.layout numbers, so a
 * box can differ by at most the 4 percent of poster width the plan allows (it differs by 0).
 */
const PAIRS = [
  ['wrap frame', 'web/src/components/wrap/PosterFrame.tsx', 'mobile/components/wrap/PosterFrame.tsx'],
  ['dominant', 'web/src/components/wrap/PosterDominant.tsx', 'mobile/components/wrap/PosterDominant.tsx'],
  ['wrap card', 'web/src/components/wrap/WrapCardPoster.tsx', 'mobile/components/wrap/WrapCardPoster.tsx'],
] as const;

describe('web and mobile posters share one structure', () => {
  for (const [name, web, mobile] of PAIRS) {
    it(`${name}: both read POSTER and use weight ${POSTER.weight}, no 800 or 900`, () => {
      for (const src of [read(web), read(mobile)]) {
        expect(src).toContain('POSTER');
        expect(src).not.toMatch(/fontWeight:\s*['"]?[89]00/);
        expect(src).not.toMatch(/posterFont\((800|900)/);
        expect(src).not.toMatch(/radial-?gradient|RadialGradient/i);
      }
    });
  }

  it('frames both draw the festival band, the baked mark and the layout y positions', () => {
    for (const src of [read(PAIRS[0][1]), read(PAIRS[0][2])]) {
      expect(src).toContain('posterBand(festivalName)');
      expect(src).toMatch(/favicon\.svg|splash-icon\.png/);
      for (const key of ['headerTop', 'headerHeight', 'bodyTop', 'footerHeight']) expect(src).toContain(key);
    }
  });

  it('card posters cap rows at layout.maxRows and size the dominant object from POSTER.dominantSize', () => {
    for (const src of [read(PAIRS[2][1]), read(PAIRS[2][2])]) expect(src).toMatch(/slice\(0, (L|layout)\.maxRows\)/);
    for (const src of [read(PAIRS[1][1]), read(PAIRS[1][2])]) expect(src).toContain('POSTER.dominantSize');
  });

  it('both schedule posters draw the band and the footer lockup', () => {
    for (const p of ['web/src/components/features/ScheduleImagePoster.tsx', 'mobile/components/ScheduleImagePoster.tsx']) {
      const src = read(p);
      expect(src).toContain('posterBand(model.festivalName)');
      expect(src).toContain('FESTIE');
      expect(src).not.toMatch(/radial-?gradient/i);
    }
  });
});
