import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('mobile Artists screen has no Spotify picker', () => {
  const src = read('app/admin/festival-links.tsx');

  it('tells the editor to pick the artist on the web', () => {
    expect(src).toContain('Pick the artist on the web');
  });

  it('has no "Find missing links" button and calls no Spotify route', () => {
    expect(src).not.toContain('Find missing links');
    expect(src).not.toContain('runSpotifyBackfill');
    expect(src).not.toContain('findSpotifyCandidates');
    expect(src).not.toContain('pickSpotifyCandidates');
  });
});
