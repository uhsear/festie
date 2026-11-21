import type { Artist, FestivalSet, LineupEntry } from '../types/domain';
import { artistDisplayName } from './format';
import { lineupEntryName } from './lineup';

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
 * The tappable pieces of an announced-lineup act, split like `artistNameSegments`. A single piece carries the
 * entry id only for an announced act, because the sheet's Interested toggle makes no sense for a scheduled or
 * cancelled one.
 */
export function lineupEntrySegments(entry: LineupEntry, separator: string | undefined, announced: boolean): ArtistNameSegment[] {
  const shown = lineupEntryName(entry, separator);
  const sep = separator || 'b2b';
  if (entry.artists.length > 1 && shown === entry.artists.map((a) => a.name).join(` ${sep} `)) {
    return entry.artists.map((a) => ({ label: a.name, target: { title: a.name, artists: [a] } }));
  }
  return [{ label: shown, target: { title: shown, artists: entry.artists, ...(announced ? { entryId: entry.id } : {}) } }];
}

const hasDetails = (a: Artist) => !!(a.photo || a.genres?.length || (a.links && Object.keys(a.links).length));

/**
 * Fills photo, genres and links for artists the caller only knew by name, from the sets already
 * loaded. An artist that already has any of them is left as given. An artist with an id is matched by id
 * only, so two artists who share a name never borrow each other's links.
 */
export function enrichArtistTarget(target: ArtistSheetTarget, sets: readonly FestivalSet[]): ArtistSheetTarget {
  if (target.artists.every(hasDetails)) return target;
  const byName = new Map<string, Artist>();
  const byId = new Map<string, Artist>();
  for (const s of sets) {
    for (const a of s.artists ?? []) {
      if (a.id && !byId.has(a.id)) byId.set(a.id, a);
      if (!byName.has(a.name.toLowerCase())) byName.set(a.name.toLowerCase(), a);
    }
  }
  return {
    ...target,
    artists: target.artists.map((a) => {
      if (hasDetails(a)) return a;
      if (a.id) return byId.get(a.id) ?? a;
      return byName.get(a.name.toLowerCase()) ?? a;
    }),
  };
}
