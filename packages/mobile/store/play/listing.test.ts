import { existsSync, readFileSync } from 'node:fs';
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
