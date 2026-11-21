import type { Artist } from '../types/domain';

/**
 * Spotify attribution (Spotify Developer Policy II.4, Design Guidelines "Attribution"). Wherever an
 * artist photo or genres that came from Spotify show, the screen shows the Spotify logo and a link
 * back to the artist's Spotify page. Web and mobile share these rules; each draws its own logo.
 */

/** The link text Spotify allows when the Spotify app may be installed. */
export const SPOTIFY_LISTEN_LABEL = 'Listen on Spotify';
/** Where the logo links when the artist has no Spotify page of its own. */
export const SPOTIFY_HOME_URL = 'https://open.spotify.com/';
/** Smallest sizes the Design Guidelines allow, in CSS pixels: the icon alone, and the full logo's width. */
export const SPOTIFY_MIN_ICON_PX = 21;
export const SPOTIFY_MIN_LOGO_WIDTH_PX = 70;

const SPOTIFY_IMAGE_HOST = /(^|\.)(scdn\.co|spotifycdn\.com)$/i;
const SPOTIFY_ARTIST_PAGE = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/[A-Za-z0-9]+/;

/** True for an image on one of Spotify's image hosts (the artist photos Festie stores come from there). */
export function isSpotifyImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && SPOTIFY_IMAGE_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** The artist's Spotify page, or null. Only an https artist page counts. */
export function spotifyArtistPage(artist: Pick<Artist, 'links'>): string | null {
  const url = artist.links?.spotify;
  return url && SPOTIFY_ARTIST_PAGE.test(url) ? url : null;
}

/** Does this artist show Spotify content: a photo from Spotify's image host, or genres next to a Spotify link? */
export function showsSpotifyContent(artist: Pick<Artist, 'photo' | 'genres' | 'links'>): boolean {
  return isSpotifyImageUrl(artist.photo) || (Boolean(artist.genres?.length) && spotifyArtistPage(artist) !== null);
}

/**
 * The attribution a group of artists needs: null when none of them shows Spotify content, else the link
 * back, which is the first such artist's Spotify page (or Spotify's home page when it has none).
 */
export function spotifyAttributionFor(artists: ReadonlyArray<Artist> | undefined): { href: string } | null {
  const shown = (artists ?? []).filter(showsSpotifyContent);
  if (shown.length === 0) return null;
  for (const artist of shown) {
    const page = spotifyArtistPage(artist);
    if (page) return { href: page };
  }
  return { href: SPOTIFY_HOME_URL };
}
