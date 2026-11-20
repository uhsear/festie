// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Admin artist routes (/admin/artists): the Artists screen and the set editor's picker.
 * An edit changes every festival that lists the artist, past ones too. Shared by web and mobile.
 */

import { api, ApiClientError } from './api';
import type { BackfillReportInput } from '../utils/artistBackfillReview';

export interface AdminArtist {
  id: string;
  name: string;
  /** The note that tells same-name artists apart. Empty when there is none. */
  label: string;
  links: Record<string, string>;
  photo: string | null;
  genres: string[];
  spotifyId: string | null;
  /** The edit token: send it back as `expectedUpdatedAt`. */
  updatedAt: string;
  /** An artist an organizer created stays unverified until an admin verifies it (POST /admin/artists/:id/verify). */
  verified?: boolean;
  /** The server chose the note ("unnamed 1") because the name and note clashed with an artist the creator could not see. */
  labelAuto?: boolean;
}

export interface AdminArtistRow extends AdminArtist {
  /** Other festivals that list the artist, archived ones left out. */
  alsoOn: number;
  /** Another live artist has the same name. */
  sameName: boolean;
  linkCount: number;
  /** Only in the "Possible duplicates" list: the ids of the artists this one may duplicate. */
  duplicateOf?: string[];
}

export interface ArtistCandidate {
  id: string;
  name: string;
  label: string;
  photo: string | null;
  platforms: string[];
  lastFestival: { id: string; name: string } | null;
}

export type ArtistMatchOutcome = 'linked' | 'pick' | 'new';

export interface ArtistMatchResult {
  name: string;
  outcome: ArtistMatchOutcome;
  candidates: ArtistCandidate[];
}

export interface ArtistChanges {
  name?: string;
  label?: string;
  /** One raw link. The server detects the platform from the host and cleans it. */
  addLink?: string;
  /** Platform keys to remove. */
  removeLinks?: string[];
}

export interface ArtistImpactFestival {
  id: string;
  name: string;
  published: boolean;
  archived: boolean;
  firstDate: string | null;
}

export interface SpotifyCandidate {
  spotifyId: string;
  spotifyUrl: string;
  name: string;
  imageUrl: string | null;
  followers: number | null;
  genres: string[];
  /** The name equals the artist's name. */
  exact: boolean;
  /** Another artist already holds this Spotify id, for example "Avello (NL)". The candidate cannot be picked. */
  linkedTo: string | null;
}

export interface SpotifyCandidateRow {
  artist: AdminArtistRow;
  candidates: SpotifyCandidate[];
  /** Exactly one candidate has the exact name, no other artist holds it, and no other artist has the name. */
  singleExact: boolean;
}

export interface SpotifyCandidatesResult {
  artists: SpotifyCandidateRow[];
  /** Artists without a Spotify link that this run left out. Run it again after the editor links or skips these. */
  notSearched: number;
  /** Artists whose search Spotify refused. They show no candidates: try again. */
  searchFailed: number;
}

export type SpotifyPickStatus = 'saved' | 'shared' | 'changed' | 'taken' | 'unavailable' | 'error';

export interface SpotifyPickResult {
  artistId: string;
  status: SpotifyPickStatus;
  message?: string;
  /** `shared`: the other festivals that list the artist, past and archived ones too. */
  alsoOn?: number;
  /** `saved`: the stored artist. `changed`: the current artist. */
  artist?: AdminArtist;
  festivalsUpdated?: number;
}

export interface SpotifyPick {
  artistId: string;
  expectedUpdatedAt: string;
  spotifyId: string;
  /** The number of other festivals the editor confirmed with "Change everywhere". The server counts again under its locks. */
  acceptedAlsoOn?: number;
}

export type MergeSide = 'survivor' | 'loser';

/** Per field, which artist's value the merged artist keeps. A field that is not listed keeps the survivor's. */
export interface ArtistMergePick {
  name?: MergeSide;
  label?: MergeSide;
  photo?: MergeSide;
  genres?: MergeSide;
  /** By platform key. A platform the picked side lacks takes the other side's link. */
  links?: Record<string, MergeSide>;
}

