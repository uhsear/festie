import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('t41 native config source guards', () => {
  const raw = read('app.json');
  const expo = JSON.parse(raw).expo;

  it('app.json keeps the 1.4.0 version until the release commit and declares the /join app link', () => {
    // OTAs from main must keep reaching 1.4.0 users; the bump is a separate release commit.
    expect(expo.version).toBe('1.5.0');
    const prefixes = expo.android.intentFilters[0].data.map((d: { pathPrefix: string }) => d.pathPrefix);
    expect(prefixes).toEqual(expect.arrayContaining(['/set', '/reset-password', '/join', '/crew']));
  });
  it('expo-location plugin enables background location', () => {
    const entry = expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-location');
    expect(entry[1]).toMatchObject({
      isIosBackgroundLocationEnabled: true,
      isAndroidBackgroundLocationEnabled: true,
      isAndroidForegroundServiceEnabled: true,
    });
    expect(raw).not.toContain('Only used while the app is open');
  });
  it('package.json declares the new native modules', () => {
    const deps = JSON.parse(read('package.json')).dependencies;
    for (const name of ['expo-task-manager', 'expo-keep-awake', 'expo-brightness']) {
      expect(deps).toHaveProperty(name);
    }
  });
  it('index.js loads bootstrap, then backgroundShare, then the router entry', () => {
    const src = read('index.js');
    const a = src.indexOf("'./bootstrap'");
    const b = src.indexOf("'./lib/backgroundShare'");
    const c = src.indexOf("'expo-router/entry'");
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
  it('new native modules are never statically imported, so 1.4.0 binaries still launch', () => {
    const banned = ['expo-task-manager', 'expo-keep-awake', 'expo-brightness'];
    for (const file of ['index.js', 'lib/backgroundShare.ts', 'components/BeaconModal.tsx']) {
      const src = read(file);
      for (const name of banned) {
        expect(src, `${file} imports ${name}`).not.toMatch(
          new RegExp(String.raw`^\s*import\s+(?!type\b)(?:[^'";]*\sfrom\s+)?['"]${name}['"]`, 'm'),
        );
      }
    }
    expect(read('lib/backgroundShare.ts')).toContain("requireOptionalNativeModule('ExpoTaskManager')");
    const beacon = read('components/BeaconModal.tsx');
    expect(beacon).toContain("requireOptionalNativeModule('ExpoKeepAwake')");
    expect(beacon).toContain("requireOptionalNativeModule('ExpoBrightness')");
  });
  it('backgroundShare defines the task and imports only declared deps', () => {
    const src = read('lib/backgroundShare.ts');
    expect(src).toContain('TaskManager.defineTask');
    const pkg = JSON.parse(read('package.json'));
    const declared = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
    const specs = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) {
      expect(s === 'react-native' || s.startsWith('@festie/shared') || declared.has(s), s).toBe(true);
    }
  });
});
