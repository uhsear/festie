import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
const screen = read('app', 'picks-image.tsx');
const poster = read('components', 'ScheduleImagePoster.tsx');
const lockPoster = read('components', 'LockscreenPoster.tsx');
const grid = read('app', 'grid.tsx');
const picks = read('app', '(tabs)', 'picks.tsx');
const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> };

describe('T38 mobile Save image', () => {
  it('builds the model, captures on device, fetches the printable page and toasts failures', () => {
    expect(screen).toContain('buildScheduleImageModel');
    expect(screen).toContain('captureRef');
    expect(screen).toContain('fetchPrintableSchedule');
    expect(screen).toContain('showToast');
    expect(screen).not.toContain('Share.share(');
  });

  it('draws lock-screen wallpapers from the shared model, one captured image per save', () => {
    expect(screen).toContain('buildLockscreenModel');
    expect(screen).toContain('useLocalSearchParams');
    expect(screen).toContain('isMode(modeParam)');
    expect(screen).toContain('${verb} image ${visiblePage + 1} of ${pageCount}…');
    // Save captures the image on screen, then moves the pager to the next one.
    expect(screen).toContain("const page = shape === 'lockscreen' ? visiblePage : 0;");
    expect(screen).toContain('setPreviewPage(page + 1)');
    expect(lockPoster).toContain('allowFontScaling={false}');
  });

  it('loads crew picks, remembers look options and explains how to set the wallpaper', () => {
    expect(screen).toContain('useCrewOverlapStatus(');
    expect(screen).toContain('crewLoaded,');
    expect(screen).toContain("'Save without crew'");
    expect(screen).toContain("const OPTIONS_KEY = 'festie.lockscreen.options.v1';");
    // Mode and phone size are never stored.
    expect(screen).toContain('JSON.stringify({ theme, lockStyle, priorities, clock })');
    for (const text of [
      'Set it as your wallpaper',
      'Tap Share, then Use as Wallpaper.',
      'Choose Lock screen.',
      'Long-press the lock screen and tap +.',
      'You only need to redo this if set times change.',
      'How to set it as wallpaper',
      'Settings › Notifications › Display As › Count.',
      'Clock + widgets',
      'Preview only. The clock and buttons are not in your saved image.',
      'Fit on 1 image: hide ${maybeOnDay} Maybe',
      'Only sets still to come',
      'Times as of ${clockTime(fetchedAt)}',
      '(estimated)',
      'You have no picks yet.',
      'Show full lineup',
      'Showing ${shownPicks} of ${timedPicks} picks',
    ]) {
      expect(screen).toContain(text);
    }
  });

  it('stamps the image at tap time, records it for the out-of-date banner and keeps the overlay out of the capture', () => {
    expect(screen).toContain("const fresh = shape === 'lockscreen' ? lockFor(lockDay) : null;");
    expect(screen).toContain('recordSaved(fresh)');
    expect(screen).toContain('lockscreenSnapshot(');
    const capture = screen.slice(screen.indexOf('styles.offscreen'));
    expect(capture.slice(0, capture.indexOf('</ScrollView>'))).not.toContain('LockscreenOverlay');
    expect(picks).toContain('<LockscreenStaleBanner />');
  });

  it('never tells Android users to tap Save Image', () => {
    expect(screen).toContain("IOS ? 'Next: tap Save Image.' : 'Next: pick Photos or Files to keep it.'");
  });

  it('opens Full lineup from the schedule grid', () => {
    expect(grid).toContain("'/picks-image?mode=full'");
  });

  it('adds the Save image entry point to Picks', () => {
    expect(picks).toContain("'/picks-image'");
  });

  it('imports only declared mobile dependencies or @festie/shared', () => {
    const deps = new Set(Object.keys(pkg.dependencies ?? {}));
    for (const src of [screen, poster, lockPoster]) {
      const specs = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      for (const spec of specs) {
        if (spec.startsWith('.') || spec.startsWith('@festie/shared')) continue;
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
        expect(deps.has(name)).toBe(true);
      }
    }
  });
});
