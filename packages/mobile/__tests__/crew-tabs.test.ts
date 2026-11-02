import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('crew tabs share keys with @festie/shared', () => {
  it('CrewTabBar renders CREW_TABS', () => {
    expect(read('components/CrewTabBar.tsx')).toContain('CREW_TABS');
  });

  it('crew.tsx parses the tab param and links to the map', () => {
    const src = read('app/(tabs)/crew.tsx');
    expect(src).toContain('parseCrewTab(');
    expect(src).toContain('crew-action-map');
    expect(src).not.toContain('crew-action-find');
    expect(src).not.toContain("'/find'");
  });

  it('Open map row sits after SOS and before the status block', () => {
    const src = read('app/(tabs)/crew.tsx');
    const map = src.indexOf('crew-action-map');
    expect(map).toBeGreaterThan(src.indexOf('<CrewSos'));
    expect(map).toBeLessThan(src.indexOf('<CrewStatus'));
  });
});
