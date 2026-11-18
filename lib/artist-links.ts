// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Per-platform rules for artist links: which platform a URL belongs to and its canonical form.
 * Backend only. No client copy: a client sends the raw link and shows the server's message.
 * Callers: the artist backfill, and later the artist routes, organizer festival saves and import
 * link columns. A festival save by an admin never rejects a link with these rules.
 * Platforms are the keys of ALLOWED_LINK_PLATFORMS. youtube and apple_music arrive with that list.
 */

import { ALLOWED_LINK_PLATFORMS } from './constants';

export type ArtistLinkPlatform = (typeof ALLOWED_LINK_PLATFORMS)[number];

export type ArtistLinkResult = { ok: true; url: string; spotifyId?: string } | { ok: false; message: string };

export const MAX_ARTIST_LINK_LENGTH = 500;

const LABELS: Record<ArtistLinkPlatform, string> = {
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  instagram: 'Instagram',
  twitter: 'X',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  website: 'Website',
};

const HOST_PLATFORM: Record<string, ArtistLinkPlatform> = {
  'open.spotify.com': 'spotify',
  'soundcloud.com': 'soundcloud',
  'on.soundcloud.com': 'soundcloud',
  'instagram.com': 'instagram',
  'twitter.com': 'twitter',
  'x.com': 'twitter',
  'tiktok.com': 'tiktok',
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
};

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_URI = /^spotify:artist:([A-Za-z0-9]{22})$/;
const TRACKING_PARAMS = new Set(['si', 'igshid', 'fbclid']);

const fail = (message: string): ArtistLinkResult => ({ ok: false, message });

/** The host without a leading "www." or "m.". */
function canonicalHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^(?:www|m)\./, '');
}

/** The platform whose host the link points to, or null for an unknown host or an unreadable link. */
export function detectPlatform(url: string): ArtistLinkPlatform | null {
  const raw = String(url ?? '').trim();
  if (SPOTIFY_URI.test(raw)) return 'spotify';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const platform = HOST_PLATFORM[canonicalHost(parsed.hostname)];
    return platform ?? null;
  } catch {
    return null;
  }
}

/** The path segments after removing the tracking parameters and the fragment. */
function segmentsOf(parsed: URL): string[] {
  return parsed.pathname.split('/').filter(Boolean);
}

function cleanQuery(parsed: URL): string {
  const kept = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key.toLowerCase())) continue;
    kept.append(key, value);
  }
  const text = kept.toString();
  return text ? `?${text}` : '';
}

const PROFILE_HINT = 'Copy the profile link.';

function normalizeSpotify(parsed: URL | null, raw: string): ArtistLinkResult {
  const uri = SPOTIFY_URI.exec(raw);
  if (uri) return { ok: true, url: `https://open.spotify.com/artist/${uri[1]}`, spotifyId: uri[1]! };
  if (!parsed || canonicalHost(parsed.hostname) !== 'open.spotify.com') return fail('This is not a Spotify link. Open the artist page on open.spotify.com and copy that link.');
  const segments = segmentsOf(parsed);
  if (segments[0] && /^intl-[a-z]{2}(?:-[a-z]+)?$/i.test(segments[0])) segments.shift();
  if (segments[0] === 'artist' && segments[1] && SPOTIFY_ID.test(segments[1]) && segments.length === 2) {
    return { ok: true, url: `https://open.spotify.com/artist/${segments[1]}`, spotifyId: segments[1] };
  }
  const kind = segments[0];
  if (kind && ['track', 'album', 'playlist', 'episode', 'show', 'user'].includes(kind)) {
    return fail(`This is a Spotify ${kind} link. Open the artist page and copy that link.`);
  }
  return fail('This is not a Spotify artist link. Open the artist page and copy that link.');
}

function normalizeSoundcloud(parsed: URL): ArtistLinkResult {
  const host = canonicalHost(parsed.hostname);
  const segments = segmentsOf(parsed);
  if (host !== 'soundcloud.com' && host !== 'on.soundcloud.com') return fail('This is not a SoundCloud link.');
  if (host === 'on.soundcloud.com' || segments.length !== 1) {
    return fail('Open the link and copy the full soundcloud.com address of the artist.');
  }
  return { ok: true, url: `https://soundcloud.com/${segments[0]}` };
}

