// The boot overlay must hand off from the native splash without the mark moving, so its
// size and art are pinned to the expo-splash-screen config, and it speaks only real state.
import { BOOT_STATUS_DELAY_MS, bootStatusLine } from '../lib/bootStatus';
import { colors } from '@festie/shared/tokens';
import { read } from './read-source';

const overlay = read('components/BootOverlay.tsx');
const layout = read('app/_layout.tsx');
const appJson = JSON.parse(read('app.json'));
const splashPlugin = appJson.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];

describe('boot overlay handoff', () => {
  it('draws the mark at the native splash width, from the same art, centred', () => {
    expect(overlay).toContain(`SPLASH_MARK_SIZE = ${splashPlugin.imageWidth}`);
    expect(splashPlugin.resizeMode).toBe('contain');
    expect(splashPlugin.image).toBe('./assets/splash-icon.png');
    expect(overlay).toContain("require('../assets/splash-icon.png')");
    expect(overlay).toContain("justifyContent: 'center'");
  });

  it('paints the Stage token ground in every theme, not a literal, and fades out', () => {
    expect(overlay).toContain('t.colors.bg.primary');
    expect(overlay).toContain('const t = tokens');
    expect(overlay).not.toContain('MARK_DAYLIGHT');
    expect(overlay).not.toContain('useUIStore');
    expect(colors.bg.primary).toBe(splashPlugin.backgroundColor);
    expect(overlay).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(overlay).toContain('FadeOut');
  });

  it('replaces the spinner in the root layout', () => {
    expect(layout).toContain('<BootOverlay');
    expect(layout).not.toContain('ActivityIndicator');
  });
});

describe('bootStatusLine', () => {
  it('waits 1.5 s before showing a line', () => {
    expect(BOOT_STATUS_DELAY_MS).toBe(1500);
  });
  it('names the saved plan when offline, whatever else is pending', () => {
    expect(bootStatusLine({ offline: true, hydrated: false })).toBe('Opening your saved plan');
    expect(bootStatusLine({ offline: true, hydrated: true })).toBe('Opening your saved plan');
  });
  it('separates the store restore from the generic wait when online', () => {
    expect(bootStatusLine({ offline: false, hydrated: false })).toBe('Restoring your saved data');
    expect(bootStatusLine({ offline: false, hydrated: true })).toBe('Getting Festie ready');
  });
});

describe('splash handoff', () => {
  it('lifts the native splash from the overlay layout', () => {
    expect(overlay).toContain('onLayout={() => setLaidOut(true)}');
    expect(overlay).toContain('if (laidOut) SplashScreen.hideAsync()');
  });
});
