// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Admin artist routes (/admin/artists): the Artists screen and the set editor's picker.
 * An edit changes every festival that lists the artist, past ones too. Shared by web and mobile.
 */

import { api, ApiClientError } from './api';

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
}

export interface AdminArtistRow extends AdminArtist {
  /** Other festivals that list the artist, archived ones left out. */
  alsoOn: number;
  /** Another live artist has the same name. */
  sameName: boolean;
  linkCount: number;
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