export interface ArtistMergeCounts {
  festivals: number;
  sets: number;
  lineupEntries: number;
}

export interface ArtistUse {
  festivals: ArtistImpactFestival[];
  counts: { sets: number; lineupEntries: number };
}

export const ARTIST_CHANGED = 'ARTIST_CHANGED';
export const ARTIST_EXISTS = 'ARTIST_EXISTS';

export async function listFestivalArtists(festivalId: string): Promise<AdminArtistRow[]> {
  const data = await api.get<{ artists: AdminArtistRow[] }>(`/admin/artists?festivalId=${encodeURIComponent(festivalId)}`);
  return data.artists;
}

export async function searchArtists(query: string): Promise<AdminArtistRow[]> {
  const data = await api.get<{ artists: AdminArtistRow[] }>(`/admin/artists?q=${encodeURIComponent(query)}`);
  return data.artists;
}

/** Matches names (and optional Spotify links) against live artists in one call. */
export async function matchArtists(items: Array<{ name: string; spotify?: string | null }>): Promise<ArtistMatchResult[]> {
  const data = await api.post<{ results: ArtistMatchResult[] }>('/admin/artists/match', { items });
  return data.results;
}

export async function createArtist(input: { name: string; label?: string; link?: string }): Promise<AdminArtist> {
  const data = await api.post<{ artist: AdminArtist }>('/admin/artists', input);
  return data.artist;
}

export async function updateArtist(
  id: string,
  expectedUpdatedAt: string,
  changes: ArtistChanges,
): Promise<{ artist: AdminArtist; festivalsUpdated: number }> {
  return api.patch(`/admin/artists/${encodeURIComponent(id)}`, { expectedUpdatedAt, changes });
}

export async function getArtistImpact(id: string): Promise<ArtistImpactFestival[]> {
  const data = await api.get<{ festivals: ArtistImpactFestival[] }>(`/admin/artists/${encodeURIComponent(id)}/impact`);
  return data.festivals;
}

/** Where the artist plays: the festivals (archived ones marked) and the number of sets and announced-lineup entries. */
export async function getArtistUse(id: string): Promise<ArtistUse> {
  return api.get<ArtistUse>(`/admin/artists/${encodeURIComponent(id)}/impact`);
}

/** Admin, web only: artists that share a name key (they differ by note) or have keys one character apart. */
export async function listDuplicateArtists(): Promise<AdminArtistRow[]> {
  const data = await api.get<{ artists: AdminArtistRow[] }>('/admin/artists?duplicates=true&limit=1000');
  return data.artists;
}

/**
 * Merges `loser` into `survivor`. Needs a recent re-auth: run it through `withReauth`. `acceptedFestivals`
 * is the festival count the editor saw (see `mergeFestivalCount`); the server counts again and refuses a higher one.
 */
export async function mergeArtists(
  survivor: Pick<AdminArtist, 'id' | 'updatedAt'>,
  loser: Pick<AdminArtist, 'id' | 'updatedAt'>,
  options: { pick: ArtistMergePick; acceptedFestivals: number },
): Promise<{ artist: AdminArtist; loserId: string; counts: ArtistMergeCounts }> {
  return api.post(`/admin/artists/${encodeURIComponent(survivor.id)}/merge`, {
    loserId: loser.id,
    survivorUpdatedAt: survivor.updatedAt,
    loserUpdatedAt: loser.updatedAt,
    acceptedFestivals: options.acceptedFestivals,
    pick: options.pick,
  });
}

/** Distinct festivals that list either artist: the count a merge asks the editor to accept. */
export function mergeFestivalCount(a: ArtistUse, b: ArtistUse): number {
  return new Set([...a.festivals, ...b.festivals].map((festival) => festival.id)).size;
}

/** "Moves 4 appearances on 3 festivals from 'A' to 'B'. This cannot be undone. ..." */
export function mergePreviewText(loser: { name: string; label?: string }, survivor: { name: string; label?: string }, use: ArtistUse): string {
  const appearances = use.counts.sets + use.counts.lineupEntries;
  const festivals = use.festivals.length;
  return (
    `Moves ${appearances} ${appearances === 1 ? 'appearance' : 'appearances'} on ${festivals} ${festivals === 1 ? 'festival' : 'festivals'} ` +
    `from '${artistTitle(loser)}' to '${artistTitle(survivor)}'. This cannot be undone. ` +
    'To split them later, re-pick the artist on each set.'
  );
}

