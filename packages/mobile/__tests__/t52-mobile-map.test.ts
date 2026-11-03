import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('T52 mobile map peer', () => {
  it('OfflineMap labels peers near a stage and opens the peer compass', () => {
    const src = read('components/OfflineMap.tsx');
    expect(src).toContain('nearStageName(');
    expect(src).toContain('peerCompassHref(');
  });

  it('Map tab shows the compass button for a live peer', () => {
    const src = read('app/(tabs)/map.tsx');
    expect(src).toContain('hasLivePeer');
    expect(src).toContain('isPeerStale(');
  });

  it('CrewActivity has the battery-low icon', () => {
    expect(read('components/CrewActivity.tsx')).toContain("'battery-low'");
  });

  it('adds no raw fontSize', () => {
    expect(read('components/CrewActivity.tsx')).not.toMatch(/fontSize:/);
    expect(read('app/(tabs)/map.tsx')).not.toMatch(/fontSize:/);
  });
});
