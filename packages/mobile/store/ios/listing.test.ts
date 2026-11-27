import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
type Listing = Record<'language' | 'name' | 'subtitle' | 'promotionalText' | 'description' | 'keywords' | 'supportUrl' | 'marketingUrl' | 'privacyUrl', string>;
const listing = JSON.parse(read('listing.en-US.json')) as Listing;
// App Store Connect limits, in characters.
const LIMITS = { name: 30, subtitle: 30, promotionalText: 170, description: 4000, keywords: 100 } as const;

describe('App Store listing', () => {
  it.each(Object.entries(LIMITS) as [keyof typeof LIMITS, number][])('%s is non-empty and within %i characters', (field, limit) => {
    expect(listing[field].trim().length).toBeGreaterThan(0);
    expect(listing[field].length).toBeLessThanOrEqual(limit);
  });

  it('declares en-US and shares the Play app name', () => {
    expect(listing.language).toBe('en-US');
    expect(listing.name).toBe((JSON.parse(read('../play/listing.en-US.json')) as { title: string }).title);
  });

  it('keeps keywords comma-separated with no spaces around commas and no repeats', () => {
    expect(listing.keywords).not.toMatch(/\s,|,\s/);
    const words = listing.keywords.toLowerCase().split(',');
    expect(new Set(words).size).toBe(words.length);
    expect(words.every(Boolean)).toBe(true);
  });

  it('does not repeat the app name in the subtitle or keywords', () => {
    expect(listing.subtitle.toLowerCase()).not.toContain(listing.name.toLowerCase());
    expect(listing.keywords.toLowerCase().split(',')).not.toContain(listing.name.toLowerCase());
  });

  it.each(['supportUrl', 'marketingUrl', 'privacyUrl'] as const)('%s is an https URL', (field) => {
    expect(new URL(listing[field]).protocol).toBe('https:');
  });

  it('keeps the background-location sentence the Play listing carries', () => {
    expect(listing.description).toMatch(/background location/i);
    expect(listing.description).toContain('only until the time you pick');
  });
});