function normalizeInstagram(parsed: URL): ArtistLinkResult {
  const segments = segmentsOf(parsed);
  if (canonicalHost(parsed.hostname) !== 'instagram.com') return fail('This is not an Instagram link.');
  if (['p', 'reel', 'reels', 'tv', 'stories', 'explore'].includes(segments[0] ?? '')) {
    return fail(`This is a post. ${PROFILE_HINT}`);
  }
  if (segments.length !== 1) return fail(`This is not a profile link. ${PROFILE_HINT}`);
  return { ok: true, url: `https://www.instagram.com/${segments[0]}` };
}

function normalizeTwitter(parsed: URL): ArtistLinkResult {
  const host = canonicalHost(parsed.hostname);
  const segments = segmentsOf(parsed);
  if (host !== 'twitter.com' && host !== 'x.com') return fail('This is not an X link.');
  if (segments[1] === 'status') return fail(`This is a post. ${PROFILE_HINT}`);
  if (segments.length !== 1 || ['i', 'home', 'search', 'explore', 'intent', 'share'].includes(segments[0]!)) {
    return fail(`This is not a profile link. ${PROFILE_HINT}`);
  }
  return { ok: true, url: `https://x.com/${segments[0]}` };
}

function normalizeTiktok(parsed: URL): ArtistLinkResult {
  const segments = segmentsOf(parsed);
  if (canonicalHost(parsed.hostname) !== 'tiktok.com') return fail('This is not a TikTok link.');
  if (segments[1] === 'video') return fail(`This is a video. ${PROFILE_HINT}`);
  if (segments.length !== 1 || !segments[0]!.startsWith('@')) return fail(`This is not a profile link. ${PROFILE_HINT}`);
  return { ok: true, url: `https://www.tiktok.com/${segments[0]}` };
}

function normalizeFacebook(parsed: URL): ArtistLinkResult {
  const host = canonicalHost(parsed.hostname);
  const segments = segmentsOf(parsed);
  if (host !== 'facebook.com' && host !== 'fb.com') return fail('This is not a Facebook link.');
  if (segments.length === 1 && segments[0] === 'profile.php') {
    const id = parsed.searchParams.get('id');
    if (id && /^\d+$/.test(id)) return { ok: true, url: `https://www.facebook.com/profile.php?id=${id}` };
  }
  if (segments.length !== 1 || segments[0] === 'profile.php') return fail('Copy the page link, for example facebook.com/yourpage.');
  return { ok: true, url: `https://www.facebook.com/${segments[0]}` };
}

function normalizeWebsite(parsed: URL): ArtistLinkResult {
  const known = HOST_PLATFORM[canonicalHost(parsed.hostname)];
  if (known) {
    const label = LABELS[known];
    return fail(`This is ${/^[aeiox]/i.test(label) ? 'an' : 'a'} ${label} link. Put it in the ${label} field.`);
  }
  if (parsed.protocol !== 'https:') return fail('Use an https link.');
  const path = parsed.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${cleanQuery(parsed)}` };
}

/**
 * The canonical form of a link for one platform, or a message the editor can act on.
 * https only; http on a known host becomes https. Tracking parameters, the fragment and a trailing
 * slash go. Spotify returns the 22-character artist id.
 */
export function normalizeArtistLink(platform: ArtistLinkPlatform, url: string): ArtistLinkResult {
  const raw = String(url ?? '').trim();
  if (!raw) return fail('The link is empty.');
  if (raw.length > MAX_ARTIST_LINK_LENGTH) return fail(`The link is longer than ${MAX_ARTIST_LINK_LENGTH} characters.`);
  if (platform === 'spotify' && SPOTIFY_URI.test(raw)) return normalizeSpotify(null, raw);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail('This is not a web address. Start the link with https://.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return fail('Use an https link.');
  if (parsed.username || parsed.password) return fail('Remove the user name and password from the link.');
  switch (platform) {
    case 'spotify': return normalizeSpotify(parsed, raw);
    case 'soundcloud': return normalizeSoundcloud(parsed);
    case 'instagram': return normalizeInstagram(parsed);
    case 'twitter': return normalizeTwitter(parsed);
    case 'tiktok': return normalizeTiktok(parsed);
    case 'facebook': return normalizeFacebook(parsed);
    case 'website': return normalizeWebsite(parsed);
  }
}
