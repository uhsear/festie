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
    expect(screen).toContain('Save image ${savedPages + 1} of ${pageCount}');
    expect(screen).toContain('pages: page + 1 >= pageCount ? 0 : page + 1');
    expect(lockPoster).toContain('allowFontScaling={false}');
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
