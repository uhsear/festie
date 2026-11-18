// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * resolveArtistRefs: ties every artist element of a festival save to an artists row.
 * It runs inside the save transaction, after the festival row lock and the token check, and it
 * reads the database, never a cache. It covers set elements and announced-lineup elements.
 * The rule for one element, in order (AR plan 4.3):
 *   1. A sent id that names a tombstone follows merged_into. An unknown id counts as no id.
 *   2. A sent id of a live artist is kept, and the canonical name, links, photo and genres are copied.
 *   3. No id: reuse the id of a stored element with the same key (the same set, or any stored lineup
 *      entry). This covers old clients that strip ids, and a B2B reorder.
 *   4. No id, and a Spotify link whose id a live artist holds: link to that artist.
 *   5. No id, and exactly one live artist has the key: link to it.
 *   6. No id, and no live artist has the key: create one.
 *   7. No id, and two or more live artists have the key: save the element without an id. The save
 *      does not fail. The publish checklist asks the editor to pick one.
 * The flat `artist` and `link_url` of every set are rebuilt from the resolved elements.
 * With `fillEmptyLinks` (the import's Link column, AR plan 7.4) a sent link for a platform the artist
 * has no link for is returned in `linkFills`; the caller writes it after commit through the artist
 * route's own locks. A sent link that differs from a filled one counts in `ignoredLinkEdits`.
 */

import { createOpaqueId } from './helpers';
import { artistNameKey } from './artist-key';
import { detectPlatform, normalizeArtistLink } from './artist-links';
import { ALLOWED_LINK_PLATFORMS } from './constants';
import { createLogger } from './logger';
import { liveArtistsByKey, liveArtistsBySpotifyId, lockArtistRows, resolveArtistIds, type ArtistRecord } from './db/stores/artists';

const log = createLogger('artist-refs');

type Links = Record<string, string>;

interface Slot {
  list: any[];
  index: number;
  setId: string | null;
  element: any;
  key: string;
  sentId: string | null;
  candidateId: string | null;
}

interface NewArtist {
  id: string;
  name: string;
  key: string;
  links: Links;
  spotifyId: string | null;
  photo: string | null;
  genres: string[];
  slots: Slot[];
}

export interface RefsInput {
  festivalId: string;
  days?: any[];
  lineup?: any[];
  separator: string;
  userId: string | null;
  fillEmptyLinks?: boolean;
}

export interface RefsResult {
  days?: any[];
  lineup?: any[];
  /** Links a new artist could not take (they fail the platform rules). */
  droppedLinks: number;
  /** Elements that sent links which differ from the artist's, and lost. */
  ignoredLinkEdits: number;
  /** Names saved without an id because two or more artists have them. */
  ambiguous: string[];
  /** With fillEmptyLinks: links for an empty platform of a linked artist, to write after commit. */
  linkFills: Array<{ artistId: string; platform: string; url: string }>;
}

const stable = (value: unknown) =>
  JSON.stringify(Object.entries((value ?? {}) as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const isPlatform = (key: string) => (ALLOWED_LINK_PLATFORMS as readonly string[]).includes(key);

/** A new artist takes the element's links that pass the platform rules. Others are counted. */
function cleanNewLinks(links: Links | undefined): { links: Links; spotifyId: string | null; dropped: number } {
  const out: Links = {};
  let spotifyId: string | null = null;
  let dropped = 0;
  for (const [platform, url] of Object.entries(links ?? {})) {
    if (!isPlatform(platform)) continue;
    let target = platform;
    let result = normalizeArtistLink(platform as any, url);
    if (!result.ok) {
      // A link pasted under the wrong key (the old Spotify-only field): file it where its host says.
      const detected = detectPlatform(url);
      if (detected && detected !== platform) {
        target = detected;
        result = normalizeArtistLink(detected, url);
      }
    }
    if (!result.ok) {
      dropped++;
      continue;
    }
    if (out[target]) continue;
    out[target] = result.url;
    if (target === 'spotify') spotifyId = result.spotifyId ?? null;
  }
  return { links: out, spotifyId, dropped };
}

/** A sent link under the platform its host names, cleaned by the per-platform rules. Null when it fails them. */
function checkSentLink(platform: string, raw: unknown): { platform: string; url: string } | null {
  if (typeof raw !== 'string' || !isPlatform(platform)) return null;
  const detected = detectPlatform(raw);
  const target = (detected ?? platform) as Parameters<typeof normalizeArtistLink>[0];
  const result = normalizeArtistLink(target, raw);
  return result.ok ? { platform: target, url: result.url } : null;
}

function collectSlots(days: any[] | undefined, lineup: any[] | undefined): Slot[] {
  const slots: Slot[] = [];
  const take = (list: any[] | undefined, setId: string | null) => {
    (list ?? []).forEach((element, index) => {
      if (!element || typeof element.name !== 'string' || !element.name.trim()) return;
      slots.push({ list: list!, index, setId, element, key: artistNameKey(element.name), sentId: element.id ?? null, candidateId: null });
    });
  };
  for (const day of days ?? []) for (const set of day.sets ?? []) take(set.artists, set.id ?? null);
  for (const entry of lineup ?? []) take(entry.artists, null);
  return slots;
}

/** The canonical copy of an artist row: id, name, links, photo and genres. */
function canonicalElement(row: Pick<ArtistRecord, 'id' | 'name' | 'links' | 'photo' | 'genres'>) {
  return {
    id: row.id,
    name: row.name,
    links: { ...(row.links ?? {}) },
    ...(row.photo ? { photo: row.photo } : {}),
    ...(row.genres?.length ? { genres: row.genres } : {}),
  };
}

async function loadStored(client: any, festivalId: string) {
  const { rows: sets } = await client.query('SELECT id, artists FROM festival_sets WHERE festival_id = $1', [festivalId]);
  const { rows: festival } = await client.query('SELECT lineup FROM festivals WHERE id = $1', [festivalId]);
  const bySet = new Map<string, any[]>(sets.map((row: any) => [row.id, Array.isArray(row.artists) ? row.artists : []]));
  const lineupElements: any[] = (Array.isArray(festival[0]?.lineup) ? festival[0].lineup : []).flatMap((entry: any) => entry?.artists ?? []);
  return { bySet, lineupElements };
}

/** Step 3: the id of a stored element with the same key. */
function storedIdFor(slot: Slot, stored: Awaited<ReturnType<typeof loadStored>>): string | null {
  const sameKey = (element: any) => element?.id && typeof element.name === 'string' && artistNameKey(element.name) === slot.key;
  const fromSet = slot.setId ? stored.bySet.get(slot.setId)?.find(sameKey) : undefined;
  return (fromSet ?? stored.lineupElements.find(sameKey))?.id ?? null;
}

/** Inserts the new artists in one statement, sorted by key so two saves never deadlock on each other's index entries. */
async function insertNewArtists(client: any, fresh: NewArtist[], userId: string | null): Promise<Map<NewArtist, ArtistRecord | null>> {
  const placed = new Map<NewArtist, ArtistRecord | null>();
  if (fresh.length === 0) return placed;
  const sorted = [...fresh].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const params: any[] = [];
  const tuples = sorted.map((artist) => {
    const base = params.length;
    params.push(artist.id, artist.name, artist.key, artist.spotifyId, JSON.stringify(artist.links), artist.photo, JSON.stringify(artist.genres), userId);
    return `($${base + 1}, $${base + 2}, $${base + 3}, '', $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7}::jsonb, $${base + 8}, $${base + 8})`;
  });
  const { rows } = await client.query(
    `INSERT INTO artists (id, name, name_key, label, spotify_id, links, photo, genres, created_by, updated_by)
     VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING
     RETURNING id, name, name_key, label, spotify_id, links, photo, genres, merged_into, updated_at`,
    params,
  );
  const inserted = new Map<string, ArtistRecord>(rows.map((row: ArtistRecord) => [row.id, row]));
  const lost = sorted.filter((artist) => !inserted.has(artist.id));
  for (const artist of sorted) if (inserted.has(artist.id)) placed.set(artist, inserted.get(artist.id)!);
  if (lost.length === 0) return placed;
  // A name that returned nothing lost a race. Use the winner only when its Spotify id agrees.
  const winners = await liveArtistsByKey(client, lost.map((a) => a.key));
  const winnersBySpotify = await liveArtistsBySpotifyId(client, lost.map((a) => a.spotifyId).filter((id): id is string => !!id));
  for (const artist of lost) {
    const winner = (artist.spotifyId ? winnersBySpotify.get(artist.spotifyId) : undefined) ?? winners.get(artist.key)?.find((row) => row.label === '');
    const agrees = winner && (winner.spotify_id === artist.spotifyId || (!winner.spotify_id && !artist.spotifyId));
    placed.set(artist, agrees ? winner! : null);
  }
  return placed;
}

export async function resolveArtistRefs(client: any, input: RefsInput): Promise<RefsResult> {
  // Copies, so a retry of the transaction starts from the payload the route built.
  const days = input.days ? structuredClone(input.days) : undefined;
  const lineup = input.lineup ? structuredClone(input.lineup) : undefined;
  const result: RefsResult = { droppedLinks: 0, ignoredLinkEdits: 0, ambiguous: [], linkFills: [] };
  const slots = collectSlots(days, lineup);
  if (slots.length === 0) return { ...result, days, lineup };

  const stored = await loadStored(client, input.festivalId);
  for (const slot of slots) if (!slot.sentId) slot.candidateId = storedIdFor(slot, stored);
  const asked = [...new Set(slots.map((s) => s.sentId ?? s.candidateId).filter((id): id is string => !!id))];
  const live = await resolveArtistIds(client, asked);

  const linked = new Map<Slot, ArtistRecord>();
  const open: Slot[] = [];
  // Sent links that differ from the artist's links lose: the canonical links win.
  const noteIgnoredLinks = (slot: Slot, row: ArtistRecord) => {
    const sent = slot.element.links ?? {};
    if (Object.keys(sent).length === 0 || stable(sent) === stable(row.links)) return;
    let ignored = !input.fillEmptyLinks;
    for (const [platform, raw] of input.fillEmptyLinks ? Object.entries(sent) : []) {
      const checked = checkSentLink(platform, raw);
      const have = checked ? row.links?.[checked.platform] : undefined;
      if (!checked || (have && have !== checked.url)) ignored = true;
      else if (!have && !result.linkFills.some((f) => f.artistId === row.id && f.platform === checked.platform)) {
        result.linkFills.push({ artistId: row.id, platform: checked.platform, url: checked.url });
      }
    }
    if (!ignored) return;
    result.ignoredLinkEdits++;
    log.info('artist link edit ignored: the canonical links win', { artistId: row.id });
  };
  for (const slot of slots) {
    const id = slot.sentId ?? slot.candidateId;
    const row = id ? live.get(id) : undefined;
    if (row) {
      linked.set(slot, row);
      noteIgnoredLinks(slot, row);
    } else {
      if (slot.sentId) log.warn('unknown artist id dropped from a save', { festivalId: input.festivalId, artistId: slot.sentId });
      open.push(slot);
    }
  }

  const spotifyOf = (slot: Slot) => {
    const url = slot.element.links?.spotify;
    const checked = typeof url === 'string' ? normalizeArtistLink('spotify', url) : null;
    return checked?.ok ? (checked.spotifyId ?? null) : null;
  };
  const bySpotify = await liveArtistsBySpotifyId(client, [...new Set(open.map(spotifyOf).filter((id): id is string => !!id))]);
  const byKey = await liveArtistsByKey(client, [...new Set(open.map((s) => s.key))]);
  const fresh = new Map<string, NewArtist>();
  for (const slot of open) {
    const spotifyHit = bySpotify.get(spotifyOf(slot) ?? '');
    const sameKey = byKey.get(slot.key) ?? [];
    if (spotifyHit || sameKey.length === 1) {
      const row = spotifyHit ?? sameKey[0]!;
      linked.set(slot, row);
      noteIgnoredLinks(slot, row);
    } else if (sameKey.length > 1) result.ambiguous.push(String(slot.element.name).trim());
    else {
      const cleaned = cleanNewLinks(slot.element.links);
      result.droppedLinks += cleaned.dropped;
      const group =
        fresh.get(slot.key) ??
        ({
          id: createOpaqueId('art'),
          name: String(slot.element.name).trim(),
          key: slot.key,
          links: {},
          spotifyId: null,
          photo: null,
          genres: [],
          slots: [],
        } as NewArtist);
      for (const [platform, url] of Object.entries(cleaned.links)) group.links[platform] ??= url;
      if (!group.photo && typeof slot.element.photo === 'string' && slot.element.photo.startsWith('https://')) group.photo = slot.element.photo.slice(0, 500);
      if (group.genres.length === 0 && Array.isArray(slot.element.genres)) group.genres = slot.element.genres.filter((g: any) => typeof g === 'string').slice(0, 10);
      group.slots.push(slot);
      fresh.set(slot.key, group);
    }
  }
  // spotifyId must belong to the stored Spotify link, whichever slot supplied it.
  for (const group of fresh.values()) {
    const checked = group.links.spotify ? normalizeArtistLink('spotify', group.links.spotify) : null;
    group.spotifyId = checked?.ok ? (checked.spotifyId ?? null) : null;
  }
  const placed = await insertNewArtists(client, [...fresh.values()], input.userId);
  for (const [group, row] of placed) {
    if (row) for (const slot of group.slots) linked.set(slot, row);
    else for (const slot of group.slots) result.ambiguous.push(String(slot.element.name).trim());
  }

  // Share-lock the rows this save copies, then copy their newest version: an artist edit that commits
  // in between must not leave this festival with the old name.
  const current = await lockArtistRows(client, [...new Set([...linked.values()].map((row) => row.id))]);
  for (const [slot, row] of linked) slot.list[slot.index] = canonicalElement(current.get(row.id) ?? row);
  rebuildFlatFields(days, input.separator);
  return { ...result, days, lineup };
}

/** The flat artist and link_url follow the resolved elements, so a stale form never leaves an old flat name. */
function rebuildFlatFields(days: any[] | undefined, separator: string) {
  for (const day of days ?? []) {
    for (const set of day.sets ?? []) {
      if (!Array.isArray(set.artists) || set.artists.length === 0) continue;
      set.artist = set.artists.map((a: any) => a.name).join(` ${separator} `);
      set.linkUrl = set.artists[0]?.links?.spotify || null;
    }
  }
}

/** The artist, flat name and link of one set a writer is about to store. Changed in place. */
export interface SetValuesTarget {
  artists: any[];
  artist: string;
  linkUrl: string | null;
}

/**
 * Ties the sets a writer is about to store (import commit and undo) to their artists rows, in the
 * writer's transaction. `sets` pair the stored set id, when there is one, with its values.
 */
export async function resolveSetValues(
  client: any,
  input: { festivalId: string; separator: string; userId: string | null; fillEmptyLinks?: boolean },
  sets: Array<{ id: string; values: SetValuesTarget }>,
): Promise<RefsResult> {
  const days = [{ sets: sets.map((s) => ({ id: s.id, artists: s.values.artists })) }];
  const result = await resolveArtistRefs(client, { ...input, days });
  result.days![0].sets.forEach((resolved: any, index: number) => {
    const target = sets[index]!.values;
    target.artists = resolved.artists;
    if (resolved.artists.length === 0) return;
    target.artist = resolved.artist;
    target.linkUrl = resolved.linkUrl ?? null;
  });
  return result;
}
