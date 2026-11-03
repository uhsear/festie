import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('T28 mobile SOS tools', () => {
  it('CrewCheckIn uses the shared hook and error helper, no raw fontSize', () => {
    const src = read('components/CrewCheckIn.tsx');
    expect(src).toContain('useCheckIn');
    expect(src).toContain('checkinErrorMessage');
    expect(src).toContain("from '@festie/shared/hooks'");
    expect(src).not.toMatch(/fontSize/);
  });

  it('CrewCheckIn takes its chips from the shared CHECKIN_DURATIONS, like web', () => {
    const src = read('components/CrewCheckIn.tsx');
    expect(src).toContain('CHECKIN_DURATIONS.map(');
    expect(src).not.toMatch(/\[15, 30, 60, 120\]/);
  });

  it('BeaconModal flashes via shared constant, honours reduce motion and Android back', () => {
    const src = read('components/BeaconModal.tsx');
    expect(src).toContain('BEACON_FLASH_MS');
    expect(src).toContain('useReduceMotion');
    expect(src).toContain('onRequestClose');
    const specs = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const spec of specs) {
      const ok =
        spec.startsWith('.') ||
        // T41: expo (native-module gate) plus type-only imports of the gated modules.
        ['react', 'react-native', '@expo/vector-icons', 'expo', 'expo-keep-awake', 'expo-brightness'].includes(spec) ||
        spec.startsWith('@festie/shared/');
      expect(ok, spec).toBe(true);
    }
  });

  it('CrewSos and SosBanner show who has seen the SOS', () => {
    expect(read('components/CrewSos.tsx')).toContain('sosSeenLabel(');
    expect(read('components/SosBanner.tsx')).toContain('sosSeenLabel(');
  });
});
