import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const listing = JSON.parse(readFileSync(join(here, 'listing.en-US.json'), 'utf8')) as Record<'language' | 'title' | 'shortDescription' | 'fullDescription', string>;
// Mirrors LIMITS in publish.py: Play rejects a listing that exceeds them.
const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 } as const;

describe('Play store listing', () => {
  it.each(Object.entries(LIMITS) as [keyof typeof LIMITS, number][])('%s is non-empty and within %i characters', (field, limit) => {
    const value = listing[field];
    expect(value.trim().length).toBeGreaterThan(0);
    expect(value.length).toBeLessThanOrEqual(limit);
  });

  it('declares the en-US language the images directory is keyed on', () => {
    expect(listing.language).toBe('en-US');
    expect(existsSync(join(here, 'images', listing.language))).toBe(true);
  });

  it.each(['featureGraphic/featureGraphic.png', 'icon/icon.png'])(
    'ships image %s',
    (rel) => {
      expect(existsSync(join(here, 'images', 'en-US', rel))).toBe(true);
    },
  );
});

// Screenshot set checks (SV-04, SV-18). Play rules: PNG or JPEG, each side 320 to 3,840 px, the long side at most twice the short.
// The images are captured by hand on an emulator, so the checks run only once a set exists. screenshots.json records the capture.
const SHOT_DIRS = { phoneScreenshots: 'phone', sevenInchScreenshots: 'sevenInch', tenInchScreenshots: 'tenInch' } as const;
const MAX_SHOTS = 8;
const appVersion = (JSON.parse(readFileSync(join(here, '..', '..', 'app.json'), 'utf8')) as { expo: { version: string } }).expo.version;

function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('not a PNG');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function sizeProblem({ width, height }: { width: number; height: number }): string | null {
  const [short, long] = width < height ? [width, height] : [height, width];
  if (short < 320 || long > 3840) return `${width}x${height} is outside 320 to 3840 px`;
  if (long > short * 2) return `${width}x${height} is more than 2:1`;
  return null;
}

const shotFiles = (dir: string) => {
  const abs = join(here, 'images', 'en-US', dir);
  return existsSync(abs) ? readdirSync(abs).filter((f) => f.toLowerCase().endsWith('.png')).sort() : [];
};
const hasShots = Object.keys(SHOT_DIRS).some((d) => shotFiles(d).length > 0);

describe('Play screenshot checks', () => {
  it('reads PNG sizes and rejects sizes Play refuses', () => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(0x89504e47, 0);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(1080, 16);
    png.writeUInt32BE(1920, 20);
    expect(pngSize(png)).toEqual({ width: 1080, height: 1920 });
    expect(() => pngSize(Buffer.alloc(24))).toThrow('not a PNG');
    expect(sizeProblem({ width: 1080, height: 1920 })).toBeNull();
    expect(sizeProblem({ width: 300, height: 600 })).toMatch('outside');
    expect(sizeProblem({ width: 1080, height: 2400 })).toMatch('2:1');
  });

  describe.skipIf(!hasShots)('captured set', () => {
    const manifest = hasShots
      ? (JSON.parse(readFileSync(join(here, 'screenshots.json'), 'utf8')) as { appVersion: string } & Record<'phone' | 'sevenInch' | 'tenInch', string[]>)
      : null;

    it.each(Object.entries(SHOT_DIRS))('%s holds 2 to 8 numbered PNGs in the recorded order', (dir, key) => {
      const files = shotFiles(dir);
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(files.length).toBeLessThanOrEqual(MAX_SHOTS);
      files.forEach((f, i) => expect(f, 'files are numbered from 01 with no gap').toMatch(new RegExp(`^${String(i + 1).padStart(2, '0')}-[a-z0-9-]+\\.png$`)));
      expect(files).toEqual(manifest![key]);
      for (const f of files) {
        const size = pngSize(readFileSync(join(here, 'images', 'en-US', dir, f)));
        expect(sizeProblem(size), `${dir}/${f}`).toBeNull();
      }
    });

    it('records an app version no newer than app.json', () => {
      const parse = (v: string) => v.split('.').map(Number);
      const [rec, cur] = [parse(manifest!.appVersion), parse(appVersion)];
      expect(manifest!.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
      const diff = rec.findIndex((n, k) => n !== cur[k]);
      expect(diff === -1 || rec[diff]! < cur[diff]!).toBe(true);
    });
  });
});
