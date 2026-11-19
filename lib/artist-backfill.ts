// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The artist backfill: gives every artist element in festival_sets.artists and festivals.lineup an
 * artists row and an id, one transaction per festival. Nothing reads the ids yet.
 *   planBackfill   reads the database and groups the elements. It writes nothing (the dry run).
 *   applyBackfillPlan   writes the plan, skipping a festival that changed after the plan was read.
 *   verifyBackfill   checks counts, ids and that a second plan has no changes.
 * Grouping follows the artist repository plan, section 5.2. The script scripts/artist-backfill.ts
 * calls these and refuses any database whose name does not end in _test or _staging.
 */

import { createHash } from 'node:crypto';
import { Client, type Pool } from 'pg';
import { createOpaqueId } from './helpers';
import { sanitizeString, sanitizeLinkRecord } from './helpers/sanitize';
import { artistNameKey, shownSetName, stripSetTag } from './artist-key';
import { ALLOWED_LINK_PLATFORMS, MAX_ARTISTS_PER_SET } from './constants';
import { normalizeSetArtists } from './schemas';
import { detectPlatform, normalizeArtistLink, type ArtistLinkPlatform } from './artist-links';
import { withTransactionRetry } from './db/connection';
import { lockFestivalAny } from './db/stores/lineup-imports';

type Links = Record<string, string>;

export interface ArtistRow {
  id: string;
  name: string;
  name_key: string;
  label: string;
  spotify_id: string | null;
  links: Links | null;
  photo: string | null;
  genres: string[] | null;
  merged_into: string | null;
}

interface FestivalInfo {
  id: string;
  updatedAtText: string | null;
  separator: string;
  recency: string;
  lineup: any[];
}

interface Group {
  id: string;
  existing: ArtistRow | null;
  key: string;
  label: string;
  spotifyId: string | null;
  elems: Elem[];
  links: Links;
  name: string;
  photo: string | null;
  genres: string[];
  actualId?: string | null;
  /** An existing row with no Spotify id that takes one Spotify cluster: what it gains. */
  fill?: { spotifyId: string; links: Links };
}

interface Elem {
  owner: Owner;
  ordinal: number;
  original: any;
  name: string;
  key: string;
  /** The key of the name as stored, before stripSetTag. */
  rawKey: string;
  links: Links;
  photo: string | null;
  genres: string[];
  spotifyId: string | null;
  fromId: string | null;
  group: Group | null;
  leftAlone: boolean;
}

type Item = { keep: any } | Elem;

interface Owner {
  festival: FestivalInfo;
  kind: 'set' | 'lineup';
  ownerId: string;
  original: any[];
  legacy: boolean;
  items: Item[];
  flat: string;
  linkUrl: string | null;
  displayName: string | null;
  entry: any;
}

export interface BackfillReport {
  counts: Record<string, number>;
  renames: Array<{ festivalId: string; setId: string; before: string; after: string }>;
  joinedBySpotify: Array<{ artist: string; names: string[] }>;
  joinedByName: Array<{ artist: string; festivalId: string; ownerId: string; name: string }>;
  needsPick: Array<{ festivalId: string; kind: string; ownerId: string; ordinal: number; name: string }>;
  separateArtists: Array<{ key: string; names: string[]; notes: string[] }>;
  linkRefiles: Array<{ festivalId: string; ownerId: string; name: string; from: string; to: string; url: string }>;
  linkFailures: Array<{ festivalId: string; ownerId: string; name: string; platform: string; url: string; message: string }>;
  linkConflicts: Array<{ artist: string; platform: string; kept: string; dropped: string }>;
  b2bSplits: Array<{ festivalId: string; ownerId: string; name: string; parts: string[] }>;
  b2bNotSplit: Array<{ festivalId: string; ownerId: string; name: string; parts: string[] }>;
  splitLinksToPlace: Array<{ festivalId: string; ownerId: string; name: string; links: Links }>;
  photosNotCopied: Array<{ festivalId: string; ownerId: string; name: string; photo: string }>;
  linksNotCopied: Array<{ festivalId: string; ownerId: string; name: string; links: Links }>;
  rowFills: Array<{ artistId: string; artist: string; spotifyId: string; links: Links }>;
}

export interface BackfillPlan {
  report: BackfillReport;
  festivals: FestivalInfo[];
  owners: Owner[];
  groups: Group[];
  changedOwners: Owner[];
  newGroups: Group[];
}

const B2B_SPLIT = /\s+b2b\s+/i;
const MAX_NAME = 300;
// The image hosts of the CSP img-src list in lib/helpers.ts.
const PHOTO_HOST = /^(?:art\.festie\.us|(?:[a-z0-9-]+\.)+scdn\.co|(?:[a-z0-9-]+\.)+spotifycdn\.com)$/i;

const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

/** JSON with sorted keys, so a value read back from jsonb compares equal to the one that was written. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    isObject(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val,
  );
}

/** Identifies a dry-run report. A run that is given this hash refuses to write when the plan it computes differs. */
export function planHash(report: BackfillReport): string {
  return createHash('sha256').update(stable(report)).digest('hex');
}

