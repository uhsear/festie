import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const { fullDescription } = JSON.parse(readFileSync(join(here, 'listing.en-US.json'), 'utf8')) as { fullDescription: string };
const appJson = JSON.parse(readFileSync(join(here, '..', '..', 'app.json'), 'utf8')) as {
  expo: { plugins: (string | [string, Record<string, unknown>])[] };
};

describe('Play listing location claims', () => {
  it('does not claim sharing only runs while the app is open', () => {
    expect(fullDescription).not.toMatch(/only while the app is open/i);
  });

  it('ties background location to the opt-in and the chosen end time', () => {
    expect(fullDescription).toMatch(/background location/i);
    expect(fullDescription).toContain('only until the time you pick');
  });

  it('matches app.json, which still enables background location', () => {
    const entry = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location');
    const options = Array.isArray(entry) ? entry[1] : {};
    // If this turns false, the background-location sentence in the listing may be removable.
    expect(options.isAndroidBackgroundLocationEnabled).toBe(true);
  });
});
