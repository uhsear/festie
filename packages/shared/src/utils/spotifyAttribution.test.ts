import { describe, expect, it } from 'vitest';
import {
  isSpotifyImageUrl,
  showsSpotifyContent,
  SPOTIFY_HOME_URL,
  spotifyArtistPage,
  spotifyAttributionFor,
} from './spotifyAttribution';

const PAGE = 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb';

describe('spotifyAttribution', () => {
  it('recognizes Spotify image hosts and nothing else', () => {
    expect(isSpotifyImageUrl('https://i.scdn.co/image/abc')).toBe(true);
    expect(isSpotifyImageUrl('https://image-cdn-ak.spotifycdn.com/image/abc')).toBe(true);
    for (const other of ['https://art.festie.us/a.jpg', 'http://i.scdn.co/image/abc', 'https://evilscdn.co/x', 'https://scdn.co.evil.example/x', '', null, undefined, 'not a url']) {
      expect(isSpotifyImageUrl(other as string | null | undefined)).toBe(false);
    }
  });

  it('accepts only an https artist page as the link back', () => {
    expect(spotifyArtistPage({ links: { spotify: PAGE } })).toBe(PAGE);
    expect(spotifyArtistPage({ links: { spotify: 'https://open.spotify.com/intl-de/artist/4Z8W4fKeB5YxbusRsdQVPb' } })).not.toBeNull();
    expect(spotifyArtistPage({ links: { spotify: 'https://open.spotify.com/track/4Z8W4fKeB5YxbusRsdQVPb' } })).toBeNull();
    expect(spotifyArtistPage({ links: { spotify: 'javascript:alert(1)' } })).toBeNull();
    expect(spotifyArtistPage({})).toBeNull();
  });

  it('shows Spotify content for a Spotify photo, or for genres next to a Spotify link, not for a bare artist', () => {
    expect(showsSpotifyContent({ photo: 'https://i.scdn.co/image/abc' })).toBe(true);
    expect(showsSpotifyContent({ genres: ['house'], links: { spotify: PAGE } })).toBe(true);
    expect(showsSpotifyContent({ genres: ['house'] })).toBe(false);
    expect(showsSpotifyContent({ photo: 'https://art.festie.us/a.jpg', links: { spotify: PAGE } })).toBe(false);
    expect(showsSpotifyContent({})).toBe(false);
  });

  it('links back to the first artist page, falls back to Spotify home, and is null without Spotify content', () => {
    expect(spotifyAttributionFor(undefined)).toBeNull();
    expect(spotifyAttributionFor([{ name: 'A' }, { name: 'B', photo: 'https://art.festie.us/b.jpg' }])).toBeNull();
    expect(spotifyAttributionFor([{ name: 'A', photo: 'https://i.scdn.co/image/a' }])).toEqual({ href: SPOTIFY_HOME_URL });
    expect(
      spotifyAttributionFor([
        { name: 'A', photo: 'https://i.scdn.co/image/a' },
        { name: 'B', genres: ['techno'], links: { spotify: PAGE } },
      ]),
    ).toEqual({ href: PAGE });
  });
});