function allowedPhoto(photo: string): boolean {
  try {
    const url = new URL(photo);
    return url.protocol === 'https:' && PHOTO_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

function cleanGenres(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((g): g is string => typeof g === 'string')
    .map((g) => sanitizeString(g, 50))
    .filter(Boolean)
    .slice(0, 10);
}

const emptyReport = (): BackfillReport => ({
  counts: {},
  renames: [],
  joinedBySpotify: [],
  joinedByName: [],
  needsPick: [],
  separateArtists: [],
  linkRefiles: [],
  linkFailures: [],
  linkConflicts: [],
  b2bSplits: [],
  b2bNotSplit: [],
  splitLinksToPlace: [],
  photosNotCopied: [],
  linksNotCopied: [],
  rowFills: [],
});

// ── Reading ────────────────────────────────────────────────────────────────────────────────────

async function loadFestivals(pool: Pool): Promise<FestivalInfo[]> {
  const { rows } = await pool.query(
    `
  SELECT
    f.id,
    f.updated_at::text AS updated_at_text,
    f.b2b_separator,
    f.lineup,
    COALESCE(
      (
        SELECT
          MAX(d.date)
        FROM
          festival_days d
        WHERE
          d.festival_id = f.id
      ),
      to_char(f.created_at, 'YYYY-MM-DD')
    ) AS recency
  FROM
    festivals f
  ORDER BY
    f.id
`,
  );
  return rows.map((row: any) => ({
    id: row.id,
    updatedAtText: row.updated_at_text,
    separator: row.b2b_separator || 'b2b',
    recency: row.recency || '',
    lineup: Array.isArray(row.lineup) ? row.lineup : [],
  }));
}

async function loadOwners(pool: Pool, festivals: FestivalInfo[]): Promise<Owner[]> {
  const byId = new Map(festivals.map((f) => [f.id, f]));
  const owners: Owner[] = [];
  const { rows: sets } = await pool.query(
    `
  SELECT
    id,
    festival_id,
    artist,
    link_url,
    display_name,
    CASE
      WHEN jsonb_typeof(artists) = 'array' THEN artists
      ELSE '[]'::jsonb
    END AS artists
  FROM
    festival_sets
  ORDER BY
    festival_id,
    day_index,
    sort_order,
    id
`,
  );
  for (const row of sets) {
    const festival = byId.get(row.festival_id);
    if (!festival) continue;
    const flat = String(row.artist ?? '');
    const legacy = row.artists.length === 0 && flat.trim() !== '';
    owners.push({
      festival, kind: 'set', ownerId: row.id, original: row.artists, legacy, items: [], flat,
      linkUrl: row.link_url ?? null, displayName: row.display_name ?? null, entry: null,
    });
  }
  for (const festival of festivals) {
    festival.lineup.forEach((entry: any, index: number) => {
      owners.push({
        festival, kind: 'lineup', ownerId: String(entry?.id ?? `#${index}`),
        original: Array.isArray(entry?.artists) ? entry.artists : [], legacy: false, items: [],
        flat: '', linkUrl: null, displayName: entry?.displayName || null, entry,
      });
    });
  }
  return owners;
}

async function loadArtists(pool: Pool): Promise<ArtistRow[]> {
  const { rows } = await pool.query(
    'SELECT id, name, name_key, label, spotify_id, links, photo, genres, merged_into FROM artists ORDER BY id',
  );
  return rows;
}

// ── Cleaning ───────────────────────────────────────────────────────────────────────────────────

const isPlatform = (key: string): key is ArtistLinkPlatform => (ALLOWED_LINK_PLATFORMS as readonly string[]).includes(key);

/**
 * Cleans one element's links with lib/artist-links.ts. A link that fails the rules stays as it is.
 * A value that is not http(s), or sits under a key no platform uses, is dropped and reported.
 */
function cleanLinks(rawLinks: unknown, owner: Owner, name: string, report: BackfillReport): Links {
  const raw = sanitizeLinkRecord(rawLinks);
  const out: Links = {};
  const refiles: Array<{ from: string; to: ArtistLinkPlatform; url: string }> = [];
  const base = { festivalId: owner.festival.id, ownerId: owner.ownerId, name };
  const dropped: Links = Object.fromEntries(
    Object.entries(isObject(rawLinks) ? rawLinks : {}).filter(([key, value]) => typeof value === 'string' && value.trim() && !(key in raw)),
  ) as Links;
  for (const [key, url] of Object.entries(raw)) {
    const detected = detectPlatform(url);
    const target = detected && detected !== key ? detected : isPlatform(key) ? key : null;
    if (!target) {
      dropped[key] = url;
      continue;
    }
    const result = normalizeArtistLink(target, url);
    if (!result.ok) {
      out[key] = url;
      report.linkFailures.push({ ...base, platform: key, url, message: result.message });
    } else if (target === key) {
      out[key] = result.url;
    } else {
      refiles.push({ from: key, to: target, url: result.url });
    }
  }
  for (const refile of refiles) {
    const taken = out[refile.to];
    if (taken && taken !== refile.url) {
      out[refile.from] = raw[refile.from]!;
      report.linkFailures.push({ ...base, platform: refile.from, url: refile.url, message: `The ${refile.to} link is already set to a different address.` });
      continue;
    }
    out[refile.to] = refile.url;
    report.linkRefiles.push({ ...base, from: refile.from, to: refile.to, url: refile.url });
  }
  if (Object.keys(dropped).length > 0) report.linksNotCopied.push({ ...base, links: dropped });
  return out;
}

function spotifyIdOf(links: Links): string | null {
  if (!links.spotify) return null;
  const result = normalizeArtistLink('spotify', links.spotify);
  return result.ok ? (result.spotifyId ?? null) : null;
}

function makeElem(owner: Owner, ordinal: number, original: any, rawName: string, links: Links, split: boolean): Elem {
  const photo = !split && typeof original?.photo === 'string' && original.photo ? original.photo : null;
  const name = stripSetTag(rawName);
  return {
    owner, ordinal, original, name: name.slice(0, MAX_NAME), key: artistNameKey(name), rawKey: artistNameKey(rawName), links, photo,
    genres: split ? [] : cleanGenres(original?.genres), spotifyId: spotifyIdOf(links),
    fromId: !split && typeof original?.id === 'string' && original.id ? original.id : null,
    group: null, leftAlone: false,
  };
}

/**
 * Step 1 to 3: the elements of one owner, B2B names split, set tags stripped and links cleaned. A split that would
 * push the owner past MAX_ARTISTS_PER_SET is left undone and reported, so the form can still save.
 */
function buildItems(owner: Owner, report: BackfillReport): void {
  const source: any[] = owner.legacy ? normalizeSetArtists({ artist: owner.flat, linkUrl: owner.linkUrl }) : owner.original;
  let projected = source.length;
  for (const original of source) {
    const name = isObject(original) ? String(original.name ?? '').trim() : '';
    if (!name) {
      owner.items.push({ keep: original });
      continue;
    }
    const base = { festivalId: owner.festival.id, ownerId: owner.ownerId, name };
    const parts = name.split(B2B_SPLIT).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1 && projected + parts.length - 1 > MAX_ARTISTS_PER_SET) {
      report.b2bNotSplit.push({ ...base, parts });
    } else if (parts.length > 1) {
      projected += parts.length - 1;
      report.b2bSplits.push({ ...base, parts });
      const links = sanitizeLinkRecord(original.links);
      if (Object.keys(links).length > 0) report.splitLinksToPlace.push({ ...base, links });
      for (const part of parts) owner.items.push(makeElem(owner, owner.items.length, original, part, {}, true));
      continue;
    }
    const links = cleanLinks(original.links, owner, name, report);
    owner.items.push(makeElem(owner, owner.items.length, original, name, links, false));
  }
}

// ── Grouping ───────────────────────────────────────────────────────────────────────────────────

const linksConflict = (a: Links, b: Links) => Object.keys(a).some((platform) => b[platform] && b[platform] !== a[platform]);

function mostFrequentName(elems: Elem[]): string {
  const stats = new Map<string, { count: number; recency: string }>();
  for (const elem of elems) {
    const stat = stats.get(elem.name) ?? { count: 0, recency: '' };
    stat.count += 1;
    if (elem.owner.festival.recency > stat.recency) stat.recency = elem.owner.festival.recency;
    stats.set(elem.name, stat);
  }
  const ranked = [...stats.entries()].sort(
    ([nameA, a], [nameB, b]) => b.count - a.count || (a.recency < b.recency ? 1 : a.recency > b.recency ? -1 : 0) || (nameA < nameB ? -1 : 1),
  );
  return ranked[0]![0];
}

function addToGroup(group: Group, elem: Elem, report: BackfillReport): void {
  elem.group = group;
  group.elems.push(elem);
  for (const [platform, url] of Object.entries(elem.links)) {
    const kept = group.links[platform];
    if (!kept) group.links[platform] = url;
    else if (kept !== url) report.linkConflicts.push({ artist: group.name || elem.name, platform, kept, dropped: url });
  }
}

const newGroup = (spotifyId: string | null): Group => ({
  id: createOpaqueId('art'), existing: null, key: '', label: '', spotifyId, elems: [], links: {}, name: '', photo: null, genres: [],
});

function existingGroup(row: ArtistRow): Group {
  return {
    id: row.id, existing: row, key: row.name_key, label: row.label, spotifyId: row.spotify_id, elems: [],
    links: { ...(row.links ?? {}) }, name: row.name, photo: row.photo, genres: row.genres ?? [], actualId: row.id,
  };
}

/** Elements with no Spotify id in one key, clustered so that no cluster holds conflicting links. */
function clusterByLinks(elems: Elem[]): Elem[][] {
  const clusters: Array<{ links: Links; elems: Elem[] }> = [];
  for (const elem of elems) {
    const cluster = clusters.find((c) => !linksConflict(c.links, elem.links));
    if (cluster) {
      cluster.elems.push(elem);
      Object.assign(cluster.links, { ...elem.links, ...cluster.links });
    } else {
      clusters.push({ links: { ...elem.links }, elems: [elem] });
    }
  }
  return clusters.map((c) => c.elems);
}

function allElems(owners: Owner[]): Elem[] {
  return owners.flatMap((owner) => owner.items.filter((item): item is Elem => !('keep' in item)));
}

function groupElements(owners: Owner[], artists: ArtistRow[], report: BackfillReport): Group[] {
  const byId = new Map(artists.map((a) => [a.id, a]));
  const liveOf = (id: string) => {
    let row = byId.get(id);
    for (let hop = 0; row?.merged_into && hop < 5; hop++) row = byId.get(row.merged_into);
    return row && !row.merged_into ? row : null;
  };
  const groups = artists.filter((a) => !a.merged_into).map(existingGroup);
  const byArtistId = new Map(groups.map((g) => [g.id, g]));
  const bySpotify = new Map(groups.filter((g) => g.spotifyId).map((g) => [g.spotifyId!, g]));
  const elems = allElems(owners);

  const unplaced: Elem[] = [];
  for (const elem of elems) {
    const live = elem.fromId ? liveOf(elem.fromId) : null;
    if (live) {
      // An id that names a tombstone is rewritten with the survivor's id.
      const group = byArtistId.get(live.id)!;
      if (elem.fromId === live.id) {
        elem.group = group;
        elem.leftAlone = true;
      } else addToGroup(group, elem, report);
    } else if (!elem.spotifyId) unplaced.push(elem);
  }
  const unmatched = new Map<string, Elem[]>();
  for (const elem of elems.filter((e) => !e.group && e.spotifyId)) {
    const group = bySpotify.get(elem.spotifyId!);
    if (group) addToGroup(group, elem, report);
    else unmatched.set(elem.spotifyId!, [...(unmatched.get(elem.spotifyId!) ?? []), elem]);
  }
  placeSpotifyClusters(groups, unmatched, report);
  groupByKey(groups, unplaced, report);
  return groups;
}

/**
 * Step 4.1 for Spotify ids no artist holds yet. A cluster joins the one existing artist with its key,
 * as a save does (lib/artist-refs.ts rules 4 and 5), when that artist has no Spotify id, its links
 * agree and no other new Spotify id shares the key. The artist then gains the Spotify id and the
 * links for its empty platforms. Two new Spotify ids on one key stay two artists.
 */
function placeSpotifyClusters(groups: Group[], unmatched: Map<string, Elem[]>, report: BackfillReport): void {
  const keyOf = new Map([...unmatched].map(([spotifyId, cluster]) => [spotifyId, artistNameKey(mostFrequentName(cluster))]));
  const clustersPerKey = new Map<string, number>();
  for (const key of keyOf.values()) clustersPerKey.set(key, (clustersPerKey.get(key) ?? 0) + 1);
  const existing = groups.filter((g) => g.existing);
  for (const [spotifyId, cluster] of unmatched) {
    const key = keyOf.get(spotifyId)!;
    const sameKey = existing.filter((g) => g.key === key);
    const links = mergedLinks(cluster);
    const target =
      clustersPerKey.get(key) === 1 && sameKey.length === 1 && !sameKey[0]!.spotifyId && !linksConflict(sameKey[0]!.links, links) ? sameKey[0]! : null;
    if (target) {
      const stored = target.existing!.links ?? {};
      target.spotifyId = spotifyId;
      target.fill = { spotifyId, links: Object.fromEntries(Object.entries(links).filter(([platform]) => !stored[platform])) };
      report.rowFills.push({ artistId: target.id, artist: target.name, ...target.fill });
    }
    const group = target ?? newGroup(spotifyId);
    if (!target) groups.push(group);
    for (const elem of cluster) addToGroup(group, elem, report);
    if (!target) {
      group.name = mostFrequentName(group.elems);
      group.key = key;
    }
  }
}

/** Steps 4.2 to 4.4: elements with no Spotify id, key by key. */
function groupByKey(groups: Group[], unplaced: Elem[], report: BackfillReport): void {
  const baseByKey = new Map<string, Group[]>();
  for (const group of groups) baseByKey.set(group.key, [...(baseByKey.get(group.key) ?? []), group]);
  const elemsByKey = new Map<string, Elem[]>();
  for (const elem of unplaced) elemsByKey.set(elem.key, [...(elemsByKey.get(elem.key) ?? []), elem]);
  for (const [key, elems] of elemsByKey) {
    const base = baseByKey.get(key) ?? [];
    for (const cluster of clusterByLinks(elems)) {
      const target = base.length === 1 && !linksConflict(base[0]!.links, mergedLinks(cluster)) ? base[0]! : null;
      if (base.length >= 2) {
        for (const elem of cluster) {
          report.needsPick.push({ festivalId: elem.owner.festival.id, kind: elem.owner.kind, ownerId: elem.owner.ownerId, ordinal: elem.ordinal, name: elem.name });
        }
        continue;
      }
      const group = target ?? newGroup(null);
      if (!target) {
        group.key = key;
        groups.push(group);
      }
      for (const elem of cluster) addToGroup(group, elem, report);
      if (!group.name) group.name = mostFrequentName(group.elems);
      if (target || cluster.length > 1) {
        for (const elem of cluster) report.joinedByName.push({ artist: group.name, festivalId: elem.owner.festival.id, ownerId: elem.owner.ownerId, name: elem.name });
      }
    }
  }
}

const mergedLinks = (elems: Elem[]): Links => Object.assign({}, ...[...elems].reverse().map((e) => e.links));

/** Step 5 and 6: neutral notes where a key has several artists, and each new group's fields. */
function finishGroups(groups: Group[], report: BackfillReport): void {
  const byKey = new Map<string, Group[]>();
  for (const group of groups.filter((g) => g.elems.length > 0 || g.existing)) {
    byKey.set(group.key, [...(byKey.get(group.key) ?? []), group]);
  }
  for (const [key, list] of byKey) {
    const fresh = list.filter((g) => !g.existing && g.elems.length > 0);
    if (list.length < 2 || fresh.length === 0) continue;
    const used = new Set(list.filter((g) => g.existing).map((g) => g.label.toLowerCase()));
    let n = 1;
    for (const group of fresh) {
      while (used.has(`unnamed ${n}`)) n += 1;
      group.label = `unnamed ${n}`;
      used.add(group.label);
    }
    report.separateArtists.push({ key, names: list.map((g) => g.name), notes: list.map((g) => g.label) });
  }
  for (const group of groups.filter((g) => !g.existing && g.elems.length > 0)) pickFields(group, report);
}

function pickFields(group: Group, report: BackfillReport): void {
  const sameKey = group.elems.filter((e) => e.key === group.key);
  group.name = mostFrequentName(sameKey.length > 0 ? sameKey : group.elems);
  const newestFirst = [...group.elems].sort((a, b) => (a.owner.festival.recency < b.owner.festival.recency ? 1 : a.owner.festival.recency > b.owner.festival.recency ? -1 : 0));
  const withPhoto = [...newestFirst.filter((e) => e.spotifyId), ...newestFirst.filter((e) => !e.spotifyId)].filter((e) => e.photo);
  for (const elem of withPhoto) {
    if (allowedPhoto(elem.photo!)) {
      group.photo ??= elem.photo;
    } else {
      report.photosNotCopied.push({ festivalId: elem.owner.festival.id, ownerId: elem.owner.ownerId, name: elem.name, photo: elem.photo! });
    }
  }
  const genreSource = newestFirst.find((e) => e.spotifyId && e.genres.length > 0) ?? newestFirst.find((e) => e.genres.length > 0);
  group.genres = genreSource?.genres ?? [];
}

// ── Output ─────────────────────────────────────────────────────────────────────────────────────

// An existing artist is copied as its row says after its fill: group.links also holds the links of joined elements.
const rowLinks = (group: Group): Links => ({ ...(group.existing!.links ?? {}), ...(group.fill?.links ?? {}) });

const copyOf = (group: Group, id: string) => ({
  id,
  name: group.name,
  links: group.existing ? rowLinks(group) : group.links,
  ...(group.photo ? { photo: group.photo } : {}),
  ...(group.genres.length > 0 ? { genres: group.genres } : {}),
});

/** An element with no usable group keeps its cleaned data and no id. */
const plainCopy = (elem: Elem) => ({
  name: elem.name,
  links: elem.links,
  ...(elem.photo ? { photo: elem.photo } : {}),
  ...(elem.genres.length > 0 ? { genres: elem.genres } : {}),
});

function outputArtists(owner: Owner, idOf: (group: Group) => string | null): any[] {
  return owner.items.map((item) => {
    if ('keep' in item) return item.keep;
    if (item.leftAlone) return item.original;
    const id = item.group ? idOf(item.group) : null;
    return item.group && id ? copyOf(item.group, id) : plainCopy(item);
  });
}

interface OwnerWrite {
  artists: any[];
  artist: string;
  linkUrl: string | null;
  displayName: string | null;
}

function ownerWrite(owner: Owner, idOf: (group: Group) => string | null): OwnerWrite {
  const artists = outputArtists(owner, idOf);
  const sep = owner.festival.separator;
  const oldNames = owner.legacy ? [owner.flat] : owner.original.map((a: any) => a?.name).filter((n: any) => typeof n === 'string' && n.trim());
  const rebuild = owner.flat === oldNames.join(` ${sep} `);
  const names = artists.map((a: any) => a?.name).filter((n: any) => typeof n === 'string' && n.trim());
  const firstSpotify = artists.find((a: any) => typeof a?.name === 'string' && a.name.trim())?.links?.spotify;
  // A name that changes beyond case and marks (a stripped set tag, a Spotify join) keeps the poster text.
  const renamed = owner.items.some((item, i) => !('keep' in item) && !item.leftAlone && item.rawKey !== artistNameKey(String(artists[i]?.name ?? '')));
  return {
    artists,
    artist: rebuild ? names.join(` ${sep} `) : owner.flat,
    linkUrl: firstSpotify || null,
    displayName: !owner.displayName && renamed ? shownName(owner) : owner.displayName,
  };
}

const shownName = (owner: Owner) =>
  shownSetName({ displayName: owner.displayName, artist: owner.flat, artists: owner.original }, owner.festival.separator).slice(0, MAX_NAME);

function ownerChanged(owner: Owner, write: OwnerWrite): boolean {
  if (stable(write.artists) !== stable(owner.original) || write.displayName !== owner.displayName) return true;
  return owner.kind === 'set' && (write.artist !== owner.flat || (write.linkUrl ?? null) !== (owner.linkUrl ?? null));
}

/** Named elements the owner holds today. A legacy flat-only set holds none. */
const namedOriginal = (owner: Owner) => (owner.legacy ? 0 : owner.original.filter((a: any) => typeof a?.name === 'string' && a.name.trim()).length);

const placeholderId = (group: Group) => group.actualId ?? 'art-pending';

// ── Plan ───────────────────────────────────────────────────────────────────────────────────────

export async function planBackfill(pool: Pool): Promise<BackfillPlan> {
  const festivals = await loadFestivals(pool);
  const owners = await loadOwners(pool, festivals);
  const artists = await loadArtists(pool);
  const report = emptyReport();
  for (const owner of owners) buildItems(owner, report);
  const groups = groupElements(owners, artists, report);
  finishGroups(groups, report);

  const changedOwners: Owner[] = [];
  for (const owner of owners) {
    const write = ownerWrite(owner, placeholderId);
    if (!ownerChanged(owner, write)) continue;
    changedOwners.push(owner);
    if (owner.kind !== 'set') continue;
    const before = shownSetName({ displayName: owner.displayName, artist: owner.flat, artists: owner.original }, owner.festival.separator);
    const after = shownSetName({ displayName: write.displayName, artist: write.artist, artists: write.artists }, owner.festival.separator);
    if (before !== after) report.renames.push({ festivalId: owner.festival.id, setId: owner.ownerId, before, after });
  }
  noteJoins(groups, report);
  const newGroups = groups.filter((g) => !g.existing && g.elems.some((e) => !e.leftAlone));
  report.counts = countPlan(owners, festivals, changedOwners, newGroups);
  return { report, festivals, owners, groups, changedOwners, newGroups };
}

function noteJoins(groups: Group[], report: BackfillReport): void {
  for (const group of groups) {
    if (group.existing) {
      for (const elem of group.elems.filter((e) => !e.leftAlone)) {
        const extra = Object.fromEntries(Object.entries(elem.links).filter(([p, url]) => rowLinks(group)[p] !== url));
        if (Object.keys(extra).length > 0) {
          report.linksNotCopied.push({ festivalId: elem.owner.festival.id, ownerId: elem.owner.ownerId, name: elem.name, links: extra });
        }
      }
    }
    const spotifyElems = group.elems.filter((e) => e.spotifyId);
    if (spotifyElems.length > 0 && group.elems.some((e) => e.key !== group.key)) {
      report.joinedBySpotify.push({ artist: group.name, names: [...new Set(group.elems.map((e) => e.name))] });
    }
  }
}

function countPlan(owners: Owner[], festivals: FestivalInfo[], changed: Owner[], newGroups: Group[]): Record<string, number> {
  const sets = owners.filter((o) => o.kind === 'set');
  return {
    festivals: festivals.length,
    sets: sets.length,
    lineupEntries: owners.length - sets.length,
    elements: owners.reduce((sum, o) => sum + namedOriginal(o) + (o.legacy ? 1 : 0), 0),
    legacyFlatOnlySets: sets.filter((o) => o.legacy).length,
    artistsToCreate: newGroups.length,
    festivalsToWrite: new Set(changed.map((o) => o.festival.id)).size,
    ownersToWrite: changed.length,
  };
}

// ── Apply ──────────────────────────────────────────────────────────────────────────────────────

export interface ApplyResult {
  runId: string;
  festivalsWritten: string[];
  festivalsSkipped: Array<{ festivalId: string; reason: string }>;
  artistsCreated: number;
  conflicts: Array<{ festivalId: string; artist: string; key: string }>;
}

const sortKey = (group: Group) => `${group.key}\u0000${group.label.toLowerCase()}`;

/** Inserts the groups a festival needs and returns each group's real id, or null on a conflict. */
async function materializeGroups(client: any, groups: Group[]): Promise<{ ids: Map<Group, string | null>; created: number }> {
  const ids = new Map<Group, string | null>();
  const pending = groups.filter((g) => g.actualId === undefined).sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  if (pending.length === 0) return { ids, created: 0 };
  const params: any[] = [];
  const tuples = pending.map((g) => {
    const base = params.length;
    params.push(g.id, g.name, g.key, g.label, g.spotifyId, JSON.stringify(g.links), g.photo, JSON.stringify(g.genres));
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}, $${base + 8}::jsonb)`;
  });
  const { rows } = await client.query(
    `INSERT INTO artists (id, name, name_key, label, spotify_id, links, photo, genres) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING RETURNING id`,
    params,
  );
  const inserted = new Set(rows.map((r: any) => r.id));
  for (const group of pending) {
    ids.set(group, inserted.has(group.id) ? group.id : await findExisting(client, group));
  }
  return { ids, created: inserted.size };
}

/** A row that already holds this group's key. Another Spotify id or none at all is a conflict. */
async function findExisting(client: any, group: Group): Promise<string | null> {
  const { rows } = group.spotifyId
    ? await client.query('SELECT id, spotify_id FROM artists WHERE spotify_id = $1 AND merged_into IS NULL', [group.spotifyId])
    : await client.query(
        'SELECT id, spotify_id FROM artists WHERE name_key = $1 AND lower(label) = lower($2) AND merged_into IS NULL',
        [group.key, group.label],
      );
  const row = rows[0];
  if (!row || (!group.spotifyId && row.spotify_id)) return null;
  return row.id;
}

/** Reseeds the edit token. After a rollback below this migration, old writers left edited_at behind. */
const RESEED_EDITED_AT = 'UPDATE festivals SET edited_at = updated_at WHERE edited_at IS NULL OR edited_at < updated_at';

/**
 * Locks the festival's set rows and compares the ones to rewrite with what the plan read. The admin
 * writers that save one set update festival_sets and festivals.updated_at in two statements, so the
 * updated_at check alone can miss a change that landed between them.
 */
async function setsUnchanged(client: any, festival: FestivalInfo, owners: Owner[]): Promise<boolean> {
  const { rows } = await client.query(
    `
  SELECT
    id,
    artist,
    link_url,
    display_name,
    CASE
      WHEN jsonb_typeof(artists) = 'array' THEN artists
      ELSE '[]'::jsonb
    END AS artists
  FROM
    festival_sets
  WHERE
    festival_id = $1
  FOR UPDATE
`,
    [festival.id],
  );
  const current = new Map(rows.map((r: any) => [r.id, r]));
  return owners.filter((o) => o.kind === 'set').every((o) => {
    const row: any = current.get(o.ownerId);
    return (
      !!row &&
      stable(row.artists) === stable(o.original) &&
      String(row.artist ?? '') === o.flat &&
      (row.link_url ?? null) === o.linkUrl &&
      (row.display_name ?? null) === o.displayName
    );
  });
}

async function writeFestival(client: any, plan: BackfillPlan, festival: FestivalInfo, runId: string) {
  await lockFestivalAny(client, festival.id);
  const { rows } = await client.query('SELECT updated_at::text AS updated_at_text FROM festivals WHERE id = $1', [festival.id]);
  if (rows[0]?.updated_at_text !== festival.updatedAtText) return { skipped: 'changed during the run; run again' as const };

  const owners = plan.changedOwners.filter((o) => o.festival === festival);
  if (!(await setsUnchanged(client, festival, owners))) return { skipped: 'changed during the run; run again' as const };
  const needed = [...new Set(owners.flatMap((o) => o.items.filter((i): i is Elem => !('keep' in i) && !i.leftAlone).map((e) => e.group!)))];
  const fills = await lockRowFills(client, needed.filter((g) => g.fill));
  if (!fills) return { skipped: 'changed during the run; run again' as const };
  const { ids, created } = await materializeGroups(client, needed.filter((g) => !g.existing));
  const idOf = (group: Group) => (ids.has(group) ? ids.get(group)! : (group.actualId ?? null));
  const writes = owners.map((owner) => ({ owner, write: ownerWrite(owner, idOf) })).filter(({ owner, write }) => ownerChanged(owner, write));
  // An inserted group always puts its new id into an element, so created > 0 implies a write here.
  if (writes.length === 0) return { written: false as const, ids, created };

  const sets = writes.filter((w) => w.owner.kind === 'set');
  const lineupChanged = writes.some((w) => w.owner.kind === 'lineup');
  await client.query(
    'INSERT INTO artist_backfill_runs (run_id, festival_id, before) VALUES ($1, $2, $3::jsonb)',
    [runId, festival.id, JSON.stringify(await beforeValues(client, plan, festival, sets.map((w) => w.owner), lineupChanged, fills))],
  );
  for (const fill of fills) {
    await client.query(
      `UPDATE artists SET spotify_id = $2, links = COALESCE(links, '{}'::jsonb) || $3::jsonb, updated_at = now() WHERE id = $1 AND spotify_id IS NULL`,
      [fill.artistId, fill.spotifyId, JSON.stringify(fill.links)],
    );
  }
  for (const { owner, write } of sets) {
    await client.query('UPDATE festival_sets SET artists = $1::jsonb, artist = $2, link_url = $3, display_name = $4 WHERE id = $5', [
      JSON.stringify(write.artists), write.artist, write.linkUrl, write.displayName, owner.ownerId,
    ]);
  }
  const lineup = festival.lineup.map((entry: any) => {
    const hit = writes.find((w) => w.owner.kind === 'lineup' && w.owner.entry === entry);
    return hit ? { ...entry, artists: hit.write.artists, ...(hit.write.displayName ? { displayName: hit.write.displayName } : {}) } : entry;
  });
  await client.query(
    'UPDATE festivals SET lineup = CASE WHEN $2::boolean THEN $3::jsonb ELSE lineup END, updated_at = now(), edited_at = now() WHERE id = $1',
    [festival.id, lineupChanged, JSON.stringify(lineup)],
  );
  return { written: true as const, ids, created };
}

interface RowFill {
  artistId: string;
  spotifyId: string;
  links: Links;
}

/**
 * Locks the existing rows this festival fills, in id order, and checks them against the plan. A row
 * as the plan read it gets its fill. A row an earlier festival of this run filled needs nothing. Any
 * other state, or a Spotify id another artist took meanwhile, returns null: the festival is skipped.
 */
async function lockRowFills(client: any, groups: Group[]): Promise<RowFill[] | null> {
  const fills: RowFill[] = [];
  for (const group of [...groups].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const { rows } = await client.query('SELECT spotify_id, links FROM artists WHERE id = $1 AND merged_into IS NULL FOR UPDATE', [group.id]);
    const row = rows[0];
    const fill = group.fill!;
    if (row?.spotify_id === fill.spotifyId && stable(row.links ?? {}) === stable(rowLinks(group))) continue;
    if (!row || row.spotify_id !== null || stable(row.links ?? {}) !== stable(group.existing!.links ?? {})) return null;
    const { rows: taken } = await client.query('SELECT 1 FROM artists WHERE spotify_id = $1 AND merged_into IS NULL', [fill.spotifyId]);
    if (taken.length > 0) return null;
    fills.push({ artistId: group.id, spotifyId: fill.spotifyId, links: fill.links });
  }
  return fills;
}

async function beforeValues(client: any, plan: BackfillPlan, festival: FestivalInfo, sets: Owner[], lineupChanged: boolean, rowFills: RowFill[]) {
  const festivalOwners = plan.owners.filter((o) => o.festival === festival);
  const elemsOf = (kind: string) => festivalOwners.filter((o) => o.kind === kind);
  const { rows } = await client.query('SELECT count(*)::int AS n FROM festival_sets WHERE festival_id = $1', [festival.id]);
  return {
    sets: Object.fromEntries(sets.map((o) => [o.ownerId, { artists: o.original, artist: o.flat, link_url: o.linkUrl, display_name: o.displayName }])),
    lineup: lineupChanged ? festival.lineup : undefined,
    // Each row this run filled: the Spotify id and links it gained, so a targeted restore can remove them.
    rowFills,
    counts: {
      sets: rows[0].n,
      lineupEntries: elemsOf('lineup').length,
      elements: festivalOwners.reduce((sum, o) => sum + namedOriginal(o), 0),
      splits: plan.report.b2bSplits.filter((s) => s.festivalId === festival.id).reduce((sum, s) => sum + s.parts.length - 1, 0),
      legacyFlat: elemsOf('set').filter((o) => o.legacy).length,
    },
  };
}

export async function applyBackfillPlan(pool: Pool, plan: BackfillPlan, options: { runId?: string } = {}): Promise<ApplyResult> {
  const runId = options.runId ?? createOpaqueId('abr');
  const result: ApplyResult = { runId, festivalsWritten: [], festivalsSkipped: [], artistsCreated: 0, conflicts: [] };
  await pool.query(RESEED_EDITED_AT);
  const festivalIds = new Set(plan.changedOwners.map((o) => o.festival.id));
  for (const festival of plan.festivals.filter((f) => festivalIds.has(f.id))) {
    const outcome = await withTransactionRetry(pool, (client) => writeFestival(client, plan, festival, runId));
    if ('skipped' in outcome) {
      result.festivalsSkipped.push({ festivalId: festival.id, reason: outcome.skipped });
      continue;
    }
    result.artistsCreated += outcome.created;
    for (const [group, id] of outcome.ids) {
      group.actualId = id;
      if (id === null) result.conflicts.push({ festivalId: festival.id, artist: group.name, key: group.key });
    }
    if (outcome.written) result.festivalsWritten.push(festival.id);
  }
  return result;
}

export async function runBackfill(pool: Pool, options: { runId?: string } = {}) {
  const plan = await planBackfill(pool);
  return { plan, apply: await applyBackfillPlan(pool, plan, options) };
}

// ── Verify ─────────────────────────────────────────────────────────────────────────────────────

export interface VerifyCheck {
  name: string;
  ok: boolean;
  details: string[];
}

const namedCount = (artists: any) => (Array.isArray(artists) ? artists.filter((a: any) => typeof a?.name === 'string' && a.name.trim()).length : 0);

async function verifyCounts(pool: Pool, runs: any[]): Promise<VerifyCheck> {
  const details: string[] = [];
  for (const run of runs) {
    const counts = run.before?.counts;
    if (!counts) continue;
    const { rows: sets } = await pool.query(
      `
  SELECT
    count(*)::int AS n,
    count(*) FILTER (
      WHERE
        COALESCE(
          jsonb_array_length(
            CASE
              WHEN jsonb_typeof(artists) = 'array' THEN artists
              ELSE '[]'::jsonb
            END
          ),
          0
        ) = 0
        AND btrim(artist) <> ''
    )::int AS bare
  FROM
    festival_sets
  WHERE
    festival_id = $1
`,
      [run.festival_id],
    );
    const { rows: elems } = await pool.query(
      `SELECT s.artists FROM festival_sets s WHERE s.festival_id = $1 UNION ALL
       SELECT e->'artists' FROM festivals f, jsonb_array_elements(f.lineup) e WHERE f.id = $1`,
      [run.festival_id],
    );
    const total = elems.reduce((sum: number, row: any) => sum + namedCount(row.artists), 0);
    const expected = counts.elements + counts.splits + counts.legacyFlat;
    const { rows: lineup } = await pool.query('SELECT jsonb_array_length(lineup)::int AS n FROM festivals WHERE id = $1', [run.festival_id]);
    if (sets[0].n !== counts.sets) details.push(`${run.festival_id}: ${sets[0].n} sets, expected ${counts.sets}`);
    if (lineup[0].n !== counts.lineupEntries) details.push(`${run.festival_id}: ${lineup[0].n} lineup entries, expected ${counts.lineupEntries}`);
    if (total !== expected) details.push(`${run.festival_id}: ${total} elements, expected ${expected}`);
    if (sets[0].bare > 0) details.push(`${run.festival_id}: ${sets[0].bare} sets have a flat artist and no artists`);
  }
  return { name: 'counts', ok: details.length === 0, details };
}

async function verifyIds(pool: Pool, runs: any[], plan: BackfillPlan): Promise<VerifyCheck> {
  const pick = new Set(plan.report.needsPick.map((p) => `${p.festivalId}|${p.kind}|${p.ownerId}|${p.ordinal}`));
  const live = new Set((await loadArtists(pool)).filter((a) => !a.merged_into).map((a) => a.id));
  const runFestivals = new Set(runs.map((r) => r.festival_id));
  const details: string[] = [];
  for (const owner of plan.owners.filter((o) => runFestivals.has(o.festival.id))) {
    owner.original.forEach((artist: any, ordinal: number) => {
      if (typeof artist?.name !== 'string' || !artist.name.trim()) return;
      if (typeof artist.id === 'string' && live.has(artist.id)) return;
      if (pick.has(`${owner.festival.id}|${owner.kind}|${owner.ownerId}|${ordinal}`)) return;
      details.push(`${owner.festival.id} ${owner.kind} ${owner.ownerId}: "${artist.name}" has no live artist id`);
    });
  }
  return { name: 'ids', ok: details.length === 0, details };
}

/** The three checks of section 5.4. A festival that changed after its run is skipped. */
export async function verifyBackfill(pool: Pool): Promise<{ ok: boolean; checks: VerifyCheck[]; skipped: string[] }> {
  const { rows } = await pool.query(
    `
  SELECT DISTINCT
    ON (r.festival_id) r.run_id,
    r.festival_id,
    r.before,
    r.created_at,
    f.updated_at
  FROM
    artist_backfill_runs r
    JOIN festivals f ON f.id = r.festival_id
  ORDER BY
    r.festival_id,
    r.created_at DESC
`,
  );
  const fresh = rows.filter((r: any) => !r.updated_at || r.updated_at <= r.created_at);
  const skipped = rows.filter((r: any) => !fresh.includes(r)).map((r: any) => r.festival_id);
  const plan = await planBackfill(pool);
  const changes = plan.report.counts.artistsToCreate! + plan.report.counts.ownersToWrite!;
  const checks = [
    await verifyCounts(pool, fresh),
    await verifyIds(pool, fresh, plan),
    { name: 'second dry run', ok: changes === 0, details: changes === 0 ? [] : [`${plan.report.counts.ownersToWrite} owners and ${plan.report.counts.artistsToCreate} artists would change`] },
  ];
  return { ok: checks.every((c) => c.ok), checks, skipped };
}

// ── Safety and report text ─────────────────────────────────────────────────────────────────────

/** The database name the way pg reads it, so the guard and the connection cannot disagree. */
export function backfillDatabaseName(databaseUrl: string): string {
  try {
    const { protocol } = new URL(databaseUrl);
    if (protocol !== 'postgres:' && protocol !== 'postgresql:') return '';
    return new Client({ connectionString: databaseUrl }).database ?? '';
  } catch {
    return '';
  }
}

/** The backfill rewrites every set. It runs only on a test or staging database. */
export function assertSafeBackfillDatabase(databaseUrl: string): void {
  const name = backfillDatabaseName(databaseUrl);
  if (!/_(?:test|staging)$/.test(name)) {
    throw new Error(
      `Refusing to run the artist backfill on database "${name}": the name must end in _test or _staging. Point ARTIST_BACKFILL_DATABASE_URL at a private test or staging database.`,
    );
  }
}

const csvCell = (value: unknown) => `"${String(typeof value === 'object' ? JSON.stringify(value) : (value ?? '')).replace(/"/g, '""')}"`;

/** One row per report entry: list, then the entry as JSON. */
export function reportToCsv(report: BackfillReport): string {
  const rows = ['list,entry'];
  for (const [list, entries] of Object.entries(report)) {
    if (list === 'counts') continue;
    for (const entry of entries as unknown[]) rows.push(`${csvCell(list)},${csvCell(entry)}`);
  }
  return `${rows.join('\n')}\n`;
}
