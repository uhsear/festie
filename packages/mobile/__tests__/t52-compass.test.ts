import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

const FILES = ['app/compass.tsx', 'components/MeetingPointCompass.tsx', 'components/PeerNudge.tsx'];
const ALLOWED = [
  'react',
  'react-native',
  'expo-router',
  'expo-location',
  '@expo/vector-icons',
];

describe('T52 mobile compass points at people', () => {
  it('compass.tsx uses the shared targets, staleness check, clock and nudge', () => {
    const src = read('app/compass.tsx');
    expect(src).toContain('compassTargets(');
    expect(src).toContain('isPeerStale(');
    expect(src).toContain('useNow(');
    expect(src).toContain('PeerNudge');
    expect(src).not.toContain('pickActiveWithCoords');
  });

  it('bare /compass with only a live peer treats that peer as the ?peer= target', () => {
    const src = read('app/compass.tsx');
    expect(src).toMatch(/targets\[0\]\?\.kind === 'peer' \? targets\[0\]\.id/);
    expect(src).toContain('const peerId = peerParam ?? fallbackPeerId');
    expect(src).toContain('router.setParams({ peer: fallbackPeerId })');
  });

  it('a peer missing from crewMembers is not named Someone', () => {
    const src = read('app/compass.tsx');
    expect(src).toContain("member ? crewMemberName(member) : ''");
  });

  it('MeetingPointCompass uses buildPursuit and does not restart watchers on target moves', () => {
    const src = read('components/MeetingPointCompass.tsx');
    expect(src).toContain('buildPursuit(');
    expect(src).not.toMatch(/import[^;]*\betaMinutes\b/);
    const deps = src.match(/\}, \[([^\]]*\bretry\b[^\]]*)\]\)/);
    expect(deps?.[1]).toBeDefined();
    expect(deps![1]).not.toContain('targetCoord');
  });

  it('PeerNudge uses the shared hook and a polite live region', () => {
    const src = read('components/PeerNudge.tsx');
    expect(src).toContain('useNudge(');
    expect(src).toContain('accessibilityLiveRegion');
  });

  it('imports stay relative, declared mobile deps, or @festie/shared', () => {
    for (const f of FILES) {
      const specs = [...read(f).matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const spec of specs) {
        const ok = spec.startsWith('.') || ALLOWED.includes(spec) || spec.startsWith('@festie/shared/');
        expect(ok, `${f}: ${spec}`).toBe(true);
      }
    }
  });

  it('uses no raw fontSize', () => {
    for (const f of FILES) {
      expect(read(f), f).not.toMatch(/fontSize:/);
    }
  });
});
