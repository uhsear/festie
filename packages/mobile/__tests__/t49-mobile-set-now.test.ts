// Source-level guards for the T49 mobile set sheet and Now & Next (no RN renderer in mobile vitest).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('T49 mobile set sheet and Now & Next', () => {
  it('the set sheet links to the stage on the map and the compass', () => {
    const src = read('app/set/[setId].tsx');
    for (const needle of ['stageCoord(', 'stageMapHref(', 'compassHref(', 'showStageOnMap']) {
      expect(src).toContain(needle);
    }
  });
  it('the set sheet button copy is Show stage on map', async () => {
    const { MAP_COPY } = await import('@festie/shared/utils');
    expect(MAP_COPY.showStageOnMap).toBe('Show stage on map');
  });
  it('useLastKnownFix never asks for permission', () => {
    const src = read('hooks/useLastKnownFix.ts');
    expect(src).toContain('getForegroundPermissionsAsync');
    expect(src).not.toContain('requestForegroundPermissionsAsync');
  });
  it('Now & Next shows the walk and turns the countdown coral when late', () => {
    const src = read('components/NowSurface.tsx');
    expect(src).toContain('walk.label');
    expect(src).toContain('walk?.late');
  });
  it('Now & Next names the walk after the countdown, as web does', () => {
    const src = read('components/NowSurface.tsx');
    expect(src).toContain('minute walk');
    expect(src).toContain('leave now');
    expect(src).toContain('${startsIn}${walkA11y}');
  });
});
