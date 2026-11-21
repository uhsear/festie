import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { read } from './read-source';

// Spotify Developer Policy II.4: Spotify photos and genres carry the Spotify logo and a link back.
describe('Spotify attribution on mobile', () => {
  const component = read('components/SpotifyAttribution.tsx');

  it('ships the official full logo, white and black, as unmodified PNGs', () => {
    for (const name of ['Spotify_Full_Logo_RGB_White.png', 'Spotify_Full_Logo_RGB_Black.png']) {
      const file = join(__dirname, '..', 'assets', 'spotify', name);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file).subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(component).toContain(name);
    }
  });

  it('links to the artist page through Linking, labels it "Listen on Spotify" and never draws on top of artwork', () => {
    expect(component).toContain('Linking.openURL');
    expect(component).toContain('SPOTIFY_LISTEN_LABEL');
    expect(component).toContain('SPOTIFY_MIN_LOGO_WIDTH_PX');
    expect(component).toContain("accessibilityRole=\"link\"");
    expect(component).not.toMatch(/position:\s*'absolute'/);
  });

  it('is shown on the set screen and in the announced-act sheet, driven by the shared rules', () => {
    for (const file of ['app/set/[setId].tsx', 'components/AnnouncedLineup.tsx']) {
      const source = read(file);
      expect(source).toContain('spotifyAttributionFor');
      expect(source).toContain('<SpotifyAttribution');
    }
  });
});
