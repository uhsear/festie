import type { Artist, FestivalSet } from '../types/domain';
import { artistDisplayName } from './format';

/** What the artist sheet shows: a title plus the artists under it. `entryId` adds the Interested toggle for an announced act. */
export interface ArtistSheetTarget {
  title: string;
  artists: Artist[];
  entryId?: string;
}

/** One tappable piece of a set's billed name. */
export interface ArtistNameSegment {
  label: string;
  target: ArtistSheetTarget;
}

const trim = (s: string) => s.trim();

/** A target for a bare name, such as a row that only carries the artist string. */
export function artistTargetFromName(name: string): ArtistSheetTarget {
  const title = trim(name) || 'Unknown';
  return { title, artists: [{ name: title }] };
}

/**
 * The tappable pieces of a set's name. A B2B set whose shown name is just its artists joined splits into one
 * piece per artist, each with its own sheet. A billed name (displayName or a differing set.artist) stays one
 * piece that opens a sheet listing every artist.
 */
export function artistNameSegments(set: FestivalSet, separator?: string): ArtistNameSegment[] {
  const shown = artistDisplayName(set, separator);
  const artists = set.artists?.filter((a) => trim(a.name)) ?? [];
  const sep = separator || 'b2b';
  if (artists.length > 1 && shown === artists.map((a) => a.name).join(` ${sep} `)) {
    return artists.map((a) => ({ label: a.name, target: { title: a.name, artists: [a] } }));
  }
  return [{ label: shown, target: { title: shown, artists: artists.length ? artists : [{ name: shown }] } }];
}

/**
 * Fills photo, genres and links for artists the caller only knew by name, from the sets already
 * loaded. An artist that already has any of them is left as given.
 */
export function enrichArtistTarget(target: ArtistSheetTarget, sets: readonly FestivalSet[]): ArtistSheetTarget {
  if (target.artists.every((a) => a.photo || a.genres?.length || (a.links && Object.keys(a.links).length))) return target;
  const known = new Map<string, Artist>();
  for (const s of sets) for (const a of s.artists ?? []) if (!known.has(a.name.toLowerCase())) known.set(a.name.toLowerCase(), a);
  return {
    ...target,
    artists: target.artists.map((a) => {
      if (a.photo || a.genres?.length || (a.links && Object.keys(a.links).length)) return a;
      return known.get(a.name.toLowerCase()) ?? a;
    }),
  };
}
