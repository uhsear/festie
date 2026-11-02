import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('P7b phase band and map shortcuts', () => {
  it('PhaseHomeActions reads the shared order and has no /find route', () => {
    const src = read('components/PhaseHomeActions.tsx');
    expect(src).toContain('PHASE_ACTION_ORDER');
    expect(src).not.toContain("'/find'");
  });
  it('Lineup shows the band after the festival and has no /find route', () => {
    const src = read('app/(tabs)/index.tsx');
    expect(src).toContain("phase === 'post'");
    expect(src).not.toContain("'/find'");
  });
  it('festival-mode has no /find route', () => {
    expect(read('app/festival-mode.tsx')).not.toContain("'/find'");
  });
  it('map links switch to the Map tab instead of pushing a second tab stack', () => {
    expect(read('components/PhaseHomeActions.tsx')).toContain("href: '/(tabs)/map'");
    for (const p of ['app/festival-mode.tsx', 'app/(tabs)/crew.tsx']) {
      expect(read(p)).not.toContain("router.push('/map')");
      expect(read(p)).toContain("router.navigate('/(tabs)/map')");
    }
  });
});
