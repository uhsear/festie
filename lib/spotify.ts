/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Spotify Web API client — Client Credentials flow
 * Used during admin lineup import to auto-populate artist link URLs.
 * No user OAuth required.
 */

import { artistNameKey } from './artist-key';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

let cachedToken: string | null = null;
let tokenExpiry = 0;

/**
 * Get a Client Credentials access token (cached, auto-refreshes)
 */
async function getToken(clientId: any, clientSecret: any) {
  if (cachedToken && Date.now() < tokenExpiry - 30_000) return cachedToken;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Spotify token request failed (${resp.status}): ${body}`);
  }

  const data: any = await resp.json();
  // eslint-disable-next-line require-atomic-updates -- module-level cache, not shared across requests
  cachedToken = data.access_token;
  // eslint-disable-next-line require-atomic-updates -- module-level cache, not shared across requests
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

/**
 * Strip booking-noise from an artist name so it matches a Spotify profile:
 * "(DJ Set)", "(Live)", "(VIP)", trailing "- Live"/"VIP" style suffixes.
 * Exported so the lineup import / backfill normalize names consistently.
 */
function cleanArtistName(name: any) {
  if (!name) return '';
  return String(name)
    .replace(/\((?:dj\s*set|live|vip|acoustic|sunset set)\)/gi, '')
    .replace(/\s*[-–]\s*(?:live|dj set|vip|acoustic)\b.*$/gi, '')
    .replace(/\bVIP\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pick the best artist from a Spotify search response: prefer an exact
 * (case-insensitive) name match, then the highest follower count. This avoids
 * the classic "first result is a more-popular unrelated same-name act" bug.
 */
function pickArtist(data: any, cleanedName: any) {
  const items = data?.artists?.items || [];
  if (!items.length) return null;
  const target = String(cleanedName || '').toLowerCase();
  const score = (a: any) => a?.followers?.total ?? a?.popularity ?? 0;
  const exact = items.filter((a: any) => (a?.name || '').toLowerCase() === target);
  const pool = exact.length ? exact : items;
  const artist = [...pool].sort((a: any, b: any) => score(b) - score(a))[0];
  if (!artist) return null;
  return {
    spotifyUrl: artist.external_urls?.spotify || null,
    spotifyId: artist.id,
    imageUrl: artist.images?.[0]?.url || null,
    genres: (artist.genres || []).slice(0, 5), // top 5 genres
  };
}

/** GET one Spotify API path with the client-credentials token. One retry with a fresh token after a 401. */
async function spotifyGet(path: string, clientId: any, clientSecret: any): Promise<Response> {
  const url = `${SPOTIFY_API_BASE}${path}`;
  const token = await getToken(clientId, clientSecret);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (resp.status !== 401) return resp;
  cachedToken = null;
  tokenExpiry = 0;
  const freshToken = await getToken(clientId, clientSecret);
  return fetch(url, { headers: { Authorization: `Bearer ${freshToken}` } });
}

/** The raw search answer for one cleaned name, or null when Spotify refuses. */
async function searchRaw(cleaned: string, clientId: any, clientSecret: any) {
  const resp = await spotifyGet(`/search?q=${encodeURIComponent(cleaned)}&type=artist&limit=8`, clientId, clientSecret);
  return resp.ok ? resp.json() : null;
}

/**
 * Search Spotify for an artist by name. Cleans booking-noise from the name,
 * fetches several candidates, and returns the best match (exact name + most
 * followers) rather than blindly taking the first result.
 * Returns { spotifyUrl, spotifyId, imageUrl, genres } or null if no match.
 */
async function searchArtist(name: any, clientId: any, clientSecret: any) {
  if (!name || !clientId || !clientSecret) return null;

  const cleaned = cleanArtistName(name) || String(name).trim();
  if (!cleaned) return null;
  return pickArtist(await searchRaw(cleaned, clientId, clientSecret), cleaned);
}

const CANDIDATE_LIMIT = 3;

/** What the Artists screen shows for one Spotify artist. */
function toCandidate(artist: any, exact: boolean) {
  return {
    spotifyId: String(artist.id),
    spotifyUrl: `https://open.spotify.com/artist/${artist.id}`,
    name: String(artist.name ?? ''),
    imageUrl: artist.images?.[0]?.url || null,
    followers: artist.followers?.total ?? null,
    genres: (artist.genres || []).slice(0, 5),
    exact,
  };
}