/** The top 3 Spotify candidates for each artist on the festival that has no Spotify link, except the `exclude` ids. Writes nothing. */
export function findSpotifyCandidates(festivalId: string, exclude: string[] = []): Promise<SpotifyCandidatesResult> {
  return api.post<SpotifyCandidatesResult>(
    '/admin/artists/spotify-candidates',
    { festivalId, ...(exclude.length > 0 ? { exclude } : {}) },
    { timeoutMs: 120_000 },
  );
}

/** Stores the picks the editor made. Each pick answers on its own row. */
export async function pickSpotifyCandidates(festivalId: string, picks: SpotifyPick[]): Promise<SpotifyPickResult[]> {
  const data = await api.post<{ results: SpotifyPickResult[] }>('/admin/artists/spotify-picks', { festivalId, picks }, { timeoutMs: 120_000 });
  return data.results;
}

export interface SpotifyRefreshResult {
  updated: number;
  skipped: number;
  unavailable: number;
  results: Array<{ artistId: string; status: 'updated' | 'skipped' | 'unavailable' | 'error' }>;
}

/** Fills the photo and genres that linked artists lack, from Spotify. Never replaces what an admin set. */
export function refreshSpotifyDetails(festivalId: string): Promise<SpotifyRefreshResult> {
  return api.post<SpotifyRefreshResult>('/admin/artists/spotify-refresh', { festivalId }, { timeoutMs: 120_000 });
}

/** "1.2M followers". Null when Spotify gave no count. */
export function followersText(followers: number | null): string | null {
  if (followers === null) return null;
  // Pick the unit after rounding to a tenth, so 999,950 reads 1M, not 1000K.
  const short =
    Math.round(followers / 100) >= 10_000
      ? `${+(followers / 1_000_000).toFixed(1)}M`
      : followers >= 1_000
        ? `${+(followers / 1_000).toFixed(1)}K`
        : String(followers);
  return `${short} ${followers === 1 ? 'follower' : 'followers'}`;
}

/** The current artist that the server sent with a 409 ARTIST_CHANGED, or null for any other error. */
export function changedArtistFrom(error: unknown): AdminArtist | null {
  if (!(error instanceof ApiClientError) || error.code !== ARTIST_CHANGED) return null;
  return (error.details?.artist as AdminArtist | undefined) ?? null;
}

/** "Avello is also on 2 festivals, including past ones. Change it everywhere?" */
export function changeEverywhereText(name: string, others: number): string {
  return `${name} is also on ${others} ${others === 1 ? 'festival' : 'festivals'}, including past ones. Change it everywhere?`;
}

/** "Avello (NL)": the name with its note. */
export function artistTitle(artist: { name: string; label?: string }): string {
  return artist.label ? `${artist.name} (${artist.label})` : artist.name;
}

export type ArtistBackfillMode = 'dry-run' | 'run' | 'verify';

export interface ArtistBackfillVerify {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; details?: unknown }>;
  skipped: unknown[];
}

export interface ArtistBackfillRunResult {
  runId: string;
  festivalsWritten: string[] | number;
  festivalsSkipped: unknown[] | number;
  artistsCreated: number;
  conflicts: unknown[] | number;
}

export interface ArtistBackfillResponse {
  mode: ArtistBackfillMode;
  report?: BackfillReportInput;
  planHash?: string;
  result?: ArtistBackfillVerify | ArtistBackfillRunResult;
}

/**
 * The artist id backfill (POST /admin/artists/backfill). `dry-run` and `verify` write nothing. `run` writes, needs a
 * recent re-auth (run it through `withReauth`) and refuses with 409 PLAN_CHANGED when `planHash` no longer matches.
 */
export async function runArtistBackfill(mode: ArtistBackfillMode, planHash?: string): Promise<ArtistBackfillResponse> {
  return api.post('/admin/artists/backfill', { mode, ...(planHash && { planHash }) });
}
