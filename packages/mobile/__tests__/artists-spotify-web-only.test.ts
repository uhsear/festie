import { describe, it, expect } from 'vitest';
import { read } from './read-source';


describe('mobile Artists screen has no Spotify picker', () => {
  const src = read('app/admin/festival-links.tsx');

  it('tells the editor to pick the artist on the web', () => {
    expect(src).toContain('Pick the artist on the web');
  });

  it('says "Merge on the web" and has no merge screen or merge call', () => {
    expect(src).toContain('Merge on the web');
    expect(src).not.toContain('mergeArtists');
    expect(src).not.toContain('ArtistMerge');
  });

  it('has no "Find missing links" button and calls no Spotify route', () => {
    expect(src).not.toContain('Find missing links');
    expect(src).not.toContain('runSpotifyBackfill');
    expect(src).not.toContain('findSpotifyCandidates');
    expect(src).not.toContain('pickSpotifyCandidates');
  });
});