/**
 * The top candidates of a Spotify search answer: artists whose name equals the searched name
 * (same key as the artist table uses) first, then by followers. Never auto-picks: the editor decides.
 */
function rankCandidates(data: any, cleanedName: any) {
  const target = artistNameKey(String(cleanedName || ''));
  const followers = (a: any) => a?.followers?.total ?? a?.popularity ?? 0;
  const items = (data?.artists?.items || []).filter((a: any) => a?.id && /^[A-Za-z0-9]{22}$/.test(a.id));
  const withExact = items.map((a: any, index: number) => ({ a, index, exact: !!target && artistNameKey(String(a.name ?? '')) === target }));
  withExact.sort((x: any, y: any) => Number(y.exact) - Number(x.exact) || followers(y.a) - followers(x.a) || x.index - y.index);
  return withExact.slice(0, CANDIDATE_LIMIT).map(({ a, exact }: any) => toCandidate(a, exact));
}

/** Top candidates for a name. [] when Spotify has none, null when Spotify refused (try again). */
async function searchCandidates(name: any, clientId: any, clientSecret: any) {
  if (!name || !clientId || !clientSecret) return null;
  const cleaned = cleanArtistName(name) || String(name).trim();
  if (!cleaned) return [];
  const data = await searchRaw(cleaned, clientId, clientSecret);
  return data ? rankCandidates(data, cleaned) : null;
}

/** One Spotify artist by id, in the candidate shape. Null when Spotify has no such artist. Throws when Spotify fails. */
async function getArtistById(spotifyId: string, clientId: any, clientSecret: any) {
  const resp = await spotifyGet(`/artists/${encodeURIComponent(spotifyId)}`, clientId, clientSecret);
  if (resp.status === 404 || resp.status === 400) return null;
  if (!resp.ok) throw new Error(`Spotify artist request failed (${resp.status})`);
  const artist: any = await resp.json();
  return artist?.id === spotifyId ? toCandidate(artist, false) : null;
}

/**
 * Bulk search multiple artist names with a bounded concurrency pool (keeps a
 * large lineup well under request timeouts while staying gentle on the API).
 * Returns Map<artistName, { spotifyUrl, spotifyId, imageUrl, genres }>
 * `search` swaps the lookup (candidates, or an artist by id).
 */
async function bulkSearchArtists(names: any, clientId: any, clientSecret: any, { concurrency = 6, log, search = searchArtist }: any = {}) {
  const results = new Map();
  const uniqueNames = [...new Set(names.filter(Boolean))];
  if (!uniqueNames.length) return results;

  // Prime the token once so the concurrent workers don't all race to fetch it.
  // Swallow failures here — each worker surfaces its own error below.
  try {
    await getToken(clientId, clientSecret);
  } catch {
    /* workers will report per-name */
  }

  let cursor = 0;
  async function worker() {
    while (cursor < uniqueNames.length) {
      const name = uniqueNames[cursor++];
      try {
        const result = await search(name, clientId, clientSecret);
        if (result) results.set(name, result);
      } catch (err: any) {
        if (log) log.warn('spotify search failed for artist', { artist: name, error: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueNames.length) }, worker));
  return results;
}

/** bulkSearchArtists for ranked candidates. A name Spotify refused is missing from the map, a name with no match maps to []. */
function bulkSearchCandidates(names: any, clientId: any, clientSecret: any, opts: any = {}) {
  return bulkSearchArtists(names, clientId, clientSecret, { ...opts, search: searchCandidates });
}

/** Spotify artists by id, looked up with a bounded pool. An id Spotify does not know, or a failed lookup, is missing from the map. */
async function getArtistsByIds(ids: string[], clientId: any, clientSecret: any, { concurrency = 6, log }: any = {}) {
  return bulkSearchArtists(ids, clientId, clientSecret, { concurrency, log, search: getArtistById });
}

export { searchArtist, bulkSearchArtists, bulkSearchCandidates, searchCandidates, rankCandidates, getArtistsByIds, getToken, cleanArtistName };
